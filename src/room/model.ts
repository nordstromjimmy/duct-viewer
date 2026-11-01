// The room: walls drawn in the plan, with a floor and roof added automatically once the walls
// are closed. Everything is in millimetres in the same space as the ducts.
//
// Walls are drawn as a chain of points in the plan (x, z). For a closed room the points are the
// INSIDE corners, so the lengths shown are inside measurements and the wall thickness goes
// outwards. An open chain (not closed) is drawn centred on the line.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export interface Room {
  /** Corner points in the plan, [x, z] in mm. */
  points: [number, number][];
  /** True when the last wall joins back to the first point. */
  closed: boolean;
  /** Inside height, floor to ceiling, mm. */
  height: number;
  /** Wall thickness, mm. */
  thickness: number;
  /** Floor level in the scene (y), mm. */
  floorY: number;
  floor: boolean;
  roof: boolean;
  /** Draw walls and roof see-through so the ducts inside stay visible. */
  seeThrough: boolean;
  /** Holes in the walls and roof where ducts go through (håltagning). */
  openings?: Opening[];
  /** Pipes and cable ladders running through the room. */
  runs?: Run[];
}

/**
 * A hole in a wall or the roof, measured the way you'd measure it on site.
 * Wall: `x` from the wall's left inside corner (seen from inside) to the hole's left edge,
 * `y` from the floor to the hole's bottom edge.
 * Roof: measured from wall `wall` – `x` along the wall from its left corner, `y` out from the wall.
 * Round holes use `w` as the diameter.
 */
export interface Opening {
  id: string;
  on: 'wall' | 'roof';
  wall: number;
  shape: 'rect' | 'round';
  w: number;
  h: number;
  x: number;
  y: number;
}

export type PipeType = 'varme' | 'kyla' | 'va' | 'sprinkler' | 'ovrigt';

export const PIPE_TYPES: Record<PipeType, { label: string; color: number }> = {
  varme: { label: 'Värme', color: 0xc92a2a },
  kyla: { label: 'Kyla', color: 0x1c7ed6 },
  va: { label: 'VA', color: 0x2f9e44 },
  sprinkler: { label: 'Sprinkler', color: 0xe8590c },
  ovrigt: { label: 'Övrigt', color: 0x868e96 },
};

/**
 * A straight horizontal pipe or cable ladder from `a` to `b` in the plan.
 * `y` is the height from the floor to its underside (underkant).
 * Pipe: `size` is the outer diameter (incl. insulation). Ladder: `size` is the width, `h` the side height.
 */
export interface Run {
  id: string;
  kind: 'pipe' | 'ladder';
  a: [number, number];
  b: [number, number];
  y: number;
  size: number;
  h: number;
  pipeType?: PipeType;
}

export const LADDER_DEFAULT = { size: 200, h: 60 };
export const PIPE_DEFAULT = { size: 114 };

export const ROOM_DEFAULTS = { height: 2700, thickness: 150, floor: true, roof: true, seeThrough: true };
export const FLOOR_SLAB = 100;
export const ROOF_SLAB = 150;

export interface P {
  x: number;
  z: number;
}
const p = (x: number, z: number): P => ({ x, z });
export const toP = ([x, z]: [number, number]): P => p(x, z);

/** One wall: inside line from a to b, its length, direction and the side the wall grows to. */
export interface Segment {
  a: P;
  b: P;
  length: number;
  /** Unit direction a → b. */
  dir: P;
  /** Unit normal pointing to the wall's outside (closed rooms) or to the right (open chains). */
  out: P;
}

/** Twice the signed area in the plan (> 0 = counter-clockwise in x/z). */
function signedArea(pts: P[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    a += pts[i].x * q.z - q.x * pts[i].z;
  }
  return a;
}

export function segments(room: Room): Segment[] {
  const pts = room.points.map(toP);
  const n = pts.length;
  const count = room.closed ? n : n - 1;
  const flip = room.closed && signedArea(pts) < 0 ? -1 : 1;
  const out: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = length ? p((b.x - a.x) / length, (b.z - a.z) / length) : p(1, 0);
    out.push({ a, b, length, dir, out: p(flip * dir.z, -flip * dir.x) });
  }
  return out;
}

