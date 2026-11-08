// Skiss: a dimensioned drawing of a straight duct made to a sketch – its shaped end and the
// stosramar mounted on its sides – to attach to the order instead of a hand drawing.
//
// Three views at the same scale, like a workshop sketch:
//   • Sett ovanifrån (top) – end 1 at the bottom, end 2 at the top, so "left" is on the left
//   • Sett från sidan – each side that has a stosram, with its position on the side
//   • Sett från ände 1 – the cross-section with the stosramar sticking out
// Drawn as SVG (also used in the printout) and saved as PNG.

import { END_TYPES } from './codes/common';
import * as THREE from 'three';
import type { StraightDuct } from './codes/types';
import type { LaidPart, Layout } from './assembly/layout';
import { mountFootprint, mountQuarter } from './assembly/layout';
import { shapedOutline } from './geometry/special';
import type { DuctSide, Mount } from './store';

export interface SkissInfo {
  project: string;
  room: string;
  /** Detail number per part id (from the order list). */
  detailOf: Map<string, number>;
}

interface Mounted {
  part: LaidPart;
  mount: Mount;
  /** Size of its end against the duct, along and across the side. */
  fp: { along: number; across: number };
  /** How far it sticks out from the side, mm. */
  out: number;
  /** Short name drawn on it: "KRM", "KK", "KD" … */
  tag: string;
  /** End types: against the duct and the far end ('' when it isn't a simple straight piece). */
  nearEnd: string;
  farEnd: string;
  /** Opening size against the duct, e.g. "1010×150". */
  size: string;
}

/** Parts that get a skiss: straight ducts with a shaped end or a stosram on a side. */
export function skissHosts(lay: Layout): LaidPart[] {
  return lay.parts.filter((p) => p.product.kind === 'KK' && (p.asm.shape || mountedOn(lay, p.asm.id).length));
}

function mountedOn(lay: Layout, id: string): Mounted[] {
  const host = lay.parts.find((p) => p.asm.id === id);
  if (!host || host.product.kind !== 'KK') return [];
  const duct = host.product;
  const toHost = host.matrix.clone().invert();
  return lay.parts
    .filter((c) => c.asm.parent === id && c.asm.mount)
    .flatMap((c) => {
      const own = c.model.ports.find((p) => p.id === c.asm.via);
      if (!own) return [];
      const mount = c.asm.mount!;
      const fp = mountFootprint(own, mountQuarter(c.asm));
      // How far it sticks out: straight pieces by their length, anything else by its outline
      const p = c.product;
      let out: number;
      if ((p.kind === 'KR' || p.kind === 'KK' || p.kind === 'KD' || p.kind === 'LD' || p.kind === 'SP') && 'length' in p) out = p.length;
      else {
        const b = c.model.bounds;
        const n = { left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] }[mount.side];
        const face = mount.side === 'left' || mount.side === 'right' ? duct.width / 2 : duct.height / 2;
        let max = 0;
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(c.matrix).applyMatrix4(toHost);
          max = Math.max(max, v.x * n[0] + v.y * n[1] + v.z * n[2] - face);
        }
        out = Math.round(max);
      }
      const straight = p.kind === 'KR' || p.kind === 'KK';
      const far = c.model.ports.find((x) => x.id !== own.id);
      return [{
        part: c,
        mount,
        fp,
        out,
        tag: p.kind === 'KR' ? (p.mounted ? 'KRM' : 'KR') : p.kind,
        nearEnd: straight ? endName(own.end) : '',
        farEnd: straight && far ? endName(far.end) : '',
        size: `${own.w}×${own.h}`,
      }];
    });
}

const endName = (code: string) => END_TYPES[code as keyof typeof END_TYPES]?.code ?? code;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SIDE_NAME: Record<DuctSide, string> = { left: 'vänster sida', right: 'höger sida', top: 'ovansidan', bottom: 'undersidan' };

// ---------- Drawing helpers (page pixels) ----------

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const INK = '#1d1b16';
const DIM = '#c2410c';

