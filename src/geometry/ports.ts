// Connection points ("ports") on a product: where each opening is, which way it faces and how
// big it is. The assembly uses these to snap parts together face to face.

import * as THREE from 'three';
import type { EndCode } from '../codes/types';

export type PortId = 'end1' | 'end2' | 'end3' | 'end4';

export interface Port {
  id: PortId;
  /** Shown in the UI, e.g. "End 2 · small". */
  label: string;
  /** Centre of the opening's face, in the model's own coordinates (mm). */
  position: THREE.Vector3;
  /** Unit vector pointing out of the part through the opening. */
  normal: THREE.Vector3;
  /** Unit vector along the opening's height (the cccc side for rectangular ends). */
  up: THREE.Vector3;
  shape: 'rect' | 'round';
  /** Rectangular: width (across, perpendicular to `up`) and height (along `up`). Round: both = Ø. */
  w: number;
  h: number;
  /** End type code shown in the UI ("PG", "F", "NIPPEL", ...). */
  end: string;
  /** False for ends that can't take another part: caps (B, Fast B, Falsad B) and grilles (TN). */
  open: boolean;
}

const CLOSED_ENDS: EndCode[] = ['B', 'FAST_B', 'FALSAD_B', 'TN'];
const Y = new THREE.Vector3(0, 1, 0);

/** A rectangular port with a standard end type. */
export function rectPort(
  id: PortId,
  label: string,
  position: THREE.Vector3,
  normal: THREE.Vector3,
  w: number,
  h: number,
  end: EndCode,
): Port {
  return {
    id,
    label,
    position,
    normal: normal.clone().normalize(),
    up: Y.clone(),
    shape: 'rect',
    w,
    h,
    end: end === 'FAST_B' ? 'Fast B' : end === 'FALSAD_B' ? 'Falsad B' : end,
    open: !CLOSED_ENDS.includes(end),
  };
}

/** A circular port (nipple or socket). */
export function roundPort(id: PortId, label: string, position: THREE.Vector3, normal: THREE.Vector3, d: number, end: string): Port {
  return { id, label, position, normal: normal.clone().normalize(), up: Y.clone(), shape: 'round', w: d, h: d, end, open: true };
}

/** "800×400" or "Ø315". */
export function portSize(p: Port): string {
  return p.shape === 'round' ? `Ø${p.w}` : `${p.w}×${p.h}`;
}

/**
 * Do two ports fit together? `quarterTurns` is how far the second port is rolled relative to the
 * first (odd = width and height swap).
 */
export function portsMatch(a: Port, b: Port, quarterTurns: number): boolean {
  if (a.shape !== b.shape) return false;
  if (a.shape === 'round') return a.w === b.w;
  const swap = Math.abs(quarterTurns) % 2 === 1;
  const bw = swap ? b.h : b.w;
  const bh = swap ? b.w : b.h;
  return a.w === bw && a.h === bh;
}
