// Measuring tool: click two points anywhere in the scene and get the distance between them,
// split into along/out from wall 1 and height (or X/Z/height without a room).
//
// Points snap to useful places: the open ends' centres, corners of parts, walls, holes, pipes and
// ladders, and otherwise to the surface under the mouse (or the floor). Hold Shift to measure
// straight along one direction. Measurements are saved in the room, shown in the 3D view and in
// a small list, and can be deleted.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { AssemblyController } from './assembly/controller';
import { wallFrame } from './room/model';
import { newId, type Measure, type Store } from './store';
import type { Viewer } from './viewer';

/** Snap to a corner or end centre within this many screen pixels. */
const SNAP_PX = 14;
const ACCENT = 0x0b7285;

type V3 = [number, number, number];
interface Snap {
  p: THREE.Vector3;
  kind: 'end' | 'corner' | 'surface' | 'floor';
}

const SNAP_LABEL: Record<Snap['kind'], string> = {
  end: 'Ändens mitt',
  corner: 'Hörn',
  surface: 'Yta',
  floor: 'Golv',
};

/** The directions a measurement is split along: wall 1 of the room, or the world axes. */
function axesFor(store: Store): { a: THREE.Vector3; b: THREE.Vector3; names: [string, string] } {
  const room = store.project.room;
  const f = room && room.points.length >= 2 ? wallFrame(room, 0) : null;
  if (f) {
    return {
      a: new THREE.Vector3(f.right.x, 0, f.right.z),
      b: new THREE.Vector3(f.inward.x, 0, f.inward.z),
      names: ['längs vägg 1', 'ut från vägg 1'],
    };
  }
  return { a: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 0, 1), names: ['X', 'Z'] };
}

/** Total length and the three parts of a measurement, mm. */
export function measureParts(store: Store, m: Measure) {
  const d = new THREE.Vector3(...m.b).sub(new THREE.Vector3(...m.a));
  const ax = axesFor(store);
  return {
    total: Math.round(d.length()),
    along: Math.round(Math.abs(d.dot(ax.a))),
    out: Math.round(Math.abs(d.dot(ax.b))),
    height: Math.round(Math.abs(d.y)),
    names: ax.names,
  };
}

/** Saved measurements as lines with a length label (drawn with the assembly). */
export function buildMeasureGroup(store: Store): THREE.Group {
  const g = new THREE.Group();
  g.name = 'measures';
  g.userData.noPick = true;
  (store.project.measures ?? []).forEach((m, i) => {
    const part = drawMeasure(new THREE.Vector3(...m.a), new THREE.Vector3(...m.b), `M${i + 1}`, `${measureParts(store, m).total}`);
    part.userData.helper = true; // hidden with the Labels button
    g.add(part);
  });
  return g;
}

const lineMat = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true });
const dotMat = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true });
const dotGeo = new THREE.SphereGeometry(1, 16, 12);

function drawMeasure(a: THREE.Vector3, b: THREE.Vector3, tag: string, text: string): THREE.Group {
  const g = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat);
  line.renderOrder = 30;
  line.raycast = () => {};
  g.add(line);
  const r = Math.max(12, a.distanceTo(b) / 120);
  for (const p of [a, b]) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.scale.setScalar(Math.min(r, 25));
    dot.position.copy(p);
    dot.renderOrder = 30;
    dot.raycast = () => {};
    g.add(dot);
  }
  const el = document.createElement('div');
  el.className = 'measure-label';
  if (tag) {
    const f = document.createElement('span');
    f.className = 'dim-field';
    f.textContent = tag;
    el.append(f);
  }
  el.append(text);
  const lbl = new CSS2DObject(el);
  el.style.pointerEvents = 'none'; // (CSS2DObject turns them on) – don't block clicks while measuring
  lbl.center.set(0.5, 1.35); // just above the line, clear of the detail badges
  lbl.position.copy(a).lerp(b, 0.5);
  g.add(lbl);
  return g;
}

export interface MeasureUi {
  panel: HTMLElement;
  button: HTMLButtonElement;
  /** Redraw the scene (after a measurement is added or removed). */
  redraw: () => void;
  /** The tool was switched on or off. */
  onToggle: (on: boolean) => void;
}