class Pen {
  out: string[] = [];
  line(x1: number, y1: number, x2: number, y2: number, color = INK, w = 1, dash = '') {
    this.out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} />`);
  }
  poly(pts: [number, number][], fill = 'none', w = 2.2, dash = '') {
    this.out.push(`<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''} />`);
  }
  text(x: number, y: number, t: string, size = 15, o: { color?: string; anchor?: string; weight?: number; rotate?: number } = {}) {
    const rot = o.rotate ? ` transform="rotate(${o.rotate} ${x} ${y})"` : '';
    this.out.push(
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${o.color ?? INK}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle" font-weight="${o.weight ?? 400}"${rot}>${esc(t)}</text>`,
    );
  }
  /**
   * Dimension between two points, drawn `off` px to the side (positive = to the left of p1→p2
   * on the page), with extension lines, ticks and the value in the middle.
   */
  dim(x1: number, y1: number, x2: number, y2: number, off: number, label: string) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const nx = uy;
    const ny = -ux;
    const a = [x1 + nx * off, y1 + ny * off];
    const b = [x2 + nx * off, y2 + ny * off];
    const ext = Math.sign(off) * 6;
    this.line(x1 + nx * Math.sign(off) * 3, y1 + ny * Math.sign(off) * 3, a[0] + nx * ext, a[1] + ny * ext, DIM, 0.8);
    this.line(x2 + nx * Math.sign(off) * 3, y2 + ny * Math.sign(off) * 3, b[0] + nx * ext, b[1] + ny * ext, DIM, 0.8);
    this.line(a[0], a[1], b[0], b[1], DIM, 1);
    for (const [px, py] of [a, b]) this.line(px - (ux + nx) * 5, py - (uy + ny) * 5, px + (ux + nx) * 5, py + (uy + ny) * 5, DIM, 1.6);
    const mx = (a[0] + b[0]) / 2 + nx * 11 * Math.sign(off || 1);
    const my = (a[1] + b[1]) / 2 + ny * 11 * Math.sign(off || 1);
    let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    this.text(mx, my, label, 14, { color: DIM, weight: 700, rotate: angle });
  }
}

/** A view: everything in mm, mapped to the page by `at`. */
interface View {
  title: string;
  /** Size in mm (including room for dimensions and labels). */
  w: number;
  h: number;
  /** Draw at page position (x, y) with `s` px per mm. */
  draw: (pen: Pen, x: number, y: number, s: number) => void;
}

// ---------- The views ----------

