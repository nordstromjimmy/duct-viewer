// 3D builders for each end type.
// Every builder works in "end space": the duct opening lies in the XY plane at z = 0,
// the duct body runs towards -Z and +Z points away from the duct.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { EndCode } from '../codes/types';
import type { Materials } from './materials';
import { ringMesh, spacedPositions } from './shapes';

/** Name of the group showing a loose PG set floating in front of an L end. */
export const LOOSE_PG = 'loosePG';

/** Sheet thickness, mm (visual). */
export const SHEET = 1;
/** PG profile height outward from the duct wall, mm (the "20" in the datasheet drawing). */
export const PG_HEIGHT = 20;
const PG_DEPTH = 14;
/** Flange width for end type F, mm. */
export const FLANGE_WIDTH = 40;

export interface EndContext {
  /** Opening (inner) width and height, mm. */
  w: number;
  h: number;
  mat: Materials;
}

/** How far each end type reaches out beyond the duct wall (used for dimension placement). */
export function endOverhang(code: EndCode): number {
  switch (code) {
    case 'PG':
    case 'B':
      return PG_HEIGHT;
    case 'F':
      return FLANGE_WIDTH;
    case 'FALSAD_B':
      return 8;
    default:
      return 0;
  }
}

/** PG profile folded from the duct sheet: front ring, outer lip and a short return. */
function pgProfile(ctx: EndContext, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const ow = ctx.w + 2 * SHEET; // duct outside
  const oh = ctx.h + 2 * SHEET;
  const fw = ow + 2 * PG_HEIGHT; // profile outside
  const fh = oh + 2 * PG_HEIGHT;

  g.add(ringMesh(fw, fh, ow, oh, -1.5, 0, material)); // front face
  g.add(ringMesh(fw, fh, fw - 2 * 1.2, fh - 2 * 1.2, -PG_DEPTH, 0, material)); // outer lip
  g.add(ringMesh(fw, fh, fw - 2 * 7, fh - 2 * 7, -PG_DEPTH, -PG_DEPTH + 1.2, material)); // return fold
  return g;
}

/** PG corners: L-shaped plates tucked inside the PG profile at each corner. */
function pgCorners(ctx: EndContext, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const ow = ctx.w + 2 * SHEET;
  const oh = ctx.h + 2 * SHEET;
  const leg = Math.min(80, ow / 3, oh / 3);
  const thick = 3;

  // L-shaped corner plate (top-right corner), mirrored to the other three.
  // It stays within the profile height so nothing sticks out past the PG.
  const shape = new THREE.Shape();
  const x0 = ow / 2;
  const y0 = oh / 2;
  const x1 = x0 + PG_HEIGHT - 2;
  const y1 = y0 + PG_HEIGHT - 2;
  shape.moveTo(x0 - leg, y0);
  shape.lineTo(x0, y0);
  shape.lineTo(x0, y0 - leg);
  shape.lineTo(x1, y0 - leg);
  shape.lineTo(x1, y1);
  shape.lineTo(x0 - leg, y1);
  shape.lineTo(x0 - leg, y0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });

  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const plate = new THREE.Mesh(geo, material);
    plate.position.z = -PG_DEPTH + 2;
    plate.castShadow = true;
    plate.scale.set(sx, sy, 1);
    g.add(plate);
  }
  return g;
}

/** Mounted gasket on the PG face. */
function gasket(ctx: EndContext): THREE.Mesh {
  const ow = ctx.w + 2 * SHEET;
  const oh = ctx.h + 2 * SHEET;
  return ringMesh(ow + 2 * 14, oh + 2 * 14, ow + 2 * 2, oh + 2 * 2, 0, 2.5, ctx.mat.gasket);
}

function pgEnd(ctx: EndContext): THREE.Group {
  const g = new THREE.Group();
  g.add(pgProfile(ctx, ctx.mat.profile));
  g.add(pgCorners(ctx, ctx.mat.corner));
  g.add(gasket(ctx));
  return g;
}

function label(text: string, x: number, y: number, z: number, className = 'scene-label'): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  return obj;
}

/** Plain end, with the PG set shown floating loose in front of it. */
function looseEnd(ctx: EndContext): THREE.Group {
  const g = new THREE.Group();
  // Everything that shows the loose set is in one group, so the assembly can drop it
  const loose = new THREE.Group();
  loose.name = LOOSE_PG;
  const set = new THREE.Group();
  set.add(pgProfile(ctx, ctx.mat.loose));
  set.add(pgCorners(ctx, ctx.mat.loose));
  const gap = Math.max(150, Math.min(ctx.w, ctx.h) * 0.3);
  set.position.z = gap;
  loose.add(set);
  loose.add(label('Loose PG set', 0, ctx.h / 2 + PG_HEIGHT + 40, gap, 'scene-label scene-label--accent'));
  g.add(loose);
  return g;
}