export class MeasureController {
  active = false;
  private start: THREE.Vector3 | null = null;
  private live = new THREE.Group();
  private store: Store;
  private viewer: Viewer;
  private asm: AssemblyController;
  private ui: MeasureUi;

  constructor(store: Store, viewer: Viewer, asm: AssemblyController, ui: MeasureUi) {
    this.store = store;
    this.viewer = viewer;
    this.asm = asm;
    this.ui = ui;
    this.live.name = 'measure-live';
    viewer.overlay.add(this.live);
    ui.button.addEventListener('click', () => this.toggle());
    ui.panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-measure]');
      if (!btn) return;
      if (btn.dataset.measure === 'clear') {
        this.store.update((p) => (p.measures = []));
      } else if (btn.dataset.measure === 'del') {
        this.store.update((p) => (p.measures = (p.measures ?? []).filter((m) => m.id !== btn.dataset.id)));
      } else if (btn.dataset.measure === 'done') {
        this.toggle(false);
        return;
      }
      this.ui.redraw();
      this.render();
    });
  }

  toggle(on = !this.active) {
    this.active = on;
    this.start = null;
    this.clearLive();
    document.body.classList.toggle('measuring', on);
    this.ui.onToggle(on);
    this.render();
  }

  /** Esc stops; returns true when the key was used. */
  onKey(e: KeyboardEvent): boolean {
    if (!this.active || e.key !== 'Escape') return false;
    if (this.start) {
      this.start = null;
      this.clearLive();
      this.render();
    } else this.toggle(false);
    return true;
  }

  onMove(ray: THREE.Ray, shift: boolean) {
    if (!this.active) return;
    const s = this.snap(ray);
    this.clearLive();
    if (!s) return;
    const p = this.start && shift ? this.straighten(this.start, s.p) : s.p;
    // Marker where the point would go
    const ring = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: s.kind === 'surface' || s.kind === 'floor' ? 0x868e96 : ACCENT, depthTest: false, transparent: true, opacity: 0.85 }));
    ring.scale.setScalar(this.viewer.mmPerPixel(p) * 5);
    ring.position.copy(p);
    ring.renderOrder = 31;
    this.live.add(ring);
    if (this.start) {
      const m: Measure = { id: '', a: this.start.toArray() as V3, b: p.toArray() as V3 };
      const parts = measureParts(this.store, m);
      this.live.add(drawMeasure(this.start, p, '', `${parts.total} mm`));
      (this.live.children.at(-1)!.children.at(-1) as CSS2DObject).element.classList.add('measure-label--live');
    } else {
      const el = document.createElement('div');
      el.className = 'measure-snap';
      el.textContent = SNAP_LABEL[s.kind];
      const lbl = new CSS2DObject(el);
      el.style.pointerEvents = 'none';
      lbl.position.copy(p);
      lbl.center.set(-0.15, 1.3);
      this.live.add(lbl);
    }
  }

  onClick(ray: THREE.Ray, shift: boolean) {
    if (!this.active) return;
    const s = this.snap(ray);
    if (!s) return;
    if (!this.start) {
      this.start = s.p.clone();
      this.render();
      return;
    }
    const p = shift ? this.straighten(this.start, s.p) : s.p;
    if (p.distanceTo(this.start) < 1) return;
    const m: Measure = { id: newId(), a: round(this.start), b: round(p) };
    this.start = null;
    this.clearLive();
    this.store.update((proj) => (proj.measures ??= []).push(m));
    this.ui.redraw();
    this.render();
  }

  /** Keep only the biggest of the three directions (Shift: measure straight). */
  private straighten(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
    const ax = axesFor(this.store);
    const d = b.clone().sub(a);
    const parts = [
      { v: ax.a, n: d.dot(ax.a) },
      { v: ax.b, n: d.dot(ax.b) },
      { v: new THREE.Vector3(0, 1, 0), n: d.y },
    ].sort((x, y) => Math.abs(y.n) - Math.abs(x.n));
    return a.clone().addScaledVector(parts[0].v, parts[0].n);
  }

  /** What the mouse is over: an end centre, a corner, a surface, or the floor. */
  private snap(ray: THREE.Ray): Snap | null {
    const root = this.viewer.modelRoot;
    if (!root) return null;
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const isShown = (o: THREE.Object3D | null): boolean => !o || (o.visible && isShown(o.parent));
    const skip = (o: THREE.Object3D | null): boolean => !!o && (o.userData.port || o.userData.helper || o.name === 'measures' || skip(o.parent));
    const hit = caster
      .intersectObject(root, true)
      .find((h) => (h.object as THREE.Mesh).isMesh && h.face && isShown(h.object) && !skip(h.object));

    const near = hit?.point ?? null;
    let best: { p: THREE.Vector3; kind: Snap['kind']; d: number } | null = null;
    const consider = (p: THREE.Vector3, kind: Snap['kind']) => {
      // Distance from the mouse ray, compared in screen pixels at that depth
      const d = ray.distanceToPoint(p) / this.viewer.mmPerPixel(p);
      if (d <= SNAP_PX && (!best || d < best.d)) best = { p: p.clone(), kind, d };
    };
    // Open ends' centres
    for (const part of this.asm.layout?.parts ?? []) for (const w of part.ports) consider(w.position, 'end');
    // Corners of the triangle under the mouse
    if (hit?.face) {
      const mesh = hit.object as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position');
      for (const i of [hit.face.a, hit.face.b, hit.face.c]) consider(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), 'corner');
    }
    if (best) return { p: (best as { p: THREE.Vector3 }).p, kind: (best as { kind: Snap['kind'] }).kind };
    if (near) return { p: near.clone(), kind: 'surface' };
    // Nothing under the mouse: the floor
    const floorY = this.store.project.room?.floorY ?? this.asm.assemblyFloorY();
    const p = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), new THREE.Vector3());
    return p ? { p, kind: 'floor' } : null;
  }

  private clearLive() {
    for (const c of [...this.live.children]) {
      c.removeFromParent();
      c.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
        if ((o as THREE.Line).isLine) (o as THREE.Line).geometry.dispose();
      });
    }
  }

  /** The list of measurements (bottom left of the 3D view). */
  render() {
    const panel = this.ui.panel;
    const list = this.store.project.measures ?? [];
    this.ui.button.classList.toggle('is-active', this.active);
    this.ui.button.setAttribute('aria-pressed', String(this.active));
    panel.hidden = !this.active && list.length === 0;
    if (panel.hidden) return;
    const head = document.createElement('div');
    head.className = 'measure-panel__head';
    const title = document.createElement('strong');
    title.textContent = 'Mätningar';
    head.append(title);
    if (list.length) head.append(button('clear', 'Rensa alla'));
    if (this.active) head.append(button('done', 'Klar'));
    const rows = list.map((m, i) => {
      const parts = measureParts(this.store, m);
      const row = document.createElement('div');
      row.className = 'measure-row';
      const main = document.createElement('div');
      main.innerHTML = `<b>M${i + 1}</b> ${parts.total} mm`;
      const sub = document.createElement('small');
      sub.textContent = `${parts.names[0]} ${parts.along} · ${parts.names[1]} ${parts.out} · höjd ${parts.height}`;
      main.append(sub);
      const del = button('del', '×', m.id);
      del.title = 'Ta bort mätningen';
      row.append(main, del);
      return row;
    });
    const hint = document.createElement('p');
    hint.className = 'measure-hint';
    hint.textContent = this.active
      ? this.start
        ? 'Klicka på andra punkten. Håll Skift för att mäta rakt. Esc avbryter.'
        : 'Klicka på första punkten – den fäster vid ändar och hörn.'
      : '';
    panel.replaceChildren(head, ...rows, ...(hint.textContent ? [hint] : []));
  }
}

function round(v: THREE.Vector3): V3 {
  return [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
}

function button(act: string, text: string, id?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.measure = act;
  if (id) b.dataset.id = id;
  b.textContent = text;
  return b;
}