function topView(d: StraightDuct, shape: LaidPart['asm']['shape'], mounts: Mounted[]): View {
  const W = d.width;
  const L = d.length;
  const leftOut = Math.max(0, ...mounts.filter((m) => m.mount.side === 'left').map((m) => m.out));
  const rightOut = Math.max(0, ...mounts.filter((m) => m.mount.side === 'right').map((m) => m.out));
  const pad = Math.max(W, L) * 0.09 + 40;
  const minX = -W / 2 - leftOut - pad * 1.6;
  const maxX = W / 2 + rightOut + pad * 1.6;
  const minY = -L / 2 - pad * 1.4;
  const maxY = L / 2 + pad * 1.4;
  return {
    title: 'Sett ovanifrån',
    w: maxX - minX,
    h: maxY - minY,
    draw(pen, ox, oy, s) {
      // Page: x → right (= the duct's left seen from end 1 is on the left), y → down (end 2 at the top)
      const P = (x: number, z: number): [number, number] => [ox + (-x - minX) * s, oy + (-z - minY) * s];
      const outline = shape ? shapedOutline(W, L, shape) : ([[W / 2, -L / 2], [W / 2, L / 2], [-W / 2, L / 2], [-W / 2, -L / 2]] as [number, number][]);
      pen.poly(outline.map(([x, z]) => P(x, z)), '#f3f1ec');
      const gap = 26;
      // Stosramar on the sides stick out; on top/bottom they're drawn on the duct
      for (const m of mounts) {
        const fp = m.fp;
        const z0 = -L / 2 + m.mount.along;
        const z1 = z0 + fp.along;
        if (m.mount.side === 'left' || m.mount.side === 'right') {
          const sg = m.mount.side === 'left' ? 1 : -1;
          const x0 = (sg * W) / 2;
          const x1 = x0 + sg * m.out;
          pen.poly([P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)], '#fde8dc');
          const c = P((x0 + x1) / 2, (z0 + z1) / 2);
          pen.text(c[0], c[1], m.tag, 14, { weight: 700 });
          // End types at both ends, when there's room for them next to the name
          if (m.out * s > 110) {
            const [fx, fy] = P(x0 + sg * 18 / s, (z0 + z1) / 2);
            if (m.nearEnd) pen.text(fx, fy, m.nearEnd, 12, { rotate: -90 });
            const [ex, ey] = P(x1 - sg * 18 / s, (z0 + z1) / 2);
            if (m.farEnd) pen.text(ex, ey, m.farEnd, 12, { rotate: -90 });
          }
          // Position along the duct, its size, and how far it sticks out
          const outer = x1 + sg * 0;
          pen.dim(...P(outer, -L / 2), ...P(outer, z0), sg > 0 ? gap : -gap, `${m.mount.along}`);
          pen.dim(...P(outer, z0), ...P(outer, z1), sg > 0 ? gap : -gap, `${fp.along}`);
          pen.dim(...P(x0, z1), ...P(x1, z1), sg > 0 ? -gap * 0.9 : gap * 0.9, `${m.out}`);
        } else {
          const x0 = W / 2 - m.mount.across;
          const x1 = x0 - fp.across;
          pen.poly([P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)], m.mount.side === 'top' ? '#fde8dc' : 'none', 1.6, m.mount.side === 'bottom' ? '7 5' : '');
          const c = P((x0 + x1) / 2, (z0 + z1) / 2);
          pen.text(c[0], c[1], m.tag, 13, { weight: 700 });
          // Position: drawn on the duct itself, from end 1 and from the left edge
          const xm = (x0 + x1) / 2;
          if (m.mount.along > 0) pen.dim(...P(xm, -L / 2), ...P(xm, z0), 0, `${m.mount.along}`);
          if (m.mount.across > 0) pen.dim(...P(W / 2, (z0 + z1) / 2), ...P(x0, (z0 + z1) / 2), 0, `${m.mount.across}`);
        }
      }
      // Overall: width at end 1, length on the plain side
      pen.dim(...P(W / 2, -L / 2), ...P(-W / 2, -L / 2), -gap * 1.4, `${W}`);
      // Overall length on the plain side, outside any stosram there (and its own dimensions)
      const plainX = shape?.corner === 'right' ? W / 2 : -W / 2;
      const plainSign = plainX > 0 ? 1 : -1;
      const out = Math.max(0, ...mounts.filter((m) => m.mount.side === (plainX > 0 ? 'left' : 'right')).map((m) => m.out));
      pen.dim(...P(plainX, -L / 2), ...P(plainX, L / 2), plainSign * (out * s + gap * (out ? 2.8 : 1.4)), `${L}`);
      // The shaped corner
      if (shape) {
        const sg = shape.corner === 'left' ? 1 : -1;
        const xs = (sg * W) / 2;
        pen.dim(...P(xs, L / 2 - shape.along), ...P(xs, L / 2), sg > 0 ? gap : -gap, `${shape.along}`);
        pen.dim(...P(xs, L / 2), ...P(xs - sg * shape.across, L / 2), sg > 0 ? gap : -gap, `${shape.across}`);
        const c = P(xs - sg * shape.across * 0.42, L / 2 - shape.along * 0.42);
        pen.text(c[0], c[1], shape.kind === 'round' ? 'Rundat' : 'Fas', 12, { color: '#6b665b' });
      }
      // End names
      const [e1x, e1y] = P(0, -L / 2);
      pen.text(e1x, e1y + gap * 3.2, `Ände 1 · ${endName(d.ends[0])}`, 15, { weight: 700 });
      const [e2x, e2y] = P(0, L / 2);
      pen.text(e2x, e2y - gap * (shape ? 3 : 2.4), shape ? `Ände 2 · stängd (${endName(d.ends[1])})` : `Ände 2 · ${endName(d.ends[1])}`, 15, { weight: 700 });
    },
  };
}