/**
 * Offset the chain of points by `d` along each segment's `out` normal. Corners are mitred
 * (each corner moves to where its two offset walls meet).
 */
function offset(room: Room, d: number): P[] {
  const pts = room.points.map(toP);
  const segs = segments(room);
  const n = pts.length;
  return pts.map((pt, i) => {
    const prev = room.closed ? segs[(i - 1 + n) % n] : segs[i - 1];
    const next = room.closed ? segs[i % segs.length] : segs[i];
    if (!prev || !next) {
      const s = (prev ?? next)!;
      return p(pt.x + s.out.x * d, pt.z + s.out.z * d);
    }
    const na = prev.out;
    const nb = next.out;
    const ca = na.x * pt.x + na.z * pt.z + d;
    const cb = nb.x * pt.x + nb.z * pt.z + d;
    const det = na.x * nb.z - na.z * nb.x;
    if (Math.abs(det) < 1e-6) return p(pt.x + nb.x * d, pt.z + nb.z * d);
    return p((ca * nb.z - cb * na.z) / det, (na.x * cb - nb.x * ca) / det);
  });
}

/** The two faces of the walls: inside/outside for a closed room, left/right for an open chain. */
export function wallFaces(room: Room): { inner: P[]; outer: P[] } {
  return room.closed
    ? { inner: room.points.map(toP), outer: offset(room, room.thickness) }
    : { inner: offset(room, -room.thickness / 2), outer: offset(room, room.thickness / 2) };
}

/**
 * Change one wall's length. The walls after it move along, so a rectangle stays a rectangle:
 * in a closed room the next two corners shift, in an open chain everything after it shifts.
 */
export function setWallLength(room: Room, index: number, length: number): void {
  const segs = segments(room);
  const s = segs[index];
  if (!s || length <= 0) return;
  const dx = s.dir.x * (length - s.length);
  const dz = s.dir.z * (length - s.length);
  const n = room.points.length;
  const move = (k: number) => {
    room.points[k] = [Math.round(room.points[k][0] + dx), Math.round(room.points[k][1] + dz)];
  };
  if (room.closed) {
    move((index + 1) % n);
    move((index + 2) % n);
  } else {
    for (let k = index + 1; k < n; k++) move(k);
  }
}

// ---------- 3D ----------

/** A flat slab with the given plan outline, from y0 up to y1. */
function slab(poly: P[], y0: number, y1: number, material: THREE.Material, holes: THREE.Path[] = []): THREE.Mesh {
  const shape = new THREE.Shape(poly.map((q) => new THREE.Vector2(q.x, q.z)));
  shape.holes.push(...holes);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 32 });
  geo.rotateX(Math.PI / 2); // shape (x, y) → world (x, z); extrudes downwards
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y1;
  mesh.receiveShadow = true;
  return mesh;
}

function materials(seeThrough: boolean) {
  const glassy = (color: number, opacity: number) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0,
      transparent: seeThrough,
      opacity: seeThrough ? opacity : 1,
      depthWrite: !seeThrough,
      side: THREE.DoubleSide,
    });
  return {
    wall: glassy(0xe6e1d6, 0.3),
    roof: glassy(0xe6e1d6, 0.16),
    floor: new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.95, metalness: 0 }),
    edge: new THREE.LineBasicMaterial({ color: 0x8c8679, transparent: true, opacity: 0.8 }),
  };
}

/** Thin outline along a mesh's edges, so see-through walls still read clearly. */
function edges(mesh: THREE.Mesh, m: THREE.LineBasicMaterial): THREE.LineSegments {
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), m);
  lines.position.copy(mesh.position);
  lines.raycast = () => {};
  return lines;
}

