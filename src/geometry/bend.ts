// Builds the 3D model for a bend (KB).
//
// The bend is worked out in 2D first, in the bend plane (u along the first leg, v across it,
// throat at v = 0, heel at v = bbbb), as two curves: the throat (inside) and the heel (outside).
// Each curve is: a start point, a turn sampled at N points, and an end point, so throat and
// heel always have matching stations. The 2D stations are then turned into rectangular
// cross-sections and swept into a shell.
//
// World mapping: u → Z, v → X (throat at x = -bbbb/2), cccc → Y. End 1 sits at z = 0 facing -Z
// (same as the other products) and the bend turns towards -X, so it lies flat seen from the top.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Bend } from '../codes/types';
import { dimension } from './dimensions';
import type { DuctModel } from './duct';
import { buildEnd, endOverhang, SHEET } from './ends';
import type { Materials } from './materials';
import { rectPort } from './ports';
import { ribbon, sweepMesh, type Ring } from './sweep';

interface Pt { u: number; v: number }
const pt = (u: number, v: number): Pt => ({ u, v });

/** A curve from end 1 to end 2: straight to the turn, the turn itself, straight to the end. */
interface Curve {
  start: Pt;
  turn: (t: number) => Pt;
  end: Pt;
}

const DEG = Math.PI / 180;

/** 90° throat geometry from the datasheet: 30 mm straight + R100 arc = 130 mm legs. */
const THROAT_R = 100;
const THROAT_STRAIGHT = 30;

/**
 * The throat (inside) curve, moved `o` mm towards the heel (negative = away from the duct).
 */
function throat(p: Bend, o: number): Curve {
  if (p.angle === 90) {
    const leg = THROAT_R + THROAT_STRAIGHT;
    const r = THROAT_R + o;
    const cu = THROAT_STRAIGHT;
    const cv = -THROAT_R;
    return {
      start: pt(0, o),
      turn: r > 0
        ? (t) => pt(cu + r * Math.cos((90 - 90 * t) * DEG), cv + r * Math.sin((90 - 90 * t) * DEG))
        : () => pt(leg + o, o), // offset past the arc centre → sharp corner
      end: pt(leg + o, -p.leg2),
    };
  }
  // 45/30/15°: sharp inner corner after a 50 mm leg
  const th = p.angle * DEG;
  const P = pt(p.leg1, 0);
  const d2 = pt(Math.cos(th), -Math.sin(th));
  const n2 = pt(Math.sin(th), Math.cos(th));
  const k = o / (1 + Math.cos(th)); // miter of the two offset lines
  const corner = pt(P.u + k * n2.u, P.v + k * (1 + n2.v));
  return {
    start: pt(0, o),
    turn: () => corner,
    end: pt(P.u + p.leg2 * d2.u + o * n2.u, P.v + p.leg2 * d2.v + o * n2.v),
  };
}

/**
 * The heel (outside) curve, moved `o` mm towards the throat (negative = away from the duct).
 */
function heel(p: Bend, o: number): Curve {
  const b = p.width;
  if (p.angle === 90) {
    const leg = THROAT_R + THROAT_STRAIGHT;
    const e = p.endWidth; // a = 4 narrows the bend-plane side at end 2
    const endU = leg + e - o;
    if (!p.roundHeel) {
      const corner = pt(endU, b - o);
      return { start: pt(0, b - o), turn: () => corner, end: pt(endU, -p.leg2) };
    }
    // Quarter circle (an ellipse when end 2 is narrower) centred level with the end of the first leg,
    // or with end 2 when the second leg is shorter than standard
    const cv = Math.min(leg, p.leg2);
    const rx = endU;
    const ry = cv + b - o;
    return {
      start: pt(0, b - o),
      turn: (t) => pt(rx * Math.sin(90 * t * DEG), -cv + ry * Math.cos(90 * t * DEG)),
      end: pt(endU, -p.leg2),
    };
  }
  const th = p.angle * DEG;
  const P = pt(p.leg1, 0);
  const d2 = pt(Math.cos(th), -Math.sin(th));
  const n2 = pt(Math.sin(th), Math.cos(th));
  const r = b - o;
  const end = pt(P.u + r * n2.u + p.leg2 * d2.u, P.v + r * n2.v + p.leg2 * d2.v);
  if (!p.roundHeel) {
    const k = r / (1 + Math.cos(th));
    const corner = pt(P.u + k * n2.u, P.v + k * (1 + n2.v));
    return { start: pt(0, r), turn: () => corner, end };
  }
  // Arc around the inner corner
  return {
    start: pt(0, r),
    turn: (t) => {
      const a = (90 - p.angle * t) * DEG;
      return pt(P.u + r * Math.cos(a), P.v + r * Math.sin(a));
    },
    end,
  };
}

