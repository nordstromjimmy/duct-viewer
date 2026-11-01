// Do any parts in the assembly hit the walls or the roof?
//
// Two steps: every mesh of every part is first turned into an oriented box (its own bounding box,
// turned and moved with the part) for a quick separating-axis test. Only when that box touches a
// wall, the roof, a pipe or a ladder are the mesh's real triangles checked – each triangle is
// clipped to the obstacle, so a transition's empty corner or the inside of a bend's curve no
// longer counts. Pipes are checked as real cylinders.

import * as THREE from 'three';
import type { Layout } from '../assembly/layout';
import { insideRoom, ROOF_SLAB, runHeight, segments, wallFrame, type Opening, type Room } from './model';

export interface Collision {
  partId: string;
  target: 'wall' | 'roof' | 'run';
  /** Wall index (0-based) for wall hits. */
  wall?: number;
  /** Pipe/ladder id for run hits. */
  run?: string;
}

/** Touching is fine (a unit standing on the floor, a duct against a wall): boxes shrink by this. */
const TOLERANCE = 5;

export interface OBB {
  c: THREE.Vector3;
  u: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  e: [number, number, number];
}

/** Oriented box from a local bounding box and the matrix that places it. */
function obbFrom(box: THREE.Box3, m: THREE.Matrix4, shrink: number): OBB {
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  m.extractBasis(x, y, z);
  const size = box.getSize(new THREE.Vector3());
  const sx = x.length();
  const sy = y.length();
  const sz = z.length();
  return {
    c: box.getCenter(new THREE.Vector3()).applyMatrix4(m),
    u: [x.normalize(), y.normalize(), z.normalize()],
    e: [
      Math.max(0, (size.x * sx) / 2 - shrink),
      Math.max(0, (size.y * sy) / 2 - shrink),
      Math.max(0, (size.z * sz) / 2 - shrink),
    ],
  };
}

/** Separating axis test for two oriented boxes (Ericson, Real-Time Collision Detection 4.4.1). */
function overlap(a: OBB, b: OBB): boolean {
  const R: number[][] = [[], [], []];
  const AbsR: number[][] = [[], [], []];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = a.u[i].dot(b.u[j]);
      AbsR[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }
  const d = b.c.clone().sub(a.c);
  const t = [d.dot(a.u[0]), d.dot(a.u[1]), d.dot(a.u[2])];
  const ae = a.e;
  const be = b.e;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(t[i]) > ae[i] + be[0] * AbsR[i][0] + be[1] * AbsR[i][1] + be[2] * AbsR[i][2]) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = ae[0] * AbsR[0][j] + ae[1] * AbsR[1][j] + ae[2] * AbsR[2][j];
    if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > ra + be[j]) return false;
  }
  // Cross products of the axes
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;
      const ra = ae[i1] * AbsR[i2][j] + ae[i2] * AbsR[i1][j];
      const rb = be[j1] * AbsR[i][j2] + be[j2] * AbsR[i][j1];
      if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb) return false;
    }
  }
  return true;
}

/** One mesh of a part: its quick box, and its triangles in world space (worked out when needed). */
interface MeshShape {
  box: OBB;
  mesh: THREE.Mesh;
  matrix: THREE.Matrix4;
  tris?: Float32Array;
}

function partShapes(part: Layout['parts'][number]): MeshShape[] {
  const out: MeshShape[] = [];
  const root = part.model.root;
  root.updateMatrixWorld(true);
  // The root may already sit in the scene (with the part's placement applied) – measure inside it
  const rootInv = root.matrixWorld.clone().invert();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !mesh.visible) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    if (box.isEmpty()) return;
    // Model space → world: the part's placement times the mesh's place inside the part
    const matrix = part.matrix.clone().multiply(rootInv.clone().multiply(mesh.matrixWorld));
    out.push({ box: obbFrom(box, matrix, TOLERANCE), mesh, matrix });
  });
  return out;
}

/** The mesh's triangles in world coordinates, 9 numbers per triangle. */
function triangles(s: MeshShape): Float32Array {
  if (s.tris) return s.tris;
  const geo = s.mesh.geometry;
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const count = index ? index.count : pos.count;
  const tris = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(s.matrix);
    tris[k * 3] = v.x;
    tris[k * 3 + 1] = v.y;
    tris[k * 3 + 2] = v.z;
  }
  s.tris = tris;
  return tris;
}

