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
}

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
function slab(poly: P[], y0: number, y1: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(poly.map((q) => new THREE.Vector2(q.x, q.z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
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

  segs.forEach((s, i) => {
    const j = (i + 1) % n;
    const wall = slab([inner[i], inner[j], outer[j], outer[i]], y0, y1, m.wall);
    wall.userData.wall = i;
    g.add(wall, edges(wall, m.edge));

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
      const roof = slab(outer, y1, y1 + ROOF_SLAB, m.roof);
      g.add(roof, edges(roof, m.edge));
    }
  }
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
