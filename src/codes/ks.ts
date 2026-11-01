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
  if (!split) return fail('En kod för S-böj börjar med KS följt av siffror, t.ex. KS-1-1000-500-0-550-1000');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 6) {
    return fail('För få fält. Förväntade KS-1-bbbb-cccc-d-eeee-ffff (sidor, isolering, fall, längd).');
  }

  const [a, width, height, d, offset, length] = nums;
  const rest = nums.slice(6);

  if (a !== 1) warnings.push(`Första fältet är alltid 1 för S-böjar (fick ${a}).`);
  if (width <= 0 || height <= 0) return fail('Måtten måste vara större än 0.');
  if (length <= 0) return fail('Längden ffff måste vara större än 0.');
  if (offset < 0) return fail('Fallet eeee kan inte vara negativt.');
  if (length >= MAX_LENGTH) warnings.push(`Längden ffff måste vara under ${MAX_LENGTH} mm enligt produktbladet.`);
  if (offset === 0) warnings.push('Fallet eeee är 0 – det här är en rak bit.');

  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);
  checkInsideFit(insulation, width, height, warnings, 'S-böj');

  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    const sf = parseSurface(rest.shift(), d, 'g');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  }
  if (rest.length > 0) warnings.push(`Extra fält ignoreras: ${rest.join('-')}`);

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return fail(ends);

  const product: SBend = { kind: 'KS', code: s, width, height, offset, length, insulation, surface, ends, warnings };

  const angle = wallAngle(product);
  if (angle > 45) {
    warnings.push(`Brant S-böj: väggarna lutar ${angle.toFixed(0)}°. Kontrollera minsta längd ffff i produktbladets dimensioneringsdiagram.`);
  }
  return { ok: true, product };
}

export function describeKS(p: SBend): SpecRow[] {
  return [
    { label: 'Produkt', value: 'S-böj', token: 'KS' },
    { label: 'Öppning', value: `${p.width} × ${p.height} mm` },
    { label: 'Fall', value: `${p.offset} mm (på bbbb-sidan)`, token: 'eeee' },
    { label: 'Längd', value: `${p.length} mm`, token: 'ffff' },
    { label: 'Väggvinkel', value: `${wallAngle(p).toFixed(1)}°` },
    ...commonRows(p),
  ];
}
