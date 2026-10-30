// KS – S-bend (S-böj): KS-1-bbbb-cccc-d-eeee-ffff-g [end1/end2]
// Source: Crenna "Kanalsystem – Rektangulärt, KS S-böj", version 3.0.
//
// 1    = always 1
// bbbb = side the offset is in ("utslagssida"), cccc = other side
// d    = insulation
// eeee = offset ("fall") between the ends, measured on the bbbb side
// ffff = length, < 2000 mm
// g    = surface layer, only for insulation 7 and 8
//
// The datasheet's dimensioning chart (minimum ffff for a given eeee and bbbb) is a nomogram
// that isn't encoded here; we show the wall angle instead and warn when it gets steep.

import {
  checkInsideFit,
  commonRows,
  normalise,
  parseEnds,
  parseInsulation,
  parseSurface,
  splitCode,
} from './common';
import type { ParseResult, SBend, SpecRow, SurfaceSpec } from './types';

export const MAX_LENGTH = 2000;

/**
 * Straight collar at each end, mm. Not given in the datasheet – the drawing shows a short
 * straight part at each end, so we use 100 mm (less on short S-bends).
 */
export function collarLength(p: SBend): number {
  return Math.min(100, p.length / 4);
}

/** Angle of the sloped middle section to the duct axis, degrees. */
export function wallAngle(p: SBend): number {
  const run = p.length - 2 * collarLength(p);
  return (Math.atan(p.offset / run) * 180) / Math.PI;
}

const fail = (error: string): ParseResult<SBend> => ({ ok: false, error });

export function parseKS(input: string): ParseResult<SBend> {
  const s = normalise(input);
  const split = splitCode(s, 'KS');
  if (!split) return fail('An S-bend code starts with KS followed by numbers, e.g. KS-1-1000-500-0-550-1000');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 6) {
    return fail('Too few fields. Expected KS-1-bbbb-cccc-d-eeee-ffff (sides, insulation, offset, length).');
  }

  const [a, width, height, d, offset, length] = nums;
  const rest = nums.slice(6);

  if (a !== 1) warnings.push(`The first field is always 1 for S-bends (got ${a}).`);
  if (width <= 0 || height <= 0) return fail('Dimensions must be greater than 0.');
  if (length <= 0) return fail('Length ffff must be greater than 0.');
  if (offset < 0) return fail('Offset eeee can\'t be negative.');
  if (length >= MAX_LENGTH) warnings.push(`Length ffff must be under ${MAX_LENGTH} mm according to the datasheet.`);
  if (offset === 0) warnings.push('Offset eeee is 0 – this is a straight piece.');

  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);
  checkInsideFit(insulation, width, height, warnings, 'S-bend');

  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    const sf = parseSurface(rest.shift(), d, 'g');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  }
  if (rest.length > 0) warnings.push(`Extra field(s) ignored: ${rest.join('-')}`);

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return fail(ends);

  const product: SBend = { kind: 'KS', code: s, width, height, offset, length, insulation, surface, ends, warnings };

  const angle = wallAngle(product);
  if (angle > 45) {
    warnings.push(`Steep S-bend: the walls are at ${angle.toFixed(0)}°. Check the minimum length ffff in the datasheet's dimensioning chart.`);
  }
  return { ok: true, product };
}

export function describeKS(p: SBend): SpecRow[] {
  return [
    { label: 'Product', value: 'S-bend', token: 'KS' },
    { label: 'Opening', value: `${p.width} × ${p.height} mm` },
    { label: 'Offset', value: `${p.offset} mm (on the bbbb side)`, token: 'eeee' },
    { label: 'Length', value: `${p.length} mm`, token: 'ffff' },
    { label: 'Wall angle', value: `${wallAngle(p).toFixed(1)}°` },
    ...commonRows(p),
  ];
}
