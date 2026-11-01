// KÖ – transition from rectangular to circular (övergång): KÖ-a-bbbb-cccc-0-eeee-ffff [ends]
// Source: Crenna "Kanalsystem – Rektangulärt, KÖ Övergång", version 3.0.
//
// a    = placement of the circular end, seen from the rectangular end (1–5, 5 = centred/standard,
//        0 = special) – same grid as KD
// bbbb, cccc = rectangular opening
// 0    = insulation – the datasheet only offers uninsulated
// eeee = circular connection diameter
// ffff = length; optional, standard 300 / 500 / 600 mm depending on size
//
// End types: the rectangular end takes the usual codes (PG standard). The circular end is a
// nipple as standard; a socket ("muff") is written in plain text, e.g. "KÖ-5-800-400-0-315 MUFF"
// or "... F/MUFF".

import { END_TYPES, INSULATION, normalise, parseEndToken, splitCode } from './common';
import { PLACEMENTS } from './kd';
import type { EndCode, ParseResult, Placement, RoundEnd, RoundTransition, SpecRow } from './types';

/** Straight rectangular collar before the taper, mm (holds the PG profile). */
export const RECT_COLLAR = 30;
/** Length of the nipple / socket on the circular end, mm (not given in the datasheet). */
export const SPIGOT_LENGTH = 50;

/**
 * Standard length from the datasheet: 300 mm if the sides are under 500, 500 mm for 500–1000,
 * 600 mm above 1000. We go by the largest side.
 */
export function standardLength(width: number, height: number): number {
  const side = Math.max(width, height);
  if (side < 500) return 300;
  if (side <= 1000) return 500;
  return 600;
}

/**
 * Centre of the circular end relative to the rectangle centre, in model coordinates (mm).
 * The rectangular end faces -Z, so "right as seen from the rectangular end" is -X.
 */
export function roundEndOffset(p: RoundTransition): { x: number; y: number } {
  const { col, row } = PLACEMENTS[p.placement];
  const viewRight = (col * Math.max(0, p.width - p.diameter)) / 2;
  const up = (row * Math.max(0, p.height - p.diameter)) / 2;
  return { x: -viewRight, y: up };
}

/** Steepest wall angle relative to the duct axis, degrees. */
export function steepestWall(p: RoundTransition): number {
  const o = roundEndOffset(p);
  const r = p.diameter / 2;
  const run = p.length - RECT_COLLAR;
  const deltas = [
    Math.abs(p.width / 2 - (o.x + r)),
    Math.abs(-p.width / 2 - (o.x - r)),
    Math.abs(p.height / 2 - (o.y + r)),
    Math.abs(-p.height / 2 - (o.y - r)),
  ];
  return (Math.atan(Math.max(...deltas) / run) * 180) / Math.PI;
}

const ROUND_END_WORDS: Record<string, RoundEnd> = {
  NIPPEL: 'nipple',
  NIPPLE: 'nipple',
  MUFF: 'socket',
};

const fail = (error: string): ParseResult<RoundTransition> => ({ ok: false, error });

