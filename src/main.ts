import './style.css';
import { AssemblyController } from './assembly/controller';
import { RoomController } from './room/controller';
import { describe, parseCode, summary } from './codes';
import type { Product } from './codes/types';
import { buildModel } from './geometry';
import { createMaterials } from './geometry/materials';
import { Store } from './store';
import { AccessoryBuilder } from './accessoryBuilder';
import { UnitBuilder } from './unitBuilder';
import { Viewer, type ViewName } from './viewer';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const panel = $<HTMLElement>('#panel');
const viewport = $<HTMLDivElement>('#viewport');
const form = $<HTMLFormElement>('#code-form');
const input = $<HTMLInputElement>('#code-input');
const errorEl = $<HTMLParagraphElement>('#code-error');
const specList = $<HTMLDListElement>('#spec-list');
const warningsEl = $<HTMLUListElement>('#warnings');
const saveBtn = $<HTMLButtonElement>('#save-part');
const partsList = $<HTMLUListElement>('#parts-list');
const partsEmpty = $<HTMLParagraphElement>('#parts-empty');
const partsMessage = $<HTMLParagraphElement>('#parts-message');
const dimsBtn = $<HTMLButtonElement>('#toggle-dims');
const insBtn = $<HTMLButtonElement>('#toggle-ins');
const sectionBtn = $<HTMLButtonElement>('#toggle-section');
const labelsBtn = $<HTMLButtonElement>('#toggle-labels');
const roomBtn = $<HTMLButtonElement>('#toggle-room');
const rotationReset = $<HTMLButtonElement>('#rotation-reset');
const rotateBtns = document.querySelectorAll<HTMLButtonElement>('#rotate [data-rotate]');
const stageHint = $<HTMLParagraphElement>('#stage-hint');

const materials = createMaterials();
const viewer = new Viewer(viewport, materials);
const store = new Store();

type Mode = 'part' | 'assembly' | 'room';
let mode: Mode = 'part';
let current: Product | null = null;
let currentView: ViewName = 'iso';

/** Toggle state per mode – dimensions are off by default in the assembly (too busy). */
const toggles = {
  part: { dims: true, insulation: true, section: false, labels: true, room: true },
  assembly: { dims: false, insulation: true, section: false, labels: true, room: true },
  room: { dims: false, insulation: true, section: false, labels: true, room: true },
};
type ToggleKey = keyof typeof toggles.part;

const asm = new AssemblyController(store, viewer, materials, {
  hint: $('#asm-hint'),
  warnings: $('#asm-warnings'),
  selected: $('#asm-selected'),
  count: $('#asm-count'),
  undo: $('#asm-undo'),
  orient: $('#asm-orient'),
  order: $('#asm-order'),
  onView: (code) => {
    input.value = code;
    setMode('part');
  },
  onRender: () => {
    applyToggles();
    showRotation();
    if (mode === 'room') room.render();
  },
});

// Room tab: walls, floor and roof around the assembly
const room = new RoomController(store, viewer, asm, {
  panel: $('#room-panel'),
  redraw: (fit) => asm.render(fit),
});

// ---------- Part mode ----------

// Ventilation unit builder: writes an AGG code into the code field and shows it
const unitBuilder = new UnitBuilder($<HTMLDetailsElement>('#unit-builder'), (code) => {
  input.value = code;
  show(code);
});
// Silencer & damper builder: same idea, writes an LD or SP code
const accessoryBuilder = new AccessoryBuilder($<HTMLDetailsElement>('#acc-builder'), (code) => {
  input.value = code;
  show(code);
});

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
  const newCode = product.code !== current?.code;
  current = product;

  viewer.setModel(buildModel(product, materials), { resetRotation: newCode });
  showRotation();
  applyToggles();
  viewer.setView(currentView, !firstModel);

  insBtn.disabled = product.insulation.side === 'none';

  renderSpec(product);
  unitBuilder.sync(product);
  accessoryBuilder.sync(product);
  renderParts();
  updateSaveButton();
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

function updateSaveButton() {
  const saved = !!current && store.project.parts.some((p) => p.code === current!.code);
  saveBtn.disabled = !current || saved;
  saveBtn.textContent = saved ? '✓ Finns i Mina delar' : '+ Spara i Mina delar';
}

// ---------- My parts ----------

