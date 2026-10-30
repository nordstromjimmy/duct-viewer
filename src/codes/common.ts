// Tables and helpers shared by all Crenna rectangular products.

import type { EndCode, InsulationSpec, Product, SpecRow, SurfaceSpec } from './types';

// NOTE: inside/outside for each option is our reading of the datasheets:
// sound insulation and the options with a surface layer (7, 8) sit inside the duct,
// EI fire insulation and Armaflex are wrapped on the outside. Adjust here if needed.
export const INSULATION: Record<number, InsulationSpec> = {
  0: { code: 0, label: 'Uninsulated', thickness: 0, side: 'none', kind: 'none', needsSurface: false },
  1: { code: 1, label: '30 mm Invent 45 sound insulation', thickness: 30, side: 'inside', kind: 'sound', needsSurface: false },
  2: { code: 2, label: '50 mm Invent 45 sound insulation', thickness: 50, side: 'inside', kind: 'sound', needsSurface: false },
  3: { code: 3, label: 'EI 15, 30 mm Invent 100/G8 fire insulation', thickness: 30, side: 'outside', kind: 'fire', needsSurface: false },
  4: { code: 4, label: 'EI 30, 70 mm Invent 100/G8 fire insulation', thickness: 70, side: 'outside', kind: 'fire', needsSurface: false },
  5: { code: 5, label: 'EI 60, 120 mm Invent 100/G8 fire insulation', thickness: 120, side: 'outside', kind: 'fire', needsSurface: false },
  6: { code: 6, label: '13 mm external Armaflex insulation', thickness: 13, side: 'outside', kind: 'armaflex', needsSurface: false },
  7: { code: 7, label: 'E30, 50 mm fire insulation', thickness: 50, side: 'inside', kind: 'fire', needsSurface: true },
  8: { code: 8, label: 'E60, 100 mm fire insulation', thickness: 100, side: 'inside', kind: 'fire', needsSurface: true },
  9: { code: 9, label: '100 mm Invent 45 sound insulation', thickness: 100, side: 'inside', kind: 'sound', needsSurface: false },
};

export const SURFACES: Record<number, SurfaceSpec> = {
  1: { code: 1, label: 'Perforated sheet metal' },
  2: { code: 2, label: 'Smooth sheet metal' },
  3: { code: 3, label: 'Mylar film and perforated sheet metal' },
};

export const END_TYPES: Record<EndCode, { code: string; label: string }> = {
  PG: { code: 'PG', label: 'PG joint (standard)' },
  L: { code: 'L', label: 'Loose PG (PG set shipped loose)' },
  P: { code: 'P', label: 'Plain / raw edge (no PG set)' },
  F: { code: 'F', label: 'Flange 40 mm' },
  B: { code: 'B', label: 'PG cap mounted' },
  FAST_B: { code: 'Fast B', label: 'Fixed cap mounted' },
  FALSAD_B: { code: 'Falsad B', label: 'Seamed cap mounted' },
  TN: { code: 'TN', label: 'Wire mesh grille' },
};

// Accepted spellings (spaces removed, upper case) -> end code
const END_ALIASES: Record<string, EndCode> = {
  PG: 'PG',
  L: 'L',
  P: 'P',
  F: 'F',
  B: 'B',
  FASTB: 'FAST_B',
  FALSADB: 'FALSAD_B',
  TN: 'TN',
};

/** One end-type token ("PG", "Fast B", ...) → end code, or null if unknown. */
export function parseEndToken(token: string): EndCode | null {
  return END_ALIASES[token.replace(/\s+/g, '').toUpperCase()] ?? null;
}

/** Normalise a code: trim, upper case, collapse spaces. */
export function normalise(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Split "PREFIX-1-2-3... END1/END2" into its numeric fields and the trailing end-type text.
 * Returns null if the code doesn't start with the prefix followed by numbers.
 */
export function splitCode(s: string, prefix: string): { nums: number[]; endPart: string } | null {
  const re = new RegExp(`^${prefix}((?:\\s*-\\s*\\d+)+)\\s*-?\\s*(.*)$`);
  const m = s.match(re);
  if (!m) return null;
  const nums = m[1].split('-').map((t) => t.trim()).filter(Boolean).map(Number);
  return { nums, endPart: m[2].trim() };
}

/** Parse "PG/F", "Fast B/P", "TN" ... Defaults to PG/PG. Returns an error string on failure. */
export function parseEnds(endPart: string, warnings: string[]): [EndCode, EndCode] | string {
  if (!endPart) return ['PG', 'PG'];
  const parts = endPart.split('/').map((t) => t.trim()).filter(Boolean);
  if (parts.length > 2) return 'Give at most two end types, e.g. PG/F';
  const parsed = parts.map((t) => END_ALIASES[t.replace(/\s+/g, '')] ?? null);
  const bad = parts.find((_, i) => parsed[i] === null);
  if (bad !== undefined) return `Unknown end type "${bad}". Valid: PG, L, P, F, B, Fast B, Falsad B, TN.`;
  if (parsed.length === 1) {
    warnings.push(`Only one end type given – using ${END_TYPES[parsed[0]!].code} on both ends.`);
    return [parsed[0]!, parsed[0]!];
  }
  return [parsed[0]!, parsed[1]!];
}

/** Look up insulation option "d". Returns an error string on failure. */
export function parseInsulation(d: number): InsulationSpec | string {
  return INSULATION[d] ?? `Unknown insulation option "${d}". Valid options are 0–9.`;
}

/** Look up surface layer for insulation 7/8. Returns an error string on failure. */
export function parseSurface(f: number | undefined, d: number, field: string): SurfaceSpec | string {
  if (f === undefined) return `Insulation ${d} needs a surface layer (ytskikt) "${field}" as the last field: 1, 2 or 3.`;
  return SURFACES[f] ?? `Unknown surface layer "${f}". Use 1 (perforated), 2 (smooth) or 3 (mylar + perforated).`;
}

/** Warn when internal insulation leaves no free area in an opening. */
export function checkInsideFit(ins: InsulationSpec, w: number, h: number, warnings: string[], what = 'duct') {
  if (ins.side === 'inside' && 2 * ins.thickness >= Math.min(w, h)) {
    warnings.push(`${ins.thickness} mm internal insulation doesn't fit in a ${w}x${h} ${what}.`);
  }
}

/** Rows shared by all products: insulation, surface layer and the two ends. */
export function commonRows(p: Product, endNames: [string, string] = ['End 1', 'End 2']): SpecRow[] {
  const rows: SpecRow[] = [{ label: 'Insulation', value: p.insulation.label, token: `d=${p.insulation.code}` }];
  if (p.surface) rows.push({ label: 'Surface layer', value: p.surface.label, token: `${p.surface.code}` });
  rows.push({ label: endNames[0], value: END_TYPES[p.ends[0]].label, token: END_TYPES[p.ends[0]].code });
  rows.push({ label: endNames[1], value: END_TYPES[p.ends[1]].label, token: END_TYPES[p.ends[1]].code });
  return rows;
}