/** Everything that shows the room: walls, floor, roof and the wall length labels. */
export function buildRoomGroup(room: Room): THREE.Group {
  const g = new THREE.Group();
  g.name = 'room';
  g.userData.noPick = true; // clicks go through to the ducts
  if (room.points.length < 2) return g;

  const m = materials(room.seeThrough);
  const { inner, outer } = wallFaces(room);
  const segs = segments(room);
  const y0 = room.floorY;
  const y1 = room.floorY + room.height;
  const n = room.points.length;

  const openings = room.openings ?? [];
  segs.forEach((s, i) => {
    const j = (i + 1) % n;
    const holes = openings.filter((o) => o.on === 'wall' && o.wall === i);
    if (holes.length === 0) {
      const wall = slab([inner[i], inner[j], outer[j], outer[i]], y0, y1, m.wall);
      wall.userData.wall = i;
      g.add(wall, edges(wall, m.edge));
    } else {
      for (const piece of wallWithHoles(room, i, holes, m.wall)) {
        piece.userData.wall = i;
        g.add(piece, edges(piece, m.edge));
      }
      for (const o of holes) g.add(openingLabel(room, o, i));
    }

    // Length label on the inside, just above the floor
    const el = document.createElement('div');
    el.className = 'wall-len';
    const f = document.createElement('span');
    f.className = 'dim-field';
    f.textContent = `V${i + 1}`;
    el.append(f, `${Math.round(s.length)}`);
    const lbl = new CSS2DObject(el);
    const inset = room.closed ? -250 : 0;
    lbl.position.set((s.a.x + s.b.x) / 2 + s.out.x * inset, y0 + 60, (s.a.z + s.b.z) / 2 + s.out.z * inset);
    g.add(lbl);
  });

  if (room.closed) {
    if (room.floor) g.add(slab(outer, y0 - FLOOR_SLAB, y0, m.floor));
    if (room.roof) {
      const holes: THREE.Path[] = [];
      for (const o of openings.filter((x) => x.on === 'roof')) {
        const h = roofHole(room, o);
        if (!h) continue;
        const path = new THREE.Path();
        if (o.shape === 'round') path.absarc(h.centre.x, h.centre.z, h.r, 0, Math.PI * 2, false);
        else path.setFromPoints(h.pts.map((q) => new THREE.Vector2(q.x, q.z)));
        holes.push(path);
        const el = document.createElement('div');
        el.className = 'wall-len opening-label';
        el.textContent = o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`;
        const lbl = new CSS2DObject(el);
        lbl.position.set(h.centre.x, y1 + ROOF_SLAB + 40, h.centre.z);
        g.add(lbl);
      }
      const roof = slab(outer, y1, y1 + ROOF_SLAB, m.roof, holes);
      roof.userData.roof = true;
      g.add(roof, edges(roof, m.edge));
    }
  }

  for (const run of room.runs ?? []) g.add(buildRun(room, run));
  return g;
}

/**
 * A wall with holes: the straight part is drawn as a flat shape seen from inside with the holes
 * cut out, pushed through the wall thickness. The mitred corner bits are added as small prisms.
 */
function wallWithHoles(room: Room, i: number, holes: Opening[], material: THREE.Material): THREE.Mesh[] {
  const f = wallFrame(room, i)!;
  const t = room.thickness;
  const h = room.height;
  const L = f.length;
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L, h), new THREE.Vector2(0, h)]);
  for (const o of holes) {
    const path = new THREE.Path();
    const x0 = THREE.MathUtils.clamp(o.x, 1, L - 1);
    const y0 = THREE.MathUtils.clamp(o.y, 1, h - 1);
    if (o.shape === 'round') {
      const r = Math.min(o.w / 2, (L - 2) / 2, (h - 2) / 2);
      path.absarc(THREE.MathUtils.clamp(o.x + o.w / 2, r + 1, L - r - 1), THREE.MathUtils.clamp(o.y + o.w / 2, r + 1, h - r - 1), r, 0, Math.PI * 2, false);
    } else {
      const x1 = THREE.MathUtils.clamp(o.x + o.w, x0 + 1, L - 1);
      const y1 = THREE.MathUtils.clamp(o.y + o.h, y0 + 1, h - 1);
      path.setFromPoints([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);
    }
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 32 });
  // Local x → right along the wall, y → up, z → into the room (right × up = inward)
  const outerOrigin = { x: f.origin.x + f.out.x * t, z: f.origin.z + f.out.z * t };
  geo.applyMatrix4(
    new THREE.Matrix4()
      .makeBasis(new THREE.Vector3(f.right.x, 0, f.right.z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.inward.x, 0, f.inward.z))
      .setPosition(outerOrigin.x, room.floorY, outerOrigin.z),
  );
  const main = new THREE.Mesh(geo, material);
  main.receiveShadow = true;

  // Corner bits between the straight part and the mitred ends
  const { inner, outer } = wallFaces(room);
  const n = room.points.length;
  const j = (i + 1) % n;
  const s = segments(room)[i];
  const off = (q: P) => p(q.x + s.out.x * t, q.z + s.out.z * t);
  const tri = (a: P, b: P, c: P) => {
    const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    return Math.abs(area) > 1 ? slab([a, b, c], room.floorY, room.floorY + h, material) : null;
  };
  return [main, tri(inner[i], off(inner[i]), outer[i]), tri(inner[j], outer[j], off(inner[j]))].filter((x): x is THREE.Mesh => !!x);
}

/** Size label in the middle of a wall opening, on the inside. */
function openingLabel(room: Room, o: Opening, i: number): CSS2DObject {
  const f = wallFrame(room, i)!;
  const c = framePoint(f, o.x + o.w / 2, -20);
  const el = document.createElement('div');
  el.className = 'wall-len opening-label';
  el.textContent = o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`;
  const lbl = new CSS2DObject(el);
  lbl.position.set(c.x, room.floorY + o.y + (o.shape === 'round' ? o.w : o.h) / 2, c.z);
  return lbl;
}

const runMaterials = new Map<string, THREE.Material>();
function runMaterial(key: string, color: number, metal = 0.2): THREE.Material {
  let m = runMaterials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: metal });
    runMaterials.set(key, m);
  }
  return m;
}