function renderParts() {
  const parts = store.project.parts;
  partsEmpty.hidden = parts.length > 0;
  partsList.replaceChildren(
    ...parts.map((part) => {
      const li = document.createElement('li');
      li.className = 'part-item';
      li.dataset.id = part.id;
      if (mode === 'part' && part.code === current?.code) li.classList.add('is-current');

      const parsed = parseCode(part.code);
      const tok = document.createElement('span');
      tok.className = 'tok';
      tok.textContent = parsed.ok ? parsed.product.kind : '?';

      const text = document.createElement('div');
      text.className = 'part-item__text';
      const name = document.createElement('span');
      name.className = 'part-item__name';
      name.textContent = part.name;
      const code = document.createElement('span');
      code.className = 'part-item__code';
      code.textContent = part.code;
      text.append(name, code);

      const actions = document.createElement('div');
      actions.className = 'part-item__actions';
      const btn = (act: string, label: string, title: string, cls: string) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = act;
        b.className = cls;
        b.textContent = label;
        b.title = title;
        actions.append(b);
      };
      btn('add', 'Lägg till', 'Lägg till i sammanställningen', 'add');
      btn('rename', '✎', 'Byt namn', 'icon');
      btn('delete', '×', 'Ta bort från Mina delar', 'icon');

      li.append(tok, text, actions);
      return li;
    }),
  );
}

/** Turn a part's name into a text field; Enter or leaving the field saves, Esc cancels. */
function startRename(li: HTMLElement, id: string) {
  const part = store.project.parts.find((p) => p.id === id);
  const nameEl = li.querySelector<HTMLElement>('.part-item__name');
  if (!part || !nameEl) return;
  const field = document.createElement('input');
  field.value = part.name;
  nameEl.replaceChildren(field);
  field.focus();
  field.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const value = field.value.trim();
    if (save && value && value !== part.name) store.renamePart(id, value);
    else renderParts();
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  field.addEventListener('blur', () => finish(true));
  field.addEventListener('click', (e) => e.stopPropagation());
}

partsList.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const li = target.closest<HTMLElement>('.part-item');
  if (!li) return;
  const part = store.project.parts.find((p) => p.id === li.dataset.id);
  if (!part) return;
  partsMessage.textContent = '';

  const act = target.closest<HTMLButtonElement>('button')?.dataset.act;
  if (act === 'add') {
    const err = asm.add(part.code);
    if (err) partsMessage.textContent = err;
  } else if (act === 'rename') {
    startRename(li, part.id);
  } else if (act === 'delete') {
    store.removePart(part.id);
  } else if (mode === 'part' && !target.closest('input')) {
    input.value = part.code;
    show(part.code);
  }
});

saveBtn.addEventListener('click', () => {
  if (!current) return;
  store.savePart(current.code, summary(current));
});

store.onChange(() => {
  renderParts();
  updateSaveButton();
});

// Export / import the whole project (My parts + assembly)
$<HTMLButtonElement>('#export-project').addEventListener('click', () => {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kanalprojekt.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const importFile = $<HTMLInputElement>('#import-file');
$<HTMLButtonElement>('#import-project').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (!file) return;
  const err = store.importJson(await file.text());
  partsMessage.textContent = err ?? '';
  if (!err && mode === 'assembly') asm.render(true);
});

// ---------- Assembly mode ----------

$<HTMLButtonElement>('#asm-undo').addEventListener('click', undo);

// Order list: copy to clipboard or download as a text file
$<HTMLElement>('#asm-order').addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-order]')?.dataset.order;
  if (!act) return;
  const text = asm.orderText();
  const status = $<HTMLElement>('#asm-order .order-copied');
  if (act === 'copy') {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Kopierat – klistra in i beställningsformuläret.';
    } catch {
      status.textContent = 'Kunde inte kopiera här – använd Ladda ner .txt i stället.';
    }
    setTimeout(() => (status.textContent = ''), 3000);
  } else {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bestallning-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
});
$<HTMLElement>('#asm-orient').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
  if (act) asm.act(act);
});
$<HTMLButtonElement>('#asm-fit').addEventListener('click', () => viewer.fit());
$<HTMLButtonElement>('#asm-clear').addEventListener('click', () => asm.clear());
$<HTMLElement>('#asm-selected').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
  if (act) asm.act(act);
});

function undo() {
  if (!store.canUndo) return;
  store.undo();
  if (mode !== 'part') asm.render();
}

// ---------- Modes ----------

function setMode(next: Mode) {
  if (mode === 'room' && next !== 'room') room.stop();
  mode = next;
  asm.roomMode = next === 'room';
  viewer.onPointerMove = next === 'room' ? (r) => room.onMove(r) : null;
  viewer.onClickRay = next === 'room' ? (r) => room.onClick(r) : null;
  viewer.onDoubleClick = next === 'room' ? () => room.onDoubleClick() : null;
  panel.dataset.mode = next;
  viewport.classList.toggle('assembly', next !== 'part');
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    const on = b.dataset.mode === next;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  partsMessage.textContent = '';
  syncToggleButtons();

  if (next === 'assembly') {
    viewer.onPick = (hit) => asm.pick(hit);
    stageHint.textContent = 'Klicka på en del för att markera den · Klicka på en orange ände för att välja var nästa del hamnar';
    rotateBtns.forEach((b) => (b.title = b.dataset.rotate === 'left' ? 'Vrid den valda delen 90° runt skarven' : 'Vrid den valda delen 90° åt andra hållet'));
    asm.render(true);
  } else if (next === 'room') {
    viewer.onPick = null;
    stageHint.textContent = 'Rita väggar genom att klicka ut hörn på golvet · Dra för att rotera · Scrolla för att zooma';
    asm.render(true);
    room.render();
  } else {
    viewer.onPick = null;
    stageHint.textContent = 'Dra för att rotera · Högerdra för att panorera · Scrolla för att zooma';
    rotateBtns.forEach((b) => (b.title = b.dataset.rotate === 'left' ? 'Rulla kanalen 90° moturs' : 'Rulla kanalen 90° medurs'));
    current = null; // redraw from scratch
    show(input.value, { updateHash: true });
  }
  renderParts();
}

