// Lofted rectangular shells: a hollow tube whose cross-section changes from one rectangle
// to another along Z. Used for transitions, and later for anything tapered.

import * as THREE from 'three';

/** A rectangle in the XY plane: centre + size, mm. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Grow (or shrink, with a negative amount) a rectangle on all sides. */
export const inflate = (r: Rect, by: number): Rect => rect(r.x, r.y, r.w + 2 * by, r.h + 2 * by);

/** Rectangle part-way between a and b (t = 0 → a, t = 1 → b). */
export const lerpRect = (a: Rect, b: Rect, t: number): Rect =>
  rect(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.w + (b.w - a.w) * t, a.h + (b.h - a.h) * t);

/** Corners counter-clockwise from bottom-left. */
function corners(r: Rect, z: number): THREE.Vector3[] {
  return [
    new THREE.Vector3(r.x - r.w / 2, r.y - r.h / 2, z),
    new THREE.Vector3(r.x + r.w / 2, r.y - r.h / 2, z),
    new THREE.Vector3(r.x + r.w / 2, r.y + r.h / 2, z),
    new THREE.Vector3(r.x - r.w / 2, r.y + r.h / 2, z),
  ];
}

/**
 * Hollow lofted shell between two rectangle pairs.
 * `outer0`/`inner0` sit at z0, `outer1`/`inner1` at z1. Closes the two end rings.
 * UVs are in mm with v running along Z, so the corrugation bump map lines up across the walls.
 */
export function loftShell(
  outer0: Rect,
  inner0: Rect,
  outer1: Rect,
  inner1: Rect,
  z0: number,
  z1: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];

  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvs: number[]) => {
    // Two triangles: a-b-c, a-c-d
    for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z);
    const [ua, va, ub, vb, uc, vc, ud, vd] = uvs;
    uv.push(ua, va, ub, vb, uc, vc, ua, va, uc, vc, ud, vd);
  };

  const o0 = corners(outer0, z0);
  const o1 = corners(outer1, z1);
  const i0 = corners(inner0, z0);
  const i1 = corners(inner1, z1);

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // Walls: u = distance along the edge, v = z
    const lenO = o0[i].distanceTo(o0[j]);
    quad(o0[i], o0[j], o1[j], o1[i], [0, z0, lenO, z0, lenO, z1, 0, z1]);
    const lenI = i0[i].distanceTo(i0[j]);
    quad(i0[j], i0[i], i1[i], i1[j], [lenI, z0, 0, z0, 0, z1, lenI, z1]);
    // End rings: u/v = x/y
    quad(o0[j], o0[i], i0[i], i0[j], [o0[j].x, o0[j].y, o0[i].x, o0[i].y, i0[i].x, i0[i].y, i0[j].x, i0[j].y]);
    quad(o1[i], o1[j], i1[j], i1[i], [o1[i].x, o1[i].y, o1[j].x, o1[j].y, i1[j].x, i1[j].y, i1[i].x, i1[i].y]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals(); // non-indexed → flat shading per face
  return geo;
}

export function loftMesh(
  outer0: Rect,
  inner0: Rect,
  outer1: Rect,
  inner1: Rect,
  z0: number,
  z1: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(loftShell(outer0, inner0, outer1, inner1, z0, z1), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}