// Builds the 3D model for a rectangular-to-round transition (KÖ).
//
// Built like a sheet-metal "square to round": each rectangle side is a flat triangle up to the
// circle, and each rectangle corner fans out to a quarter of the circle. Those are the lines you
// see on the datasheet drawing.
//
// Conventions as for the other products: scene units are mm, the rectangular end (end 1) is at
// z = 0 facing -Z, bbbb along X, cccc along Y. The taper ends at z = ffff and the nipple/socket
// continues from there.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RECT_COLLAR, roundEndOffset, SPIGOT_LENGTH } from '../codes/ko';
import type { RoundTransition } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort, roundPort } from './ports';
import { ringMesh } from './shapes';

/** Circle points per quarter. */
const QUARTER_SEGMENTS = 16;
const RADIAL_SEGMENTS = QUARTER_SEGMENTS * 4;

/** Geometry from a flat list of triangle corners. */
function triangles(points: THREE.Vector3[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The tapered part: rectangle (w x h, centred) at z0 to circle (centre cx/cy, radius r) at z1.
 * Returns the flat side faces and the curved corner fans separately – the fans get smooth
 * normals so they read as cones rather than facets.
 */
function squareToRound(w: number, h: number, cx: number, cy: number, r: number, z0: number, z1: number) {
  const corner = [
    new THREE.Vector3(w / 2, -h / 2, z0), // bottom right
    new THREE.Vector3(w / 2, h / 2, z0), // top right
    new THREE.Vector3(-w / 2, h / 2, z0), // top left
    new THREE.Vector3(-w / 2, -h / 2, z0), // bottom left
  ];
  const circle = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), z1);
  };

  const flat: THREE.Vector3[] = [];
  const fans: THREE.Vector3[] = [];
  // Side k runs from corner[k] to corner[k+1]; its outward direction is at 0°, 90°, 180°, 270°.
  for (let k = 0; k < 4; k++) {
    const a = corner[k];
    const b = corner[(k + 1) % 4];
    const sideDeg = k * 90;
    flat.push(a, b, circle(sideDeg));
    // Corner b fans across the quarter from this side's direction to the next side's
    for (let i = 0; i < QUARTER_SEGMENTS; i++) {
      const d0 = sideDeg + (90 * i) / QUARTER_SEGMENTS;
      const d1 = sideDeg + (90 * (i + 1)) / QUARTER_SEGMENTS;
      fans.push(b, circle(d1), circle(d0));
    }
  }

  const fanGeo = mergeVertices(new THREE.BufferGeometry().setFromPoints(fans));
  fanGeo.computeVertexNormals();
  return { flat: triangles(flat), fans: fanGeo };
}

/** Open cylinder along +Z from z0 to z1. */
function tube(cx: number, cy: number, r: number, z0: number, z1: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, z1 - z0, RADIAL_SEGMENTS, 1, true);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx, cy, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Ring (torus) around the Z axis at z. */
function ring(cx: number, cy: number, r: number, tubeR: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tubeR, 8, RADIAL_SEGMENTS), material);
  mesh.position.set(cx, cy, z);
  return mesh;
}

export function buildRoundTransition(p: RoundTransition, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  const w = p.width;
  const h = p.height;
  const r = p.diameter / 2;
  const L = p.length;
  const off = roundEndOffset(p);

  // Rectangular collar (holds the PG profile), corrugated like the ducts
  physical.add(ringMesh(w + 2 * SHEET, h + 2 * SHEET, w, h, 0, RECT_COLLAR, mat.ductSheet));

  // Taper
  const taper = squareToRound(w + 2 * SHEET, h + 2 * SHEET, off.x, off.y, r, RECT_COLLAR, L);
  for (const geo of [taper.flat, taper.fans]) {
    const mesh = new THREE.Mesh(geo, mat.galvanized);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    physical.add(mesh);
  }

  // Circular end
  const zTip = L + SPIGOT_LENGTH;
  if (p.roundEnd === 'nipple') {
    // Nipple: slides into the spiral duct, so slightly under nominal, with two rubber gaskets
    const rn = r - 1;
    physical.add(tube(off.x, off.y, rn, L, zTip, mat.galvanized));
    physical.add(ring(off.x, off.y, r, 2.5, L + 4, mat.profile)); // bead at the base
    physical.add(ring(off.x, off.y, rn + 1, 2.2, zTip - 14, mat.gasket));
    physical.add(ring(off.x, off.y, rn + 1, 2.2, zTip - 30, mat.gasket));
  } else {
    // Socket: the spiral duct slides into it, so slightly over nominal
    const rs = r + 1.5;
    physical.add(tube(off.x, off.y, rs, L, zTip, mat.galvanized));
    physical.add(ring(off.x, off.y, rs, 2, L + SPIGOT_LENGTH / 2, mat.profile)); // stop bead
    physical.add(ring(off.x, off.y, rs - 1.5, 1.6, zTip - 3, mat.gasket)); // gasket at the mouth
  }

  // Rectangular end
  const end1 = buildEnd(p.ends[0], { w, h, mat });
  end1.rotation.y = Math.PI; // face -Z
  physical.add(end1);

  const insulation = new THREE.Group(); // KÖ is always uninsulated
  insulation.name = 'insulation';
  physical.add(insulation);

  const bounds = new THREE.Box3().setFromObject(physical);

  // Labels
  const overhang = endOverhang(p.ends[0]);
  const gap = overhang + Math.max(60, Math.min(w, h) * 0.15);
  const W = w / 2 + SHEET;
  const H = h / 2 + SHEET;
  const tag = (text: string, pos: THREE.Vector3) => {
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    root.add(obj);
  };
  tag('End 1 · rect', new THREE.Vector3(-W - overhang - 40, H + overhang + 40, 0));
  tag(`End 2 · Ø${p.diameter} ${p.roundEnd === 'nipple' ? 'nipple' : 'socket'}`, new THREE.Vector3(off.x - r - 40, off.y + r + 60, zTip));

  // Dimensions
  const dims = new THREE.Group();
  dims.name = 'dimensions';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Rectangular end: bbbb across the top, cccc up the right side
  dims.add(dimension(V(-W, H, 0), V(W, H, 0), V(0, gap, 0), `${p.width}`, 'bbbb'));
  dims.add(dimension(V(W, -H, 0), V(W, H, 0), V(gap, 0, 0), `${p.height}`, 'cccc'));
  // Circular end: diameter across the top of the circle, lifted clear of the rectangle
  const lift = Math.max(gap, H + gap - (off.y + r));
  dims.add(dimension(V(off.x - r, off.y + r, L), V(off.x + r, off.y + r, L), V(0, lift, 0), `Ø${p.diameter}`, 'eeee'));
  // ffff from the rectangular end to the base of the nipple/socket, along the bottom right
  dims.add(dimension(V(W, -H, 0), V(W, -H, L), V(gap * 0.7, -gap * 0.7, 0), `${p.length}`, 'ffff'));
  root.add(dims);

  const ports = [
    rectPort('end1', 'End 1 · rect', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), w, h, p.ends[0]),
    roundPort('end2', 'End 2 · round', new THREE.Vector3(off.x, off.y, zTip), new THREE.Vector3(0, 0, 1), p.diameter, p.roundEnd === 'nipple' ? 'NIPPEL' : 'MUFF'),
  ];

  return { root, insulation, dimensions: dims, bounds, ports };
}
