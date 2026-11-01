// Works out where every part in the assembly sits.
//
// Parts form a tree. The first part sits at the origin; every other part is placed so that its
// connecting end ("via") sits face to face with the parent's end: same centre, opposite
// direction, and the height axes lined up – then rolled around the joint in quarter turns.

import * as THREE from 'three';
import { parseCode } from '../codes';
import type { Product } from '../codes/types';
import { buildModel } from '../geometry';
import { disposeModel, type DuctModel } from '../geometry/duct';
import { LOOSE_PG } from '../geometry/ends';
import type { Materials } from '../geometry/materials';
import { portsMatch, portSize, type Port, type PortId } from '../geometry/ports';
import type { AsmPart } from '../store';

const QUARTER = Math.PI / 2;

/** A port in world coordinates. */
export interface WorldPort {
  partId: string;
  port: Port;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  up: THREE.Vector3;
  /** Something is attached here (or this is the end the part itself hangs from). */
  connected: boolean;
}

export interface LaidPart {
  asm: AsmPart;
  product: Product;
  model: DuctModel;
  /** Model coordinates → world. */
  matrix: THREE.Matrix4;
  ports: WorldPort[];
}

export interface Joint {
  childId: string;
  parentId: string;
  position: THREE.Vector3;
  ok: boolean;
  /** e.g. "800×400 → 600×400" when the sizes don't match. */
  text: string;
}

export interface Layout {
  parts: LaidPart[];
  joints: Joint[];
  /** Parts that couldn't be placed (bad code, missing parent end). */
  problems: { id: string; code: string; message: string }[];
}

/** Basis with x = normal, y = up, z = normal × up. */
function frame(normal: THREE.Vector3, up: THREE.Vector3): THREE.Matrix4 {
  const side = new THREE.Vector3().crossVectors(normal, up);
  return new THREE.Matrix4().makeBasis(normal, up, side);
}

function worldPort(partId: string, port: Port, m: THREE.Matrix4): WorldPort {
  return {
    partId,
    port,
    position: port.position.clone().applyMatrix4(m),
    normal: port.normal.clone().transformDirection(m),
    up: port.up.clone().transformDirection(m),
    connected: false,
  };
}

/**
 * Matrix that puts `own` (a port in model coordinates) face to face with `target` (a port in
 * world coordinates), rolled `roll` quarter turns around the joint.
 */
export function attachMatrix(own: Port, target: WorldPort, roll: number): THREE.Matrix4 {
  const toNormal = target.normal.clone().negate();
  const toUp = target.up.clone().applyAxisAngle(target.normal, roll * QUARTER);
  const local = frame(own.normal, own.up);
  const world = frame(toNormal, toUp);
  const rot = world.multiply(local.clone().transpose()); // local frame → world frame
  const offset = own.position.clone().applyMatrix4(rot);
  rot.setPosition(target.position.clone().sub(offset));
  return rot;
}

/** First part: at the origin, rolled around its `via` end. */
function rootMatrix(own: Port, roll: number): THREE.Matrix4 {
  const p = own.position;
  return new THREE.Matrix4()
    .makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(own.normal, roll * QUARTER))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}

export function layout(assembly: AsmPart[], mat: Materials): Layout {
  const out: Layout = { parts: [], joints: [], problems: [] };
  const byId = new Map<string, LaidPart>();

  // Place parents before children: breadth-first from the first part(s)
  const queue = assembly.filter((a) => a.parent === null);
  const waiting = assembly.filter((a) => a.parent !== null);

  while (queue.length) {
    const asm = queue.shift()!;
    const parsed = parseCode(asm.code);
    if (!parsed.ok) {
      out.problems.push({ id: asm.id, code: asm.code, message: parsed.error });
      continue;
    }
    // A site-cut part is drawn at its cut length (the code stays what's ordered)
    const product = withCut(parsed.product, asm.cut);
    const model = buildModel(product, mat);
    dropLoosePG(model);
    const own = model.ports.find((p) => p.id === asm.via) ?? model.ports[0];

    let matrix: THREE.Matrix4;
    if (asm.parent === null) {
      matrix = rootMatrix(own, asm.roll);
      if (asm.tilt) {
        // Tip/turn around the part's centre so it stays in place
        const c = model.bounds.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
        const q = new THREE.Quaternion(...asm.tilt);
        matrix = new THREE.Matrix4()
          .makeTranslation(c.x, c.y, c.z)
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
          .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z))
          .multiply(matrix);
      }
    } else {
      const parent = byId.get(asm.parent);
      const target = parent?.ports.find((p) => p.port.id === asm.parentPort);
      if (!parent || !target) {
        disposeModel(model.root);
        out.problems.push({ id: asm.id, code: asm.code, message: 'Änden den satt fast i finns inte längre.' });
        continue;
      }
      matrix = attachMatrix(own, target, asm.roll);
      target.connected = true;
      const ok = portsMatch(target.port, own, asm.roll);
      out.joints.push({
        childId: asm.id,
        parentId: parent.asm.id,
        position: target.position.clone(),
        ok,
        text: ok ? '' : `${portSize(target.port)} → ${portSize(own)}${asm.roll % 2 ? ' (vriden 90°)' : ''}`,
      });
    }

    const ports = model.ports.map((p) => worldPort(asm.id, p, matrix));
    if (asm.parent !== null) ports.find((p) => p.port.id === own.id)!.connected = true;

    const laid: LaidPart = { asm, product, model, matrix, ports };
    out.parts.push(laid);
    byId.set(asm.id, laid);

    // Queue this part's children
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].parent === asm.id) queue.push(...waiting.splice(i, 1));
    }
  }

  for (const w of waiting) {
    out.problems.push({ id: w.id, code: w.code, message: 'Inte ansluten till sammanställningen.' });
  }
  return out;
}

