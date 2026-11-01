// Entry point for product codes: picks the right parser from the code's prefix.
// To add a product: write a parser + describe function, then register it here.

import { describeLD, describeSP, parseLD, parseSP } from './accessories';
import { describeAGG, parseAGG } from './agg';
import { describeKB, parseKB } from './kb';
import { describeKD, parseKD } from './kd';
import { describeKK, parseKK } from './kk';
import { describeKO, parseKO } from './ko';
import { describeKS, parseKS } from './ks';
import { describeKT, parseKT } from './kt';
import { normalise } from './common';
import type { ParseResult, Product, SpecRow } from './types';

const PARSERS: Record<string, (input: string) => ParseResult> = {
  KK: parseKK,
  KD: parseKD,
  KB: parseKB,
  KS: parseKS,
  KÖ: parseKO,
  KO: parseKO, // KÖ typed without Ö
  KT: parseKT,
  AGG: parseAGG,
  LD: parseLD,
  SP: parseSP,
};

export function parseCode(input: string): ParseResult {
  const s = normalise(input);
  if (!s) return { ok: false, error: 'Skriv en kod, t.ex. KK-1-1500-1000-0' };
  const prefix = s.match(/^[A-ZÅÄÖ]+/)?.[0] ?? '';
  const parser = PARSERS[prefix];
  if (!parser) {
    return { ok: false, error: `Okänd produkt "${prefix || s}". Hittills stöds: ${Object.keys(PARSERS).filter((k) => k !== 'KO').join(', ')}.` };
  }
  return parser(s);
}

/** Short one-line description, used as the default name in My parts. */
export function summary(p: Product): string {
  switch (p.kind) {
    case 'KK': return `Rak kanal ${p.width}×${p.height} · ${p.length}`;
    case 'KD': return `Dim.förändring ${p.width}×${p.height} → ${p.smallWidth}×${p.smallHeight}`;
    case 'KB': return `Böj ${p.angle}° · ${p.width}×${p.height}`;
    case 'KS': return `S-böj ${p.width}×${p.height} · fall ${p.offset}`;
    case 'KÖ': return `Övergång ${p.width}×${p.height} → Ø${p.diameter}`;
    case 'KT': return `T-stycke ${p.width}×${p.height} · avstick ${p.branchWidth}`;
    case 'AGG': return `Aggregat ${p.length}×${p.depth}×${p.height}`;
    case 'LD': return `Ljuddämpare ${p.width}×${p.height} · ${p.length}`;
    case 'SP': return `${['', 'Injusteringsspjäll', 'Motorspjäll', 'Brandspjäll'][p.type]} ${p.width}×${p.height}`;
  }
}

export function describe(p: Product): SpecRow[] {
  switch (p.kind) {
    case 'KK': return describeKK(p);
    case 'KD': return describeKD(p);
    case 'KB': return describeKB(p);
    case 'KS': return describeKS(p);
    case 'KÖ': return describeKO(p);
    case 'KT': return describeKT(p);
    case 'AGG': return describeAGG(p);
    case 'LD': return describeLD(p);
    case 'SP': return describeSP(p);
  }
}
