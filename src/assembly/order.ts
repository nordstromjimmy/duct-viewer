// The order list: every code in the assembly, grouped, with detail numbers – ready to paste
// into Crenna's order form ("Beställning": detalj nr – antal – beställningskod – ändutförande).

import { parseCode, summary } from '../codes';
import type { Project } from '../store';
import { canCut } from './layout';

/** Products ordered from Crenna. Units, silencers and dampers are generic and listed apart. */
const CRENNA = new Set(['KK', 'KD', 'KB', 'KS', 'KÖ', 'KT']);

export interface OrderLine {
  detail: number;
  /** True when the detail number was set by hand. */
  manual: boolean;
  code: string;
  /** The code without its end types, e.g. "KK-3-800-500-0-1000". */
  base: string;
  /** End types, e.g. "PG/L" – empty when none were given (standard PG). */
  ends: string;
  count: number;
  partIds: string[];
  /** Planned site cuts on parts of this line, mm. */
  cuts: number[];
}

export interface OtherLine {
  code: string;
  name: string;
  count: number;
  partIds: string[];
}

export interface Order {
  lines: OrderLine[];
  other: OtherLine[];
  /** Detail numbers used by more than one line. */
  duplicates: number[];
  /** Detail number for each part in the assembly. */
  detailOf: Map<string, number>;
}

/** "KK-3-800-500-0-1000 PG/L" → base "KK-3-800-500-0-1000", ends "PG/L". */
export function splitOrderCode(code: string): { base: string; ends: string } {
  const m = code.match(/^([A-ZÅÄÖ]+(?:-C)?(?:\s*-\s*\d+)+)\s*-?\s*(.*)$/);
  return m ? { base: m[1].replace(/\s+/g, ''), ends: m[2].trim() } : { base: code, ends: '' };
}

export function buildOrder(project: Project): Order {
  const lines: OrderLine[] = [];
  const other: OtherLine[] = [];
  const byCode = new Map<string, OrderLine>();
  const otherByCode = new Map<string, OtherLine>();

  // Group in the order parts were added, so automatic numbers follow the build order
  for (const a of project.assembly) {
    const parsed = parseCode(a.code);
    if (!parsed.ok) continue;
    const p = parsed.product;
    if (!CRENNA.has(p.kind)) {
      const o = otherByCode.get(p.code) ?? { code: p.code, name: summary(p), count: 0, partIds: [] };
      if (!otherByCode.has(p.code)) {
        otherByCode.set(p.code, o);
        other.push(o);
      }
      o.count++;
      o.partIds.push(a.id);
      continue;
    }
    let line = byCode.get(p.code);
    if (!line) {
      line = { detail: 0, manual: false, code: p.code, ...splitOrderCode(p.code), count: 0, partIds: [], cuts: [] };
      byCode.set(p.code, line);
      lines.push(line);
    }
    line.count++;
    line.partIds.push(a.id);
    if (a.cut && canCut(p) && p.kind === 'KK' && a.cut < p.length) line.cuts.push(a.cut);
  }

  // Detail numbers: hand-set ones first, then 1, 2, 3 … skipping numbers already taken
  const details = project.details ?? {};
  const taken = new Set<number>();
  for (const l of lines) {
    const n = details[l.code];
    if (n) {
      l.detail = n;
      l.manual = true;
      taken.add(n);
    }
  }
  let next = 1;
  for (const l of lines) {
    if (l.manual) continue;
    while (taken.has(next)) next++;
    l.detail = next;
    taken.add(next);
  }

  const seen = new Map<number, number>();
  for (const l of lines) seen.set(l.detail, (seen.get(l.detail) ?? 0) + 1);
  const duplicates = [...seen].filter(([, c]) => c > 1).map(([n]) => n);

  lines.sort((a, b) => a.detail - b.detail);
  const detailOf = new Map<string, number>();
  for (const l of lines) for (const id of l.partIds) detailOf.set(id, l.detail);

  return { lines, other, duplicates, detailOf };
}

/** One order line as text: "1 - 2 - KK-3-800-500-0-1000 - PG/L". */
export function lineText(l: OrderLine): string {
  return [l.detail, l.count, l.base, l.ends].filter((x) => x !== '').join(' - ');
}

/** The whole order as plain text, order lines first so they're easy to copy. */
export function orderText(order: Order): string {
  const out = order.lines.map(lineText);

  const cut = order.lines.filter((l) => l.cuts.length);
  if (cut.length) {
    out.push('', 'Kapas på plats:');
    for (const l of cut) {
      // Group equal cut lengths: "Detalj 1: 2 st kapas till 700 mm"
      const counts = new Map<number, number>();
      for (const c of l.cuts) counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const [len, n] of [...counts].sort((a, b) => a[0] - b[0])) {
        out.push(`Detalj ${l.detail}: ${n} st kapas till ${len} mm`);
      }
    }
  }

  if (order.other.length) {
    out.push('', 'Övrigt (ej Crenna):');
    for (const o of order.other) out.push(`${o.count} st - ${o.code}  (${o.name})`);
  }
  return out.join('\n') + '\n';
}
