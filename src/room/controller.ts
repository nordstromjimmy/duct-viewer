// The Room tab: draw walls in the plan, then edit lengths and room settings.
//
// Drawing: click points on the floor. The wall being drawn shows its length; type a number and
// press Enter to set it exactly. Click the first point to close the room (floor and roof are
// added), double-click or press Enter to stop with an open run of walls, Esc to stop,
// Backspace to take back the last point.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { AssemblyController } from '../assembly/controller';
import type { Store } from '../store';
import type { Viewer } from '../viewer';
import { ROOM_DEFAULTS, segments, setWallLength, toP, type P, type Room } from './model';

/** Snap step for points and lengths, mm. */
const GRID = 50;
/** Walls within this many degrees of a 45° step snap to it. */
const ANGLE_SNAP = 7;
/** Clicking within this many screen pixels of the first point closes the room. */
const CLOSE_PX = 14;

export interface RoomUi {
  panel: HTMLElement;
  /** Called after the room changes, so the 3D view is redrawn. */
  redraw: (fit?: boolean) => void;
}

export class RoomController {
  drawing = false;
  private cursor: (P & { closing?: boolean }) | null = null;
  private typed = '';
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

  // ---------- Drawing ----------

  start() {
    const old = this.room;
    this.store.update((p) => {
      p.room = {
        ...ROOM_DEFAULTS,
        ...(old ? { height: old.height, thickness: old.thickness, floor: old.floor, roof: old.roof, seeThrough: old.seeThrough } : {}),
        floorY: old?.floorY ?? this.asm.assemblyFloorY(),
        points: [],
        closed: false,
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

  /** Stop drawing. A single point (no wall yet) is dropped. */
  stop() {
    if (!this.drawing) return;
    this.drawing = false;
    this.typed = '';
    this.cursor = null;
    document.body.classList.remove('room-drawing');
    this.clearPreview();
    if (this.room && this.room.points.length < 2) {
      this.store.update((p) => {
        delete p.room;
      });
    }
    this.ui.redraw();
    this.render();
  }

  /** Where the mouse ray meets the floor. */
  private floorPoint(ray: THREE.Ray): P | null {
    const y = this.room?.floorY ?? 0;
    const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** Snap to the grid, to 45° steps from the last point, and to the first point (to close). */
  private snap(raw: P): P & { closing?: boolean } {
    const pts = this.room?.points.map(toP) ?? [];
    const y = this.room?.floorY ?? 0;
    if (pts.length >= 3) {
      const first = pts[0];
      const px = this.viewer.mmPerPixel(new THREE.Vector3(first.x, y, first.z));
      if (Math.hypot(raw.x - first.x, raw.z - first.z) < CLOSE_PX * px) return { ...first, closing: true };
    }
    const round = (v: number) => Math.round(v / GRID) * GRID;
    const last = pts.at(-1);
    if (!last) return { x: round(raw.x), z: round(raw.z) };
    let ang = Math.atan2(raw.z - last.z, raw.x - last.x);
    const step = Math.PI / 4;
    const nearest = Math.round(ang / step) * step;
    if (Math.abs(ang - nearest) < THREE.MathUtils.degToRad(ANGLE_SNAP)) ang = nearest;
    const len = round(Math.hypot(raw.x - last.x, raw.z - last.z));
    return { x: Math.round(last.x + Math.cos(ang) * len), z: Math.round(last.z + Math.sin(ang) * len) };
  }

  onMove(ray: THREE.Ray) {
    if (!this.drawing) return;
    const raw = this.floorPoint(ray);
    if (!raw) return;
    this.cursor = this.snap(raw);
    this.updatePreview();
  }

  onClick(ray: THREE.Ray) {
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

  /** Keys while drawing. Returns true when the key was used. */
  onKey(e: KeyboardEvent): boolean {
    if (!this.drawing) return false;
    if (/^[0-9]$/.test(e.key)) {
      this.typed = (this.typed + e.key).slice(0, 6);
    } else if (e.key === 'Backspace') {
      if (this.typed) this.typed = this.typed.slice(0, -1);
      else if (this.room?.points.length) {
        this.store.update((p) => {
          p.room!.points.pop();
        });
        this.ui.redraw();
        this.render();
      }
    } else if (e.key === 'Enter') {
      if (this.typed) this.placeTyped();
      else this.stop();
    } else if (e.key === 'Escape') {
      this.stop();
    } else {
      return false;
    }
    this.updatePreview();
    return true;
  }

  /** Put the next point at the typed length, in the direction of the mouse. */
  private placeTyped() {
    const len = Number(this.typed);
    const last = this.room?.points.at(-1);
    this.typed = '';
    if (!last || !(len > 0)) return;
    const c = this.cursor ?? { x: last[0] + 1, z: last[1] };
    const d = Math.hypot(c.x - last[0], c.z - last[1]) || 1;
    this.addPoint({ x: last[0] + ((c.x - last[0]) / d) * len, z: last[1] + ((c.z - last[1]) / d) * len });
  }

  // ---------- Preview of the wall being drawn ----------

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
    if (!this.drawing || !this.cursor) return;
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

    const last = this.room?.points.at(-1);
    if (!last) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(last[0], y, last[1]), new THREE.Vector3(c.x, y, c.z)]),
      new THREE.LineBasicMaterial({ color: accent, depthTest: false, transparent: true }),
    );
    line.renderOrder = 20;
    o.add(line);

    // Live length (or the length being typed)
    const len = Math.round(Math.hypot(c.x - last[0], c.z - last[1]));
    const el = document.createElement('div');
    el.className = 'wall-len wall-len--live';
    el.textContent = this.typed ? `${this.typed}▌ mm` : c.closing ? 'Close room' : `${len} mm`;
    const lbl = new CSS2DObject(el);
    lbl.position.set((last[0] + c.x) / 2, y, (last[1] + c.z) / 2);
    o.add(lbl);
  }

  // ---------- Panel ----------

  render() {
    const room = this.room;
    const panel = this.ui.panel;
    const hint = panel.querySelector<HTMLElement>('.room-hint')!;
    const drawBtn = panel.querySelector<HTMLButtonElement>('[data-room="draw"]')!;
    const stopBtn = panel.querySelector<HTMLButtonElement>('[data-room="stop"]')!;
    const clearBtn = panel.querySelector<HTMLButtonElement>('[data-room="clear"]')!;
    const settings = panel.querySelector<HTMLElement>('.room-settings')!;
    const walls = panel.querySelector<HTMLElement>('.room-walls')!;
    const tbody = walls.querySelector('tbody')!;
    const list = panel.querySelector<HTMLUListElement>('.room-collisions')!;

    const pts = room?.points.length ?? 0;
    if (this.drawing) {
      hint.textContent =
        pts === 0
          ? 'Click on the floor to place the first corner.'
          : `Click to add corners${pts >= 3 ? ', click the first corner to close the room' : ''}. Type a length and press Enter to set it exactly. Backspace takes back a corner, Esc or double-click stops.`;
    } else if (!room) {
      hint.textContent = 'Draw the walls around your assembly. Click the corners on the floor in the top view – floor and roof are added when you close the room.';
    } else {
      hint.textContent = room.closed
        ? `Room with ${pts} walls. Lengths are inside measurements – change them below.`
        : `${pts - 1} wall${pts - 1 === 1 ? '' : 's'} (open run). Close the room by drawing again and clicking the first corner, for a floor and roof.`;
    }
    drawBtn.textContent = room ? '✎ Draw again' : '✎ Draw walls';
    drawBtn.hidden = this.drawing;
    stopBtn.hidden = !this.drawing;
    clearBtn.disabled = !room || this.drawing;

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
    tbody.replaceChildren(
      ...segs.map((s, i) => {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = `Wall ${i + 1}`;
        const cell = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '50';
        input.step = '10';
        input.value = String(Math.round(s.length));
        input.dataset.wall = String(i);
        input.disabled = this.drawing;
        cell.append(input, ' mm');
        tr.append(name, cell);
        return tr;
      }),
    );

    // Collisions
    const texts = this.asm.collisionTexts();
    list.replaceChildren(
      ...(texts.length ? texts : room && pts >= 2 ? ['No parts hit the walls or roof.'] : []).map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        if (!texts.length) li.className = 'is-ok';
        return li;
      }),
    );
  }

