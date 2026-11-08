// A straight duct made to a sketch: end 2 closed, with one corner (seen from end 1) rounded or
// cut straight so the piece fits a tight space. End 1 is drawn with its normal end type.
//
// Same frame as a straight duct: runs along Z, end 1 at z = -L/2, end 2 at +L/2; width along X
// (left = +X seen from end 1), height along Y.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { StraightDuct } from '../codes/types';
import type { EndShape } from '../store';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort } from './ports';

/** The duct seen from above (x, z) with the shaped corner, as a closed outline. */
export function shapedOutline(W: number, L: number, s: EndShape, segments = 24): [number, number][] {
  const sgn = s.corner === 'left' ? 1 : -1;
  const along = Math.min(Math.max(s.along, 0), L);
  const across = Math.min(Math.max(s.across, 0), W);
  const xs = (sgn * W) / 2; // the shaped side
  const z2 = L / 2;
  // From the shaped side, round the corner, across end 2 to the other side
  const corner: [number, number][] = [];
  if (s.kind === 'round') {
    const cx = xs - sgn * across;
    const cz = z2 - along;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * (Math.PI / 2);
      corner.push([cx + sgn * across * Math.cos(t), cz + along * Math.sin(t)]);
    }
  } else {
    corner.push([xs, z2 - along], [xs - sgn * across, z2]);
  }
  const pts: [number, number][] = [[xs, -L / 2], ...corner, [-xs, z2], [-xs, -L / 2]];
  // Keep the outline counter-clockwise seen from above (+Y)
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, zz2] = pts[(i + 1) % pts.length];
    area += x1 * zz2 - x2 * z1;
  }
  return area < 0 ? pts.reverse() : pts;
}

export function buildShapedDuct(d: StraightDuct, shape: EndShape, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);
  const W = d.width + 2 * SHEET;
  const H = d.height + 2 * SHEET;
  const L = d.length;
  const outline = shapedOutline(W, L, shape);

  // Side walls: a band around the outline, open at end 1
  const n = outline.length;
  const start = outline.findIndex(([x, z], i) => {
    const [x2, z2] = outline[(i + 1) % n];
    return Math.abs(z + L / 2) < 0.01 && Math.abs(z2 + L / 2) < 0.01 && x !== x2; // the end 1 edge
  });
  const ring: [number, number][] = [];
  for (let k = 1; k <= n; k++) ring.push(outline[(start + k) % n]); // from the end 1 edge's far corner, round to its near one
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  ring.forEach(([x, z], i) => {
    if (i > 0) run += Math.hypot(x - ring[i - 1][0], z - ring[i - 1][1]);
    pos.push(x, -H / 2, z, x, H / 2, z);
    uv.push(0, run, H, run);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  band.setIndex(idx);
  band.computeVertexNormals();
  const walls = new THREE.Mesh(band, mat.ductSheet);
  walls.castShadow = true;
  walls.receiveShadow = true;
  physical.add(walls);

  // Top and bottom: the outline as flat plates
  const plateShape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const y of [H / 2, -H / 2]) {
    const geo = new THREE.ShapeGeometry(plateShape, 24);
    geo.rotateX(Math.PI / 2); // shape y → world z
    const plate = new THREE.Mesh(geo, mat.ductSheet);
    plate.position.y = y;
    plate.castShadow = true;
    physical.add(plate);
  }

  // End 1 with its normal end type
  const end1 = buildEnd(d.ends[0], { w: d.width, h: d.height, mat });
  end1.position.z = -L / 2;
  end1.rotation.y = Math.PI;
  physical.add(end1);

  const bounds = new THREE.Box3().setFromObject(physical);

  // Labels
  const tag = (text: string, x: number, y: number, z: number) => {
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    root.add(obj);
  };
  const over = endOverhang(d.ends[0]);
  tag('Ände 1', -W / 2 - over - 40, H / 2 + over + 40, -L / 2);
  tag('Stängd · enligt skiss', 0, H / 2 + 60, L / 2);

  // Dimensions: opening at end 1, the full length on the straight side, and the shaped corner
  const dims = new THREE.Group();
  dims.name = 'dimensions';
  const gap = over + Math.max(60, Math.min(d.width, d.height) * 0.15);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const sgn = shape.corner === 'left' ? 1 : -1;
  const xs = (sgn * W) / 2;
  dims.add(dimension(V(-W / 2, H / 2, -L / 2), V(W / 2, H / 2, -L / 2), V(0, gap, 0), `${d.width}`, 'bbbb'));
  dims.add(dimension(V(-xs, -H / 2, -L / 2), V(-xs, H / 2, -L / 2), V(-sgn * gap, 0, 0), `${d.height}`, 'cccc'));
  dims.add(dimension(V(-xs, -H / 2, -L / 2), V(-xs, -H / 2, L / 2), V(-sgn * gap * 0.7, -gap * 0.7, 0), `${L}`, 'eeee'));
  dims.add(dimension(V(xs, H / 2, -L / 2), V(xs, H / 2, L / 2 - shape.along), V(sgn * gap, 0, 0), `${L - shape.along}`));
  dims.add(dimension(V(xs - sgn * shape.across, H / 2, L / 2), V(-xs, H / 2, L / 2), V(0, 0, gap), `${d.width - shape.across}`));
  root.add(dims);

  const ports = [rectPort('end1', 'Ände 1', new THREE.Vector3(0, 0, -L / 2), new THREE.Vector3(0, 0, -1), d.width, d.height, d.ends[0])];
  const insulation = new THREE.Group();
  insulation.name = 'insulation';
  root.add(insulation);
  return { root, insulation, dimensions: dims, bounds, ports };
}