/** 40 mm flange made from an L-profile, with bolt holes. */
function flangeEnd(ctx: EndContext): THREE.Group {
  const g = new THREE.Group();
  const ow = ctx.w + 2 * SHEET;
  const oh = ctx.h + 2 * SHEET;
  const fw = ow + 2 * FLANGE_WIDTH;
  const fh = oh + 2 * FLANGE_WIDTH;
  const t = 3;

  g.add(ringMesh(fw, fh, ow, oh, -t, 0, ctx.mat.profile)); // flange face
  g.add(ringMesh(ow + 2 * t, oh + 2 * t, ow, oh, -30, -t, ctx.mat.profile)); // sleeve on the duct

  // Bolt holes, ~200 mm spacing, centred in the flange
  const holeGeo = new THREE.CylinderGeometry(5, 5, t + 0.6, 16);
  holeGeo.rotateX(Math.PI / 2);
  const off = FLANGE_WIDTH / 2 + SHEET;
  const xs = spacedPositions(ow + 2 * off, 200);
  const ys = spacedPositions(oh + 2 * off, 200);
  const add = (x: number, y: number) => {
    const hole = new THREE.Mesh(holeGeo, ctx.mat.gasket);
    hole.position.set(x, y, -t / 2);
    g.add(hole);
  };
  const hx = ow / 2 + off - SHEET;
  const hy = oh / 2 + off - SHEET;
  for (const x of xs) { add(x, hy); add(x, -hy); }
  for (const y of ys.slice(1, -1)) { add(hx, y); add(-hx, y); }
  return g;
}

/** Blind cap with PG profile (PG-botten). */
function pgCapEnd(ctx: EndContext): THREE.Group {
  const g = pgEnd(ctx);
  const ow = ctx.w + 2 * SHEET;
  const oh = ctx.h + 2 * SHEET;
  const cap = new THREE.Group();
  cap.add(pgProfile(ctx, ctx.mat.profile));
  cap.add(ringMesh(ow + 2 * PG_HEIGHT, oh + 2 * PG_HEIGHT, 0, 0, -1.2, 0, ctx.mat.galvanized)); // blind plate
  // Mirror the cap's PG so it faces the duct's PG across the gasket
  cap.scale.z = -1;
  cap.position.z = 2.5;
  g.add(cap);
  return g;
}

/** Fixed cap: plate set into the opening and riveted through the duct walls. */
function fixedCapEnd(ctx: EndContext): THREE.Group {
  const g = new THREE.Group();
  const lip = 25;
  g.add(ringMesh(ctx.w, ctx.h, 0, 0, -3, -1.8, ctx.mat.galvanized)); // plate
  g.add(ringMesh(ctx.w, ctx.h, ctx.w - 2.4, ctx.h - 2.4, -3 - lip, -3, ctx.mat.galvanized)); // folded lip

  const rivetGeo = new THREE.SphereGeometry(3.2, 12, 8);
  const z = -3 - lip / 2;
  const ow = ctx.w / 2 + SHEET;
  const oh = ctx.h / 2 + SHEET;
  const rivet = (x: number, y: number) => {
    const r = new THREE.Mesh(rivetGeo, ctx.mat.bolt);
    r.position.set(x, y, z);
    r.scale.set(x === ow || x === -ow ? 0.4 : 1, y === oh || y === -oh ? 0.4 : 1, 1);
    g.add(r);
  };
  for (const x of spacedPositions(ctx.w, 150, 30)) { rivet(x, oh); rivet(x, -oh); }
  for (const y of spacedPositions(ctx.h, 150, 30)) { rivet(ow, y); rivet(-ow, y); }
  return g;
}

/** Seamed cap: plate joined to the duct with a folded seam around the outside. */
function seamedCapEnd(ctx: EndContext): THREE.Group {
  const g = new THREE.Group();
  const ow = ctx.w + 2 * SHEET;
  const oh = ctx.h + 2 * SHEET;
  const seam = 8;
  g.add(ringMesh(ow + 2 * seam, oh + 2 * seam, ow, oh, -10, 0, ctx.mat.profile)); // seam bead
  g.add(ringMesh(ow + 2 * seam, oh + 2 * seam, 0, 0, 0, 1.2, ctx.mat.galvanized)); // cap plate
  return g;
}

/** Wire mesh grille across the opening. */
function meshGrilleEnd(ctx: EndContext): THREE.Group {
  const g = new THREE.Group();
  const spacing = 40;
  const r = 1.4;
  const z = -6;
  // Frame
  g.add(ringMesh(ctx.w, ctx.h, ctx.w - 2 * 15, ctx.h - 2 * 15, z - 2, z + 2, ctx.mat.galvanized));

  const xGeo = new THREE.CylinderGeometry(r, r, ctx.w, 6);
  xGeo.rotateZ(Math.PI / 2);
  const yGeo = new THREE.CylinderGeometry(r, r, ctx.h, 6);
  for (const y of spacedPositions(ctx.h, spacing, 0).slice(1, -1)) {
    const wire = new THREE.Mesh(xGeo, ctx.mat.wire);
    wire.position.set(0, y, z + r);
    g.add(wire);
  }
  for (const x of spacedPositions(ctx.w, spacing, 0).slice(1, -1)) {
    const wire = new THREE.Mesh(yGeo, ctx.mat.wire);
    wire.position.set(x, 0, z - r);
    g.add(wire);
  }
  return g;
}

export function buildEnd(code: EndCode, ctx: EndContext): THREE.Group {
  switch (code) {
    case 'PG': return pgEnd(ctx);
    case 'L': return looseEnd(ctx);
    case 'P': return new THREE.Group();
    case 'F': return flangeEnd(ctx);
    case 'B': return pgCapEnd(ctx);
    case 'FAST_B': return fixedCapEnd(ctx);
    case 'FALSAD_B': return seamedCapEnd(ctx);
    case 'TN': return meshGrilleEnd(ctx);
  }
}
