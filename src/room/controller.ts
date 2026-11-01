// The Room tab: draw walls in the plan, then edit lengths and room settings, mark openings,
// draw pipes and cable ladders, and place the assembly in the room.
//
// Drawing walls: click points on the floor. The wall being drawn shows its length; type a number
// and press Enter to set it exactly. Click the first point to close the room (floor and roof are
// added), double-click or press Enter to stop with an open run of walls, Esc to stop,
// Backspace to take back the last point.
//
// Pipes and ladders are drawn the same way, as one straight run: click the start, then the end
// (or type the length). Ends near a wall snap onto its inside face.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { AssemblyController } from '../assembly/controller';
import { newId, type Store } from '../store';
import type { Viewer } from '../viewer';
import { assemblyCorners } from './collide';
import {
  distanceFromWall,
  LADDER_DEFAULT,
  openingName,
  PIPE_DEFAULT,
  PIPE_TYPES,
  ROOM_DEFAULTS,
  runLength,
  runName,
  runWallGaps,
  segments,
  setWallLength,
  toP,
  wallFaces,
  wallFrame,
  type Opening,
  type P,
  type PipeType,
  type Room,
  type Run,
} from './model';

/** Snap step for points and lengths, mm. */
const GRID = 50;
/** Snap step for pipe/ladder lengths, mm. */
const RUN_GRID = 10;
/** Walls within this many degrees of a 45° step snap to it. */
const ANGLE_SNAP = 7;
/** Clicking within this many screen pixels of the first point closes the room. */
const CLOSE_PX = 14;
/** Pipe/ladder ends within this many screen pixels of a wall snap onto it. */
const WALL_SNAP_PX = 16;

export interface RoomUi {
  panel: HTMLElement;
  /** Called after the room changes, so the 3D view is redrawn. */
  redraw: (fit?: boolean) => void;
}

type Cursor = P & { closing?: boolean };

export class RoomController {
  drawing = false;
  /** Waiting for a click on a wall or the roof to place a new opening. */
  private placingOpening = false;
  /** Drawing a pipe or ladder: the start point once it's clicked. */
  private runDraw: { kind: Run['kind']; start: P | null } | null = null;
  /** Move mode: dragging the assembly moves it around the room. */
  private moving = false;
  private drag: { from: THREE.Vector3; plane: THREE.Plane; delta: P } | null = null;
  private cursor: Cursor | null = null;
  private typed = '';
  private lastOpening = { shape: 'rect' as Opening['shape'], w: 500, h: 500 };
  private lastRun: Record<Run['kind'], { size: number; h: number; y: number | null; pipeType: PipeType }> = {
    pipe: { size: PIPE_DEFAULT.size, h: 0, y: null, pipeType: 'varme' },
    ladder: { size: LADDER_DEFAULT.size, h: LADDER_DEFAULT.h, y: null, pipeType: 'ovrigt' },
  };
  private store: Store;
  private viewer: Viewer;
  private asm: AssemblyController;
  private ui: RoomUi;

  constructor(store: Store, viewer: Viewer, asm: AssemblyController, ui: RoomUi) {
    this.store = store;
    this.viewer = viewer;
    this.asm = asm;
    this.ui = ui;
    ui.panel.addEventListener('click', (e) => this.onPanelClick(e));
    ui.panel.addEventListener('change', (e) => this.onPanelChange(e));
  }

  private get room(): Room | undefined {
    return this.store.project.room;
  }

  /** Any click-in-the-scene mode active (walls, pipe, opening)? */
  private get busy(): boolean {
    return this.drawing || this.placingOpening || !!this.runDraw;
  }

  // ---------- Drawing walls ----------

  start() {
    this.cancelModes();
    const old = this.room;
    this.store.update((p) => {
      p.room = {
        ...ROOM_DEFAULTS,
        ...(old ? { height: old.height, thickness: old.thickness, floor: old.floor, roof: old.roof, seeThrough: old.seeThrough } : {}),
        floorY: old?.floorY ?? this.asm.assemblyFloorY(),
        points: [],
        closed: false,
        // Pipes and ladders stay where they are; openings belong to the old walls
        runs: old?.runs ?? [],
        openings: [],
      };
    });
    this.drawing = true;
    this.typed = '';
    this.cursor = null;
    document.body.classList.add('room-drawing');
    this.viewer.setView('top');
    this.ui.redraw();
    this.render();
  }

  /** Stop whatever is going on (drawing walls or a pipe, placing an opening, moving). */
  stop() {
    const wasDrawing = this.drawing;
    this.cancelModes();
    if (wasDrawing && this.room && this.room.points.length < 2) {
      this.store.update((p) => {
        delete p.room;
      });
    }
    this.ui.redraw();
    this.render();
  }

  private cancelModes() {
    this.drawing = false;
    this.placingOpening = false;
    this.runDraw = null;
    this.moving = false;
    this.drag = null;
    this.typed = '';
    this.cursor = null;
    document.body.classList.remove('room-drawing', 'room-moving');
    this.clearPreview();
  }