document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) setMode(b.dataset.mode as Mode);
  }),
);

// ---------- Toolbar ----------

function applyToggles() {
  const t = toggles[mode];
  viewer.setDimensionsVisible(t.dims && t.labels); // dimension lines without their numbers look odd
  viewer.setInsulationVisible(t.insulation);
  viewer.setLabelsVisible(t.labels);
  // The Room button only exists in the assembly – in the Room tab the walls are always shown
  viewer.setRoomVisible(mode !== 'assembly' || t.room);
  roomBtn.hidden = mode !== 'assembly' || !store.project.room;
}

function syncToggleButtons() {
  const t = toggles[mode];
  for (const [btn, key] of [[dimsBtn, 'dims'], [insBtn, 'insulation'], [sectionBtn, 'section'], [labelsBtn, 'labels'], [roomBtn, 'room']] as const) {
    btn.classList.toggle('is-active', t[key]);
    btn.setAttribute('aria-pressed', String(t[key]));
  }
  if (mode === 'assembly') insBtn.disabled = false;
  viewer.setSection(t.section);
}

function bindToggle(btn: HTMLButtonElement, key: ToggleKey, apply: (on: boolean) => void) {
  btn.addEventListener('click', () => {
    const t = toggles[mode];
    t[key] = !t[key];
    btn.classList.toggle('is-active', t[key]);
    btn.setAttribute('aria-pressed', String(t[key]));
    apply(t[key]);
  });
}
bindToggle(dimsBtn, 'dims', () => applyToggles());
bindToggle(insBtn, 'insulation', (on) => viewer.setInsulationVisible(on));
bindToggle(sectionBtn, 'section', (on) => viewer.setSection(on));
bindToggle(labelsBtn, 'labels', () => applyToggles());
bindToggle(roomBtn, 'room', () => applyToggles());

document.querySelectorAll<HTMLButtonElement>('#views button').forEach((btn) =>
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view as ViewName;
    document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('is-active', b === btn));
    viewer.setView(currentView);
  }),
);

// Rotate: rolls the duct in Part mode, turns the selected part around its joint in Assembly mode
function showRotation() {
  const deg = mode === 'part' ? viewer.rotationDegrees : mode === 'assembly' ? asm.selectedRollDegrees : null;
  rotationReset.textContent = deg === null ? '–' : `${deg}°`;
  rotationReset.disabled = mode === 'part' ? !deg : mode === 'room' || !asm.selectedIsTurned;
  rotateBtns.forEach((b) => (b.disabled = deg === null));
}
rotateBtns.forEach((btn) =>
  btn.addEventListener('click', () => {
    const left = btn.dataset.rotate === 'left';
    if (mode === 'part') viewer.rotate(left ? 'left' : 'right');
    else asm.roll(left ? 1 : -1);
    showRotation();
  }),
);
rotationReset.addEventListener('click', () => {
  if (mode === 'part') viewer.resetRotation();
  else asm.resetRoll();
  showRotation();
});

$<HTMLButtonElement>('#snapshot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = viewer.snapshot();
  a.download = mode !== 'part' ? `${mode === 'room' ? 'rum' : 'sammanstallning'}.png` : `${current?.code.replace(/[^\w-]+/g, '_') ?? 'kanal'}.png`;
  a.click();
});

// ---------- Keyboard ----------

document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea');
  if (typing) return;
  // Drawing walls: numbers, Enter, Backspace and Esc go to the drawing tool
  if (mode === 'room' && room.onKey(e)) {
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (mode === 'assembly' && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    asm.remove();
  }
});

// ---------- Part mode events ----------

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

window.addEventListener('hashchange', () => {
  const code = decodeURIComponent(location.hash.slice(1));
  if (mode === 'part' && code && code !== current?.code) {
    input.value = code;
    show(code, { updateHash: false });
  }
});

// ---------- Start ----------

const initial = decodeURIComponent(location.hash.slice(1)) || 'KK-1-1500-1000-0';
input.value = initial;
$('#asm-count').textContent = store.project.assembly.length ? String(store.project.assembly.length) : '';
setMode('part');