export function parseKO(input: string): ParseResult<RoundTransition> {
  const s = normalise(input);
  // Accept KO as well as KÖ, for keyboards without Ö
  const split = splitCode(s, 'K[ÖO]');
  if (!split) return fail('En kod för övergång till cirkulärt börjar med KÖ, t.ex. KÖ-5-1500-1000-0-315-500');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 5) {
    return fail('För få fält. Förväntade KÖ-a-bbbb-cccc-0-eeee (placering, rektangulär sida, isolering, diameter).');
  }

  const [a, width, height, d, diameter] = nums;
  const rest = nums.slice(5);

  // a – placement
  if (a === 0) return fail('Placering 0 är ett specialutförande enligt skiss – den kan inte ritas bara utifrån koden.');
  if (!(a in PLACEMENTS)) return fail(`Okänd placering "${a}". Använd 1–5 (5 = centrerad, standard).`);
  const placement = a as Placement;

  if (width <= 0 || height <= 0 || diameter <= 0) return fail('Måtten måste vara större än 0.');

  // Insulation – only uninsulated exists for KÖ
  if (d !== 0) warnings.push(`KÖ tillverkas bara oisolerad (isoleringsfält 0) – "${d}" ignoreras.`);

  // Circle bigger than the rectangle?
  if (diameter > Math.min(width, height)) {
    warnings.push(`Ø${diameter} är större än sidan ${Math.min(width, height)} mm – den cirkulära änden sticker ut utanför rektangeln.`);
  }

  // ffff – length, or the standard length
  let length: number;
  let isStandard = false;
  if (rest.length >= 1) {
    length = rest.shift()!;
    if (length <= RECT_COLLAR) return fail(`Längden ffff måste vara mer än ${RECT_COLLAR} mm.`);
  } else {
    length = standardLength(width, height);
    isStandard = true;
  }
  if (rest.length > 0) warnings.push(`Extra fält ignoreras: ${rest.join('-')}`);

  // End types: one rectangular end code and/or NIPPEL/MUFF, in any order
  let rectEnd: EndCode = 'PG';
  let roundEnd: RoundEnd = 'nipple';
  if (endPart) {
    const tokens = endPart.split('/').map((t) => t.trim()).filter(Boolean);
    if (tokens.length > 2) return fail('Ange högst två ändutföranden, t.ex. PG/MUFF');
    let gotRect = false;
    let gotRound = false;
    for (const t of tokens) {
      const word = t.replace(/\s+/g, '');
      if (word in ROUND_END_WORDS) {
        if (gotRound) return fail('Bara ett cirkulärt ändutförande (NIPPEL eller MUFF).');
        roundEnd = ROUND_END_WORDS[word];
        gotRound = true;
        continue;
      }
      const code = parseEndToken(t);
      if (!code) return fail(`Okänt ändutförande "${t}". Rektangulär ände: PG, L, P, F, B, Fast B, Falsad B, TN. Cirkulär ände: NIPPEL eller MUFF.`);
      if (gotRect) return fail('Bara ett rektangulärt ändutförande – den andra änden är cirkulär (NIPPEL eller MUFF).');
      rectEnd = code;
      gotRect = true;
    }
  }

  const product: RoundTransition = {
    kind: 'KÖ',
    code: s,
    placement,
    width,
    height,
    diameter,
    length,
    standardLength: isStandard,
    roundEnd,
    insulation: INSULATION[0],
    surface: null,
    ends: [rectEnd, rectEnd],
    warnings,
  };

  const angle = steepestWall(product);
  if (angle > 45) warnings.push(`Brant övergång: en vägg lutar ${angle.toFixed(0)}° mot kanalens axel.`);

  return { ok: true, product };
}

export function describeKO(p: RoundTransition): SpecRow[] {
  return [
    { label: 'Produkt', value: 'Övergång, rektangulär till cirkulär', token: 'KÖ' },
    { label: 'Placering', value: PLACEMENTS[p.placement].label, token: `a=${p.placement}` },
    { label: 'Rektangulär ände', value: `${p.width} × ${p.height} mm` },
    { label: 'Cirkulär ände', value: `Ø${p.diameter} mm`, token: 'eeee' },
    { label: 'Längd', value: `${p.length} mm${p.standardLength ? ' (standard)' : ''}`, token: 'ffff' },
    { label: 'Brantaste vägg', value: `${steepestWall(p).toFixed(1)}°` },
    { label: 'Isolering', value: 'Oisolerad', token: 'd=0' },
    { label: 'Ände 1 (rekt.)', value: END_TYPES[p.ends[0]].label, token: END_TYPES[p.ends[0]].code },
    {
      label: 'Ände 2 (cirk.)',
      value: p.roundEnd === 'nipple' ? 'Nippel med gummipackning (standard)' : 'Muff',
      token: p.roundEnd === 'nipple' ? 'NIPPEL' : 'MUFF',
    },
  ];
}