/**
 * Loose PG sets float in front of their end in the Part tab, to show what's delivered. In the
 * assembly they're just in the way, so they're removed and the part is measured again without them.
 */
function dropLoosePG(model: DuctModel) {
  const found: THREE.Object3D[] = [];
  model.root.traverse((o) => {
    if (o.name === LOOSE_PG) found.push(o);
  });
  if (!found.length) return;
  for (const o of found) {
    disposeModel(o);
    o.removeFromParent();
  }
  // The builders put the physical parts in the root's first child
  model.bounds = new THREE.Box3().setFromObject(model.root.children[0] ?? model.root);
}

/** Shortest cut length allowed, mm. */
export const MIN_CUT = 50;

/**
 * Can this part be cut to length on site? Straight ducts ordered with a loose PG (L) or plain
 * (P) end – the end that's left open for cutting.
 */
export function canCut(p: Product): boolean {
  return p.kind === 'KK' && (p.ends.includes('L') || p.ends.includes('P'));
}

/** The product as drawn: shortened to the cut length when there is one. */
export function withCut(p: Product, cut: number | undefined): Product {
  if (!cut || !canCut(p) || p.kind !== 'KK') return p;
  const length = Math.max(MIN_CUT, Math.min(cut, p.length));
  return length === p.length ? p : { ...p, length };
}

/** Values a quarter-turn quaternion's components can take. */
const QUAT_STEPS = [0, 0.5, Math.SQRT1_2, 1];

/**
 * Add a quarter turn around a world axis to an orientation. Components are snapped back to the
 * exact quarter-turn values so repeated turns don't drift.
 */
export function addQuarterTurn(
  tilt: [number, number, number, number] | undefined,
  axis: THREE.Vector3,
  dir: 1 | -1,
): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, dir * QUARTER).multiply(new THREE.Quaternion(...(tilt ?? [0, 0, 0, 1])));
  const snap = (v: number) => {
    const s = QUAT_STEPS.reduce((best, x) => (Math.abs(Math.abs(v) - x) < Math.abs(Math.abs(v) - best) ? x : best));
    return Math.sign(v) * s;
  };
  q.set(snap(q.x), snap(q.y), snap(q.z), snap(q.w)).normalize();
  return [q.x, q.y, q.z, q.w];
}

/** The ports a product has, without keeping its model around. */
export function portsOf(product: Product, mat: Materials): Port[] {
  const model = buildModel(product, mat);
  disposeModel(model.root);
  return model.ports;
}

/**
 * Pick which of a new part's ends to attach by, and how to roll it, so it fits the target end.
 * Falls back to end 1 unrolled when nothing fits (the joint is then flagged).
 */
export function bestFit(ports: Port[], target: Port): { via: PortId; roll: number } {
  const open = ports.filter((p) => p.open);
  for (const roll of [0, 1]) {
    const hit = open.find((p) => portsMatch(target, p, roll));
    if (hit) return { via: hit.id, roll };
  }
  return { via: (open[0] ?? ports[0]).id, roll: 0 };
}

/** Best roll for an end that's already chosen: 0 if that fits, else 1 if that fits, else 0. */
export function bestRoll(own: Port, target: Port): number {
  if (portsMatch(target, own, 0)) return 0;
  if (portsMatch(target, own, 1)) return 1;
  return 0;
}
