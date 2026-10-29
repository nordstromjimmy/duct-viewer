// Shared types for parsed product codes.

/** End types (ändutföranden). */
export type EndCode =
  | 'PG'        // PG joint (standard)
  | 'L'         // Loose PG – PG set shipped loose
  | 'P'         // Plain / raw edge, no PG set
  | 'F'         // Flange 40 mm
  | 'B'         // PG cap (PG-botten) mounted
  | 'FAST_B'    // Fixed cap mounted
  | 'FALSAD_B'  // Seamed cap mounted
  | 'TN';       // Wire mesh grille

export type InsulationSide = 'none' | 'inside' | 'outside';

export interface InsulationSpec {
  code: number;
  label: string;
  /** Thickness in mm (0 when uninsulated). */
  thickness: number;
  side: InsulationSide;
  /** What it's made of, used to pick a colour/material in 3D. */
  kind: 'none' | 'sound' | 'fire' | 'armaflex';
  /** Requires a surface layer (ytskikt) code. */
  needsSurface: boolean;
}

export interface SurfaceSpec {
  code: number;
  label: string;
}

/** Fields every product has. */
interface ProductBase {
  /** The code as the user typed it, normalised. */
  code: string;
  insulation: InsulationSpec;
  surface: SurfaceSpec | null;
  ends: [EndCode, EndCode];
  warnings: string[];
}

/** KK – straight duct. */
export interface StraightDuct extends ProductBase {
  kind: 'KK';
  /** Utförande "a": 1 = 1150, 2 = 2300, 3 = pass piece < 2000, 4 = pass piece > 2000. */
  variant: 1 | 2 | 3 | 4;
  /** Largest side, mm (bbbb) – opening dimension. */
  width: number;
  /** Smallest side, mm (cccc) – opening dimension. */
  height: number;
  /** Duct length, mm. */
  length: number;
  /** Build length (byggmått), mm. */
  buildLength: number;
}

/** Position of the small end relative to the big end, seen from the big end. */
export type Placement = 1 | 2 | 3 | 4 | 5;

/** KD – transition (dimensionsförändring). End 1 is the big end, end 2 the small end. */
export interface Transition extends ProductBase {
  kind: 'KD';
  placement: Placement;
  /** Big end opening, mm (bbbb x cccc). */
  width: number;
  height: number;
  /** Small end opening, mm (eeee x ffff). */
  smallWidth: number;
  smallHeight: number;
  /** Length, mm (gggg, default 500). */
  length: number;
}

/** Bend variant "a": 0/4 = 90° with changed side and/or leg, 1 = 90°, 2 = 90° long leg, 3/5/6 = 45/30/15°. */
export type BendVariant = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** KB – bend (böj). The bend turns towards the throat in the plane of the bbbb side. */
export interface Bend extends ProductBase {
  kind: 'KB';
  variant: BendVariant;
  /** Bend angle, degrees. */
  angle: number;
  /** End 1 opening, mm: bbbb (in the bend plane, "utslagssida") x cccc ("mantelsida"). */
  width: number;
  height: number;
  /** End 2 opening, mm. Differs from end 1 for a = 4 (eeee replaces bbbb) and a = 0 (eeee replaces cccc). */
  endWidth: number;
  endHeight: number;
  /** Leg lengths, mm: 130/130 for 90° bends (second leg 450 or ffff when extended), 50/50 for 45/30/15°. */
  leg1: number;
  leg2: number;
  /** Round heel (outer radius). Insulated bends are made with a square heel. */
  roundHeel: boolean;
  /** Guide vane (ledskena) at bbbb/3 from the throat. */
  guideVane: boolean;
}

/** KS – S-bend (S-böj): same opening at both ends, offset by eeee in the bbbb direction. */
export interface SBend extends ProductBase {
  kind: 'KS';
  /** Opening, mm: bbbb (side the offset is in, "utslagssida") x cccc. */
  width: number;
  height: number;
  /** Offset ("fall") between the two ends, mm (eeee). */
  offset: number;
  /** Length, mm (ffff). */
  length: number;
}

export type Product = StraightDuct | Transition | Bend | SBend;

export type ParseResult<T = Product> =
  | { ok: true; product: T }
  | { ok: false; error: string };

/** A row in the "Decoded" panel. */
export interface SpecRow {
  label: string;
  value: string;
  /** Small code token shown before the value, e.g. "a=1". */
  token?: string;
}