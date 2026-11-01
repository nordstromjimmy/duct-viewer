// The "Ventilation unit" builder in the Part tab. A form for size and connections that writes
// an AGG code into the code field – the code stays the single source of truth.

import { DEFAULT_UNIT_CODE, FACES, parseAGG, PRESETS, ROLE_ORDER, ROLES, unitCode } from './codes/agg';
import type { Product, UnitConnection, UnitFace, UnitRole, VentUnit } from './codes/types';

type Config = Pick<VentUnit, 'length' | 'depth' | 'height' | 'connections'>;

/** Labels for the two size fields, per face. */
const SIZE_HINT: Record<UnitFace, [string, string]> = {
  T: ['längs längden', 'längs djupet'],
  F: ['bredd', 'höjd'],
  B: ['bredd', 'höjd'],
  V: ['bredd', 'höjd'],
  H: ['bredd', 'höjd'],
};

export class UnitBuilder {
  private root: HTMLDetailsElement;
  private body: HTMLElement;
  private onChange: (code: string) => void;
  /** Last config, kept so switching a connection off and on again remembers its settings. */
  private config: Config;
  private memory = new Map<UnitRole, UnitConnection>();
  private ignoreToggle = false;

  constructor(root: HTMLDetailsElement, onChange: (code: string) => void) {
    this.root = root;
    this.onChange = onChange;
    const def = parseAGG(DEFAULT_UNIT_CODE);
    this.config = def.ok ? def.product : { length: 2400, depth: 1200, height: 1300, connections: [] };
    for (const c of this.config.connections) this.memory.set(c.role, c);

    root.innerHTML = `
      <summary>Ventilationsaggregat <span class="ub-tag">byggare</span></summary>
      <div class="ub"></div>`;
    this.body = root.querySelector('.ub')!;
    this.render();

    root.addEventListener('toggle', () => {
      if (this.ignoreToggle) {
        this.ignoreToggle = false;
        return;
      }
      if (root.open) this.emit(); // opening the builder shows the unit
    });
    this.body.addEventListener('input', (e) => this.onInput(e));
    this.body.addEventListener('change', (e) => this.onInput(e));
    this.body.addEventListener('click', (e) => {
      const preset = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-preset]')?.dataset.preset;
      if (!preset) return;
      this.config = PRESETS[preset].make(this.config);
      for (const c of this.config.connections) this.memory.set(c.role, c);
      this.render();
      this.emit();
    });
  }

  /** Called whenever the Part tab shows a product: fill in for units, close for anything else. */
  sync(product: Product) {
    if (product.kind === 'AGG') {
      const p = product;
      this.config = { length: p.length, depth: p.depth, height: p.height, connections: p.connections.map((c) => ({ ...c })) };
      for (const c of this.config.connections) this.memory.set(c.role, c);
      if (!this.root.contains(document.activeElement)) this.render(); // don't disturb typing
      if (!this.root.open) {
        this.ignoreToggle = true;
        this.root.open = true;
      }
    } else if (this.root.open) {
      this.ignoreToggle = true;
      this.root.open = false;
    }
  }

  private emit() {
    this.onChange(unitCode(this.config));
  }

  private render() {
    const c = this.config;
    const num = (name: string, value: number, label: string, step = 50) =>
      `<label>${label}<input type="number" name="${name}" value="${value}" min="0" step="${step}" /></label>`;
    const rows = ROLE_ORDER.map((role) => {
      const r = ROLES[role];
      const conn = c.connections.find((x) => x.role === role) ?? this.memory.get(role);
      const on = c.connections.some((x) => x.role === role);
      const face = conn?.face ?? 'T';
      const slot = conn?.slot ?? 1;
      const [hw, hh] = SIZE_HINT[face];
      const faceOpts = (Object.keys(FACES) as UnitFace[])
        .map((f) => `<option value="${f}"${f === face ? ' selected' : ''}>${FACES[f].label}</option>`)
        .join('');
      const slotOpts = FACES[face].slots.map((s, i) => `<option value="${i + 1}"${i + 1 === slot ? ' selected' : ''}>${s}</option>`).join('');
      return `
        <div class="ub-conn${on ? '' : ' is-off'}" data-role="${role}" style="--role:${r.color}">
          <label class="ub-on"><input type="checkbox" name="on"${on ? ' checked' : ''} />
            <span class="ub-dot"></span><span class="ub-name">${r.label}<small>${role}</small></span></label>
          <div class="ub-fields">
            <div class="ub-row ub-place">
              <select name="face" aria-label="${r.label} sida">${faceOpts}</select>
              <select name="slot" aria-label="${r.label} position">${slotOpts}</select>
            </div>
            <div class="ub-row ub-size">
              <label>${hw}<input type="number" name="w" value="${conn?.w ?? 500}" min="50" step="50" /></label>
              <label>${hh}<input type="number" name="h" value="${conn?.h ?? 800}" min="50" step="50" /></label>
            </div>
          </div>
        </div>`;
    }).join('');

    this.body.innerHTML = `
      <div class="ub-presets">${Object.entries(PRESETS)
        .map(([k, v]) => `<button type="button" data-preset="${k}">${v.label}</button>`)
        .join('')}</div>
      <div class="ub-dims">
        ${num('length', c.length, 'Längd')}${num('depth', c.depth, 'Djup')}${num('height', c.height, 'Höjd')}
      </div>
      <div class="ub-conns">${rows}</div>
      <p class="ub-note">Positionerna 1–4 räknas från vänster till höger sett framifrån. Mått i mm: på ovansidan går bredden längs aggregatets längd.</p>`;
  }

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (!el.name) return;
    const c = this.config;

    if (el.name === 'length' || el.name === 'depth' || el.name === 'height') {
      const v = Number(el.value);
      if (!(v > 0)) return; // wait until there's a number
      c[el.name] = v;
      this.emit();
      return;
    }

    const row = el.closest<HTMLElement>('.ub-conn');
    if (!row) return;
    const role = row.dataset.role as UnitRole;
    const get = (name: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!.value;
    const on = row.querySelector<HTMLInputElement>('[name="on"]')!.checked;
    const w = Number(get('w'));
    const conn: UnitConnection = {
      role,
      face: get('face') as UnitFace,
      slot: Number(get('slot')),
      w,
      h: Number(get('h')),
    };
    // A face change can make the old position invalid (ends only have 2)
    if (conn.slot > FACES[conn.face].slots.length) conn.slot = 1;
    if (!(conn.w > 0) || !(conn.h > 0)) return;

    this.memory.set(role, conn);
    c.connections = c.connections.filter((x) => x.role !== role);
    if (on) c.connections.push(conn);

    // Options that depend on other fields (positions, size labels) need a redraw
    if (el.name === 'face' || el.name === 'on') this.render();
    this.emit();
  }
}
