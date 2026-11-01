// KT – T-piece (T-stycke): KT-a-bbbb-cccc-d-eeee-f [end1/end2/end3]
// Source: Crenna "Kanalsystem – Rektangulärt, KT T-stycke", version 3.0.
//
// a    = 1: legs 130/130/130, 2: custom leg lengths (attach a sketch)
// bbbb, cccc = opening of the straight run (ends 1 and 2)
// d    = insulation
// eeee = branch side along the run; the branch opening (end 3) is eeee x cccc
// f    = surface layer, only for insulation 7 and 8
//
// End types: up to three, in end order, e.g. "PG/PG/F". One type applies to all three ends.

import {
  checkInsideFit,
  commonRows,
  END_TYPES,
  normalise,
  parseEndToken,
  parseInsulation,
  parseSurface,
  splitCode,
} from './common';
import type { EndCode, ParseResult, SpecRow, SurfaceSpec, Tee } from './types';

export const STANDARD_LEG = 130;
/** Straight collar at each end before the 45° chamfer, mm (measured off the datasheet drawing). */
export const TEE_COLLAR = 20;

/** Total length of the run, end 1 to end 2, mm. */
export function runLength(p: Tee): number {
  return p.legs[0] + p.branchWidth + p.legs[1];
}

const fail = (error: string): ParseResult<Tee> => ({ ok: false, error });

export function parseKT(input: string): ParseResult<Tee> {
  const s = normalise(input);
  const split = splitCode(s, 'KT');
  if (!split) return fail('En kod för T-stycke börjar med KT följt av siffror, t.ex. KT-1-1500-1000-0-1200');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 5) {
    return fail('För få fält. Förväntade KT-a-bbbb-cccc-d-eeee (utförande, genomgående öppning, isolering, avstickarens sida).');
  }

  const [a, width, height, d, branchWidth] = nums;
  const rest = nums.slice(5);

  if (a !== 1 && a !== 2) return fail(`Okänt utförande "${a}". Använd 1 (ben 130/130/130) eller 2 (valfria ben enligt skiss).`);
  if (a === 2) warnings.push('Utförande 2 har valfria benlängder enligt skiss – ritas med standardben 130 mm.');

  if (width <= 0 || height <= 0 || branchWidth <= 0) return fail('Måtten måste vara större än 0.');

  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);
  checkInsideFit(insulation, Math.min(width, branchWidth), height, warnings, 'T-stycke');

  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    const sf = parseSurface(rest.shift(), d, 'f');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  }
  if (rest.length > 0) warnings.push(`Extra fält ignoreras: ${rest.join('-')}`);

  // End types for ends 1, 2 and 3
  let ends: EndCode[] = ['PG', 'PG', 'PG'];
  if (endPart) {
    const tokens = endPart.split('/').map((t) => t.trim()).filter(Boolean);
    if (tokens.length > 3) return fail('Ange högst tre ändutföranden (ände 1 / ände 2 / ände 3), t.ex. PG/PG/F');
    const parsed = tokens.map(parseEndToken);
    const bad = tokens.find((_, i) => parsed[i] === null);
    if (bad !== undefined) return fail(`Okänt ändutförande "${bad}". Giltiga: PG, L, P, F, B, Fast B, Falsad B, TN.`);
    const codes = parsed as EndCode[];
    if (codes.length === 1) {
      ends = [codes[0], codes[0], codes[0]];
      warnings.push(`Bara ett ändutförande angivet – använder ${END_TYPES[codes[0]].code} på alla tre ändarna.`);
    } else if (codes.length === 2) {
      ends = [codes[0], codes[1], 'PG'];
      warnings.push('Två ändutföranden angivna – används för ände 1 och 2, avstickaren (ände 3) får PG. Lägg till ett tredje för avstickaren, t.ex. PG/PG/F.');
    } else {
      ends = codes;
    }
  }

  return {
    ok: true,
    product: {
      kind: 'KT',
      code: s,
      variant: a,
      width,
      height,
      branchWidth,
      legs: [STANDARD_LEG, STANDARD_LEG, STANDARD_LEG],
      insulation,
      surface,
      ends: [ends[0], ends[1]],
      branchEnd: ends[2],
      warnings,
    },
  };
}

export function describeKT(p: Tee): SpecRow[] {
  return [
    { label: 'Produkt', value: 'T-stycke', token: 'KT' },
    { label: 'Utförande', value: p.variant === 1 ? 'Ben 130/130/130 mm' : 'Valfria ben (enligt skiss)', token: `a=${p.variant}` },
    { label: 'Genomgående (ände 1–2)', value: `${p.width} × ${p.height} mm` },
    { label: 'Avstick (ände 3)', value: `${p.branchWidth} × ${p.height} mm` },
    { label: 'Genomgående längd', value: `${runLength(p)} mm` },
    ...commonRows(p),
    { label: 'Ände 3 (avstick)', value: END_TYPES[p.branchEnd].label, token: END_TYPES[p.branchEnd].code },
  ];
}
