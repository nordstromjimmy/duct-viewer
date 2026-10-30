// Generic silencers (LD) and dampers (SP), rectangular. Not tied to a manufacturer – just the
// dimensions needed to plan the duct run.
//
// Silencer:  LD-bbbb-cccc-llll[-n] [ends]   width, height, length, n = number of baffles (optional)
// Damper:    SP-a-bbbb-cccc-llll [ends]     a = 1 manual (injustering), 2 motorised, 3 fire damper

import { commonRows, INSULATION, normalise, parseEnds, splitCode } from './common';
import type { Damper, DamperType, ParseResult, Silencer, SpecRow } from './types';

export const DAMPER_TYPES: Record<DamperType, { label: string; sv: string; defaultLength: number }> = {
  1: { label: 'Manual', sv: 'Injusteringsspjäll', defaultLength: 200 },
  2: { label: 'Motorised', sv: 'Motorspjäll', defaultLength: 200 },
  3: { label: 'Fire damper', sv: 'Brandspjäll', defaultLength: 400 },
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
const endRows = (p: Silencer | Damper) => commonRows(p).filter((r) => r.label !== 'Insulation');

// ---------- Silencer ----------

const failLD = (error: string): ParseResult<Silencer> => ({ ok: false, error });

export function parseLD(input: string): ParseResult<Silencer> {
  const s = normalise(input);
  const split = splitCode(s, 'LD');
  if (!split) return failLD('A silencer code looks like LD-800-500-1200 (width-height-length).');
  const { nums, endPart } = split;
  const warnings: string[] = [];

  if (nums.length !== 3 && nums.length !== 4) return failLD('Expected LD-width-height-length, optionally -baffles at the end.');
  const [width, height, length] = nums;
  if (width <= 0 || height <= 0 || length <= 0) return failLD('Dimensions must be greater than 0.');

  let baffles = nums[3] ?? 0;
  const auto = !baffles;
  if (auto) baffles = autoBaffles(width);
  if (baffles > width / 60) warnings.push(`${baffles} baffles is a lot for ${width} mm – they'll be very thin.`);

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
    { label: 'Product', value: 'Silencer (generic)', token: 'LD' },
    { label: 'Opening', value: `${p.width} × ${p.height} mm` },
    { label: 'Length', value: `${p.length} mm` },
    { label: 'Baffles', value: `${p.baffles}${p.autoBaffles ? ' (automatic)' : ''}` },
    ...endRows(p),
  ];
}

// ---------- Damper ----------

const failSP = (error: string): ParseResult<Damper> => ({ ok: false, error });

export function parseSP(input: string): ParseResult<Damper> {
  const s = normalise(input);
  const split = splitCode(s, 'SP');
  if (!split) return failSP('A damper code looks like SP-1-800-500-200 (type-width-height-length).');
  const { nums, endPart } = split;
  const warnings: string[] = [];

  const [a, width, height, length] = nums;
  if (!(a in DAMPER_TYPES)) return failSP('The first number is the damper type: 1 = manual, 2 = motorised, 3 = fire damper.');
  if (nums.length !== 4) return failSP('Expected SP-type-width-height-length, e.g. SP-1-800-500-200.');
  if (width <= 0 || height <= 0 || length <= 0) return failSP('Dimensions must be greater than 0.');
  if (length < 100) warnings.push('Very short damper – blades and gears may stick out of the frame.');

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
    { label: 'Product', value: 'Damper (generic)', token: 'SP' },
    { label: 'Type', value: `${t.label} · ${t.sv}`, token: `a=${p.type}` },
    { label: 'Opening', value: `${p.width} × ${p.height} mm` },
    { label: 'Length', value: `${p.length} mm` },
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