/** A pipe (cylinder) or cable ladder (two side rails with rungs). */
function buildRun(room: Room, run: Run): THREE.Group {
  const g = new THREE.Group();
  g.userData.run = run.id;
  const len = runLength(run);
  if (len < 1) return g;
  const dir = new THREE.Vector3(run.b[0] - run.a[0], 0, run.b[1] - run.a[1]).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  const hgt = runHeight(run);
  const centre = new THREE.Vector3((run.a[0] + run.b[0]) / 2, room.floorY + run.y + hgt / 2, (run.a[1] + run.b[1]) / 2);
  // Local frame: x = across, y = up, z = along the run
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(side, new THREE.Vector3(0, 1, 0), dir).setPosition(centre);

  if (run.kind === 'pipe') {
    const type = PIPE_TYPES[run.pipeType ?? 'ovrigt'];
    const geo = new THREE.CylinderGeometry(run.size / 2, run.size / 2, len, 32);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, runMaterial(`pipe-${run.pipeType}`, type.color, 0.1));
    mesh.castShadow = true;
    g.add(mesh);
  } else {
    const mat = runMaterial('ladder', 0xadb5bd, 0.6);
    const sheet = 2;
    const railGeo = new THREE.BoxGeometry(sheet, run.h, len);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, mat);
      rail.position.x = sx * (run.size / 2 - sheet / 2);
      rail.castShadow = true;
      g.add(rail);
    }
    const rungGeo = new THREE.BoxGeometry(run.size - 2 * sheet, 12, 25);
    const count = Math.max(1, Math.floor(len / 300));
    for (let k = 0; k <= count; k++) {
      const rung = new THREE.Mesh(rungGeo, mat);
      rung.position.set(0, -run.h / 2 + 6, -len / 2 + 12.5 + ((len - 25) * k) / count);
      g.add(rung);
    }
  }

  const el = document.createElement('div');
  el.className = 'wall-len run-label';
  el.textContent = run.kind === 'pipe' ? `${runName(room, run)} · Ø${run.size} · uk ${run.y}` : `${runName(room, run)} · ${run.size}×${run.h} · uk ${run.y}`;
  const lbl = new CSS2DObject(el);
  lbl.position.set(0, hgt / 2 + 40, 0);
  g.add(lbl);
  return g;
}

