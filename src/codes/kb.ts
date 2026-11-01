// KB – bend (böj): KB-a-bbbb-cccc-d-eeee-ffff-g [end1/end2]
// Source: Crenna "Kanalsystem – Rektangulärt, KB Böj", version 3.0.
//
// a    = variant (see VARIANTS)
// bbbb = side in the bend plane ("utslagssida"), cccc = the other side ("mantelsida")
// d    = insulation
// eeee = reduced side at end 2, only for a = 0 (replaces cccc) and a = 4 (replaces bbbb)
// ffff = length of the second leg, only for a = 0 and a = 4 (standard 130)
// g    = surface layer, only for insulation 7 and 8

import {
  checkInsideFit,
  commonRows,
  normalise,
  parseEnds,
  parseInsulation,
  parseSurface,
  splitCode,
} from './common';
import type { Bend, BendVariant, ParseResult, SpecRow, SurfaceSpec } from './types';

export const VARIANTS: Record<BendVariant, { label: string; angle: number; leg2?: number; custom?: boolean }> = {
  0: { label: '90° böj, ändrad sida (cccc) och/eller benlängd', angle: 90, custom: true },
  1: { label: '90° böj, standardben 130/130 mm', angle: 90, leg2: 130 },
  2: { label: '90° böj, ben 130/450 mm', angle: 90, leg2: 450 },
  3: { label: '45° böj', angle: 45, leg2: 50 },
  4: { label: '90° böj, reducerad sida (bbbb) och/eller benlängd', angle: 90, custom: true },
  5: { label: '30° böj', angle: 30, leg2: 50 },
  6: { label: '15° böj', angle: 15, leg2: 50 },
};

/** Datasheet rule: a guide vane is fitted when bbbb ≥ 800 mm (AMA VVS & Kyl 09). */
export const VANE_FROM = 800;
/** Standard 90° leg (30 mm straight + R100 throat). */
export const LEG_90 = 130;
/** Shortest leg that still contains the R100 throat arc. */
export const LEG_MIN = 100;

const fail = (error: string): ParseResult<Bend> => ({ ok: false, error });

export function parseKB(input: string): ParseResult<Bend> {
  const s = normalise(input);
  const split = splitCode(s, 'KB');
  if (!split) return fail('En kod för böj börjar med KB följt av siffror, t.ex. KB-1-1500-1000-0');

  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 4) {
    return fail('För få fält. Förväntade KB-a-bbbb-cccc-d (utförande, utslagssida, mantelsida, isolering).');
  }

  const [a, width, height, d] = nums;
  const rest = nums.slice(4);

  if (!(a in VARIANTS)) return fail(`Okänt utförande "${a}". Använd 0–6 (1 = 90°, 3 = 45°, 5 = 30°, 6 = 15°).`);
  const variant = a as BendVariant;
  const v = VARIANTS[variant];

  if (width <= 0 || height <= 0) return fail('Måtten måste vara större än 0.');

  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);

  // eeee + ffff for a = 0 / 4
  let endWidth = width;
  let endHeight = height;
  let leg2 = v.leg2 ?? LEG_90;
  if (v.custom) {
    const e = rest.shift();
    const f = rest.shift();
    if (e === undefined || f === undefined) {
      return fail(`Utförande ${a} kräver eeee (reducerad sida, eller ${a === 4 ? 'bbbb' : 'cccc'} om oförändrad) och ffff (benlängd, 130 som standard), t.ex. KB-${a}-${width}-${height}-${d}-${a === 4 ? width : height}-400`);
    }
    if (e <= 0) return fail('Den reducerade sidan eeee måste vara större än 0.');
    if (a === 4) {
      endWidth = e;
      if (e > width) warnings.push(`eeee (${e}) är större än bbbb (${width}) – utförande 4 är för en reducerad sida.`);
    } else {
      endHeight = e;
      if (e > height) warnings.push(`eeee (${e}) är större än cccc (${height}) – utförande 0 är för en reducerad sida.`);
    }
    leg2 = f;
    // The datasheet gives no minimum ("valfri benlängd"). Geometrically the leg must at least
    // contain the R100 throat arc, so below that we draw the minimum and say so.
    if (leg2 < LEG_MIN) {
      warnings.push(`Benet ${leg2} mm är kortare än innerradien ${LEG_MIN} mm – ritas som ${LEG_MIN} mm.`);
      leg2 = LEG_MIN;
    } else if (leg2 < LEG_90) {
      warnings.push(`Benet ${leg2} mm är kortare än standard ${LEG_90} mm – produktbladet anger inget minimum, kontrollera med Crenna.`);
    }
  }

  // g – surface layer
  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    const sf = parseSurface(rest.shift(), d, 'g');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  }
  if (rest.length > 0) warnings.push(`Extra fält ignoreras: ${rest.join('-')}`);

  checkInsideFit(insulation, Math.min(width, endWidth), Math.min(height, endHeight), warnings, 'böj');

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return fail(ends);

  const insulated = insulation.side !== 'none';
  const is90 = v.angle === 90;
  // Guide vane only drawn on 90° bends – the datasheet shows none on 45/30/15°.
  const guideVane = is90 && (width >= VANE_FROM || insulated);

  return {
    ok: true,
    product: {
      kind: 'KB',
      code: s,
      variant,
      angle: v.angle,
      width,
      height,
      endWidth,
      endHeight,
      leg1: is90 ? LEG_90 : 50,
      leg2,
      roundHeel: !insulated,
      guideVane,
      insulation,
      surface,
      ends,
      warnings,
    },
  };
}

export function describeKB(p: Bend): SpecRow[] {
  const sameEnds = p.endWidth === p.width && p.endHeight === p.height;
  const rows: SpecRow[] = [
    { label: 'Produkt', value: 'Böj', token: 'KB' },
    { label: 'Utförande', value: VARIANTS[p.variant].label, token: `a=${p.variant}` },
    { label: 'Vinkel', value: `${p.angle}°` },
    { label: sameEnds ? 'Öppning' : 'Öppning ände 1', value: `${p.width} × ${p.height} mm` },
  ];
  if (!sameEnds) rows.push({ label: 'Öppning ände 2', value: `${p.endWidth} × ${p.endHeight} mm` });
  rows.push(
    { label: 'Ben', value: `${p.leg1} / ${p.leg2} mm` },
    { label: 'Ytterhörn', value: p.roundHeel ? 'Rund' : 'Fyrkantig (isolerad)' },
    {
      label: 'Ledskena',
      value: p.guideVane ? `Ja, vid ${Math.round(p.width / 3)} mm (bbbb/3)` : 'Nej',
    },
    ...commonRows(p),
  );
  return rows;
}
