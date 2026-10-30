// Swept rectangular shells: a hollow tube built from a list of cross-sections ("stations"),
// each given as four 3D corners. Handles curved paths (bends) and changing sizes.

import * as THREE from 'three';

/** Four corners of a rectangular cross-section, in a consistent order around the section. */
export type Ring = [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];

/**
 * Hollow shell between an outer and an inner surface, both given as matching lists of rings.
 * `v` is the distance along the path at each station (mm), used for the corrugation UVs.
 * The first and last stations are closed with end rings.
 */
export function sweepShell(
  outer: Ring[],
  inner: Ring[],
  v: number[],
  /** Which ring edges (0–3) get the corrugation; the others get a flat UV. */
  ribbed: number[] = [0, 1, 2, 3],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];

  const quad = (
    a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
    ua: number, va: number, ub: number, vb: number, uc: number, vc: number, ud: number, vd: number,
  ) => {
    for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z);
    uv.push(ua, va, ub, vb, uc, vc, ua, va, uc, vc, ud, vd);
  };

  const n = outer.length;
  for (let k = 0; k < n - 1; k++) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const rib = ribbed.includes(i);
      const va = rib ? v[k] : 0;
      const vb = rib ? v[k + 1] : 0;
      const o0 = outer[k], o1 = outer[k + 1];
      const lo = o0[i].distanceTo(o0[j]);
      quad(o0[i], o0[j], o1[j], o1[i], 0, va, lo, va, lo, vb, 0, vb);
      if (inner.length) {
        const i0 = inner[k], i1 = inner[k + 1];
        const li = i0[i].distanceTo(i0[j]);
        quad(i0[j], i0[i], i1[i], i1[j], li, va, 0, va, 0, vb, li, vb);
      }
    }
  }

  // End rings (or plain caps when there's no inner surface)
  for (const k of [0, n - 1]) {
    const o = outer[k];
    if (inner.length) {
      const ir = inner[k];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        quad(o[i], o[j], ir[j], ir[i], 0, 0, 1, 0, 1, 1, 0, 1);
      }
    } else {
      quad(o[0], o[1], o[2], o[3], 0, 0, 1, 0, 1, 1, 0, 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

export function sweepMesh(
  outer: Ring[],
  inner: Ring[],
  v: number[],
  material: THREE.Material,
  ribbed?: number[],
): THREE.Mesh {
  const mesh = new THREE.Mesh(sweepShell(outer, inner, v, ribbed), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A thin ribbon (single surface) through pairs of points – used for guide vanes. */
export function ribbon(a: THREE.Vector3[], b: THREE.Vector3[], material: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  for (let k = 0; k < a.length - 1; k++) {
    for (const p of [a[k], b[k], b[k + 1], a[k], b[k + 1], a[k + 1]]) pos.push(p.x, p.y, p.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}
