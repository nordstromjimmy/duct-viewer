// AGG – generic ventilation unit (aggregat). Not a Crenna product: the unit is configured in the
// app's builder, which writes a readable code like
//
//   AGG-2400-1200-1300 UTE:T1:500x800 AVL:T2:500x800 FRÅN:T3:500x800 TILL:T4:500x800
//
//   AGG-L-D-H          length, depth, height (mm, height includes the base frame)
//   ROLE:FACE SLOT:SIZE one per connection; leave one out to remove it
//     ROLE  UTE = intake (uteluft), AVL = exhaust (avluft), TILL = supply (tilluft),
//           FRÅN = extract (frånluft)
//     FACE  T = top, F = front, B = back, V = left end, H = right end (seen from the front)
//     SLOT  top/front/back: 1–4 from the left; ends: 1 = upper, 2 = lower
//     SIZE  WxH (mm)

import { INSULATION, normalise, splitCode } from './common';
import type { ParseResult, SpecRow, UnitConnection, UnitFace, UnitRole, VentUnit } from './types';

/** Height of the base frame, mm. */
export const UNIT_BASE = 120;

export const ROLES: Record<UnitRole, { label: string; sv: string; port: 'end1' | 'end2' | 'end3' | 'end4'; color: string }> = {
  TILL: { label: 'Tilluft', sv: 'Tilluft', port: 'end3', color: '#1971c2' },
  FRÅN: { label: 'Frånluft', sv: 'Frånluft', port: 'end4', color: '#e0a800' },
  UTE: { label: 'Uteluft', sv: 'Uteluft', port: 'end1', color: '#2f9e44' },
  AVL: { label: 'Avluft', sv: 'Avluft', port: 'end2', color: '#9c5b2e' },
};
/** Display order: the duct-side connections first. */
export const ROLE_ORDER: UnitRole[] = ['TILL', 'FRÅN', 'UTE', 'AVL'];

export const FACES: Record<UnitFace, { label: string; slots: string[] }> = {
  T: { label: 'Ovansida', slots: ['Pos 1', 'Pos 2', 'Pos 3', 'Pos 4'] },
  F: { label: 'Framsida', slots: ['Pos 1', 'Pos 2', 'Pos 3', 'Pos 4'] },
  B: { label: 'Baksida', slots: ['Pos 1', 'Pos 2', 'Pos 3', 'Pos 4'] },
  V: { label: 'Vänster gavel', slots: ['Övre', 'Nedre'] },
  H: { label: 'Höger gavel', slots: ['Övre', 'Nedre'] },
};

type Vec = [number, number, number];

/**
 * Where a connection sits, in the unit's own coordinates (centred on the origin, X along the
 * length, Y up, Z towards the front). `up` is the direction of the connection's height `h`.
 */
export function slotFrame(u: Pick<VentUnit, 'length' | 'depth' | 'height'>, face: UnitFace, slot: number) {
  const L = u.length;
  const D = u.depth;
  const hc = u.height - UNIT_BASE; // casing height
  const yc = -u.height / 2 + UNIT_BASE + hc / 2; // casing centre
  const along = -L / 2 + (L / 8) * (2 * slot - 1); // centre of quarter `slot`
  const endY = slot === 1 ? yc + hc / 4 : yc - hc / 4;
  const margin = 100;
  switch (face) {
    case 'T': return { center: [along, u.height / 2, 0] as Vec, normal: [0, 1, 0] as Vec, up: [0, 0, 1] as Vec, maxW: L / 4 - margin, maxH: D - 2 * margin };
    case 'F': return { center: [along, yc, D / 2] as Vec, normal: [0, 0, 1] as Vec, up: [0, 1, 0] as Vec, maxW: L / 4 - margin, maxH: hc - 2 * margin };
    case 'B': return { center: [along, yc, -D / 2] as Vec, normal: [0, 0, -1] as Vec, up: [0, 1, 0] as Vec, maxW: L / 4 - margin, maxH: hc - 2 * margin };
    case 'V': return { center: [-L / 2, endY, 0] as Vec, normal: [-1, 0, 0] as Vec, up: [0, 1, 0] as Vec, maxW: D - 2 * margin, maxH: hc / 2 - margin };
    case 'H': return { center: [L / 2, endY, 0] as Vec, normal: [1, 0, 0] as Vec, up: [0, 1, 0] as Vec, maxW: D - 2 * margin, maxH: hc / 2 - margin };
  }
}

export function connSize(c: UnitConnection): string {
  return `${c.w}×${c.h}`;
}

/** Build the code for a unit configuration. */
export function unitCode(u: Pick<VentUnit, 'length' | 'depth' | 'height' | 'connections'>): string {
  const conns = ROLE_ORDER.map((r) => u.connections.find((c) => c.role === r))
    .filter((c): c is UnitConnection => !!c)
    .map((c) => `${c.role}:${c.face}${c.slot}:${c.w}x${c.h}`);
  return normalise([`AGG-${u.length}-${u.depth}-${u.height}`, ...conns].join(' '));
}

// ---------- Presets ----------

type UnitConfig = Pick<VentUnit, 'length' | 'depth' | 'height' | 'connections'>;
const rect = (role: UnitRole, face: UnitFace, slot: number, w: number, h: number): UnitConnection => ({ role, face, slot, w, h });

