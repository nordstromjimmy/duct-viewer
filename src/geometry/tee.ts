// Builds the 3D model for a T-piece (KT).
//
// Seen from above (the plan), the T-piece is one outline: a rectangle (the run, bbbb wide) with
// the branch bulging out on one side, joined by 45° chamfers. The model is that outline with
// flat cheek plates top and bottom (cccc apart) and walls on every edge that isn't an opening.
//
// Conventions as for the other products: scene units are mm, end 1 at z = 0 facing -Z, end 2 at
// z = run length facing +Z, bbbb along X, cccc along Y. The branch (end 3) faces -X.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { runLength, TEE_COLLAR } from '../codes/kt';
import type { Tee } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort } from './ports';

/** A point in the plan: x across the run, z along it. */
interface P2 { x: number; z: number }
const p2 = (x: number, z: number): P2 => ({ x, z });

/**
 * The plan outline, counter-clockwise, plus which edges are openings.
 * Edge i runs from point i to point i + 1.
 */
function outline(p: Tee): { pts: P2[]; openings: Set<number> } {
  const b = p.width;
  const e = p.branchWidth;
  const [leg1, leg2, leg3] = p.legs;
  const L = runLength(p);
  const C = TEE_COLLAR;
  const xBranch = -b / 2 - leg3; // face of the branch opening
  const xChamfer = -b / 2 - (leg3 - C); // where the chamfer meets the branch collar

  const pts = [
    p2(b / 2, 0), // 0  end 1, right
    p2(b / 2, L), // 1  end 2, right
    p2(-b / 2, L), // 2  end 2, left
    p2(-b / 2, L - C), // 3  end of end-2 collar
    p2(xChamfer, leg1 + e), // 4  chamfer down to the branch collar
    p2(xBranch, leg1 + e), // 5  branch opening
    p2(xBranch, leg1), // 6  branch opening
    p2(xChamfer, leg1), // 7  branch collar
    p2(-b / 2, C), // 8  chamfer back to the run
    p2(-b / 2, 0), // 9  end 1, left
  ];
  void leg2; // ben 2 is part of runLength()
  // Openings: end 2 (1→2), branch (5→6), end 1 (9→0)
  return { pts, openings: new Set([1, 5, 9]) };
}

/**
 * Offset a counter-clockwise outline, edge by edge (positive = outwards). Each corner moves to
 * where its two neighbouring offset edges meet.
 */
function offsetOutline(pts: P2[], dist: (edge: number) => number): P2[] {
  const n = pts.length;
  const normal = (i: number) => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return p2((b.z - a.z) / len, -(b.x - a.x) / len); // right-hand side = outside for CCW
  };
  return pts.map((pt, i) => {
    const ia = (i - 1 + n) % n; // edge coming into this corner
    const na = normal(ia);
    const nb = normal(i);
    const ca = na.x * pts[ia].x + na.z * pts[ia].z + dist(ia);
    const cb = nb.x * pt.x + nb.z * pt.z + dist(i);
    const det = na.x * nb.z - na.z * nb.x;
    if (Math.abs(det) < 1e-9) return p2(pt.x + nb.x * dist(i), pt.z + nb.z * dist(i));
    return p2((ca * nb.z - cb * na.z) / det, (na.x * cb - nb.x * ca) / det);
  });
}

