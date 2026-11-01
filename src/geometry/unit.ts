// Builds the 3D model for a generic ventilation unit (AGG).
//
// Deliberately brand-neutral: a painted cabinet on a base frame, aluminium-look edge profiles,
// door panels with plain handles on the front, and colour-coded duct connections:
// intake green, exhaust brown, supply blue, extract yellow.
//
// Coordinates: centred on the origin, X along the length, Y up, Z towards the front (doors).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { connSize, ROLES, slotFrame, UNIT_BASE } from '../codes/agg';
import type { UnitConnection, VentUnit } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import type { Materials } from './materials';
import type { Port } from './ports';
import { ringMesh } from './shapes';

/** How far the connection collars stick out, mm. */
const COLLAR = 60;
/** Edge profile size, mm. */
const EDGE = 36;

function box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const v3 = (a: [number, number, number]) => new THREE.Vector3(...a);

function roleMaterial(c: UnitConnection, mat: Materials): THREE.Material {
  switch (c.role) {
    case 'UTE': return mat.connUTE;
    case 'AVL': return mat.connAVL;
    case 'TILL': return mat.connTILL;
    case 'FRÅN': return mat.connFRAN;
  }
}

/** One connection: collar, colour band, flange and a dark opening. Built in its own frame:
 *  X across (width), Y along `up` (height), Z out of the unit. */
function connection(c: UnitConnection, mat: Materials): THREE.Group {
  const g = new THREE.Group();
  const t = 2;
  const band = roleMaterial(c, mat);
  const { w, h } = c;
  g.add(box(w, h, 2, 0, 0, 2, mat.unitRecess)); // the opening seen through the collar
  g.add(ringMesh(w + 2 * t, h + 2 * t, w, h, 0, COLLAR, mat.galvanized));
  g.add(ringMesh(w + 2 * t + 8, h + 2 * t + 8, w + 2 * t, h + 2 * t, 10, 32, band));
  g.add(ringMesh(w + 2 * 22, h + 2 * 22, w + 2 * t, h + 2 * t, COLLAR - 10, COLLAR, mat.profile)); // flange
  return g;
}

export function buildUnit(p: VentUnit, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  const L = p.length;
  const D = p.depth;
  const H = p.height;
  const hc = H - UNIT_BASE;
  const yc = -H / 2 + UNIT_BASE + hc / 2;
  const yb = -H / 2; // floor

  // Base frame
  const rail = 70;
  physical.add(box(L, UNIT_BASE, rail, 0, yb + UNIT_BASE / 2, D / 2 - rail / 2, mat.unitFrame));
  physical.add(box(L, UNIT_BASE, rail, 0, yb + UNIT_BASE / 2, -D / 2 + rail / 2, mat.unitFrame));
  physical.add(box(rail, UNIT_BASE, D - 2 * rail, L / 2 - rail / 2, yb + UNIT_BASE / 2, 0, mat.unitFrame));
  physical.add(box(rail, UNIT_BASE, D - 2 * rail, -L / 2 + rail / 2, yb + UNIT_BASE / 2, 0, mat.unitFrame));

  // Casing
  physical.add(box(L - 2, hc - 2, D - 2, 0, yc, 0, mat.unitCasing));

  // Edge profiles on all twelve edges
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) physical.add(box(L, EDGE, EDGE, 0, yc + (sy * (hc - EDGE)) / 2, (sz * (D - EDGE)) / 2, mat.unitEdge));
    for (const sx of [-1, 1]) physical.add(box(EDGE, EDGE, D, (sx * (L - EDGE)) / 2, yc + (sy * (hc - EDGE)) / 2, 0, mat.unitEdge));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) physical.add(box(EDGE, hc, EDGE, (sx * (L - EDGE)) / 2, yc, (sz * (D - EDGE)) / 2, mat.unitEdge));
  }

  // Front: door panels with plain handles (skipped where a front connection is)
  const doors = Math.max(2, Math.round(L / 850));
  const usable = L - 2 * EDGE;
  const dw = usable / doors;
  const frontConns = p.connections.filter((c) => c.face === 'F');
  for (let i = 0; i < doors; i++) {
    const x0 = -L / 2 + EDGE + i * dw;
    const cx = x0 + dw / 2;
    const blocked = frontConns.some((c) => Math.abs(slotFrame(p, 'F', c.slot).center[0] - cx) < dw / 2 + c.w / 2);
    if (blocked) continue;
    const doorH = hc - 2 * EDGE - 30;
    physical.add(box(dw - 14, doorH, 8, cx, yc, D / 2 + 4, mat.unitDoor));
    const hx = i % 2 === 0 ? x0 + dw - 110 : x0 + 110; // handles on the opening side
    for (const hy of [yc + doorH * 0.32, yc - doorH * 0.32]) {
      physical.add(box(150, 56, 16, hx, hy, D / 2 + 16, mat.unitHandle));
      physical.add(box(108, 12, 8, hx, hy, D / 2 + 26, mat.unitEdge));
    }
  }

  // Top: panel seams
  const panels = Math.max(2, Math.round(L / 1200));
  for (let i = 1; i < panels; i++) {
    physical.add(box(10, 3, D - 2 * EDGE, -L / 2 + (L / panels) * i, H / 2 + 1, 0, mat.unitEdge));
  }

  // Connections
  const ports: Port[] = [];
  const labels = new THREE.Group();
  for (const c of p.connections) {
    const f = slotFrame(p, c.face, c.slot);
    const n = v3(f.normal);
    const up = v3(f.up);
    const across = new THREE.Vector3().crossVectors(up, n); // same frame the assembly markers use
    const g = connection(c, mat);
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(across, up, n).setPosition(v3(f.center));
    physical.add(g);

    const role = ROLES[c.role];
    ports.push({
      id: role.port,
      label: role.label,
      position: v3(f.center).addScaledVector(n, COLLAR),
      normal: n,
      up,
      shape: 'rect',
      w: c.w,
      h: c.h,
      end: 'PG',
      open: true,
    });

    // Label floating just outside the connection
    const el = document.createElement('div');
    el.className = 'scene-label unit-conn';
    el.style.setProperty('--role', role.color);
    el.textContent = `${role.label} ${connSize(c)}`;
    const lbl = new CSS2DObject(el);
    lbl.position.copy(v3(f.center).addScaledVector(n, COLLAR + 120));
    labels.add(lbl);
  }
  root.add(labels);

  const insulation = new THREE.Group(); // units aren't insulated here
  insulation.name = 'insulation';
  physical.add(insulation);

  const bounds = new THREE.Box3().setFromObject(physical);

  // Dimensions: length along the front, depth along the right end, height at the front-right corner
  const dims = new THREE.Group();
  dims.name = 'dimensions';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const gap = 200;
  dims.add(dimension(V(-L / 2, yb, D / 2), V(L / 2, yb, D / 2), V(0, 0, gap), `${L}`, 'L'));
  dims.add(dimension(V(L / 2, yb, D / 2), V(L / 2, yb, -D / 2), V(gap, 0, 0), `${D}`, 'D'));
  dims.add(dimension(V(L / 2, yb, D / 2), V(L / 2, H / 2, D / 2), V(gap * 0.7, 0, gap * 0.7), `${H}`, 'H'));
  root.add(dims);

  // Ports in a fixed order (supply, extract, intake, exhaust) so new ducts start from supply
  const order = ['end3', 'end4', 'end1', 'end2'];
  ports.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return { root, insulation, dimensions: dims, bounds, ports };
}