/** Clip a convex polygon to one side of a plane: keep points with dot(p, n) <= d. */
function clipPlane(poly: THREE.Vector3[], n: THREE.Vector3, d: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a.dot(n) - d;
    const db = b.dot(n) - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(a.clone().lerp(b, da / (da - db)));
  }
  return out;
}

/** The part of a triangle that lies inside a box (empty when they don't touch). */
function clipToBox(tri: THREE.Vector3[], box: OBB): THREE.Vector3[] {
  let poly = tri;
  for (let k = 0; k < 3 && poly.length; k++) {
    const u = box.u[k];
    const c = box.c.dot(u);
    poly = clipPlane(poly, u, c + box.e[k]);
    if (poly.length) poly = clipPlane(poly, u.clone().negate(), -(c - box.e[k]));
  }
  return poly;
}

/** Run `test` on each triangle's piece inside `box`; stops at the first true. */
function someTriangle(s: MeshShape, box: OBB, test: (piece: THREE.Vector3[]) => boolean): boolean {
  if (!overlap(s.box, box)) return false;
  const t = triangles(s);
  for (let k = 0; k < t.length; k += 9) {
    const tri = [
      new THREE.Vector3(t[k], t[k + 1], t[k + 2]),
      new THREE.Vector3(t[k + 3], t[k + 4], t[k + 5]),
      new THREE.Vector3(t[k + 6], t[k + 7], t[k + 8]),
    ];
    const piece = clipToBox(tri, box);
    if (piece.length && test(piece)) return true;
  }
  return false;
}

/** Are all points (in the opening's own measures u/v) inside the opening? Touching the edge is fine. */
function fitsOpening(o: Opening, pts: [number, number][]): boolean {
  if (o.shape === 'round') {
    const r = o.w / 2;
    return pts.every(([u, v]) => Math.hypot(u - (o.x + r), v - (o.y + r)) <= r + TOLERANCE);
  }
  return pts.every(([u, v]) => u >= o.x - TOLERANCE && u <= o.x + o.w + TOLERANCE && v >= o.y - TOLERANCE && v <= o.y + o.h + TOLERANCE);
}

/** Shortest distance from a point to a convex 2D polygon (0 when inside). */
function distToPolygon(px: number, py: number, poly: [number, number][]): number {
  let inside = poly.length >= 3;
  let sign = 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const cross = ex * (py - ay) - ey * (px - ax);
    if (Math.abs(cross) > 1e-9) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) inside = false;
    }
    const len2 = ex * ex + ey * ey;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + ex * t), py - (ay + ey * t)));
  }
  return inside && sign !== 0 ? 0 : best;
}

