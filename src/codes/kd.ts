// KD – transition (dimensionsförändring): KD-a-bbbb-cccc-d-eeee-ffff-gggg-h [end1/end2]
// Source: Crenna "Kanalsystem – Rektangulärt, KD Dimensionsförändring", version 3.0.
//
// a    = placement of the small end, seen from the big end (1–5, 5 = centred/standard, 0 = special)
// bbbb = big end width, cccc = big end height
// d    = insulation
// eeee = small end width, ffff = small end height
// gggg = length if other than 500 mm
// h    = surface layer, only for insulation 7 and 8

import {
  checkInsideFit,
  commonRows,
  normalise,
  parseEnds,
  parseInsulation,
  parseSurface,
  splitCode,
} from './common';
import type { ParseResult, Placement, SpecRow, SurfaceSpec, Transition } from './types';

export const STANDARD_LENGTH = 500;

/**
 * Placement grid from the datasheet, seen from the big end:
 *
 *   1 2 3
 *   4 5 4
 *   3 2 1
 *
 * The same number appears twice because the part can be turned 180°.
 * We always draw the upper/left one.
 */
export const PLACEMENTS: Record<Placement, { label: string; col: -1 | 0 | 1; row: 0 | 1 }> = {
  1: { label: 'Hörn – uppe till vänster (eller nere till höger)', col: -1, row: 1 },
  2: { label: 'Jäms med överkant (eller underkant), centrerad i sidled', col: 0, row: 1 },
  3: { label: 'Hörn – uppe till höger (eller nere till vänster)', col: 1, row: 1 },
  4: { label: 'Jäms med vänster (eller höger) sida, centrerad i höjdled', col: -1, row: 0 },
  5: { label: 'Centrerad (standard)', col: 0, row: 0 },
};

/**
 * Centre of the small end relative to the big end, in model coordinates (mm).
 * The model's big end faces -Z, so "right as seen from the big end" is -X.
 */
export function smallEndOffset(p: Transition): { x: number; y: number } {
  const { col, row } = PLACEMENTS[p.placement];
  const viewRight = (col * (p.width - p.smallWidth)) / 2;
  const up = (row * (p.height - p.smallHeight)) / 2;
  return { x: -viewRight, y: up };
}

/** Steepest wall angle relative to the duct axis, degrees. */
export function steepestWall(p: Transition): number {
  const o = smallEndOffset(p);
  const deltas = [
    Math.abs(p.width / 2 - (o.x + p.smallWidth / 2)), // +X wall
    Math.abs(-p.width / 2 - (o.x - p.smallWidth / 2)), // -X wall
    Math.abs(p.height / 2 - (o.y + p.smallHeight / 2)), // top
    Math.abs(-p.height / 2 - (o.y - p.smallHeight / 2)), // bottom
  ];
  return (Math.atan(Math.max(...deltas) / p.length) * 180) / Math.PI;
}

const fail = (error: string): ParseResult<Transition> => ({ ok: false, error });

export function parseKD(input: string): ParseResult<Transition> {
  const s = normalise(input);
  const split = splitCode(s, 'KD');
  if (!split) return fail('En kod för dimensionsförändring börjar med KD följt av siffror, t.ex. KD-5-1500-1000-0-1200-800');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 6) {
    return fail('För få fält. Förväntade KD-a-bbbb-cccc-d-eeee-ffff (placering, stor ände, isolering, liten ände).');
  }

  const [a, width, height, d, smallWidth, smallHeight] = nums;
  const rest = nums.slice(6);

  // a – placement
  if (a === 0) return fail('Placering 0 är ett specialutförande enligt skiss – den kan inte ritas bara utifrån koden.');
  if (!(a in PLACEMENTS)) return fail(`Okänd placering "${a}". Använd 1–5 (5 = centrerad, standard).`);
  const placement = a as Placement;

  // Dimensions
  if ([width, height, smallWidth, smallHeight].some((v) => v <= 0)) return fail('Måtten måste vara större än 0.');
  if (smallWidth >= width && smallHeight >= height) {
    warnings.push('Den lilla änden (eeee x ffff) är inte mindre än den stora (bbbb x cccc).');
  } else if (smallWidth > width || smallHeight > height) {
    warnings.push('Den lilla änden är större än den stora i en riktning.');
  }
  if (smallWidth === width && smallHeight === height) warnings.push('Båda ändarna är lika stora – det här är en rak bit.');

  // d – insulation
  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);
  checkInsideFit(insulation, smallWidth, smallHeight, warnings, 'liten ände');

  // gggg – optional length, h – surface layer for insulation 7/8
  let length = STANDARD_LENGTH;
  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    if (rest.length >= 2) length = rest.shift()!;
    const sf = parseSurface(rest.shift(), d, 'h');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  } else if (rest.length >= 1) {
    length = rest.shift()!;
  }
  if (length <= 0) return fail('Längden måste vara större än 0.');
  if (rest.length > 0) warnings.push(`Extra fält ignoreras: ${rest.join('-')}`);

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return fail(ends);

  const product: Transition = {
    kind: 'KD',
    code: s,
    placement,
    width,
    height,
    smallWidth,
    smallHeight,
    length,
    insulation,
    surface,
    ends,
    warnings,
  };

  const angle = steepestWall(product);
  if (angle > 45) warnings.push(`Brant övergång: en vägg lutar ${angle.toFixed(0)}° mot kanalens axel.`);

  return { ok: true, product };
}

export function describeKD(p: Transition): SpecRow[] {
  return [
    { label: 'Produkt', value: 'Dimensionsförändring', token: 'KD' },
    { label: 'Placering', value: PLACEMENTS[p.placement].label, token: `a=${p.placement}` },
    { label: 'Stor ände', value: `${p.width} × ${p.height} mm` },
    { label: 'Liten ände', value: `${p.smallWidth} × ${p.smallHeight} mm` },
    { label: 'Längd', value: `${p.length} mm${p.length === STANDARD_LENGTH ? ' (standard)' : ''}` },
    { label: 'Brantaste vägg', value: `${steepestWall(p).toFixed(1)}°` },
    ...commonRows(p, ['Ände 1 (stor)', 'Ände 2 (liten)']),
  ];
}
