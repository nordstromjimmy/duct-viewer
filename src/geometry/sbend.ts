// Builds the 3D model for an S-bend (KS).
// Same conventions as the other products: scene units are mm, end 1 at z = 0 facing -Z,
// bbbb along X, cccc along Y. The duct runs straight for a short collar, slopes across by
// eeee (towards -X) and runs straight again into end 2 at z = ffff.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { collarLength } from '../codes/ks';
import type { SBend } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort } from './ports';
import { sweepMesh, type Ring } from './sweep';

export function buildSBend(p: SBend, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  const L = p.length;
  const S = collarLength(p);

  /** Centre of the cross-section along X at a given z. */
  const centreX = (z: number) => {
    if (z <= S) return 0;
    if (z >= L - S) return -p.offset;
    return (-p.offset * (z - S)) / (L - 2 * S);
  };

  /** Rectangular ring of the given size (centred on the duct axis) at each z. */
  const rings = (zs: number[], w: number, h: number): Ring[] =>
    zs.map((z) => {
      const x = centreX(z);
      return [
        new THREE.Vector3(x - w / 2, -h / 2, z),
        new THREE.Vector3(x + w / 2, -h / 2, z),
        new THREE.Vector3(x + w / 2, h / 2, z),
        new THREE.Vector3(x - w / 2, h / 2, z),
      ];
    });

  const w = p.width;
  const h = p.height;
  const zs = [0, S, L - S, L];

  // Sheet body (UV v = z, so the ribs run across the duct)
  physical.add(sweepMesh(rings(zs, w + 2 * SHEET, h + 2 * SHEET), rings(zs, w, h), zs, mat.ductSheet));

  // Insulation
  const insulation = new THREE.Group();
  insulation.name = 'insulation';
  const ins = p.insulation;
  const insMat = ins.kind === 'sound' ? mat.sound : ins.kind === 'armaflex' ? mat.armaflex : mat.fire;
  const t = ins.thickness;
  if (ins.side === 'inside' && Math.min(w, h) - 2 * t > 0) {
    const zi = [2, S, L - S, L - 2];
    insulation.add(sweepMesh(rings(zi, w, h), rings(zi, w - 2 * t, h - 2 * t), zi, insMat));
    if (p.surface) {
      insulation.add(
        sweepMesh(rings(zi, w - 2 * t, h - 2 * t), rings(zi, w - 2 * t - 1.6, h - 2 * t - 1.6), zi, mat.liner),
      );
    }
  } else if (ins.side === 'outside') {
    // Stopped short of each end so the joint can be made
    const stop = Math.min(80, L / 4);
    const zo = [stop, S, L - S, L - stop];
    const ow = w + 2 * SHEET;
    const oh = h + 2 * SHEET;
    insulation.add(sweepMesh(rings(zo, ow + 2 * t, oh + 2 * t), rings(zo, ow, oh), zo, insMat));
  }
  physical.add(insulation);

  // Ends
  const end1 = buildEnd(p.ends[0], { w, h, mat });
  end1.rotation.y = Math.PI; // face -Z
  physical.add(end1);

  const end2 = buildEnd(p.ends[1], { w, h, mat });
  end2.position.set(-p.offset, 0, L);
  physical.add(end2);

  const bounds = new THREE.Box3().setFromObject(physical);

  // Labels
  const outsideIns = ins.side === 'outside' ? t : 0;
  const overhang = Math.max(endOverhang(p.ends[0]), endOverhang(p.ends[1]), outsideIns);
  const gap = overhang + Math.max(60, Math.min(w, h) * 0.15);
  const W = w / 2 + SHEET;
  const H = h / 2 + SHEET;

  const tag = (text: string, x: number, z: number) => {
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, H + overhang + 40, z);
    root.add(obj);
  };
  tag('Ände 1', -W - overhang - 40, 0);
  tag('Ände 2', -p.offset - W - overhang - 40, L);

  // Dimensions
  const dims = new THREE.Group();
  dims.name = 'dimensions';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const x2 = -p.offset; // centre of end 2
  // bbbb across the top and cccc up the side of end 2 (the end the 3D view looks at)
  dims.add(dimension(V(x2 - W, H, L), V(x2 + W, H, L), V(0, gap, 0), `${p.width}`, 'bbbb'));
  dims.add(dimension(V(x2 + W, -H, L), V(x2 + W, H, L), V(gap, 0, 0), `${p.height}`, 'cccc'));
  // eeee: offset between the -X edges of the two ends, drawn under end 2
  dims.add(dimension(V(-W, -H, L), V(x2 - W, -H, L), V(0, -gap, 0), `${p.offset}`, 'eeee'));
  // ffff along the +X bottom edge of end 1
  dims.add(dimension(V(W, -H, 0), V(W, -H, L), V(gap * 0.7, -gap * 0.7, 0), `${p.length}`, 'ffff'));
  root.add(dims);

  return {
    root,
    insulation,
    dimensions: dims,
    bounds,
    // Cut horizontally so the section shows the S shape
    section: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    // Higher than the straight-duct view so the S shape (in the XZ plane) reads clearly
    iso: new THREE.Vector3(1, 1.5, 1.3).normalize(),
    ports: [
      rectPort('end1', 'Ände 1', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), w, h, p.ends[0]),
      rectPort('end2', 'Ände 2', new THREE.Vector3(-p.offset, 0, L), new THREE.Vector3(0, 0, 1), w, h, p.ends[1]),
    ],
  };
}
