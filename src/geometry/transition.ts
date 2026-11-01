// Builds the 3D model for a transition (KD).
// Same conventions as the straight duct: scene units are mm, the part runs along Z,
// end 1 (big end) at z = -length/2 facing -Z, end 2 (small end) at z = +length/2.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { smallEndOffset } from '../codes/kd';
import type { Transition } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import { inflate, lerpRect, loftMesh, rect, type Rect } from './loft';
import type { Materials } from './materials';
import { rectPort } from './ports';

function buildInsulation(p: Transition, big: Rect, small: Rect, mat: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'insulation';
  const ins = p.insulation;
  if (ins.side === 'none') return g;

  const t = ins.thickness;
  const z0 = -p.length / 2;
  const z1 = p.length / 2;
  const material = ins.kind === 'sound' ? mat.sound : ins.kind === 'armaflex' ? mat.armaflex : mat.fire;

  if (ins.side === 'inside') {
    const bigIn = inflate(big, -t);
    const smallIn = inflate(small, -t);
    if (Math.min(bigIn.w, bigIn.h, smallIn.w, smallIn.h) <= 0) return g; // parser warns
    g.add(loftMesh(big, bigIn, small, smallIn, z0 + 2, z1 - 2, material));
    if (p.surface) {
      g.add(loftMesh(bigIn, inflate(bigIn, -0.8), smallIn, inflate(smallIn, -0.8), z0 + 2, z1 - 2, mat.liner));
    }
  } else {
    // Wrapped outside, stopped short of each end so the joint can be made
    const stop = Math.min(80, p.length / 4);
    const a = inflate(lerpRect(big, small, stop / p.length), SHEET);
    const b = inflate(lerpRect(big, small, 1 - stop / p.length), SHEET);
    g.add(loftMesh(inflate(a, t), a, inflate(b, t), b, z0 + stop, z1 - stop, material));
  }
  return g;
}

function tag(text: string, x: number, y: number, z: number): CSS2DObject {
  const el = document.createElement('div');
  el.className = 'scene-label';
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  return obj;
}

function buildDimensions(p: Transition, big: Rect, small: Rect, overhang: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dimensions';
  const z0 = -p.length / 2;
  const z1 = p.length / 2;
  const T = SHEET;
  const gap = overhang + Math.max(60, Math.min(p.width, p.height) * 0.15);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Outermost extents of the sheet, so every dimension clears the whole part
  const maxX = Math.max(big.x + big.w / 2, small.x + small.w / 2) + T;
  const maxY = Math.max(big.y + big.h / 2, small.y + small.h / 2) + T;
  const minY = Math.min(big.y - big.h / 2, small.y - small.h / 2) - T;

  for (const [r, z] of [[big, z0], [small, z1]] as [Rect, number][]) {
    const left = r.x - r.w / 2 - T;
    const right = r.x + r.w / 2 + T;
    const top = r.y + r.h / 2 + T;
    const bottom = r.y - r.h / 2 - T;
    const isBig = r === big;
    const w = isBig ? p.width : p.smallWidth;
    const h = isBig ? p.height : p.smallHeight;
    g.add(dimension(V(left, top, z), V(right, top, z), V(0, maxY - top + gap, 0), `${w}`, isBig ? 'bbbb' : 'eeee'));
    g.add(dimension(V(right, bottom, z), V(right, top, z), V(maxX - right + gap, 0, 0), `${h}`, isBig ? 'cccc' : 'ffff'));
  }
  g.add(dimension(V(maxX, minY, z0), V(maxX, minY, z1), V(gap * 0.7, -gap * 0.7, 0), `${p.length}`, 'gggg'));
  return g;
}

export function buildTransition(p: Transition, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  const z0 = -p.length / 2;
  const z1 = p.length / 2;
  const off = smallEndOffset(p);
  const big = rect(0, 0, p.width, p.height); // openings (inside of the sheet)
  const small = rect(off.x, off.y, p.smallWidth, p.smallHeight);

  // Sheet body
  physical.add(loftMesh(inflate(big, SHEET), big, inflate(small, SHEET), small, z0, z1, mat.ductSheet));

  // Ends
  const end1 = buildEnd(p.ends[0], { w: p.width, h: p.height, mat });
  end1.position.z = z0;
  end1.rotation.y = Math.PI; // face -Z
  physical.add(end1);

  const end2 = buildEnd(p.ends[1], { w: p.smallWidth, h: p.smallHeight, mat });
  end2.position.set(off.x, off.y, z1);
  physical.add(end2);

  const insulation = buildInsulation(p, big, small, mat);
  physical.add(insulation);

  const bounds = new THREE.Box3().setFromObject(physical);

  const outsideIns = p.insulation.side === 'outside' ? p.insulation.thickness : 0;
  const overhang = Math.max(endOverhang(p.ends[0]), endOverhang(p.ends[1]), outsideIns);

  root.add(tag('Ände 1 · stor', -p.width / 2 - overhang - 40, p.height / 2 + overhang + 40, z0));
  root.add(tag('Ände 2 · liten', off.x - p.smallWidth / 2 - overhang - 40, off.y + p.smallHeight / 2 + overhang + 40, z1));

  const dimensions = buildDimensions(p, big, small, overhang);
  root.add(dimensions);

  const ports = [
    rectPort('end1', 'Ände 1 · stor', new THREE.Vector3(0, 0, z0), new THREE.Vector3(0, 0, -1), p.width, p.height, p.ends[0]),
    rectPort('end2', 'Ände 2 · liten', new THREE.Vector3(off.x, off.y, z1), new THREE.Vector3(0, 0, 1), p.smallWidth, p.smallHeight, p.ends[1]),
  ];

  return { root, insulation, dimensions, bounds, ports };
}