/** A flat plate with the given outline, from y0 up to y1. */
function plate(poly: P2[], y0: number, y1: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(poly.map((q) => new THREE.Vector2(q.x, q.z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // shape y → world z, extrusion → world -y
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A vertical wall along a plan edge, from y0 to y1. v0/v1 = distance along the outline (for ribs). */
function wall(a: P2, b: P2, y0: number, y1: number, v0: number, v1: number, material: THREE.Material): THREE.Mesh {
  const A0 = new THREE.Vector3(a.x, y0, a.z);
  const B0 = new THREE.Vector3(b.x, y0, b.z);
  const B1 = new THREE.Vector3(b.x, y1, b.z);
  const A1 = new THREE.Vector3(a.x, y1, a.z);
  const geo = new THREE.BufferGeometry().setFromPoints([A0, B0, B1, A0, B1, A1]);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([y0, v0, y0, v1, y1, v1, y0, v0, y1, v1, y1, v0], 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildTee(p: Tee, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  const b = p.width;
  const h = p.height;
  const e = p.branchWidth;
  const [leg1, , leg3] = p.legs;
  const L = runLength(p);
  const hh = h / 2;

  const { pts, openings } = outline(p);
  const n = pts.length;
  const walls = [...Array(n).keys()].filter((i) => !openings.has(i));
  const next = (i: number) => (i + 1) % n;

  // Distance along the outline at each corner, for the rib texture
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));

  // Sheet: cheek plates (reaching the sheet's outside, flush with the openings) and walls
  const sheetOut = offsetOutline(pts, (i) => (openings.has(i) ? 0 : SHEET));
  physical.add(plate(sheetOut, hh, hh + SHEET, mat.ductSheet));
  physical.add(plate(sheetOut, -hh - SHEET, -hh, mat.ductSheet));
  for (const i of walls) physical.add(wall(pts[i], pts[next(i)], -hh, hh, along[i], along[i] + Math.hypot(pts[next(i)].x - pts[i].x, pts[next(i)].z - pts[i].z), mat.ductSheet));

  // Insulation: wall blocks along each wall edge plus slabs on the cheeks
  const insulation = new THREE.Group();
  insulation.name = 'insulation';
  const ins = p.insulation;
  const t = ins.thickness;
  const insMat = ins.kind === 'sound' ? mat.sound : ins.kind === 'armaflex' ? mat.armaflex : mat.fire;
  if (ins.side === 'inside' && Math.min(b, e, h) - 2 * t > 0) {
    const inner = offsetOutline(pts, (i) => (openings.has(i) ? 0 : -t));
    for (const i of walls) insulation.add(plate([pts[i], pts[next(i)], inner[next(i)], inner[i]], -hh + t, hh - t, insMat));
    insulation.add(plate(pts, hh - t, hh, insMat));
    insulation.add(plate(pts, -hh, -hh + t, insMat));
    if (p.surface) {
      // Surface layer facing the air stream
      for (const i of walls) insulation.add(wall(inner[i], inner[next(i)], -hh + t, hh - t, 0, 0, mat.liner));
      insulation.add(plate(inner, hh - t - 0.8, hh - t, mat.liner));
      insulation.add(plate(inner, -hh + t, -hh + t + 0.8, mat.liner));
    }
  } else if (ins.side === 'outside') {
    // Stopped short of each opening so the joint can be made
    const stop = TEE_COLLAR * 0.75;
    const a = offsetOutline(pts, (i) => (openings.has(i) ? -stop : SHEET));
    const o = offsetOutline(pts, (i) => (openings.has(i) ? -stop : SHEET + t));
    const yo = hh + SHEET;
    for (const i of walls) insulation.add(plate([a[i], a[next(i)], o[next(i)], o[i]], -yo, yo, insMat));
    insulation.add(plate(o, yo, yo + t, insMat));
    insulation.add(plate(o, -yo - t, -yo, insMat));
  }
  physical.add(insulation);

  // Ends
  const end1 = buildEnd(p.ends[0], { w: b, h, mat });
  end1.rotation.y = Math.PI; // face -Z
  physical.add(end1);

  const end2 = buildEnd(p.ends[1], { w: b, h, mat });
  end2.position.z = L;
  physical.add(end2);

  const xBranch = -b / 2 - leg3;
  const end3 = buildEnd(p.branchEnd, { w: e, h, mat });
  end3.position.set(xBranch, 0, leg1 + e / 2);
  end3.rotation.y = -Math.PI / 2; // face -X, opening width along Z
  physical.add(end3);

  const bounds = new THREE.Box3().setFromObject(physical);

  // Labels
  const outsideIns = ins.side === 'outside' ? t : 0;
  const overhang = Math.max(endOverhang(p.ends[0]), endOverhang(p.ends[1]), endOverhang(p.branchEnd), outsideIns);
  const gap = overhang + Math.max(60, Math.min(b, h) * 0.15);
  const W = b / 2 + SHEET;
  const H = hh + SHEET;
  const tag = (text: string, x: number, z: number) => {
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, H + overhang + 40, z);
    root.add(obj);
  };
  tag('End 1', W + overhang + 40, 0);
  tag('End 2', W + overhang + 40, L);
  tag('End 3 · branch', xBranch - overhang - 40, leg1 + e / 2);

  // Dimensions
  const dims = new THREE.Group();
  dims.name = 'dimensions';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Run opening at end 2 (the end the 3D view looks at): bbbb across the top, cccc on the branch side
  dims.add(dimension(V(-W, H, L), V(W, H, L), V(0, gap, 0), `${p.width}`, 'bbbb'));
  dims.add(dimension(V(-W, -H, L), V(-W, H, L), V(-gap, 0, 0), `${p.height}`, 'cccc'));
  // Branch width along the top of the branch opening
  dims.add(dimension(V(xBranch - SHEET, H, leg1), V(xBranch - SHEET, H, leg1 + e), V(-gap, 0, 0), `${p.branchWidth}`, 'eeee'));
  // Run length along the bottom of the straight side
  dims.add(dimension(V(W, -H, 0), V(W, -H, L), V(gap * 0.7, -gap * 0.7, 0), `${L}`));
  root.add(dims);

  return {
    root,
    insulation,
    dimensions: dims,
    bounds,
    // Cut horizontally so the section shows the T shape
    section: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    // From the branch side, so the branch and end 2 are both in view
    iso: new THREE.Vector3(-1.1, 0.9, 1.2).normalize(),
    ports: [
      rectPort('end1', 'End 1', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), b, h, p.ends[0]),
      rectPort('end2', 'End 2', new THREE.Vector3(0, 0, L), new THREE.Vector3(0, 0, 1), b, h, p.ends[1]),
      rectPort('end3', 'End 3 · branch', new THREE.Vector3(xBranch, 0, leg1 + e / 2), new THREE.Vector3(-1, 0, 0), e, h, p.branchEnd),
    ],
  };
}