/** The duct's side with the stosramar on it, seen from outside that side. */
function sideView(d: StraightDuct, side: DuctSide, mounts: Mounted[]): View {
  const L = d.length;
  const across = side === 'left' || side === 'right' ? d.height : d.width;
  const pad = Math.max(L, across) * 0.08 + 40;
  const minX = -pad * 1.6;
  const maxX = L + pad * 1.6;
  const minY = -pad * 1.8;
  const maxY = across + pad * 1.4;
  // A true view from outside: on the left side end 1 is on the right, on the right side on the left
  const flip = side === 'left' || side === 'top';
  const name = side === 'left' ? 'Sett från vänster sida' : side === 'right' ? 'Sett från höger sida' : side === 'top' ? 'Sett ovanifrån, ovansidan' : 'Sett underifrån';
  return {
    title: name,
    w: maxX - minX,
    h: maxY - minY,
    draw(pen, ox, oy, s) {
      // Page x: along the duct, page y: across the side (bottom edge at the bottom)
      const P = (u: number, v: number): [number, number] => [ox + ((flip ? L - u : u) - minX) * s, oy + (maxY - v) * s];
      pen.poly([P(0, 0), P(L, 0), P(L, across), P(0, across)], '#f3f1ec');
      const gap = 24;
      for (const m of mounts) {
        const fp = m.fp;
        const u0 = m.mount.along;
        const v0 = m.mount.across;
        pen.poly([P(u0, v0), P(u0 + fp.along, v0), P(u0 + fp.along, v0 + fp.across), P(u0, v0 + fp.across)], '#fde8dc');
        const c = P(u0 + fp.along / 2, v0 + fp.across / 2);
        pen.text(c[0], c[1], `${m.tag} ${m.size}`, 13, { weight: 700 });
        const f = flip ? -1 : 1;
        pen.dim(...P(0, across), ...P(u0, across), gap * f, `${u0}`);
        pen.dim(...P(u0, across), ...P(u0 + fp.along, across), gap * f, `${fp.along}`);
        if (u0 + fp.along < L) pen.dim(...P(u0 + fp.along, across), ...P(L, across), gap * f, `${L - u0 - fp.along}`);
        pen.dim(...P(u0 + fp.along, v0), ...P(u0 + fp.along, v0 + fp.across), -gap * 0.9 * f, `${fp.across}`);
        if (v0 > 0) pen.dim(...P(u0, 0), ...P(u0, v0), gap * 0.9 * f, `${v0}`);
        else {
          const [tx, ty] = P(u0 + fp.along / 2, 0);
          pen.text(tx, ty + 16, 'jäms med underkant', 12, { color: '#6b665b' });
        }
      }
      pen.dim(...P(0, 0), ...P(0, across), gap * 1.6 * (flip ? -1 : 1), `${across}`);
      const [lx, ly] = P(0, 0);
      pen.text(lx, ly + gap * 1.9, `Ände 1 · ${endName(d.ends[0])}`, 13, { anchor: flip ? 'end' : 'start', color: '#6b665b', weight: 700 });
      const [rx, ry] = P(L, 0);
      pen.text(rx, ry + gap * 1.9, 'Ände 2', 13, { anchor: flip ? 'start' : 'end', color: '#6b665b', weight: 700 });
    },
  };
}

/** Cross-section seen from end 1, with the stosramar sticking out. */
function endView(d: StraightDuct, mounts: Mounted[]): View {
  const W = d.width;
  const H = d.height;
  const out = (side: DuctSide) => Math.max(0, ...mounts.filter((m) => m.mount.side === side).map((m) => m.out));
  // Seen from end 1 looking along the duct: its left side is on the page's left
  const pad = Math.max(W, H) * 0.12 + 40;
  const minX = -W / 2 - out('left') - pad * 1.4;
  const maxX = W / 2 + out('right') + pad * 1.4;
  const minY = -H / 2 - out('bottom') - pad * 1.4;
  const maxY = H / 2 + out('top') + pad * 1.4;
  return {
    title: 'Sett från ände 1',
    w: maxX - minX,
    h: maxY - minY,
    draw(pen, ox, oy, s) {
      // Page x = −X (left side of the duct on the left), page y = −Y
      const P = (x: number, y: number): [number, number] => [ox + (-x - minX) * s, oy + (maxY - y) * s];
      pen.poly([P(W / 2, -H / 2), P(-W / 2, -H / 2), P(-W / 2, H / 2), P(W / 2, H / 2)], '#f3f1ec');
      const gap = 24;
      for (const m of mounts) {
        const fp = m.fp;
        const len = m.out;
        let r: [number, number, number, number]; // x0, y0, x1, y1 in mm
        switch (m.mount.side) {
          case 'left': r = [W / 2, -H / 2 + m.mount.across, W / 2 + len, -H / 2 + m.mount.across + fp.across]; break;
          case 'right': r = [-W / 2, -H / 2 + m.mount.across, -W / 2 - len, -H / 2 + m.mount.across + fp.across]; break;
          case 'top': r = [W / 2 - m.mount.across, H / 2, W / 2 - m.mount.across - fp.across, H / 2 + len]; break;
          case 'bottom': r = [W / 2 - m.mount.across, -H / 2, W / 2 - m.mount.across - fp.across, -H / 2 - len]; break;
        }
        const [x0, y0, x1, y1] = r;
        pen.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], '#fde8dc');
        if (m.mount.side === 'left' || m.mount.side === 'right') {
          pen.dim(...P(x0, Math.max(y0, y1)), ...P(x1, Math.max(y0, y1)), m.mount.side === 'left' ? -gap : gap, `${len}`);
          pen.dim(...P(x1, y0), ...P(x1, y1), m.mount.side === 'left' ? gap : -gap, `${fp.across}`);
        } else {
          pen.dim(...P(x1, y0), ...P(x1, y1), m.mount.side === 'top' ? -gap : gap, `${len}`);
          pen.dim(...P(x0, y1), ...P(x1, y1), m.mount.side === 'top' ? gap : -gap, `${fp.across}`);
        }
      }
      pen.dim(...P(W / 2, -H / 2), ...P(-W / 2, -H / 2), -gap * 1.2, `${W}`);
      // Height on the side with the least sticking out, outside it
      const useRight = out('right') <= out('left');
      const hx = useRight ? -W / 2 : W / 2;
      const away = (useRight ? out('right') : out('left')) * s + gap * (mounts.some((m) => m.mount.side === (useRight ? 'right' : 'left')) ? 2.4 : 1);
      pen.dim(...P(hx, -H / 2), ...P(hx, H / 2), useRight ? -away : away, `${H}`);
    },
  };
}

