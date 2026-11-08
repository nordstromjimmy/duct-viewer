// KR / KRM – stosram (collar for a branch off a duct side or end): KR-a-bbbb-cccc-d-e-ffff [end1/end2]
// KR is delivered loose, KRM is mounted at the factory on the duct it belongs to.
// Source: Crenna "Kanalsystem – Rektangulärt, KR Stosram", version 3.0.
//
// End 1 is the side that sits against the duct (flange, F, as standard) and end 2 the free
// opening (PG as standard).

import { checkInsideFit, commonRows, normalise, parseEnds, parseInsulation, parseSurface, splitCode } from './common';
import type { ParseResult, SpecRow, Stosram, SurfaceSpec } from './types';

export const KR_VARIANTS: Record<number, { label: string; length?: number }> = {
  1: { label: 'Längd 50 mm (endast oisolerad)', length: 50 },
  2: { label: 'Längd 51–500 mm' },
};

const fail = (error: string): ParseResult<Stosram> => ({ ok: false, error });

export function parseKR(input: string): ParseResult<Stosram> {
  const s = normalise(input);
  const split = splitCode(s, 'KRM?');
  if (!split) return fail('En kod för stosram börjar med KR (lös) eller KRM (monterad), t.ex. KRM-2-1010-150-0-350');
  const mounted = s.startsWith('KRM');
  const { nums, endPart } = split;
  const warnings: string[] = [];
  if (nums.length < 3) return fail('För få fält. Förväntade KR-a-bbbb-cccc-d (utförande, sida bbbb, sida cccc, isolering).');

  const [a, width, height] = nums;
  const rest = nums.slice(3);
  const variant = KR_VARIANTS[a];
  if (!variant) return fail(`Okänt utförande "${a}". Använd 1 (längd 50 mm) eller 2 (längd 51–500 mm).`);
  if (width <= 0 || height <= 0) return fail('Måtten måste vara större än 0.');

  // d – insulation (left out in the datasheet's own example, KR-1-1000-500)
  let d = 0;
  if (rest.length && !(a === 2 && rest.length === 1 && rest[0] > 9)) d = rest.shift()!;
  const insulation = parseInsulation(d);
  if (typeof insulation === 'string') return fail(insulation);
  checkInsideFit(insulation, width, height, warnings, 'stosram');

  // e – surface layer (insulation 7 and 8)
  let surface: SurfaceSpec | null = null;
  if (insulation.needsSurface) {
    const sf = parseSurface(rest.shift(), d, 'e');
    if (typeof sf === 'string') return fail(sf);
    surface = sf;
  }

  // ffff – length
  let length = 50;
  if (a === 2) {
    const l = rest.shift();
    if (l === undefined) return fail(`Utförande 2 kräver längden ffff (51–500 mm), t.ex. ${mounted ? 'KRM' : 'KR'}-2-${width}-${height}-${d}-200`);
    length = l;
    if (length < 51 || length > 500) warnings.push('Utförande 2 är för längder 51–500 mm.');
    if (insulation.side !== 'none' && length < 100) warnings.push('Isolerad stosram går att få från 100 mm längd.');
  } else {
    if (insulation.side !== 'none') warnings.push('Utförande 1 (50 mm) finns bara oisolerad.');
    if (rest.length && rest[0] !== 50) warnings.push(`Utförande 1 är alltid 50 mm – längden ${rest[0]} ignoreras.`);
    if (rest.length) rest.shift();
  }
  if (rest.length > 0) warnings.push(`Extra fält ignoreras: ${rest.join('-')}`);

  // Standard: flange against the duct, PG joint on the free end
  const ends = endPart ? parseEnds(endPart, warnings) : (['F', 'PG'] as Stosram['ends']);
  if (typeof ends === 'string') return fail(ends);

  return {
    ok: true,
    product: { kind: 'KR', code: s, mounted, variant: a as 1 | 2, width, height, length, insulation, surface, ends, warnings },
  };
}

export function describeKR(p: Stosram): SpecRow[] {
  return [
    { label: 'Produkt', value: p.mounted ? 'Stosram, monterad i fabrik' : 'Stosram, levereras lös', token: p.mounted ? 'KRM' : 'KR' },
    { label: 'Utförande', value: KR_VARIANTS[p.variant].label, token: `a=${p.variant}` },
    { label: 'Öppning', value: `${p.width} × ${p.height} mm` },
    { label: 'Längd', value: `${p.length} mm`, token: p.variant === 2 ? 'ffff' : undefined },
    ...commonRows(p, ['Ände 1 (mot kanalen)', 'Ände 2 (fri)']),
  ];
}