  /** Where the mouse ray meets the floor. */
  private floorPoint(ray: THREE.Ray): P | null {
    const y = this.room?.floorY ?? 0;
    const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  private pxAt(pt: P): number {
    return this.viewer.mmPerPixel(new THREE.Vector3(pt.x, this.room?.floorY ?? 0, pt.z));
  }

  /** Snap to the grid, to 45° steps from the last point, and to the first point (to close). */
  private snap(raw: P): Cursor {
    const pts = this.room?.points.map(toP) ?? [];
    if (pts.length >= 3) {
      const first = pts[0];
      if (Math.hypot(raw.x - first.x, raw.z - first.z) < CLOSE_PX * this.pxAt(first)) return { ...first, closing: true };
    }
    const round = (v: number) => Math.round(v / GRID) * GRID;
    const last = pts.at(-1);
    if (!last) return { x: round(raw.x), z: round(raw.z) };
    return angleSnap(last, raw, GRID);
  }

  onMove(ray: THREE.Ray) {
    if (!this.drawing && !this.runDraw) return;
    const raw = this.floorPoint(ray);
    if (!raw) return;
    this.cursor = this.drawing ? this.snap(raw) : this.snapRun(raw);
    this.updatePreview();
  }

  onClick(ray: THREE.Ray) {
    if (this.placingOpening) {
      this.placeOpeningAt(ray);
      return;
    }
    if (this.runDraw) {
      const raw = this.floorPoint(ray);
      if (raw) this.runPoint(this.snapRun(raw));
      return;
    }
    if (!this.drawing) return;
    const raw = this.floorPoint(ray);
    if (!raw) return;
    const pt = this.snap(raw);
    if (pt.closing) {
      this.close();
      return;
    }
    this.addPoint(pt);
  }

  onDoubleClick() {
    if (this.drawing) this.stop();
  }

  private addPoint(pt: P) {
    const last = this.room?.points.at(-1);
    if (last && Math.hypot(last[0] - pt.x, last[1] - pt.z) < 1) return; // same spot (double-click)
    this.store.update((p) => {
      p.room!.points.push([Math.round(pt.x), Math.round(pt.z)]);
    });
    this.typed = '';
    this.ui.redraw();
    this.updatePreview();
    this.render();
  }

  private close() {
    if ((this.room?.points.length ?? 0) < 3) return;
    this.store.update((p) => {
      p.room!.closed = true;
    });
    this.drawing = false;
    document.body.classList.remove('room-drawing');
    this.clearPreview();
    this.ui.redraw(true);
    this.render();
  }

  /** Keys while drawing or placing. Returns true when the key was used. */
  onKey(e: KeyboardEvent): boolean {
    if (!this.busy && !this.moving) return false;
    if (e.key === 'Escape') {
      this.stop();
      return true;
    }
    if (this.placingOpening || this.moving) return false;
    if (/^[0-9]$/.test(e.key)) {
      this.typed = (this.typed + e.key).slice(0, 6);
    } else if (e.key === 'Backspace') {
      if (this.typed) this.typed = this.typed.slice(0, -1);
      else if (this.runDraw?.start) this.runDraw.start = null;
      else if (this.drawing && this.room?.points.length) {
        this.store.update((p) => {
          p.room!.points.pop();
        });
        this.ui.redraw();
        this.render();
      }
    } else if (e.key === 'Enter') {
      if (this.typed) this.placeTyped();
      else this.stop();
    } else {
      return false;
    }
    this.updatePreview();
    this.render();
    return true;
  }

  /** Put the next point at the typed length, in the direction of the mouse. */
  private placeTyped() {
    const len = Number(this.typed);
    this.typed = '';
    if (!(len > 0)) return;
    if (this.runDraw) {
      const s = this.runDraw.start;
      if (!s) return;
      const c = this.cursor ?? { x: s.x + 1, z: s.z };
      const d = Math.hypot(c.x - s.x, c.z - s.z) || 1;
      this.runPoint({ x: s.x + ((c.x - s.x) / d) * len, z: s.z + ((c.z - s.z) / d) * len });
      return;
    }
    const last = this.room?.points.at(-1);
    if (!last) return;
    const c = this.cursor ?? { x: last[0] + 1, z: last[1] };
    const d = Math.hypot(c.x - last[0], c.z - last[1]) || 1;
    this.addPoint({ x: last[0] + ((c.x - last[0]) / d) * len, z: last[1] + ((c.z - last[1]) / d) * len });
  }

  // ---------- Pipes and cable ladders ----------

  private startRun(kind: Run['kind']) {
    if (!this.room) return;
    this.cancelModes();
    this.runDraw = { kind, start: null };
    document.body.classList.add('room-drawing');
    this.viewer.setView('top');
    this.render();
  }

  /** Grid + 45° snapping from the start point, and onto a wall's inside face when close to one. */
  private snapRun(raw: P): P {
    const start = this.runDraw?.start;
    let pt: P = start ? angleSnap(start, raw, RUN_GRID) : { x: Math.round(raw.x / RUN_GRID) * RUN_GRID, z: Math.round(raw.z / RUN_GRID) * RUN_GRID };
    const room = this.room;
    if (!room) return pt;
    const limit = WALL_SNAP_PX * this.pxAt(pt);
    const { inner } = wallFaces(room);
    const n = room.points.length;
    let best: { d: number; pt: P } | null = null;
    const count = segments(room).length;
    for (let i = 0; i < count; i++) {
      const a = inner[i];
      const b = inner[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (!len) continue;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const along = (pt.x - a.x) * ux + (pt.z - a.z) * uz;
      if (along < -limit || along > len + limit) continue;
      const d = Math.abs((pt.x - a.x) * -uz + (pt.z - a.z) * ux);
      if (d > limit || (best && d > best.d)) continue;
      let q: P;
      if (start) {
        // Slide along the run's direction until it meets the wall face
        const dx = pt.x - start.x;
        const dz = pt.z - start.z;
        const denom = dx * -uz + dz * ux;
        if (Math.abs(denom) < 1e-6) continue;
        const t = ((a.x - start.x) * -uz + (a.z - start.z) * ux) / denom;
        q = { x: start.x + dx * t, z: start.z + dz * t };
      } else {
        q = { x: a.x + ux * along, z: a.z + uz * along };
      }
      best = { d, pt: q };
    }
    if (best) pt = { x: Math.round(best.pt.x), z: Math.round(best.pt.z) };
    return pt;
  }

  private runPoint(pt: P) {
    const rd = this.runDraw;
    const room = this.room;
    if (!rd || !room) return;
    if (!rd.start) {
      rd.start = pt;
      this.typed = '';
      this.updatePreview();
      this.render();
      return;
    }
    if (Math.hypot(pt.x - rd.start.x, pt.z - rd.start.z) < 20) return;
    const last = this.lastRun[rd.kind];
    const defaultY = rd.kind === 'pipe' ? room.height - 400 : room.height - 250;
    const run: Run = {
      id: newId(),
      kind: rd.kind,
      a: [Math.round(rd.start.x), Math.round(rd.start.z)],
      b: [Math.round(pt.x), Math.round(pt.z)],
      y: Math.max(0, last.y ?? defaultY),
      size: last.size,
      h: rd.kind === 'ladder' ? last.h : 0,
      ...(rd.kind === 'pipe' ? { pipeType: last.pipeType } : {}),
    };
    this.store.update((p) => {
      (p.room!.runs ??= []).push(run);
    });
    this.cancelModes();
    this.ui.redraw();
    this.render();
  }

  // ---------- Openings ----------

  private startOpening() {
    if (!this.room) return;
    this.cancelModes();
    this.placingOpening = true;
    document.body.classList.add('room-drawing');
    this.render();
  }

  /** Click on a wall's inside (in 3D) or on the roof (in the top view) → new opening there. */
  private placeOpeningAt(ray: THREE.Ray) {
    const room = this.room;
    const group = this.viewer.modelRoot?.getObjectByName('room');
    if (!room || !group) return;
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const hits = caster.intersectObject(group, true).filter((h) => (h.object as THREE.Mesh).isMesh && h.face);
    const toLocal = (v: THREE.Vector3) => this.viewer.modelRoot!.worldToLocal(v.clone());

    // A wall's inside face, facing the camera (so you can click through a see-through wall)
    let wallHit: { i: number; pt: THREE.Vector3 } | null = null;
    for (const h of hits) {
      const i = h.object.userData.wall;
      if (i === undefined) continue;
      const f = wallFrame(room, i);
      if (!f) continue;
      const n = h.face!.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.dot(ray.direction) < 0 && n.x * f.inward.x + n.z * f.inward.z > 0.7) {
        wallHit = { i, pt: toLocal(h.point) };
        break;
      }
    }
    const s = this.lastOpening;
    const hh = s.shape === 'round' ? s.w : s.h;
    const r10 = (v: number) => Math.max(0, Math.round(v / 10) * 10);
    let o: Opening | null = null;
    if (wallHit) {
      const f = wallFrame(room, wallHit.i)!;
      const along = (wallHit.pt.x - f.origin.x) * f.right.x + (wallHit.pt.z - f.origin.z) * f.right.z;
      o = { id: newId(), on: 'wall', wall: wallHit.i, shape: s.shape, w: s.w, h: hh, x: r10(along - s.w / 2), y: r10(wallHit.pt.y - room.floorY - hh / 2) };
    } else {
      const roofHit = hits.find((h) => h.object.userData.roof);
      if (roofHit && room.closed) {
        const pt = toLocal(roofHit.point);
        // Measure from the closest wall
        let best = { i: 0, d: Infinity };
        segments(room).forEach((_, i) => {
          const d = distanceFromWall(wallFrame(room, i)!, { x: pt.x, z: pt.z });
          if (d >= 0 && d < best.d) best = { i, d };
        });
        const f = wallFrame(room, best.i)!;
        const along = (pt.x - f.origin.x) * f.right.x + (pt.z - f.origin.z) * f.right.z;
        o = { id: newId(), on: 'roof', wall: best.i, shape: s.shape, w: s.w, h: hh, x: r10(along - s.w / 2), y: r10(best.d - hh / 2) };
      }
    }
    if (!o) return; // missed – keep waiting for a click
    const opening = o;
    this.store.update((p) => {
      (p.room!.openings ??= []).push(opening);
    });
    this.cancelModes();
    this.ui.redraw();
    this.render();
  }

  /** Text for the builder/whoever makes the holes. */
  openingText(): string {
    const room = this.room;
    const list = room?.openings ?? [];
    const lines = [`Håltagning – ${new Date().toISOString().slice(0, 10)}`, 'Mått till hålets kant. "Vänster hörn" = sett inifrån rummet.', ''];
    list.forEach((o, i) => {
      const size = o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h} (b×h)`;
      if (o.on === 'wall') {
        lines.push(`${i + 1}. Vägg ${o.wall + 1} · ${size} · ${o.x} mm från vänster hörn · underkant ${o.y} mm över golv`);
      } else {
        lines.push(`${i + 1}. Tak · ${o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`} · ${o.x} mm längs vägg ${o.wall + 1} från vänster hörn · ${o.y} mm ut från vägg ${o.wall + 1}`);
      }
    });
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- Moving the assembly ----------

