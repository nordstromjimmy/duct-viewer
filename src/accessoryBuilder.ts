// "Silencer & damper" builder in the Part tab: a small form that writes an LD or SP code into
// the code field, like the ventilation unit builder.

import { DAMPER_TYPES, damperCode, silencerCode } from './codes/accessories';
import type { DamperType, Product } from './codes/types';

interface State {
  kind: 'LD' | 'SP';
  width: number;
  height: number;
  length: number;
  baffles: number; // 0 = automatic
  type: DamperType;
}

export class AccessoryBuilder {
  private root: HTMLDetailsElement;
  private body: HTMLElement;
  private onChange: (code: string) => void;
  private state: State = { kind: 'LD', width: 800, height: 500, length: 1200, baffles: 0, type: 1 };
  private ignoreToggle = false;

  constructor(root: HTMLDetailsElement, onChange: (code: string) => void) {
    this.root = root;
    this.onChange = onChange;
    root.innerHTML = `<summary>Ljuddämpare &amp; spjäll <span class="ub-tag">byggare</span></summary><div class="ub"></div>`;
    this.body = root.querySelector('.ub')!;
    this.render();

    root.addEventListener('toggle', () => {
      if (this.ignoreToggle) {
        this.ignoreToggle = false;
        return;
      }
      if (root.open) this.emit();
    });
    this.body.addEventListener('input', (e) => this.onInput(e, false));
    this.body.addEventListener('change', (e) => this.onInput(e, true));
  }

  /** Fill in for silencers/dampers shown in the Part tab, close for anything else. */
  sync(p: Product) {
    if (p.kind === 'LD' || p.kind === 'SP') {
      const s = this.state;
      s.kind = p.kind;
      s.width = p.width;
      s.height = p.height;
      s.length = p.length;
      if (p.kind === 'LD') s.baffles = p.autoBaffles ? 0 : p.baffles;
      else s.type = p.type;
      if (!this.root.contains(document.activeElement)) this.render();
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
    const s = this.state;
    this.onChange(s.kind === 'LD' ? silencerCode(s.width, s.height, s.length, s.baffles) : damperCode(s.type, s.width, s.height, s.length));
  }

  private render() {
    const s = this.state;
    const opt = (v: string | number, label: string, cur: string | number) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const num = (name: string, label: string, value: number, min = 50, step = 50) =>
      `<label>${label}<input type="number" name="${name}" value="${value}" min="${min}" step="${step}" /></label>`;
    const size = `${num('width', 'Bredd', s.width)}${num('height', 'Höjd', s.height)}${num('length', 'Längd', s.length)}`;
    const extra =
      s.kind === 'LD'
        ? `<label>Kulisser<input type="number" name="baffles" value="${s.baffles}" min="0" step="1" /></label>
           <p class="ub-note">0 = automatiskt (ungefär en per 300 mm bredd).</p>`
        : `<label>Spjälltyp<select name="type">${(Object.keys(DAMPER_TYPES) as unknown as DamperType[])
            .map((t) => opt(Number(t), DAMPER_TYPES[t].label, s.type))
            .join('')}</select></label>`;

    this.body.innerHTML = `
      <select name="kind" aria-label="Del">${opt('LD', 'Ljuddämpare', s.kind)}${opt('SP', 'Spjäll', s.kind)}</select>
      <div class="ub-dims">${size}</div>
      <div class="ab-extra">${extra}</div>`;
  }

  private onInput(e: Event, committed: boolean) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const s = this.state;
    switch (el.name) {
      case 'kind': {
        if (!committed) return;
        s.kind = el.value as State['kind'];
        // Sensible default length when switching
        s.length = s.kind === 'SP' ? DAMPER_TYPES[s.type].defaultLength : 1200;
        this.render();
        break;
      }
      case 'type':
        if (!committed) return;
        s.type = Number(el.value) as DamperType;
        s.length = DAMPER_TYPES[s.type].defaultLength;
        this.render();
        break;
      case 'width': case 'height': case 'length': case 'baffles': {
        const v = Number(el.value);
        if (!(v >= 0) || (el.name !== 'baffles' && v === 0)) return;
        s[el.name] = Math.round(v);
        break;
      }
      default:
        return;
    }
    this.emit();
  }
}
