// Printable job sheet: one section per room with a plan drawing (walls with lengths, holes,
// pipes, ladders, the assembly seen from above, measurements), a 3D picture, the order list and
// the list of holes – plus the whole project's order at the end. Printed with the browser's own
// print dialog, where "Save as PDF" makes a PDF.

import { lineText, roomOrder, type Order } from './assembly/order';
import { measureParts } from './measure';
import { framePoint, PIPE_TYPES, roofHole, runLength, runName, segments, wallFaces, wallFrame, type P } from './room/model';
import type { Store, RoomData } from './store';

/** What's needed per room, gathered while each room is shown. */
export interface RoomSheet {
  room: RoomData;
  index: number;
  /** 3D picture (PNG data URL). */
  picture: string | null;
  /** Each part seen from above. */
  outlines: { partId: string; outlines: [number, number][][]; centre: [number, number] }[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Build the printable pages into `root`. */
export function buildPrint(root: HTMLElement, store: Store, sheets: RoomSheet[], order: Order) {
  const job = store.job;
  const date = new Date().toLocaleDateString('sv-SE');
  const pages = sheets.map((s) => roomPage(store, s, order, date));
  if (job.rooms.length > 1) pages.push(projectPage(store, order, date));
  root.innerHTML = pages.join('');
}

function header(store: Store, sub: string, date: string): string {
  return `<header class="pr-head"><div><div class="pr-project">${esc(store.job.name)}</div><h1>${esc(sub)}</h1></div><div class="pr-date">${date}</div></header>`;
}

function roomPage(store: Store, s: RoomSheet, order: Order, date: string): string {
  const ro = roomOrder(order, s.index);
  const room = s.room.room;
  const plan = planSvg(s, order);
  const parts: string[] = [`<section class="pr-page">`, header(store, s.room.name, date)];
  parts.push(`<div class="pr-figs">`);
  if (plan) parts.push(`<figure class="pr-plan"><figcaption>Planritning (sett ovanifrån, mått i mm)</figcaption>${plan}</figure>`);
  if (s.picture) parts.push(`<figure class="pr-3d"><figcaption>3D-vy</figcaption><img src="${s.picture}" alt="3D-vy av ${esc(s.room.name)}" /></figure>`);
  parts.push(`</div>`);

  parts.push(`<div class="pr-lists">`);
  parts.push(orderTable(ro, 'Beställningslista – detta rum'));
  const holes = room?.openings ?? [];
  if (room && holes.length) {
    parts.push(`<h2>Håltagning</h2><p class="pr-note">Mått till hålets kant. ”Vänster hörn” = sett inifrån rummet.</p><table class="pr-table"><thead><tr><th>Hål</th><th>Placering</th><th>Storlek</th><th>Position</th></tr></thead><tbody>`);
    holes.forEach((o, i) => {
      const size = o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`;
      const pos =
        o.on === 'wall'
          ? `${o.x} från vänster hörn · underkant ${o.y} över golv`
          : `${o.x} längs vägg ${o.wall + 1} från vänster hörn · ${o.y} ut från vägg ${o.wall + 1}`;
      parts.push(`<tr><td>${i + 1}</td><td>${o.on === 'wall' ? `Vägg ${o.wall + 1}` : 'Tak'}</td><td class="pr-mono">${size}</td><td>${pos}</td></tr>`);
    });
    parts.push(`</tbody></table>`);
  }
  const runs = room?.runs ?? [];
  if (room && runs.length) {
    parts.push(`<h2>Rör och kabelstegar</h2><table class="pr-table"><thead><tr><th>Namn</th><th>Storlek</th><th>Underkant</th><th>Längd</th></tr></thead><tbody>`);
    for (const r of runs) {
      parts.push(`<tr><td>${esc(runName(room, r))}</td><td class="pr-mono">${r.kind === 'pipe' ? `Ø${r.size}` : `${r.size}×${r.h}`}</td><td class="pr-mono">${r.y}</td><td class="pr-mono">${runLength(r)}</td></tr>`);
    }
    parts.push(`</tbody></table>`);
  }
  const measures = s.room.measures ?? [];
  if (measures.length) {
    parts.push(`<h2>Mätningar</h2><table class="pr-table"><thead><tr><th></th><th>Längd</th><th>Uppdelning</th></tr></thead><tbody>`);
    measures.forEach((m, i) => {
      const mp = measurePartsFor(store, s.room, m);
      parts.push(`<tr><td>M${i + 1}</td><td class="pr-mono">${mp.total} mm</td><td>${mp.names[0]} ${mp.along} · ${mp.names[1]} ${mp.out} · höjd ${mp.height}</td></tr>`);
    });
    parts.push(`</tbody></table>`);
  }
  if (room) {
    const segs = segments(room);
    parts.push(
      `<h2>Rummet</h2><p class="pr-note">${segs.map((sg, i) => `Vägg ${i + 1}: ${Math.round(sg.length)}`).join(' · ')}. Invändig höjd ${room.height}, väggtjocklek ${room.thickness}.</p>`,
    );
  }
  parts.push(`</div></section>`);
  return parts.join('');
}

/** measureParts uses the active room's wall 1 – lend it this room for a moment. */
function measurePartsFor(store: Store, room: RoomData, m: Parameters<typeof measureParts>[1]) {
  const proxy = { project: { room: room.room } } as unknown as Store;
  return measureParts(store.job.active === room.id ? store : proxy, m);
}

function orderTable(o: Order, title: string): string {
  const out: string[] = [`<h2>${title}</h2>`];
  if (!o.lines.length && !o.other.length) return out.concat('<p class="pr-note">Inga delar.</p>').join('');
  out.push(`<table class="pr-table"><thead><tr><th>Detalj</th><th>Antal</th><th>Beställningskod</th><th>Ändar</th></tr></thead><tbody>`);
  for (const l of o.lines) {
    out.push(`<tr><td class="pr-mono">${l.detail}</td><td class="pr-mono">${l.count}</td><td class="pr-mono">${esc(l.base)}</td><td class="pr-mono">${esc(l.ends || '–')}</td></tr>`);
  }
  out.push(`</tbody></table>`);
  const cuts = o.lines.filter((l) => l.cuts.length);
  if (cuts.length) {
    out.push(`<p class="pr-note"><b>Kapas på plats:</b> `);
    out.push(
      cuts
        .map((l) => {
          const counts = new Map<number, number>();
          for (const c of l.cuts) counts.set(c, (counts.get(c) ?? 0) + 1);
          return [...counts].map(([len, n]) => `detalj ${l.detail}: ${n} st till ${len} mm`).join(', ');
        })
        .join(' · '),
    );
    out.push(`</p>`);
  }
  if (o.other.length) {
    out.push(`<p class="pr-note"><b>Övrigt (ej Crenna):</b> ${o.other.map((x) => `${x.count} st ${esc(x.code)} (${esc(x.name)})`).join(' · ')}</p>`);
  }
  return out.join('');
}

function projectPage(store: Store, order: Order, date: string): string {
  const names = store.job.rooms.map((r) => r.name);
  const out: string[] = [`<section class="pr-page">`, header(store, 'Hela projektet', date), orderTable(order, 'Beställningslista – alla rum')];
  out.push(`<h2>Fördelning per rum</h2><table class="pr-table"><thead><tr><th>Detalj</th><th>Kod</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>`);
  for (const l of order.lines) {
    out.push(`<tr><td class="pr-mono">${l.detail}</td><td class="pr-mono" title="${esc(lineText(l))}">${esc(l.code)}</td>${l.rooms.map((n) => `<td class="pr-mono">${n || ''}</td>`).join('')}</tr>`);
  }
  out.push(`</tbody></table></section>`);
  return out.join('');
}

// ---------- Plan drawing ----------

/** The room and assembly seen from above, as SVG (plan x → right, z → down, like the Top view). */
function planSvg(s: RoomSheet, order: Order): string | null {
  const room = s.room.room;
  const pts: [number, number][] = [];
  const add = (q: P | [number, number]) => pts.push(Array.isArray(q) ? q : [q.x, q.z]);
  let faces: ReturnType<typeof wallFaces> | null = null;
  if (room && room.points.length >= 2) {
    faces = wallFaces(room);
    faces.outer.forEach(add);
    faces.inner.forEach(add);
    for (const r of room.runs ?? []) {
      add(r.a);
      add(r.b);
    }
  }
  for (const o of s.outlines) for (const ol of o.outlines) ol.forEach(add);
  for (const m of s.room.measures ?? []) {
    add([m.a[0], m.a[2]]);
    add([m.b[0], m.b[2]]);
  }
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]);
  const zs = pts.map((q) => q[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 500);
  const pad = span * 0.08;
  const x0 = Math.min(...xs) - pad;
  const z0 = Math.min(...zs) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...zs) - Math.min(...zs) + 2 * pad;
  const fs = span / 45; // text size
  const sw = span / 900; // thin line width
  const poly = (q: (P | [number, number])[]) => q.map((v) => (Array.isArray(v) ? `${v[0]},${v[1]}` : `${v.x},${v.z}`)).join(' ');
  const text = (x: number, z: number, t: string, cls = '', size = fs) =>
    `<text x="${x}" y="${z}" font-size="${size}" class="${cls}" text-anchor="middle" dominant-baseline="middle">${esc(t)}</text>`;
  const out: string[] = [];

  if (room && faces) {
    const n = room.points.length;
    const segs = segments(room);
    const openings = room.openings ?? [];
    if (room.closed) out.push(`<polygon points="${poly(faces.inner)}" class="pl-floor" />`);
    segs.forEach((sg, i) => {
      const j = (i + 1) % n;
      out.push(`<polygon points="${poly([faces!.inner[i], faces!.inner[j], faces!.outer[j], faces!.outer[i]])}" class="pl-wall" stroke-width="${sw}" />`);
      // Wall length on the inside
      const inset = room.closed ? -fs * 1.6 : fs * 1.2;
      const mx = (sg.a.x + sg.b.x) / 2 + sg.out.x * inset;
      const mz = (sg.a.z + sg.b.z) / 2 + sg.out.z * inset;
      out.push(text(mx, mz, `V${i + 1}  ${Math.round(sg.length)}`, 'pl-wall-len'));
    });
    // Wall openings: a gap across the wall with the size next to it
    for (const o of openings) {
      if (o.on === 'roof') {
        const hole = roofHole(room, o);
        if (!hole) continue;
        out.push(
          o.shape === 'round'
            ? `<circle cx="${hole.centre.x}" cy="${hole.centre.z}" r="${hole.r}" class="pl-roofhole" stroke-width="${sw * 1.5}" stroke-dasharray="${fs * 0.5} ${fs * 0.3}" />`
            : `<polygon points="${poly(hole.pts)}" class="pl-roofhole" stroke-width="${sw * 1.5}" stroke-dasharray="${fs * 0.5} ${fs * 0.3}" />`,
        );
        out.push(text(hole.centre.x, hole.centre.z, `Tak ${o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`}`, 'pl-hole-txt', fs * 0.8));
        continue;
      }
      const f = wallFrame(room, o.wall);
      if (!f) continue;
      const a = framePoint(f, o.x, 0);
      const b = framePoint(f, o.x + o.w, 0);
      const t = room.thickness;
      const ao = { x: a.x + f.out.x * t, z: a.z + f.out.z * t };
      const bo = { x: b.x + f.out.x * t, z: b.z + f.out.z * t };
      out.push(`<polygon points="${poly([a, b, bo, ao])}" class="pl-hole" stroke-width="${sw * 1.5}" />`);
      const c = framePoint(f, o.x + o.w / 2, fs * 1.1); // just inside the room
      out.push(text(c.x, c.z, `${o.shape === 'round' ? `Ø${o.w}` : `${o.w}×${o.h}`} uk ${o.y}`, 'pl-hole-txt', fs * 0.8));
    }
    // Pipes and ladders
    for (const r of room.runs ?? []) {
      const color = r.kind === 'pipe' ? `#${PIPE_TYPES[r.pipeType ?? 'ovrigt'].color.toString(16).padStart(6, '0')}` : '#868e96';
      if (r.kind === 'pipe') {
        out.push(`<line x1="${r.a[0]}" y1="${r.a[1]}" x2="${r.b[0]}" y2="${r.b[1]}" stroke="${color}" stroke-width="${Math.max(r.size, sw * 3)}" stroke-opacity="0.7" />`);
      } else {
        const len = runLength(r) || 1;
        const dx = (r.b[0] - r.a[0]) / len;
        const dz = (r.b[1] - r.a[1]) / len;
        const ox = -dz * (r.size / 2);
        const oz = dx * (r.size / 2);
        out.push(
          `<polygon points="${poly([[r.a[0] + ox, r.a[1] + oz], [r.b[0] + ox, r.b[1] + oz], [r.b[0] - ox, r.b[1] - oz], [r.a[0] - ox, r.a[1] - oz]])}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="${sw * 1.5}" />`,
        );
      }
      const label = `${runName(room, r)} · uk ${r.y}`;
      out.push(text((r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2 - Math.max(r.size / 2, fs * 0.6) - fs * 0.6, label, 'pl-run-txt', fs * 0.75));
    }
  }

  // The assembly from above, with detail numbers
  for (const o of s.outlines) for (const ol of o.outlines) out.push(`<polygon points="${poly(ol)}" class="pl-part" stroke-width="${sw}" />`);
  for (const o of s.outlines) {
    const d = order.detailOf.get(o.partId);
    if (d === undefined) continue;
    out.push(`<circle cx="${o.centre[0]}" cy="${o.centre[1]}" r="${fs * 0.75}" class="pl-badge" />`, text(o.centre[0], o.centre[1], String(d), 'pl-badge-txt', fs * 0.85));
  }

  // Measurements
  (s.room.measures ?? []).forEach((m, i) => {
    const a = [m.a[0], m.a[2]];
    const b = [m.b[0], m.b[2]];
    const len = Math.round(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]));
    out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="pl-measure" stroke-width="${sw * 2}" />`);
    out.push(text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - fs * 0.7, `M${i + 1} ${len}`, 'pl-measure-txt', fs * 0.8));
  });

  // Scale bar: 1 m (or 500 mm / 2 m to suit the size)
  const bar = span > 8000 ? 2000 : span > 2500 ? 1000 : 500;
  const bx = x0 + pad * 0.5;
  const bz = z0 + h - pad * 0.4;
  out.push(`<line x1="${bx}" y1="${bz}" x2="${bx + bar}" y2="${bz}" class="pl-scale" stroke-width="${sw * 3}" />`);
  out.push(text(bx + bar / 2, bz - fs * 0.7, `${bar} mm`, 'pl-scale-txt', fs * 0.75));

  return `<svg class="pl" viewBox="${x0} ${z0} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${out.join('')}</svg>`;
}

