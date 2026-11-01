// Generic silencers (LD) and dampers (SP), rectangular. Not tied to a manufacturer – just the
// dimensions needed to plan the duct run.
//
// Silencer:  LD-bbbb-cccc-llll[-n] [ends]   width, height, length, n = number of baffles (optional)
// Damper:    SP-a-bbbb-cccc-llll [ends]     a = 1 manual (injustering), 2 motorised, 3 fire damper

import { commonRows, INSULATION, normalise, parseEnds, splitCode } from './common';
import type { Damper, DamperType, ParseResult, Silencer, SpecRow } from './types';

export const DAMPER_TYPES: Record<DamperType, { label: string; sv: string; defaultLength: number }> = {
  1: { label: 'Injusteringsspjäll', sv: 'Injusteringsspjäll', defaultLength: 200 },
  2: { label: 'Motorspjäll', sv: 'Motorspjäll', defaultLength: 200 },
  3: { label: 'Brandspjäll', sv: 'Brandspjäll', defaultLength: 400 },
};

/** Baffle count when none is given: roughly one per 300 mm of width. */
export function autoBaffles(width: number): number {
  return Math.max(1, Math.round(width / 300));
}

/** Baffle thickness and the air gap between baffles, mm. */
export function baffleLayout(width: number, n: number): { thickness: number; gap: number } {
  const thickness = Math.min(100, (width / n) * 0.5);
  return { thickness, gap: (width - n * thickness) / n };
}

/** Rows shared by both: the two end types. */
const endRows = (p: Silencer | Damper) => commonRows(p).filter((r) => r.label !== 'Isolering');

// ---------- Silencer ----------

const failLD = (error: string): ParseResult<Silencer> => ({ ok: false, error });

export function parseLD(input: string): ParseResult<Silencer> {
  const s = normalise(input);
  const split = splitCode(s, 'LD');
  if (!split) return failLD('En ljuddämparkod ser ut som LD-800-500-1200 (bredd-höjd-längd).');
  const { nums, endPart } = split;
  const warnings: string[] = [];

  if (nums.length !== 3 && nums.length !== 4) return failLD('Förväntade LD-bredd-höjd-längd, eventuellt -kulisser på slutet.');
  const [width, height, length] = nums;
  if (width <= 0 || height <= 0 || length <= 0) return failLD('Måtten måste vara större än 0.');

  let baffles = nums[3] ?? 0;
  const auto = !baffles;
  if (auto) baffles = autoBaffles(width);
  if (baffles > width / 60) warnings.push(`${baffles} kulisser är många för ${width} mm – de blir väldigt tunna.`);

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return failLD(ends);

  return {
    ok: true,
    product: {
      kind: 'LD', code: s, width, height, length, baffles, autoBaffles: auto,
      insulation: INSULATION[0], surface: null, ends, warnings,
    },
  };
}

export function describeLD(p: Silencer): SpecRow[] {
  return [
    { label: 'Produkt', value: 'Ljuddämpare (generisk)', token: 'LD' },
    { label: 'Öppning', value: `${p.width} × ${p.height} mm` },
    { label: 'Längd', value: `${p.length} mm` },
    { label: 'Kulisser', value: `${p.baffles}${p.autoBaffles ? ' (automatiskt)' : ''}` },
    ...endRows(p),
  ];
}

// ---------- Damper ----------

const failSP = (error: string): ParseResult<Damper> => ({ ok: false, error });

export function parseSP(input: string): ParseResult<Damper> {
  const s = normalise(input);
  const split = splitCode(s, 'SP');
  if (!split) return failSP('En spjällkod ser ut som SP-1-800-500-200 (typ-bredd-höjd-längd).');
  const { nums, endPart } = split;
  const warnings: string[] = [];

  const [a, width, height, length] = nums;
  if (!(a in DAMPER_TYPES)) return failSP('Första talet är spjälltypen: 1 = injustering, 2 = motor, 3 = brandspjäll.');
  if (nums.length !== 4) return failSP('Förväntade SP-typ-bredd-höjd-längd, t.ex. SP-1-800-500-200.');
  if (width <= 0 || height <= 0 || length <= 0) return failSP('Måtten måste vara större än 0.');
  if (length < 100) warnings.push('Väldigt kort spjäll – blad och kugghjul kan sticka ut ur ramen.');

  const ends = parseEnds(endPart, warnings);
  if (typeof ends === 'string') return failSP(ends);

  return {
    ok: true,
    product: {
      kind: 'SP', code: s, type: a as DamperType, width, height, length,
      insulation: INSULATION[0], surface: null, ends, warnings,
    },
  };
}

export function describeSP(p: Damper): SpecRow[] {
  const t = DAMPER_TYPES[p.type];
  return [
    { label: 'Produkt', value: 'Spjäll (generiskt)', token: 'SP' },
    { label: 'Typ', value: t.label, token: `a=${p.type}` },
    { label: 'Öppning', value: `${p.width} × ${p.height} mm` },
    { label: 'Längd', value: `${p.length} mm` },
    ...endRows(p),
  ];
}

// ---------- Codes from the builder ----------

export function silencerCode(w: number, h: number, l: number, baffles: number): string {
  return `LD-${w}-${h}-${l}${baffles > 0 ? `-${baffles}` : ''}`;
}

export function damperCode(type: DamperType, w: number, h: number, l: number): string {
  return `SP-${type}-${w}-${h}-${l}`;
}