export const PRESETS: Record<string, { label: string; make: (u: Pick<VentUnit, 'length' | 'depth' | 'height'>) => UnitConfig }> = {
  top: {
    label: 'Alla på ovansidan',
    make: (u) => ({ ...u, connections: [rect('UTE', 'T', 1, 500, 800), rect('AVL', 'T', 2, 500, 800), rect('FRÅN', 'T', 3, 500, 800), rect('TILL', 'T', 4, 500, 800)] }),
  },
  ends: {
    label: 'På gavlarna',
    make: (u) => ({ ...u, connections: [rect('TILL', 'V', 1, 800, 400), rect('FRÅN', 'V', 2, 800, 400), rect('AVL', 'H', 1, 800, 400), rect('UTE', 'H', 2, 800, 400)] }),
  },
  supply: {
    label: 'Bara tilluft',
    make: (u) => ({ ...u, connections: [rect('UTE', 'T', 1, 500, 800), rect('TILL', 'T', 4, 500, 800)] }),
  },
};

export const DEFAULT_UNIT_CODE = unitCode(PRESETS.top.make({ length: 2400, depth: 1200, height: 1300 }));

// ---------- Parsing ----------

const CONN_RE = /^(UTE|AVL|TILL|FRÅN|FRAN):([TFBVH])(\d):(\d+)X(\d+)$/;
const fail = (error: string): ParseResult<VentUnit> => ({ ok: false, error });

export function parseAGG(input: string): ParseResult<VentUnit> {
  const s = normalise(input);
  const split = splitCode(s, 'AGG');
  if (!split) return fail('En aggregatkod ser ut som AGG-2400-1200-1300 TILL:T4:500x800 … – enklast är att använda aggregatbyggaren.');
  const { nums, endPart } = split;
  if (nums.length < 3) return fail('Ange aggregatets storlek: AGG-längd-djup-höjd (mm).');
  const [length, depth, height] = nums;
  if (nums.length > 3) return fail('För många tal efter AGG – förväntade AGG-längd-djup-höjd.');
  if (length < 600 || depth < 400 || height < UNIT_BASE + 300) return fail('Aggregatet är för litet för att ritas (minst 600 × 400 × 420 mm).');

  const warnings: string[] = [];
  const connections: UnitConnection[] = [];
  for (const token of endPart.split(/\s+/).filter(Boolean)) {
    const m = token.match(CONN_RE);
    if (!m) return fail(`Kan inte läsa anslutningen "${token}". Använd t.ex. TILL:T4:500x800.`);
    const role = (m[1] === 'FRAN' ? 'FRÅN' : m[1]) as UnitRole;
    const face = m[2] as UnitFace;
    const slot = Number(m[3]);
    if (connections.some((c) => c.role === role)) return fail(`${ROLES[role].label} (${role}) är angiven två gånger.`);
    if (slot < 1 || slot > FACES[face].slots.length) {
      return fail(`${FACES[face].label} har positionerna 1–${FACES[face].slots.length} (fick ${slot}).`);
    }
    const w = Number(m[4]);
    const h = Number(m[5]);
    if (w <= 0 || h <= 0) return fail(`${ROLES[role].label}: storleken måste vara större än 0.`);
    connections.push({ role, face, slot, w, h });
  }

  // Checks
  if (connections.length === 0) warnings.push('Inga anslutningar – lägg till minst en i byggaren.');
  for (const c of connections) {
    const f = slotFrame({ length, depth, height }, c.face, c.slot);
    if (c.w > f.maxW || c.h > f.maxH) {
      warnings.push(`${ROLES[c.role].label} ${connSize(c)} är för stor för ${FACES[c.face].label.toLowerCase()} position ${c.slot} (max ca ${Math.floor(f.maxW)}×${Math.floor(f.maxH)}).`);
    }
  }
  for (let i = 0; i < connections.length; i++) {
    for (let j = i + 1; j < connections.length; j++) {
      const a = connections[i];
      const b = connections[j];
      if (a.face === b.face && a.slot === b.slot) {
        warnings.push(`${ROLES[a.role].label} och ${ROLES[b.role].label} sitter på samma ställe (${FACES[a.face].label.toLowerCase()} ${a.slot}).`);
      }
    }
  }

  return {
    ok: true,
    product: {
      kind: 'AGG',
      code: s,
      length,
      depth,
      height,
      connections,
      insulation: INSULATION[0],
      surface: null,
      ends: ['PG', 'PG'],
      warnings,
    },
  };
}

export function describeAGG(p: VentUnit): SpecRow[] {
  const rows: SpecRow[] = [
    { label: 'Produkt', value: 'Ventilationsaggregat (generiskt)', token: 'AGG' },
    { label: 'Storlek L × D × H', value: `${p.length} × ${p.depth} × ${p.height} mm` },
  ];
  for (const role of ROLE_ORDER) {
    const c = p.connections.find((x) => x.role === role);
    const r = ROLES[role];
    rows.push({
      label: r.label,
      value: c ? `${FACES[c.face].label} ${FACES[c.face].slots[c.slot - 1].toLowerCase()} · ${connSize(c)}` : '–',
      token: role,
    });
  }
  return rows;
}
