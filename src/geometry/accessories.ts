// 3D models for the generic silencer (LD) and damper (SP).
// Same conventions as a straight duct: centred on the origin, running along Z,
// end 1 at z = -length/2 facing -Z, end 2 at z = +length/2. Width along X, height along Y.

import * as THREE from 'three';
import { baffleLayout } from '../codes/accessories';
import type { Damper, Silencer } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort, type Port } from './ports';
import { ringMesh } from './shapes';

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z);

/** Rectangular ends (PG etc.) at both ends of a straight body. */
function rectEnds(p: Silencer | Damper, mat: Materials, g: THREE.Group) {
  const ctx = { w: p.width, h: p.height, mat };
  const e1 = buildEnd(p.ends[0], ctx);
  e1.position.z = -p.length / 2;
  e1.rotation.y = Math.PI;
  g.add(e1);
  const e2 = buildEnd(p.ends[1], ctx);
  e2.position.z = p.length / 2;
  g.add(e2);
}

function ports(p: Silencer | Damper): Port[] {
  const z = p.length / 2;
  const a = new THREE.Vector3(0, 0, -z);
  const b = new THREE.Vector3(0, 0, z);
  return [
    rectPort('end1', 'Ände 1', a, new THREE.Vector3(0, 0, -1), p.width, p.height, p.ends[0]),
    rectPort('end2', 'Ände 2', b, new THREE.Vector3(0, 0, 1), p.width, p.height, p.ends[1]),
  ];
}

/** Dimensions: width and height on end 2, length along the bottom. */
function dims(p: Silencer | Damper): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dimensions';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const z = p.length / 2;
  const gap = Math.max(endOverhang(p.ends[0]), endOverhang(p.ends[1])) + Math.max(60, Math.min(p.width, p.height) * 0.15);
  const W = p.width / 2 + SHEET;
  const H = p.height / 2 + SHEET;
  g.add(dimension(V(-W, H, z), V(W, H, z), V(0, gap, 0), `${p.width}`));
  g.add(dimension(V(W, -H, z), V(W, H, z), V(gap, 0, 0), `${p.height}`));
  g.add(dimension(V(W, -H, -z), V(W, -H, z), V(gap * 0.7, -gap * 0.7, 0), `${p.length}`));
  return g;
}

function finish(root: THREE.Group, physical: THREE.Group, p: Silencer | Damper): DuctModel {
  const insulation = new THREE.Group();
  insulation.name = 'insulation';
  physical.add(insulation);
  const bounds = new THREE.Box3().setFromObject(physical);
  const dimensions = dims(p);
  root.add(dimensions);
  return { root, insulation, dimensions, bounds, ports: ports(p) };
}

// ---------- Silencer ----------

export function buildSilencer(p: Silencer, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);
  const L = p.length;

  // Rectangular: plain casing with sound-absorbing baffles inside
  const w = p.width;
  const h = p.height;
  physical.add(ringMesh(w + 2 * SHEET, h + 2 * SHEET, w, h, -L / 2, L / 2, mat.galvanized));
  const { thickness: t, gap } = baffleLayout(w, p.baffles);
  const inset = Math.min(60, L * 0.1); // baffles stop short of the ends
  const bl = L - 2 * inset - t; // straight part, the rounded noses add t/2 at each end
  for (let i = 0; i < p.baffles; i++) {
    const x = -w / 2 + gap / 2 + t / 2 + i * (t + gap);
    physical.add(box(t, h - 2, Math.max(bl, 1), mat.sound, x, 0, 0));
    for (const s of [-1, 1]) {
      // Rounded perforated-sheet nose at each end
      const nose = new THREE.CylinderGeometry(t / 2, t / 2, h - 2, 24, 1, false, s < 0 ? Math.PI : 0, Math.PI);
      physical.add(mesh(nose, mat.liner, x, 0, (s * bl) / 2));
    }
  }
  rectEnds(p, mat, physical);
  return finish(root, physical, p);
}

// ---------- Damper ----------

/** Manual quadrant (sector plate + lever), motor or fire actuator, on the +X side. */
function drive(p: Damper, mat: Materials, xSide: number, axleY: number): THREE.Group {
  const g = new THREE.Group();
  if (p.type === 1) {
    const sector = new THREE.CylinderGeometry(70, 70, 4, 24, 1, false, -Math.PI / 4, Math.PI / 2);
    sector.rotateZ(Math.PI / 2); // face +X
    g.add(mesh(sector, mat.profile, xSide + 4, axleY, 0));
    g.add(box(10, 90, 16, mat.unitHandle, xSide + 14, axleY + 40, 0)); // lever
    const knob = mesh(new THREE.SphereGeometry(10, 16, 12), mat.unitHandle, xSide + 14, axleY + 88, 0);
    g.add(knob);
  } else {
    const actuator = p.type === 3 ? mat.fireRed : mat.actuator;
    const len = Math.min(200, p.length - 20);
    g.add(box(80, 110, len, actuator, xSide + 46, axleY, 0));
    g.add(box(6, 120, Math.min(len + 20, p.length), mat.profile, xSide + 3, axleY, 0)); // mounting bracket
    if (p.type === 3) g.add(box(40, 40, 60, mat.actuator, xSide + 26, axleY - 110, 0)); // thermal release
  }
  return g;
}

export function buildDamper(p: Damper, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);
  const L = p.length;
  const open = THREE.MathUtils.degToRad(30); // blades drawn partly open

  const w = p.width;
  const h = p.height;
  physical.add(ringMesh(w + 2 * SHEET, h + 2 * SHEET, w, h, -L / 2, L / 2, mat.galvanized));

  if (p.type === 3) {
    // Fire damper: one insulated blade, shown open (along the airflow)
    const depth = Math.min(L - 40, h * 0.9);
    physical.add(box(w - 6, 30, depth, mat.fire));
    const shaft = new THREE.CylinderGeometry(6, 6, w + 30, 12);
    shaft.rotateZ(Math.PI / 2);
    physical.add(mesh(shaft, mat.bolt));
  } else {
    // Multi-blade, opposed blades
    const n = Math.max(1, Math.round(h / 180));
    const pitch = h / n;
    const bladeDepth = Math.min(pitch * 0.95, L - 20);
    for (let i = 0; i < n; i++) {
      const y = -h / 2 + pitch * (i + 0.5);
      const blade = new THREE.BoxGeometry(w - 6, bladeDepth, 3);
      blade.rotateX(Math.PI / 2 - (i % 2 ? -open : open));
      physical.add(mesh(blade, mat.profile, 0, y, 0));
      const shaft = new THREE.CylinderGeometry(4, 4, w + 24, 10);
      shaft.rotateZ(Math.PI / 2);
      physical.add(mesh(shaft, mat.bolt, 0, y, 0));
    }
  }
  const axleY = p.type === 3 ? 0 : -h / 2 + h / Math.max(1, Math.round(h / 180)) / 2;
  physical.add(drive(p, mat, w / 2 + SHEET, axleY));
  rectEnds(p, mat, physical);
  return finish(root, physical, p);
}
