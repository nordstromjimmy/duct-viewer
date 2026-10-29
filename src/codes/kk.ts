// KK – straight duct (rakkanal): KK-a-bbbb-cccc-d-eeee-f [end1/end2]
// Source: Crenna "Kanalsystem – Rektangulärt, KK Rakkanal", version 4.0.

import {
  checkInsideFit,
  commonRows,
  normalise,
  parseEnds,
  parseInsulation,
  parseSurface,
  splitCode,
} from './common';
import type { ParseResult, SpecRow, StraightDuct, SurfaceSpec } from './types';

export const VARIANTS: Record<number, { label: string; length?: number; buildLength?: number }> = {
  1: { label: 'Standard length 1150 mm', length: 1150, buildLength: 1165 },
  2: { label: 'Standard length 2300 mm', length: 2300, buildLength: 2330 },
  3: { label: 'Pass piece < 2000 mm' },
  4: { label: 'Pass piece > 2000 mm' },
};

/** Weight table, kg/m (±10 %). weights[largest][smallest]. */
const WEIGHTS: Record<number, Record<number, number>> = {
  150: { 100: 3.0, 150: 3.6 },
  200: { 100: 3.6, 150: 4.2, 200: 4.8 },
  250: { 100: 4.2, 150: 4.8, 200: 5.4, 250: 6.0 },
  300: { 100: 4.8, 150: 5.4, 200: 6.0, 250: 7.2 },
  400: { 100: 6.0, 150: 6.6, 200: 7.2, 250: 7.8, 300: 8.4, 400: 9.6 },
  500: { 150: 7.8, 200: 8.4, 250: 9.0, 300: 9.6, 400: 10.8, 500: 12.0 },
  600: { 150: 9.0, 200: 9.6, 250: 10.2, 300: 10.8, 400: 12.0, 500: 13.2, 600: 14.4 },
  800: { 200: 12.0, 250: 12.6, 300: 13.2, 400: 14.4, 500: 15.6, 600: 16.8, 800: 19.2 },
  1000: { 250: 15.0, 300: 15.6, 400: 16.8, 500: 18.0, 600: 19.2, 800: 21.6, 1000: 24.0 },
  1200: { 300: 20.1, 400: 21.4, 500: 22.8, 600: 24.1, 800: 26.8, 1000: 29.5, 1200: 32.2 },
  1400: { 400: 24.1, 500: 25.5, 600: 26.8, 800: 29.5, 1000: 32.2, 1200: 34.8 },
  1600: { 400: 26.8, 500: 28.1, 600: 29.5, 800: 32.2, 1000: 34.8, 1200: 37.5 },
  1800: { 500: 30.8, 600: 32.2, 800: 34.8, 1000: 37.5, 1200: 40.2 },
  2000: { 500: 33.5, 600: 34.8, 800: 37.5, 1000: 40.2, 1200: 42.9 },
};

/** Weight in kg/m from the datasheet table, or null if the size isn't listed. */
export function weightPerMeter(width: number, height: number): number | null {
  const big = Math.max(width, height);
  const small = Math.min(width, height);
  return WEIGHTS[big]?.[small] ?? null;
}

const fail = (error: string): ParseResult<StraightDuct> => ({ ok: false, error });

export function parseKK(input: string): ParseResult<StraightDuct> {
  const s = normalise(input);
  // Also accepts the Lindab spelling KK-C-...
  const split = splitCode(s, 'KK(?:\\s*-?\\s*C)?');
  if (!split) return fail('A straight duct code starts with KK followed by numbers, e.g. KK-1-1500-1000-0');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 4) {
    return fail('Too few fields. Expected KK-a-bbbb-cccc-d (variant, largest side, smallest side, insulation).');
  }

  const [a, width, height, d] = nums;
  const rest = nums.slice(4);

  // a – variant
  const variant = VARIANTS[a];
  if (!variant) return fail(`Unknown variant "${a}". Use 1 (1150 mm), 2 (2300 mm), 3 (pass < 2000) or 4 (pass > 2000).`);

  // bbbb / cccc – dimensions
  if (width <= 0 || height <= 0) return fail('Dimensions must be greater than 0.');
  if (width < height) warnings.push(`Largest side should come first (${height}x${width}). Showing as typed.`);
  if (Math.max(width, height) > 2000 || Math.min(width, height) < 100) {
    warnings.push('Dimension is outside the datasheet range (100–2000 mm).');
  }

  // d – insulation
  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);
  checkInsideFit(insulation, width, height, warnings);

  // eeee – length
  let length: number;
  if (a === 3 || a === 4) {
    const l = rest.shift();
    if (l === undefined) return fail(`Variant ${a} is a pass piece – add the length in mm, e.g. KK-${a}-${width}-${height}-${d}-${a === 3 ? 1750 : 2800}`);
    length = l;
    if (a === 3 && length >= 2000) warnings.push('Variant 3 is for pass pieces shorter than 2000 mm.');
    if (a === 4 && length <= 2000) warnings.push('Variant 4 is for pass pieces longer than 2000 mm.');
  } else {
    length = variant.length!;
    // A length may still be written out for standard ducts (e.g. KK-1-1200-500-0-1150).
    const surfaceFieldsLeft = insulation.needsSurface ? 1 : 0;
    if (rest.length > surfaceFieldsLeft) {
      const l = rest.shift()!;
      if (l !== length) warnings.push(`Variant ${a} is always ${length} mm – ignoring length ${l}.`);
    }
  }
  if (length <= 0) return fail('Length must be greater than 0.');

  // f – surface layer (only for insulation 7 and 8)
  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    const sf = parseSurface(rest.shift(), d, 'f');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  }

  if (rest.length > 0) warnings.push(`Extra field(s) ignored: ${rest.join('-')}`);

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return fail(ends);

  if (weightPerMeter(width, height) !== null && insulation.side !== 'none') {
    warnings.push('Weight is for the uninsulated duct (±10 %).');
  }

  return {
    ok: true,
    product: {
      kind: 'KK',
      code: s,
      variant: a as 1 | 2 | 3 | 4,
      width,
      height,
      length,
      buildLength: variant.buildLength ?? length + 5,
      insulation,
      surface,
      ends,
      warnings,
    },
  };
}

export function describeKK(d: StraightDuct): SpecRow[] {
  const rows: SpecRow[] = [
    { label: 'Product', value: 'Straight duct', token: 'KK' },
    { label: 'Variant', value: VARIANTS[d.variant].label, token: `a=${d.variant}` },
    { label: 'Opening', value: `${d.width} × ${d.height} mm` },
    { label: 'Length', value: `${d.length} mm` },
    { label: 'Build length', value: `${d.buildLength} mm` },
    ...commonRows(d),
  ];
  const kgm = weightPerMeter(d.width, d.height);
  rows.push({
    label: 'Weight',
    value: kgm === null ? 'Size not in weight table' : `${kgm.toFixed(1)} kg/m · ≈ ${((kgm * d.length) / 1000).toFixed(1)} kg`,
  });
  return rows;
}