export function findCollisions(room: Room, lay: Layout): Collision[] {
  if (room.points.length < 2) return [];
  const segs = segments(room);
  const up = new THREE.Vector3(0, 1, 0);
  const h = room.height;
  const openings = room.openings ?? [];

  // Wall boxes: along the inside line, as thick as the wall, on the outside of the line
  // (closed room) or centred on it (open chain). Thinned a little so touching a wall is fine.
  const walls: OBB[] = segs.map((s) => {
    const shift = room.closed ? room.thickness / 2 : 0;
    return {
      c: new THREE.Vector3((s.a.x + s.b.x) / 2 + s.out.x * shift, room.floorY + h / 2, (s.a.z + s.b.z) / 2 + s.out.z * shift),
      u: [new THREE.Vector3(s.dir.x, 0, s.dir.z), up.clone(), new THREE.Vector3(s.out.x, 0, s.out.z)],
      e: [s.length / 2, h / 2, Math.max(1, room.thickness / 2 - TOLERANCE)],
    };
  });
  const frames = segs.map((_, i) => wallFrame(room, i)!);
  const wallHoles = segs.map((_, i) => openings.filter((o) => o.on === 'wall' && o.wall === i));
  const roofHoles = openings.filter((o) => o.on === 'roof');
  const ceiling = room.floorY + h;
  const checkRoof = room.closed && room.roof;
  // The roof as a thin layer across everything; what's inside the room outline counts
  const roofBox: OBB = {
    c: new THREE.Vector3(0, ceiling + (TOLERANCE + ROOF_SLAB) / 2, 0),
    u: [new THREE.Vector3(1, 0, 0), up.clone(), new THREE.Vector3(0, 0, 1)],
    e: [1e7, (ROOF_SLAB - TOLERANCE) / 2, 1e7],
  };

  // Pipes and ladders: a box each (thinned so touching is fine); pipes are then checked as cylinders
  const runs = (room.runs ?? []).flatMap((run) => {
    const dx = run.b[0] - run.a[0];
    const dz = run.b[1] - run.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1) return [];
    const dir = new THREE.Vector3(dx / len, 0, dz / len);
    const side = new THREE.Vector3().crossVectors(up, dir);
    const hgt = runHeight(run);
    const box: OBB = {
      c: new THREE.Vector3((run.a[0] + run.b[0]) / 2, room.floorY + run.y + hgt / 2, (run.a[1] + run.b[1]) / 2),
      u: [side, up.clone(), dir],
      e: [Math.max(1, run.size / 2 - TOLERANCE), Math.max(1, hgt / 2 - TOLERANCE), len / 2],
    };
    return [{ run, box, r: run.kind === 'pipe' ? run.size / 2 - TOLERANCE : 0 }];
  });

  const hits: Collision[] = [];
  for (const part of lay.parts) {
    const shapes = partShapes(part);
    const hitWalls: number[] = [];
    walls.forEach((w, i) => {
      const f = frames[i];
      const holes = wallHoles[i];
      const inWall = (piece: THREE.Vector3[]) => {
        if (!holes.length) return true;
        // Where the piece sits on the wall, seen from inside
        const uv = piece.map((q): [number, number] => [(q.x - f.origin.x) * f.right.x + (q.z - f.origin.z) * f.right.z, q.y - room.floorY]);
        return !holes.some((o) => fitsOpening(o, uv));
      };
      if (shapes.some((s) => someTriangle(s, w, inWall))) hitWalls.push(i);
    });

    let hitRoof = false;
    if (checkRoof) {
      const inRoof = (piece: THREE.Vector3[]) => {
        if (!piece.some((q) => insideRoom(room, { x: q.x, z: q.z }))) return false;
        return !roofHoles.some((o) => {
          const f = wallFrame(room, o.wall);
          if (!f) return false;
          const uv = piece.map((q): [number, number] => [
            (q.x - f.origin.x) * f.right.x + (q.z - f.origin.z) * f.right.z,
            (q.x - f.origin.x) * f.inward.x + (q.z - f.origin.z) * f.inward.z,
          ]);
          return fitsOpening(o, uv);
        });
      };
      hitRoof = shapes.some((s) => someTriangle(s, roofBox, inRoof));
    }

    const hitRuns: string[] = [];
    for (const { run, box, r } of runs) {
      const test =
        run.kind === 'pipe'
          ? (piece: THREE.Vector3[]) => {
              // Seen end-on, does the piece come within the pipe's radius of its centre line?
              const across = piece.map((q): [number, number] => {
                const d = q.clone().sub(box.c);
                return [d.dot(box.u[0]), d.dot(box.u[1])];
              });
              return distToPolygon(0, 0, across) <= r;
            }
          : () => true;
      if (shapes.some((s) => someTriangle(s, box, test))) hitRuns.push(run.id);
    }

    for (const i of hitWalls) hits.push({ partId: part.asm.id, target: 'wall', wall: i });
    if (hitRoof) hits.push({ partId: part.asm.id, target: 'roof' });
    for (const id of hitRuns) hits.push({ partId: part.asm.id, target: 'run', run: id });
  }
  return hits;
}

/** Points on the parts' real surfaces, in world coordinates (for distances to walls and floor). */
export function assemblyCorners(lay: Layout): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const part of lay.parts) {
    for (const s of partShapes(part)) {
      const pos = s.mesh.geometry.getAttribute('position');
      for (let k = 0; k < pos.count; k++) out.push(new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(s.matrix));
    }
  }
  return out;
}