/** Is a plan point inside the room outline (inside faces)? */
export function insideRoom(room: Room, pt: P): boolean {
  const pts = room.points.map(toP);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > pt.z !== b.z > pt.z && pt.x < ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- Measuring frames for walls (openings, distances) ----------

/**
 * A wall seen from the inside: `origin` is its left inside corner, `right` runs along the inside
 * face to the right, `inward` points into the room, `out` through the wall.
 */
export interface WallFrame {
  origin: P;
  right: P;
  inward: P;
  out: P;
  length: number;
}

export function wallFrame(room: Room, i: number): WallFrame | null {
  const segs = segments(room);
  const s = segs[i];
  if (!s) return null;
  const { inner } = wallFaces(room);
  const n = room.points.length;
  const ai = inner[i];
  const bi = inner[(i + 1) % n];
  const length = Math.hypot(bi.x - ai.x, bi.z - ai.z);
  // Looking at the wall from inside (along `out`), right = out × up
  const right = p(-s.out.z, s.out.x);
  const leftIsA = right.x * s.dir.x + right.z * s.dir.z > 0;
  return { origin: leftIsA ? ai : bi, right, inward: p(-s.out.x, -s.out.z), out: s.out, length };
}

/** Plan point at `along` to the right of the wall's left corner and `into` the room. */
export function framePoint(f: WallFrame, along: number, into: number): P {
  return p(f.origin.x + f.right.x * along + f.inward.x * into, f.origin.z + f.right.z * along + f.inward.z * into);
}

/** Outline of a roof opening in the plan (rectangle corners, or centre + radius). */
export function roofHole(room: Room, o: Opening): { pts: P[]; centre: P; r: number } | null {
  const f = wallFrame(room, o.wall);
  if (!f) return null;
  if (o.shape === 'round') return { pts: [], centre: framePoint(f, o.x + o.w / 2, o.y + o.w / 2), r: o.w / 2 };
  return {
    pts: [framePoint(f, o.x, o.y), framePoint(f, o.x + o.w, o.y), framePoint(f, o.x + o.w, o.y + o.h), framePoint(f, o.x, o.y + o.h)],
    centre: framePoint(f, o.x + o.w / 2, o.y + o.h / 2),
    r: 0,
  };
}

/** Distance from a wall's inside face to a plan point, into the room (negative = behind the wall). */
export function distanceFromWall(f: WallFrame, pt: P): number {
  return (pt.x - f.origin.x) * f.inward.x + (pt.z - f.origin.z) * f.inward.z;
}

/** Every wall a run is parallel to (and in front of), with the gap between the wall and the run's side. */
export function runWallGaps(room: Room, run: Run): { wall: number; gap: number }[] {
  const dx = run.b[0] - run.a[0];
  const dz = run.b[1] - run.a[1];
  const len = Math.hypot(dx, dz);
  if (!len) return [];
  const mid = p((run.a[0] + run.b[0]) / 2, (run.a[1] + run.b[1]) / 2);
  const out: { wall: number; gap: number }[] = [];
  const segs = segments(room);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (Math.abs((dx * s.dir.x + dz * s.dir.z) / len) < 0.999) continue; // not parallel
    const d = distanceFromWall(wallFrame(room, i)!, mid);
    if (d < 0) continue;
    out.push({ wall: i, gap: Math.round(d - run.size / 2) });
  }
  return out;
}

export function runLength(run: Run): number {
  return Math.round(Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]));
}

/** Height of a run's cross-section (pipe: its diameter). */
export const runHeight = (run: Run) => (run.kind === 'pipe' ? run.size : run.h);

/** Short name: "Rör 2 (Värme)", "Kabelstege 1". */
export function runName(room: Room, run: Run): string {
  const same = (room.runs ?? []).filter((r) => r.kind === run.kind);
  const n = same.indexOf(run) + 1;
  return run.kind === 'pipe' ? `Rör ${n} (${PIPE_TYPES[run.pipeType ?? 'ovrigt'].label})` : `Kabelstege ${n}`;
}

/** "Vägg 2" / "Tak" plus size, for lists. */
export function openingName(o: Opening, index: number): string {
  const size = o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`;
  return `Hål ${index + 1} · ${o.on === 'roof' ? 'tak' : `vägg ${o.wall + 1}`} · ${size}`;
}