  private onPanelClick(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-room]')?.dataset.room;
    if (act === 'draw') this.start();
    else if (act === 'stop') this.stop();
    else if (act === 'clear') {
      this.store.update((p) => {
        delete p.room;
      });
      this.ui.redraw(true);
      this.render();
    } else if (act === 'floor-auto') {
      const y = this.asm.assemblyFloorY();
      this.change((r) => (r.floorY = y));
    }
  }

  private onPanelChange(e: Event) {
    const el = e.target as HTMLInputElement;
    if (!this.room) return;
    if (el.dataset.wall !== undefined) {
      const v = Math.round(Number(el.value));
      if (!(v >= 50)) {
        this.render();
        return;
      }
      this.change((r) => setWallLength(r, Number(el.dataset.wall), v));
      return;
    }
    const num = Math.round(Number(el.value));
    switch (el.name) {
      case 'height': if (num >= 500) this.change((r) => (r.height = num)); break;
      case 'thickness': if (num >= 20) this.change((r) => (r.thickness = num)); break;
      case 'floorY': if (Number.isFinite(num) && el.value !== '') this.change((r) => (r.floorY = num)); break;
      case 'floor': this.change((r) => (r.floor = el.checked)); break;
      case 'roof': this.change((r) => (r.roof = el.checked)); break;
      case 'seeThrough': this.change((r) => (r.seeThrough = el.checked)); break;
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