  /** Viewer drag start: in move mode, grabbing the assembly starts moving it. */
  dragStart(ray: THREE.Ray, hit: THREE.Object3D | null): boolean {
    if (!this.moving || !hit) return false;
    let o: THREE.Object3D | null = hit;
    while (o && o.name !== 'asm-content') o = o.parent;
    if (!o) return false;
    // Drag along a level plane through the grabbed point
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const p = caster.intersectObject(hit, false)[0]?.point;
    if (!p) return false;
    const local = this.viewer.modelRoot!.worldToLocal(p.clone());
    this.drag = { from: local, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -local.y), delta: { x: 0, z: 0 } };
    return true;
  }

  dragMove(ray: THREE.Ray) {
    const d = this.drag;
    const root = this.viewer.modelRoot;
    if (!d || !root) return;
    const localRay = ray.clone().applyMatrix4(root.matrixWorld.clone().invert());
    const hit = localRay.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    d.delta = { x: Math.round((hit.x - d.from.x) / 10) * 10, z: Math.round((hit.z - d.from.z) / 10) * 10 };
    const content = root.getObjectByName('asm-content');
    content?.position.set(d.delta.x, 0, d.delta.z);
  }

  dragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d || (!d.delta.x && !d.delta.z)) return;
    this.shiftAssembly(d.delta.x, 0, d.delta.z);
  }

  private shiftAssembly(dx: number, dy: number, dz: number) {
    this.store.update((p) => {
      const [x, y, z] = p.place ?? [0, 0, 0];
      p.place = [Math.round(x + dx), Math.round(y + dy), Math.round(z + dz)];
    });
    this.ui.redraw();
    this.render();
  }

  /** Smallest gap from each wall's inside face to the assembly, and its height above the floor. */
  private placement(): { walls: (number | null)[]; floor: number } | null {
    const room = this.room;
    const lay = this.asm.layout;
    if (!room || !lay || !lay.parts.length) return null;
    const corners = assemblyCorners(lay);
    if (!corners.length) return null;
    // (Plain loops: there can be far too many points for Math.min(...list))
    const walls = segments(room).map((_, i) => {
      const f = wallFrame(room, i)!;
      let min = Infinity;
      for (const c of corners) min = Math.min(min, distanceFromWall(f, { x: c.x, z: c.z }));
      return Math.round(min);
    });
    let lowest = Infinity;
    for (const c of corners) lowest = Math.min(lowest, c.y);
    const floor = Math.round(lowest - room.floorY);
    return { walls, floor };
  }

  // ---------- Preview of the wall / run being drawn ----------

  private clearPreview() {
    const o = this.viewer.overlay;
    for (const child of [...o.children]) {
      child.removeFromParent();
      child.traverse((c) => {
        if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
      });
    }
  }

  private updatePreview() {
    this.clearPreview();
    if (!(this.drawing || this.runDraw) || !this.cursor) return;
    const o = this.viewer.overlay;
    const y = (this.room?.floorY ?? 0) + 5;
    const c = this.cursor;
    const accent = 0xe8590c;

    // Cursor marker
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(c.closing ? 60 : 35, c.closing ? 85 : 50, 32),
      new THREE.MeshBasicMaterial({ color: accent, depthTest: false, transparent: true }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, y, c.z);
    ring.renderOrder = 20;
    o.add(ring);

    const lastPt = this.runDraw ? this.runDraw.start : this.room?.points.at(-1) ? toP(this.room.points.at(-1)!) : null;
    if (!lastPt) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(lastPt.x, y, lastPt.z), new THREE.Vector3(c.x, y, c.z)]),
      new THREE.LineBasicMaterial({ color: accent, depthTest: false, transparent: true }),
    );
    line.renderOrder = 20;
    o.add(line);

    // Live length (or the length being typed)
    const len = Math.round(Math.hypot(c.x - lastPt.x, c.z - lastPt.z));
    const el = document.createElement('div');
    el.className = 'wall-len wall-len--live';
    el.textContent = this.typed ? `${this.typed}▌ mm` : c.closing ? 'Stäng rummet' : `${len} mm`;
    const lbl = new CSS2DObject(el);
    lbl.position.set((lastPt.x + c.x) / 2, y, (lastPt.z + c.z) / 2);
    o.add(lbl);
  }

  // ---------- Panel ----------

  render() {
    const room = this.room;
    const panel = this.ui.panel;
    const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
    // Keep the cursor in the field being edited when the panel is rebuilt
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && panel.contains(active) ? `${active.getAttribute('name')}|${active.dataset.id ?? ''}|${active.dataset.wall ?? ''}` : null;

    const hint = q<HTMLElement>('.room-hint');
    const drawBtn = q<HTMLButtonElement>('[data-room="draw"]');
    const stopBtn = q<HTMLButtonElement>('[data-room="stop"]');
    const clearBtn = q<HTMLButtonElement>('[data-room="clear"]');
    const settings = q<HTMLElement>('.room-settings');
    const walls = q<HTMLElement>('.room-walls');
    const list = q<HTMLUListElement>('.room-collisions');

    const pts = room?.points.length ?? 0;
    if (this.drawing) {
      hint.textContent =
        pts === 0
          ? 'Klicka på golvet för att sätta första hörnet.'
          : `Klicka för att lägga till hörn${pts >= 3 ? ', klicka på första hörnet för att stänga rummet' : ''}. Skriv en längd och tryck Enter för att sätta den exakt. Backsteg tar bort ett hörn, Esc eller dubbelklick avslutar.`;
    } else if (this.runDraw) {
      const what = this.runDraw.kind === 'pipe' ? 'röret' : 'kabelstegen';
      hint.textContent = this.runDraw.start
        ? `Klicka där ${what} slutar, eller skriv längden och tryck Enter. Nära en vägg fäster änden mot väggen. Esc avbryter.`
        : `Klicka där ${what} börjar (vyn Ovan). Nära en vägg fäster punkten mot väggen. Esc avbryter.`;
    } else if (this.placingOpening) {
      hint.textContent = 'Klicka på insidan av en vägg där hålet ska sitta – eller på taket i vyn Ovan. Justera måtten i listan efteråt. Esc avbryter.';
    } else if (this.moving) {
      hint.textContent = 'Dra sammanställningen dit den ska stå. Avståndet till väggarna visas nedan och kan skrivas in exakt. Klicka Klar när du är nöjd.';
    } else if (!room) {
      hint.textContent = 'Rita väggarna runt din sammanställning. Klicka ut hörnen på golvet i vyn ovanifrån – golv och tak läggs till när du stänger rummet.';
    } else {
      hint.textContent = room.closed
        ? `Rum med ${pts} väggar. Längderna är invändiga mått – ändra dem nedan.`
        : `${pts - 1} ${pts - 1 === 1 ? 'vägg' : 'väggar'} (öppen rad). Stäng rummet genom att rita igen och klicka på första hörnet, så får du golv och tak.`;
    }
    drawBtn.textContent = room ? '✎ Rita om' : '✎ Rita väggar';
    drawBtn.hidden = this.busy;
    stopBtn.hidden = !this.busy;
    stopBtn.textContent = this.drawing ? 'Sluta rita' : 'Avbryt';
    clearBtn.disabled = !room || this.busy;

    // Settings
    settings.hidden = !room;
    if (room) {
      const set = (name: string, v: string | boolean) => {
        const el = settings.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        if (document.activeElement === el) return;
        if (typeof v === 'boolean') el.checked = v;
        else el.value = v;
      };
      set('height', String(room.height));
      set('thickness', String(room.thickness));
      set('floorY', String(room.floorY));
      set('floor', room.floor);
      set('roof', room.roof);
      set('seeThrough', room.seeThrough);
      settings.querySelectorAll<HTMLInputElement>('[name="floor"], [name="roof"]').forEach((el) => (el.disabled = !room.closed));
    }

    // Wall lengths
    const segs = room ? segments(room) : [];
    walls.hidden = segs.length === 0;
    walls.querySelector('tbody')!.replaceChildren(
      ...segs.map((s, i) => row(`Vägg ${i + 1}`, numInput('wall-len', Math.round(s.length), { wall: i, min: 50, step: 10, disabled: this.busy }), 'mm')),
    );

    const ready = !!room && pts >= 2 && !this.drawing;
    this.renderPlacement(ready);
    this.renderOpenings(ready);
    this.renderRuns(ready);

    // Collisions
    const texts = this.asm.collisionTexts();
    list.replaceChildren(
      ...(texts.length ? texts : room && pts >= 2 ? ['Inga delar krockar med väggar, tak, rör eller kabelstegar.'] : []).map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        if (!texts.length) li.className = 'is-ok';
        return li;
      }),
    );

    if (focusKey) {
      const [name, id, wall] = focusKey.split('|');
      const again = [...panel.querySelectorAll<HTMLElement>(`[name="${name}"]`)].find(
        (el) => (el.dataset.id ?? '') === id && (el.dataset.wall ?? '') === wall,
      );
      if (again && again !== document.activeElement) again.focus();
    }
  }

  private renderPlacement(ready: boolean) {
    const sec = this.ui.panel.querySelector<HTMLElement>('.room-place')!;
    const info = this.placement();
    sec.hidden = !ready || this.asm.partCount === 0;
    if (sec.hidden) return;
    const moveBtn = sec.querySelector<HTMLButtonElement>('[data-room="move"]')!;
    moveBtn.textContent = this.moving ? '✓ Klar' : '✥ Flytta (dra i 3D)';
    moveBtn.classList.toggle('is-on', this.moving);
    sec.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = this.busy));
    const rows: HTMLTableRowElement[] = [];
    if (info) {
      info.walls.forEach((d, i) => {
        if (d !== null) rows.push(row(`Till vägg ${i + 1}`, numInput('place-wall', d, { wall: i, step: 10, disabled: this.busy }), 'mm'));
      });
      rows.push(row('Över golvet', numInput('place-floor', info.floor, { step: 10, disabled: this.busy }), 'mm'));
    }
    sec.querySelector('tbody')!.replaceChildren(...rows);
  }

  private renderOpenings(ready: boolean) {
    const room = this.room;
    const sec = this.ui.panel.querySelector<HTMLElement>('.room-openings')!;
    sec.hidden = !ready;
    if (!room || sec.hidden) return;
    const openings = room.openings ?? [];
    const wallCount = segments(room).length;
    sec.querySelectorAll<HTMLButtonElement>('[data-room="add-opening"]').forEach((b) => (b.disabled = this.busy));
    sec.querySelectorAll<HTMLButtonElement>('[data-room^="opening-"]').forEach((b) => (b.disabled = openings.length === 0));
    const cards = openings.map((o, i) => {
      const card = itemCard(openingName(o, i), 'del-opening', o.id);
      const grid = card.querySelector('.item__grid')!;
      const isRoof = o.on === 'roof';
      grid.append(
        field('Placering', select('o-on', o.id, [['wall', 'Vägg'], ['roof', 'Tak']], o.on, !room.closed)),
        field(isRoof ? 'Mätt från vägg' : 'Vägg', select('o-wall', o.id, Array.from({ length: wallCount }, (_, k) => [String(k), `Vägg ${k + 1}`]), String(o.wall))),
        field('Form', select('o-shape', o.id, [['rect', 'Rektangulär'], ['round', 'Rund']], o.shape)),
        field(o.shape === 'round' ? 'Ø' : 'Bredd', numInput('o-w', o.w, { id: o.id, min: 10, step: 10 }), 'mm'),
      );
      if (o.shape === 'rect') grid.append(field(isRoof ? 'Djup' : 'Höjd', numInput('o-h', o.h, { id: o.id, min: 10, step: 10 }), 'mm'));
      grid.append(
        field(isRoof ? 'Längs väggen från vänster hörn' : 'Från vänster hörn', numInput('o-x', o.x, { id: o.id, step: 10 }), 'mm'),
        field(isRoof ? 'Ut från väggen' : 'Underkant över golv', numInput('o-y', o.y, { id: o.id, step: 10 }), 'mm'),
      );
      return card;
    });
    const listEl = sec.querySelector<HTMLElement>('.opening-list')!;
    listEl.replaceChildren(...cards);
    if (!cards.length) listEl.append(note('Inga hål än. Tryck ”+ Håltagning” och klicka på en vägg.'));
  }

  private renderRuns(ready: boolean) {
    const room = this.room;
    const sec = this.ui.panel.querySelector<HTMLElement>('.room-runs')!;
    sec.hidden = !ready;
    if (!room || sec.hidden) return;
    sec.querySelectorAll<HTMLButtonElement>('[data-room^="add-"]').forEach((b) => (b.disabled = this.busy));
    const cards = (room.runs ?? []).map((r) => {
      const card = itemCard(runName(room, r), 'del-run', r.id);
      const grid = card.querySelector('.item__grid')!;
      if (r.kind === 'pipe') {
        grid.append(
          field('Typ', select('r-type', r.id, Object.entries(PIPE_TYPES).map(([k, v]) => [k, v.label]), r.pipeType ?? 'ovrigt')),
          field('Ytterdiameter', numInput('r-size', r.size, { id: r.id, min: 10, step: 1 }), 'mm'),
        );
      } else {
        grid.append(
          field('Bredd', numInput('r-size', r.size, { id: r.id, min: 50, step: 50 }), 'mm'),
          field('Höjd', numInput('r-h', r.h, { id: r.id, min: 10, step: 10 }), 'mm'),
        );
      }
      grid.append(
        field('Underkant över golv', numInput('r-y', r.y, { id: r.id, min: 0, step: 10 }), 'mm'),
        field('Längd', numInput('r-len', runLength(r), { id: r.id, min: 50, step: 10 }), 'mm'),
      );
      for (const g of runWallGaps(room, r)) {
        grid.append(field(`Avstånd till vägg ${g.wall + 1}`, numInput('r-gap', g.gap, { id: r.id, wall: g.wall, step: 10 }), 'mm'));
      }
      return card;
    });
    const listEl = sec.querySelector<HTMLElement>('.run-list')!;
    listEl.replaceChildren(...cards);
    if (!cards.length) listEl.append(note('Inga rör eller kabelstegar än.'));
  }

  private onPanelClick(e: Event) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-room]');
    const act = btn?.dataset.room;
    if (!act) return;
    switch (act) {
      case 'draw': return this.start();
      case 'stop': return this.stop();
      case 'clear':
        this.cancelModes();
        this.store.update((p) => {
          delete p.room;
        });
        this.ui.redraw(true);
        return this.render();
      case 'floor-auto': {
        const y = this.asm.assemblyFloorY();
        return this.change((r) => (r.floorY = y));
      }
      case 'add-opening': return this.startOpening();
      case 'add-pipe': return this.startRun('pipe');
      case 'add-ladder': return this.startRun('ladder');
      case 'del-opening': return this.change((r) => (r.openings = (r.openings ?? []).filter((o) => o.id !== btn!.dataset.id)));
      case 'del-run': return this.change((r) => (r.runs = (r.runs ?? []).filter((x) => x.id !== btn!.dataset.id)));
      case 'move':
        if (this.moving) this.cancelModes();
        else {
          this.cancelModes();
          this.moving = true;
          document.body.classList.add('room-moving');
        }
        return this.render();
      case 'spin':
        this.asm.tip(new THREE.Vector3(0, 1, 0), -1);
        return this.render();
      case 'opening-copy':
        navigator.clipboard?.writeText(this.openingText()).catch(() => {});
        return;
      case 'opening-download': {
        const blob = new Blob([this.openingText()], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `haltagning-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
    }
  }

  private onPanelChange(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const room = this.room;
    if (!room) return;
    const num = Math.round(Number(el.value));
    const ok = el.value !== '' && Number.isFinite(num);
    const id = el.dataset.id;

    // Openings
    if (el.name.startsWith('o-')) {
      const idx = (room.openings ?? []).findIndex((o) => o.id === id);
      if (idx < 0) return;
      this.change((r) => {
        const o = r.openings![idx];
        switch (el.name) {
          case 'o-on': o.on = el.value as Opening['on']; break;
          case 'o-wall': o.wall = Number(el.value); break;
          case 'o-shape': o.shape = el.value as Opening['shape']; if (o.shape === 'round') o.h = o.w; break;
          case 'o-w': if (ok && num >= 10) { o.w = num; if (o.shape === 'round') o.h = num; } break;
          case 'o-h': if (ok && num >= 10) o.h = num; break;
          case 'o-x': if (ok) o.x = num; break;
          case 'o-y': if (ok) o.y = num; break;
        }
        this.lastOpening = { shape: o.shape, w: o.w, h: o.h };
      });
      return;
    }

    // Pipes and ladders
    if (el.name.startsWith('r-')) {
      const idx = (room.runs ?? []).findIndex((x) => x.id === id);
      if (idx < 0) return;
      this.change((r) => {
        const run = r.runs![idx];
        switch (el.name) {
          case 'r-type': run.pipeType = el.value as PipeType; break;
          case 'r-size': if (ok && num >= 10) run.size = num; break;
          case 'r-h': if (ok && num >= 10) run.h = num; break;
          case 'r-y': if (ok && num >= 0) run.y = num; break;
          case 'r-len': {
            const len = runLength(run);
            if (!ok || num < 50 || !len) break;
            const dx = (run.b[0] - run.a[0]) / len;
            const dz = (run.b[1] - run.a[1]) / len;
            run.b = [Math.round(run.a[0] + dx * num), Math.round(run.a[1] + dz * num)];
            break;
          }
          case 'r-gap': {
            const wall = Number((el as HTMLInputElement).dataset.wall);
            const gap = runWallGaps(r, run).find((g) => g.wall === wall);
            const f = gap && wallFrame(r, gap.wall);
            if (!ok || !gap || !f) break;
            const d = num - gap.gap;
            run.a = [Math.round(run.a[0] + f.inward.x * d), Math.round(run.a[1] + f.inward.z * d)];
            run.b = [Math.round(run.b[0] + f.inward.x * d), Math.round(run.b[1] + f.inward.z * d)];
            break;
          }
        }
        this.lastRun[run.kind] = { size: run.size, h: run.h, y: run.y, pipeType: run.pipeType ?? this.lastRun[run.kind].pipeType };
      });
      return;
    }

    // Where the assembly stands
    if (el.name === 'place-wall' || el.name === 'place-floor') {
      const info = this.placement();
      if (!info || !ok) return this.render();
      if (el.name === 'place-floor') return this.shiftAssembly(0, num - info.floor, 0);
      const i = Number((el as HTMLInputElement).dataset.wall);
      const f = wallFrame(room, i);
      const old = info.walls[i];
      if (!f || old === null) return;
      const d = num - old;
      return this.shiftAssembly(f.inward.x * d, 0, f.inward.z * d);
    }

    if (el.name === 'wall-len') {
      if (!(ok && num >= 50)) return this.render();
      this.change((r) => setWallLength(r, Number((el as HTMLInputElement).dataset.wall), num));
      return;
    }
    switch (el.name) {
      case 'height': if (num >= 500) this.change((r) => (r.height = num)); break;
      case 'thickness': if (num >= 20) this.change((r) => (r.thickness = num)); break;
      case 'floorY': if (ok) this.change((r) => (r.floorY = num)); break;
      case 'floor': this.change((r) => (r.floor = (el as HTMLInputElement).checked)); break;
      case 'roof': this.change((r) => (r.roof = (el as HTMLInputElement).checked)); break;
      case 'seeThrough': this.change((r) => (r.seeThrough = (el as HTMLInputElement).checked)); break;
    }
    this.render();
  }

  private change(fn: (r: Room) => void) {
    this.store.update((p) => {
      if (p.room) fn(p.room);
    });
    this.ui.redraw();
    this.render();
  }
}

// ---------- Small helpers ----------

/** Snap `raw` to 45° steps (when close) from `from`, with the length rounded to `grid`. */
function angleSnap(from: P, raw: P, grid: number): P {
  let ang = Math.atan2(raw.z - from.z, raw.x - from.x);
  const step = Math.PI / 4;
  const nearest = Math.round(ang / step) * step;
  if (Math.abs(ang - nearest) < THREE.MathUtils.degToRad(ANGLE_SNAP)) ang = nearest;
  const len = Math.round(Math.hypot(raw.x - from.x, raw.z - from.z) / grid) * grid;
  return { x: Math.round(from.x + Math.cos(ang) * len), z: Math.round(from.z + Math.sin(ang) * len) };
}

function numInput(name: string, value: number, o: { id?: string; wall?: number; min?: number; step?: number; disabled?: boolean } = {}): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.name = name;
  input.value = String(value);
  if (o.min !== undefined) input.min = String(o.min);
  input.step = String(o.step ?? 10);
  if (o.id) input.dataset.id = o.id;
  if (o.wall !== undefined) input.dataset.wall = String(o.wall);
  input.disabled = !!o.disabled;
  return input;
}

function select(name: string, id: string, options: [string, string][], value: string, disabled = false): HTMLSelectElement {
  const s = document.createElement('select');
  s.name = name;
  s.dataset.id = id;
  s.disabled = disabled;
  for (const [v, label] of options) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label;
    opt.selected = v === value;
    s.append(opt);
  }
  return s;
}

function row(label: string, input: HTMLElement, unit: string): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const name = document.createElement('td');
  name.textContent = label;
  const cell = document.createElement('td');
  cell.append(input, ` ${unit}`);
  tr.append(name, cell);
  return tr;
}

function field(label: string, input: HTMLElement, unit?: string): HTMLLabelElement {
  const l = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = label;
  l.append(span);
  if (unit) {
    const wrap = document.createElement('span');
    wrap.className = 'item__input';
    wrap.append(input, unit);
    l.append(wrap);
  } else {
    l.append(input);
  }
  return l;
}

function itemCard(title: string, delAct: string, id: string): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'item';
  const head = document.createElement('div');
  head.className = 'item__head';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon';
  del.textContent = '×';
  del.title = 'Ta bort';
  del.dataset.room = delAct;
  del.dataset.id = id;
  head.append(strong, del);
  const grid = document.createElement('div');
  grid.className = 'item__grid';
  card.append(head, grid);
  return card;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'item-empty';
  p.textContent = text;
  return p;
}
