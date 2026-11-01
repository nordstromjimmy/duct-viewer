// Builds the 3D model for a straight duct (KK).
// Scene units are millimetres. The duct runs along Z, centred on the origin:
// end 1 at z = -length/2, end 2 at z = +length/2. Width (largest side) is X, height is Y.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { StraightDuct } from '../codes/types';
import { dimension } from './dimensions';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort, type Port } from './ports';
import { ringMesh } from './shapes';

export interface DuctModel {
  root: THREE.Group;
  insulation: THREE.Group;
  dimensions: THREE.Group;
  /** Bounding box of the physical model (excluding dimensions). */
  bounds: THREE.Box3;
  /** Plane used by the Section toggle (keeps the side the normal points to). Default: cut along X. */
  section?: THREE.Plane;
  /** Direction the "3D" view looks from (towards the model). Default: front-right-above. */
  iso?: THREE.Vector3;
  /** Openings other parts can connect to (used by the assembly). */
  ports: Port[];
}

function buildInsulation(d: StraightDuct, mat: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'insulation';
  const ins = d.insulation;
  if (ins.side === 'none') return g;

  const t = ins.thickness;
  const L = d.length;
  const material = ins.kind === 'sound' ? mat.sound : ins.kind === 'armaflex' ? mat.armaflex : mat.fire;

  if (ins.side === 'inside') {
    const iw = d.width - 2 * t;
    const ih = d.height - 2 * t;
    if (iw <= 0 || ih <= 0) return g; // too thick for this size – parser warns
    g.add(ringMesh(d.width, d.height, iw, ih, -L / 2 + 2, L / 2 - 2, material));
    if (d.surface) {
      // Surface layer facing the air stream
      g.add(ringMesh(iw, ih, iw - 2 * 0.8, ih - 2 * 0.8, -L / 2 + 2, L / 2 - 2, mat.liner));
    }
  } else {
    // Wrapped outside – stopped short of each end so the joint can be made
    const ow = d.width + 2 * SHEET;
    const oh = d.height + 2 * SHEET;
    const stop = Math.min(80, L / 4);
    g.add(ringMesh(ow + 2 * t, oh + 2 * t, ow, oh, -L / 2 + stop, L / 2 - stop, material));
  }
  return g;
}

function buildDimensions(d: StraightDuct, overhang: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dimensions';
  const W = d.width / 2 + SHEET;
  const H = d.height / 2 + SHEET;
  const zEnd = d.length / 2;
  const gap = overhang + Math.max(60, Math.min(d.width, d.height) * 0.15);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Width across the top of end 2
  g.add(dimension(V(-W, H, zEnd), V(W, H, zEnd), V(0, gap, 0), `${d.width}`, 'bbbb'));
  // Height up the right side of end 2
  g.add(dimension(V(W, -H, zEnd), V(W, H, zEnd), V(gap, 0, 0), `${d.height}`, 'cccc'));
  // Length along the bottom right edge
  g.add(dimension(V(W, -H, -zEnd), V(W, -H, zEnd), V(gap * 0.7, -gap * 0.7, 0), `${d.length}`,
    d.variant >= 3 ? 'eeee' : undefined)); // standard lengths come from "a", not a field
  return g;
}

function endTag(text: string, z: number, d: StraightDuct, overhang: number): CSS2DObject {
  const el = document.createElement('div');
  el.className = 'scene-label';
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(-d.width / 2 - overhang - 40, d.height / 2 + overhang + 40, z);
  return obj;
}

export function buildDuct(d: StraightDuct, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  // Duct body: sheet ring extruded along the full length
  physical.add(
    ringMesh(d.width + 2 * SHEET, d.height + 2 * SHEET, d.width, d.height, -d.length / 2, d.length / 2, mat.ductSheet),
  );

  // Ends
  const ctx = { w: d.width, h: d.height, mat };
  const end1 = buildEnd(d.ends[0], ctx);
  end1.position.z = -d.length / 2;
  end1.rotation.y = Math.PI; // face -Z
  physical.add(end1);

  const end2 = buildEnd(d.ends[1], ctx);
  end2.position.z = d.length / 2;
  physical.add(end2);

  const insulation = buildInsulation(d, mat);
  physical.add(insulation);

  // Bounds of the physical model, used to frame the camera
  const bounds = new THREE.Box3().setFromObject(physical);

  const outsideIns = d.insulation.side === 'outside' ? d.insulation.thickness : 0;
  const overhang = Math.max(endOverhang(d.ends[0]), endOverhang(d.ends[1]), outsideIns);

  root.add(endTag('Ände 1', -d.length / 2, d, overhang));
  root.add(endTag('Ände 2', d.length / 2, d, overhang));

  const dimensions = buildDimensions(d, overhang);
  root.add(dimensions);

  const ports = [
    rectPort('end1', 'Ände 1', new THREE.Vector3(0, 0, -d.length / 2), new THREE.Vector3(0, 0, -1), d.width, d.height, d.ends[0]),
    rectPort('end2', 'Ände 2', new THREE.Vector3(0, 0, d.length / 2), new THREE.Vector3(0, 0, 1), d.width, d.height, d.ends[1]),
  ];

  return { root, insulation, dimensions, bounds, ports };
}

/** Free up GPU memory for a model that's being replaced. */
export function disposeModel(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    if (o instanceof CSS2DObject) o.element.remove();
  });
}
