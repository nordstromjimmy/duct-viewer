// Do any parts in the assembly hit the walls or the roof?
//
// Every mesh of every part is turned into an oriented box (its own bounding box, turned and
// moved with the part) and tested against each wall's box with the separating axis test. That
// keeps straight ducts exact; curved parts like bends are checked a little generously.

import * as THREE from 'three';
import type { Layout } from '../assembly/layout';
import { insideRoom, ROOF_SLAB, segments, type Room } from './model';

export interface Collision {
  partId: string;
  target: 'wall' | 'roof';
  /** Wall index (0-based) for wall hits. */
  wall?: number;
}

/** Touching is fine (a unit standing on the floor, a duct against a wall): boxes shrink by this. */
const TOLERANCE = 5;

interface OBB {
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

/** Oriented boxes for all meshes of a part, in world coordinates. */
function partBoxes(part: Layout['parts'][number]): OBB[] {
  const out: OBB[] = [];
  part.model.root.updateMatrixWorld(true);
  part.model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    if (box.isEmpty()) return;
    // Model space → world: the part's placement times the mesh's place inside the part
    const m = part.matrix.clone().multiply(mesh.matrixWorld);
    out.push(obbFrom(box, m, TOLERANCE));
  });
  return out;
}

export function findCollisions(room: Room, lay: Layout): Collision[] {
  if (room.points.length < 2) return [];
  const segs = segments(room);
  const up = new THREE.Vector3(0, 1, 0);
  const h = room.height;

  // Wall boxes: along the inside line, as thick as the wall, on the outside of the line
  // (closed room) or centred on it (open chain)
  const walls: OBB[] = segs.map((s) => {
    const shift = room.closed ? room.thickness / 2 : 0;
    return {
      c: new THREE.Vector3((s.a.x + s.b.x) / 2 + s.out.x * shift, room.floorY + h / 2, (s.a.z + s.b.z) / 2 + s.out.z * shift),
      u: [new THREE.Vector3(s.dir.x, 0, s.dir.z), up.clone(), new THREE.Vector3(s.out.x, 0, s.out.z)],
      e: [s.length / 2, h / 2, room.thickness / 2],
    };
  });
  const ceiling = room.floorY + h;
  const checkRoof = room.closed && room.roof;

  const hits: Collision[] = [];
  for (const part of lay.parts) {
    const boxes = partBoxes(part);
    const hitWalls = new Set<number>();
    let hitRoof = false;
    for (const box of boxes) {
      walls.forEach((w, i) => {
        if (!hitWalls.has(i) && overlap(box, w)) hitWalls.add(i);
      });
      if (checkRoof && !hitRoof) {
        // Highest point of the box above the ceiling, somewhere over the room
        const top = box.c.y + Math.abs(box.u[0].y) * box.e[0] + Math.abs(box.u[1].y) * box.e[1] + Math.abs(box.u[2].y) * box.e[2];
        const bottom = 2 * box.c.y - top;
        if (top > ceiling && bottom < ceiling + ROOF_SLAB && insideRoom(room, { x: box.c.x, z: box.c.z })) hitRoof = true;
      }
    }
    for (const i of [...hitWalls].sort((a, b) => a - b)) hits.push({ partId: part.asm.id, target: 'wall', wall: i });
    if (hitRoof) hits.push({ partId: part.asm.id, target: 'roof' });
  }
  return hits;
}