// ---------- The sheet ----------

/** The skiss for a straight duct (and what's mounted on it) as an SVG document. */
export function skissSvg(host: LaidPart, lay: Layout, info: SkissInfo, pageW = 1600, pageH = 1130): string {
  const d = host.product as StraightDuct;
  const mounts = mountedOn(lay, host.asm.id);
  const shape = host.asm.shape;
  const views: View[] = [topView(d, shape, mounts)];
  // Stosramar on top are shown in the top view; the other sides get a view of their own
  const sides = [...new Set(mounts.map((m) => m.mount.side))].filter((s) => s !== 'top');
  for (const side of sides) views.push(sideView(d, side, mounts.filter((m) => m.mount.side === side)));
  views.push(endView(d, mounts));

  const pen = new Pen();
  const headH = 112 + (1 + mounts.length) * 22;
  const footH = 110;
  const margin = 36;
  // Top view on the left, the others stacked on the right – one scale for all
  const leftW = (pageW - 3 * margin) * 0.48;
  const rightW = pageW - 3 * margin - leftW;
  const areaH = pageH - headH - footH - margin;
  const others = views.slice(1);
  const titleH = 34;
  const eachH = (areaH - others.length * titleH) / Math.max(1, others.length) - 10;
  const scale = Math.min(
    leftW / views[0].w,
    (areaH - titleH) / views[0].h,
    ...others.map((v) => Math.min(rightW / v.w, eachH / v.h)),
  );

  // Header
  const detail = info.detailOf.get(host.asm.id);
  pen.text(margin, 48, `SKISS${detail !== undefined ? ` · DETALJ ${detail}` : ''}`, 30, { anchor: 'start', weight: 700 });
  pen.text(pageW - margin, 40, info.project, 17, { anchor: 'end', weight: 700 });
  pen.text(pageW - margin, 64, `${info.room} · ${new Date().toLocaleDateString('sv-SE')}`, 15, { anchor: 'end', color: '#6b665b' });
  const codes = [
    `${detail ?? '–'}: ${host.asm.code}${shape ? ' (enligt skiss)' : ''}`,
    ...mounts.map((m) => `${info.detailOf.get(m.part.asm.id) ?? '–'}: ${m.part.asm.code} – ${m.tag === 'KRM' ? 'monteras' : 'sitter'} på ${SIDE_NAME[m.mount.side]}`),
  ];
  codes.forEach((c, i) => pen.text(margin, 88 + i * 22, c, 15, { anchor: 'start', weight: i === 0 ? 700 : 400 }));
  pen.line(margin, headH - 8, pageW - margin, headH - 8, INK, 2);

  // Views
  const place = (v: View, x: number, y: number, w: number, h: number) => {
    pen.text(x, y + 12, v.title.toUpperCase(), 13, { anchor: 'start', weight: 700, color: '#6b665b' });
    const vw = v.w * scale;
    const vh = v.h * scale;
    v.draw(pen, x + (w - vw) / 2, y + titleH + (h - titleH - vh) / 2, scale);
  };
  place(views[0], margin, headH, leftW, areaH);
  let y = headH;
  for (const v of others) {
    const h = titleH + eachH;
    place(v, margin * 2 + leftW, y, rightW, h);
    y += h + 10;
  }

  // Footer: notes and what the sketch means
  const fy = pageH - footH;
  pen.line(margin, fy, pageW - margin, fy, '#d7d2c6', 1);
  const notes = [
    'Mått i mm. Vänster/höger = sett från ände 1 mot ände 2. Monterade delars läge mäts från ände 1 till deras kant och från kanalens underkant.',
    ...(host.asm.note ? [`Anteckning: ${host.asm.note}`] : []),
  ];
  notes.forEach((n, i) => pen.text(margin, fy + 28 + i * 24, n, i ? 16 : 13, { anchor: 'start', color: i ? INK : '#6b665b', weight: i ? 700 : 400 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="0 0 ${pageW} ${pageH}"><rect width="100%" height="100%" fill="#fff" />${pen.out.join('')}</svg>`;
}

/** Turn the SVG into a PNG and download it. */
export async function downloadSkissPng(svg: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
