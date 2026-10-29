import './style.css';
import { describe, parseCode } from './codes';
import type { Product } from './codes/types';
import { buildModel } from './geometry';
import { createMaterials } from './geometry/materials';
import { Viewer, type ViewName } from './viewer';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const form = $<HTMLFormElement>('#code-form');
const input = $<HTMLInputElement>('#code-input');
const errorEl = $<HTMLParagraphElement>('#code-error');
const specList = $<HTMLDListElement>('#spec-list');
const warningsEl = $<HTMLUListElement>('#warnings');
const dimsBtn = $<HTMLButtonElement>('#toggle-dims');
const insBtn = $<HTMLButtonElement>('#toggle-ins');
const sectionBtn = $<HTMLButtonElement>('#toggle-section');

const materials = createMaterials();
const viewer = new Viewer($('#viewport'), materials);

let current: Product | null = null;
let currentView: ViewName = 'iso';
const state = { dims: true, insulation: true, section: false };

// ---------- Show a code ----------

function show(code: string, opts: { updateHash?: boolean } = {}) {
  const result = parseCode(code);
  if (!result.ok) {
    errorEl.textContent = result.error;
    input.classList.add('is-invalid');
    return;
  }
  errorEl.textContent = '';
  input.classList.remove('is-invalid');

  const product = result.product;
  const firstModel = current === null;
  current = product;

  viewer.setModel(buildModel(product, materials));
  viewer.setDimensionsVisible(state.dims);
  viewer.setInsulationVisible(state.insulation);
  viewer.setView(currentView, !firstModel);

  insBtn.disabled = product.insulation.side === 'none';

  renderSpec(product);
  if (opts.updateHash !== false) history.replaceState(null, '', `#${encodeURIComponent(product.code)}`);
}

function renderSpec(p: Product) {
  specList.replaceChildren(
    ...describe(p).flatMap(({ label, value, token }) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (token) {
        const t = document.createElement('span');
        t.className = 'tok';
        t.textContent = token;
        dd.append(t);
      }
      dd.append(value);
      return [dt, dd];
    }),
  );

  warningsEl.replaceChildren(
    ...p.warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }),
  );
}

// ---------- Events ----------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  show(input.value);
});

// Live update while typing (only redraws when the code is valid)
let typingTimer = 0;
input.addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => {
    if (parseCode(input.value).ok) show(input.value);
    else {
      input.classList.remove('is-invalid');
      errorEl.textContent = '';
    }
  }, 350);
});

document.querySelectorAll<HTMLButtonElement>('.examples button').forEach((btn) =>
  btn.addEventListener('click', () => {
    input.value = btn.dataset.code!;
    show(input.value);
  }),
);

document.querySelectorAll<HTMLButtonElement>('#views button').forEach((btn) =>
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view as ViewName;
    document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('is-active', b === btn));
    viewer.setView(currentView);
  }),
);

function bindToggle(btn: HTMLButtonElement, key: keyof typeof state, apply: (on: boolean) => void) {
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('is-active', state[key]);
    btn.setAttribute('aria-pressed', String(state[key]));
    apply(state[key]);
  });
}
bindToggle(dimsBtn, 'dims', (on) => viewer.setDimensionsVisible(on));
bindToggle(insBtn, 'insulation', (on) => viewer.setInsulationVisible(on));
bindToggle(sectionBtn, 'section', (on) => viewer.setSection(on));

$<HTMLButtonElement>('#snapshot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = viewer.snapshot();
  a.download = `${current?.code.replace(/[^\w-]+/g, '_') ?? 'duct'}.png`;
  a.click();
});

window.addEventListener('hashchange', () => {
  const code = decodeURIComponent(location.hash.slice(1));
  if (code && code !== current?.code) {
    input.value = code;
    show(code, { updateHash: false });
  }
});

// ---------- Start ----------

const initial = decodeURIComponent(location.hash.slice(1)) || 'KK-1-1500-1000-0';
input.value = initial;
show(initial);