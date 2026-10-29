// Entry point for product codes: picks the right parser from the code's prefix.
// To add a product: write a parser + describe function, then register it here.

import { describeKB, parseKB } from './kb';
import { describeKD, parseKD } from './kd';
import { describeKK, parseKK } from './kk';
import { describeKO, parseKO } from './ko';
import { describeKS, parseKS } from './ks';
import { normalise } from './common';
import type { ParseResult, Product, SpecRow } from './types';

const PARSERS: Record<string, (input: string) => ParseResult> = {
  KK: parseKK,
  KD: parseKD,
  KB: parseKB,
  KS: parseKS,
  KÖ: parseKO,
  KO: parseKO, // KÖ typed without Ö
};

export function parseCode(input: string): ParseResult {
  const s = normalise(input);
  if (!s) return { ok: false, error: 'Enter a code, e.g. KK-1-1500-1000-0' };
  const prefix = s.match(/^[A-ZÅÄÖ]+/)?.[0] ?? '';
  const parser = PARSERS[prefix];
  if (!parser) {
    return { ok: false, error: `Unknown product "${prefix || s}". Supported so far: ${Object.keys(PARSERS).filter((k) => k !== 'KO').join(', ')}.` };
  }
  return parser(s);
}

export function describe(p: Product): SpecRow[] {
  switch (p.kind) {
    case 'KK': return describeKK(p);
    case 'KD': return describeKD(p);
    case 'KB': return describeKB(p);
    case 'KS': return describeKS(p);
    case 'KÖ': return describeKO(p);
  }
}