/** Sample a curve into stations: start, turn at n+1 points, end. */
function sample(c: Curve, n: number): Pt[] {
  const out = [c.start];
  for (let i = 0; i <= n; i++) out.push(c.turn(i / n));
  out.push(c.end);
  return out;
}

/** Move the first and last station inwards along the curve (used to stop outside insulation short of the ends). */
function trim(pts: Pt[], dist: number): Pt[] {
  const out = pts.slice();
  const move = (from: Pt, to: Pt) => {
    const len = Math.hypot(to.u - from.u, to.v - from.v);
    if (len === 0) return from;
    const f = Math.min(dist, len * 0.9) / len;
    return pt(from.u + (to.u - from.u) * f, from.v + (to.v - from.v) * f);
  };
  out[0] = move(pts[0], pts[1]);
  out[pts.length - 1] = move(pts[pts.length - 1], pts[pts.length - 2]);
  return out;
}

export function buildBend(p: Bend, mat: Materials): DuctModel {
  const root = new THREE.Group();
  const physical = new THREE.Group();
  root.add(physical);

  const b = p.width;
  const N = Math.max(6, Math.round((p.angle / 90) * 32));
  const stationCount = N + 3;

  // Half of cccc at each station (a = 0 tapers it towards end 2, symmetric about y = 0)
  const halfH = Array.from({ length: stationCount }, (_, k) => {
    const f = k / (stationCount - 1);
    return (p.height + (p.endHeight - p.height) * f) / 2;
  });

  const toWorld = (q: Pt, y: number) => new THREE.Vector3(q.v - b / 2, y, q.u);

  /** Rings from throat/heel offsets and an extra amount added to the half-height. */
  const rings = (th: Pt[], he: Pt[], grow: number): Ring[] =>
    th.map((t, k) => {
      const h = halfH[k] + grow;
      return [toWorld(t, -h), toWorld(he[k], -h), toWorld(he[k], h), toWorld(t, h)];
    });

  const curves = (o: number) => ({ th: sample(throat(p, o), N), he: sample(heel(p, o), N) });

  // Distance along the heel, for the corrugation texture
  const base = curves(0);
  const vAlong = [0];
  for (let k = 1; k < stationCount; k++) {
    const a = base.he[k - 1];
    const c = base.he[k];
    vAlong.push(vAlong[k - 1] + Math.hypot(c.u - a.u, c.v - a.v));
  }

  // Sheet body
  const outer = curves(-SHEET);
  // Ring edges: 0 = bottom cheek, 1 = heel, 2 = top cheek, 3 = throat. Cheeks are flat (no ribs).
  physical.add(sweepMesh(rings(outer.th, outer.he, SHEET), rings(base.th, base.he, 0), vAlong, mat.ductSheet, [1, 3]));

  // Insulation
  const insulation = new THREE.Group();
  insulation.name = 'insulation';
  const ins = p.insulation;
  const insMat = ins.kind === 'sound' ? mat.sound : ins.kind === 'armaflex' ? mat.armaflex : mat.fire;
  let vaneInset = 0;
  if (ins.side === 'inside') {
    const t = ins.thickness;
    const inner = curves(t);
    if (Math.min(...halfH) - t > 0 && b - 2 * t > 0) {
      insulation.add(sweepMesh(rings(base.th, base.he, 0), rings(inner.th, inner.he, -t), vAlong, insMat));
      if (p.surface) {
        const liner = curves(t + 0.8);
        insulation.add(sweepMesh(rings(inner.th, inner.he, -t), rings(liner.th, liner.he, -t - 0.8), vAlong, mat.liner));
      }
      vaneInset = t;
    }
  } else if (ins.side === 'outside') {
    const t = ins.thickness;
    const wrapOut = curves(-SHEET - t);
    const stop = 40;
    insulation.add(
      sweepMesh(
        rings(trim(wrapOut.th, stop), trim(wrapOut.he, stop), SHEET + t),
        rings(trim(outer.th, stop), trim(outer.he, stop), SHEET),
        vAlong,
        insMat,
      ),
    );
  }
  physical.add(insulation);

  // Guide vane at bbbb/3 from the throat, through the first leg and the turn
  if (p.guideVane) {
    const vane = sample(throat(p, b / 3), N).slice(0, N + 2);
    const lo = vane.map((q, k) => toWorld(q, -(halfH[k] - vaneInset)));
    const hi = vane.map((q, k) => toWorld(q, halfH[k] - vaneInset));
    physical.add(ribbon(lo, hi, mat.galvanized));
  }

  // Ends
  const end1 = buildEnd(p.ends[0], { w: p.width, h: p.height, mat });
  end1.rotation.y = Math.PI; // face -Z
  physical.add(end1);

  const th = p.angle * DEG;
  const thEnd = base.th[stationCount - 1];
  const heEnd = base.he[stationCount - 1];
  const c2 = pt((thEnd.u + heEnd.u) / 2, (thEnd.v + heEnd.v) / 2);
  const end2 = buildEnd(p.ends[1], { w: p.endWidth, h: p.endHeight, mat });
  end2.position.copy(toWorld(c2, 0));
  end2.rotation.y = -th; // local +Z along the second leg
  physical.add(end2);

  const bounds = new THREE.Box3().setFromObject(physical);

  // Labels and dimensions
  const outsideIns = ins.side === 'outside' ? ins.thickness : 0;
  const overhang = Math.max(endOverhang(p.ends[0]), endOverhang(p.ends[1]), outsideIns);
  const gap = overhang + Math.max(60, Math.min(p.width, p.height) * 0.15);

  const label = (text: string, pos: THREE.Vector3, className = 'scene-label') => {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    root.add(obj);
  };
  const h1 = p.height / 2 + SHEET;
  const h2 = p.endHeight / 2 + SHEET;
  // End tags on the heel side, where the two ends are furthest apart
  label('End 1', new THREE.Vector3(b / 2 + overhang + 40, h1 + overhang + 40, 0));
  label('End 2', toWorld(heEnd, h2 + overhang + 40));
  label(`${p.angle}°`, toWorld(base.th[Math.floor(stationCount / 2)], h1 + 30), 'scene-label scene-label--accent');

  const dims = new THREE.Group();
  dims.name = 'dimensions';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // End 1: bbbb across the top, cccc up the heel side
  dims.add(dimension(V(-b / 2 - SHEET, h1, 0), V(b / 2 + SHEET, h1, 0), V(0, gap, 0), `${p.width}`, 'bbbb'));
  dims.add(dimension(V(b / 2 + SHEET, -h1, 0), V(b / 2 + SHEET, h1, 0), V(gap, 0, 0), `${p.height}`, 'cccc'));
  // End 2: width across the top, height on the heel side, pushed out along the second leg
  const outDir = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th));
  const i2 = toWorld(outer.th[stationCount - 1], h2);
  const o2 = toWorld(outer.he[stationCount - 1], h2);
  // a = 4 replaces bbbb with eeee at end 2, a = 0 replaces cccc
  dims.add(dimension(i2, o2, V(0, gap, 0), `${p.endWidth}`, p.variant === 4 ? 'eeee' : 'bbbb'));
  dims.add(dimension(o2.clone().setY(-h2), o2, outDir.clone().multiplyScalar(gap), `${p.endHeight}`, p.variant === 0 ? 'eeee' : 'cccc'));
  // 90° bends: second leg, measured like the datasheet – from end 2 to the throat edge of end 1
  if (p.angle === 90) {
    const z = 0;
    dims.add(
      dimension(
        V(-b / 2, h1, z),
        V(-b / 2 - p.leg2, h1, z),
        V(0, 0, -gap),
        `${p.leg2}`,
        p.variant === 0 || p.variant === 4 ? 'ffff' : undefined,
      ),
    );
  }
  root.add(dims);

  return {
    root,
    insulation,
    dimensions: dims,
    bounds,
    // Cut horizontally so the section shows the shape of the turn
    section: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    iso: bendIsoDirection(p.angle),
    ports: [
      rectPort('end1', 'End 1', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), p.width, p.height, p.ends[0]),
      rectPort('end2', 'End 2', toWorld(c2, 0), outDir, p.endWidth, p.endHeight, p.ends[1]),
    ],
  };
}

/**
 * 3D view direction for a bend. 90° bends are seen from the throat side so both openings show;
 * smaller angles use the straight-duct view turned half the bend angle.
 */
function bendIsoDirection(angle: number): THREE.Vector3 {
  if (angle >= 60) return new THREE.Vector3(-1, 0.9, -1).normalize();
  return new THREE.Vector3(1.1, 0.75, 1.3).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (-angle / 2) * DEG);
}
