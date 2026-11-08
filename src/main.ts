import './style.css';
import { AssemblyController } from './assembly/controller';
import { RoomController } from './room/controller';
import { MeasureController } from './measure';
import { buildPrint, type RoomSheet } from './print';
import { downloadSkissPng, skissHosts, skissSvg } from './skiss';
import { partOutlines } from './room/collide';
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
    measure.render();
  },
  selectedExtras: (asm) => skissSection(asm.mount && asm.parent ? asm.parent : asm.id),
});

// Room tab: walls, floor and roof around the assembly
const room = new RoomController(store, viewer, asm, {
  panel: $('#room-panel'),
  redraw: (fit) => asm.render(fit),
});

// Skiss: for a straight duct with a shaped end or a stosram on its side (or a stosram on one)
function skissSection(hostId: string): HTMLElement[] | null {
  const lay = asm.layout;
  const host = lay && skissHosts(lay).find((p) => p.asm.id === hostId);
  if (!lay || !host) return null;
  const info = () => ({ project: store.job.name, room: store.activeRoom.name, detailOf: asm.projectOrder?.detailOf ?? new Map<string, number>() });
  const wrap = document.createElement('div');
  wrap.className = 'sel-skiss';
  const note = document.createElement('textarea');
  note.placeholder = 'Anteckning på skissen (valfritt), t.ex. ”Inspektionslucka på ovansidan”';
  note.value = host.asm.note ?? '';
  note.addEventListener('keydown', (e) => e.stopPropagation());
  note.addEventListener('change', () => {
    const text = note.value.trim();
    store.update((p) => {
      const a = p.assembly.find((x) => x.id === host.asm.id);
      if (!a) return;
      if (text) a.note = text;
      else delete a.note;
    });
    asm.render();
  });
  const preview = document.createElement('img');
  preview.className = 'sel-skiss__preview';
  preview.alt = 'Skiss';
  preview.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(skissSvg(host, lay, info()))}`;
  preview.title = 'Klicka för att spara skissen som PNG';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary';
  save.textContent = 'Spara skiss (PNG)';
  const run = () => {
    const d = asm.projectOrder?.detailOf.get(host.asm.id);
    void downloadSkissPng(skissSvg(host, lay, info()), `skiss${d !== undefined ? `-detalj-${d}` : ''}-${slug(host.asm.code)}.png`);
  };
  save.addEventListener('click', run);
  preview.addEventListener('click', run);
  const label = document.createElement('h3');
  label.textContent = 'Skiss';
  wrap.append(label, preview, note, save);
  return [wrap];
}

// Measuring tool (Assembly and Room tabs)
const measureBtn = $<HTMLButtonElement>('#measure');
const measure = new MeasureController(store, viewer, asm, {
  panel: $('#measure-panel'),
  button: measureBtn,
  redraw: () => asm.render(),
  onToggle: (on) => {
    if (on && mode === 'room') room.stop();
    wireViewer();
  },
});

// Starting something in the Room tab (drawing, a hole, a pipe…) ends measuring
$<HTMLElement>('#room-panel').addEventListener(
  'click',
  (e) => {
    if (measure.active && (e.target as HTMLElement).closest('[data-room]')) measure.toggle(false);
  },
  { capture: true },
);

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
      btn('rename', '✎', 'Ändra namn och kod', 'icon');
      btn('delete', '×', 'Ta bort från Mina delar', 'icon');

      li.append(tok, text, actions);
      return li;
    }),
  );
}

/**
 * Edit a saved part's name and code in place. Enter or clicking elsewhere saves, Esc cancels.
 * Changing the code only affects new copies – parts already placed keep their code.
 */
function startRename(li: HTMLElement, id: string) {
  const part = store.project.parts.find((p) => p.id === id);
  const nameEl = li.querySelector<HTMLElement>('.part-item__name');
  const codeEl = li.querySelector<HTMLElement>('.part-item__code');
  if (!part || !nameEl || !codeEl) return;
  const nameField = document.createElement('input');
  nameField.value = part.name;
  nameField.setAttribute('aria-label', 'Namn');
  const codeField = document.createElement('input');
  codeField.value = part.code;
  codeField.className = 'part-item__codefield';
  codeField.spellcheck = false;
  codeField.setAttribute('aria-label', 'Kod');
  nameEl.replaceChildren(nameField);
  codeEl.replaceChildren(codeField);
  li.classList.add('is-editing');
  nameField.focus();
  nameField.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    if (!save) {
      done = true;
      partsMessage.textContent = '';
      renderParts();
      return;
    }
    const name = nameField.value.trim() || part.name;
    const parsed = parseCode(codeField.value);
    if (!parsed.ok) {
      partsMessage.textContent = parsed.error;
      codeField.focus();
      return;
    }
    done = true;
    partsMessage.textContent = '';
    const code = parsed.product.code;
    if (code !== part.code && store.project.parts.some((p) => p.id !== id && p.code === code)) {
      partsMessage.textContent = 'Den koden finns redan i Mina delar.';
      renderParts();
      return;
    }
    if (code !== part.code) {
      // A name that was just the old description follows the new code
      const oldParsed = parseCode(part.code);
      const autoName = oldParsed.ok && name === summary(oldParsed.product);
      store.setPartCode(id, code, autoName ? summary(parsed.product) : name);
    } else if (name !== part.name) store.renamePart(id, name);
    else renderParts();
  };
  for (const field of [nameField, codeField]) {
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    field.addEventListener('click', (e) => e.stopPropagation());
  }
  // Save when focus leaves the part (not when moving between its two fields)
  li.addEventListener('focusout', (e) => {
    if (!li.contains(e.relatedTarget as Node)) setTimeout(() => finish(true), 0);
  });
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
  renderProjectBar();
});

// ---------- Projects and rooms ----------

const jobSelect = $<HTMLSelectElement>('#job-select');
const roomSelect = $<HTMLSelectElement>('#room-select');
const projectMessage = $<HTMLParagraphElement>('#project-message');

/** File-name friendly version of a name. */
const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'projekt';

function renderProjectBar() {
  const jobs = store.listJobs();
  if (!jobs.some((j) => j.id === store.job.id)) jobs.unshift({ id: store.job.id, name: store.job.name, updated: Date.now() });
  jobSelect.replaceChildren(
    ...jobs.map((j) => {
      const o = document.createElement('option');
      o.value = j.id;
      o.textContent = j.id === store.job.id ? store.job.name : j.name;
      o.selected = j.id === store.job.id;
      return o;
    }),
  );
  roomSelect.replaceChildren(
    ...store.job.rooms.map((r) => {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name;
      o.selected = r.id === store.job.active;
      return o;
    }),
  );
  $<HTMLButtonElement>('[data-job="room-delete"]').disabled = store.job.rooms.length < 2;
}

/** After switching project or room: start the views over. */
function afterSwitch() {
  room.stop();
  if (measure.active) measure.toggle(false);
  projectMessage.textContent = '';
  if (mode === 'part') {
    renderParts();
    $('#asm-count').textContent = store.project.assembly.length ? String(store.project.assembly.length) : '';
  } else {
    asm.render(true);
    if (mode === 'room') room.render();
  }
}

jobSelect.addEventListener('change', () => {
  store.switchJob(jobSelect.value);
  afterSwitch();
});
roomSelect.addEventListener('change', () => {
  store.switchRoom(roomSelect.value);
  afterSwitch();
});

$<HTMLElement>('#project-bar').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-job]')?.dataset.job;
  if (!act) return;
  const ask = (q: string, value: string) => window.prompt(q, value)?.trim() || null;
  switch (act) {
    case 'new': {
      const name = ask('Namn på det nya projektet:', 'Nytt projekt');
      if (name) store.createJob(name);
      break;
    }
    case 'rename': {
      const name = ask('Nytt namn på projektet:', store.job.name);
      if (name) store.renameJob(name);
      return;
    }
    case 'delete':
      if (!window.confirm(`Ta bort projektet ”${store.job.name}” med alla rum? Det går inte att ångra. Exportera först om du vill spara en kopia.`)) return;
      store.deleteJob();
      break;
    case 'room-new': {
      const name = ask('Namn på det nya rummet:', `Rum ${store.job.rooms.length + 1}`);
      if (name) store.addRoom(name);
      break;
    }
    case 'room-rename': {
      const name = ask('Nytt namn på rummet:', store.activeRoom.name);
      if (name) store.renameRoom(name);
      return;
    }
    case 'room-delete':
      if (store.job.rooms.length < 2) return;
      if (!window.confirm(`Ta bort rummet ”${store.activeRoom.name}” med väggar och sammanställning?`)) return;
      store.removeRoom();
      break;
  }
  afterSwitch();
});

// Print / PDF: every room is shown once to take its 3D picture, then the pages are built and
// the browser's print dialog opens ("Save as PDF" gives a PDF).
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
async function printProject() {
  const printBtn = $<HTMLButtonElement>('#print-project');
  printBtn.disabled = true;
  printBtn.textContent = 'Förbereder…';
  const original = store.job.active;
  const prevMode = mode;
  if (measure.active) measure.toggle(false);
  room.stop();
  const prevRoomMode = asm.roomMode;
  asm.roomMode = true; // no selection or end markers in the pictures
  const sheets: RoomSheet[] = [];
  try {
    for (const [index, r] of store.job.rooms.entries()) {
      store.switchRoom(r.id);
      asm.render(true);
      viewer.setLabelsVisible(true);
      viewer.setRoomVisible(true);
      viewer.setDimensionsVisible(false);
      viewer.setView('iso', false);
      await nextFrame();
      viewer.renderNow();
      const hasContent = r.assembly.length > 0 || !!r.room;
      const lay = asm.layout;
      const detailOf = asm.projectOrder?.detailOf ?? new Map<string, number>();
      const skisser = lay ? skissHosts(lay).map((h) => skissSvg(h, lay, { project: store.job.name, room: r.name, detailOf })) : [];
      sheets.push({ room: r, index, picture: hasContent ? viewer.snapshot() : null, outlines: lay ? partOutlines(lay) : [], skisser });
    }
    const order = asm.projectOrder;
    store.switchRoom(original);
    if (order) buildPrint($('#print-root'), store, sheets, order);
  } finally {
    asm.roomMode = prevRoomMode;
    store.switchRoom(original);
    setMode(prevMode);
    printBtn.disabled = false;
    printBtn.textContent = 'Skriv ut';
  }
  // Let the pictures load before the print dialog takes its snapshot of the page
  await Promise.all([...document.querySelectorAll<HTMLImageElement>('#print-root img')].map((img) => img.decode().catch(() => {})));
  window.print();
}
$<HTMLButtonElement>('#print-project').addEventListener('click', () => void printProject());

// Export / import a whole project (all rooms + My parts)
$<HTMLButtonElement>('#export-project').addEventListener('click', () => {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(store.job.name)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const importFile = $<HTMLInputElement>('#import-file');
$<HTMLButtonElement>('#import-project').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (!file) return;
  const err = store.importJson(await file.text(), file.name);
  projectMessage.textContent = err ?? '';
  if (!err) afterSwitch();
});

// ---------- Assembly mode ----------

$<HTMLButtonElement>('#asm-undo').addEventListener('click', undo);

// Order list: this room or the whole project; copy to clipboard or download as a text file
$<HTMLElement>('#asm-order').addEventListener('click', async (e) => {
  const scope = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-scope]')?.dataset.scope;
  if (scope === 'room' || scope === 'project') {
    asm.orderScope = scope;
    asm.render();
    return;
  }
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
    const what = asm.orderScope === 'project' ? store.job.name : `${store.job.name}-${store.activeRoom.name}`;
    a.download = `bestallning-${slug(what)}-${new Date().toISOString().slice(0, 10)}.txt`;
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
  if (next === 'part' && measure.active) measure.toggle(false);
  mode = next;
  asm.roomMode = next === 'room';
  measureBtn.hidden = next === 'part';
  panel.dataset.mode = next;
  viewport.classList.toggle('assembly', next !== 'part');
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    const on = b.dataset.mode === next;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  partsMessage.textContent = '';
  syncToggleButtons();

  wireViewer();
  if (next === 'assembly') {
    stageHint.textContent = 'Klicka på en del för att markera den · Klicka på en orange ände för att välja var nästa del hamnar';
    rotateBtns.forEach((b) => (b.title = b.dataset.rotate === 'left' ? 'Vrid den valda delen 90° runt skarven' : 'Vrid den valda delen 90° åt andra hållet'));
    asm.render(true);
  } else if (next === 'room') {
    stageHint.textContent = 'Rita väggar genom att klicka ut hörn på golvet · Dra för att rotera · Scrolla för att zooma';
    asm.render(true);
    room.render();
  } else {
    stageHint.textContent = 'Dra för att rotera · Högerdra för att panorera · Scrolla för att zooma';
    rotateBtns.forEach((b) => (b.title = b.dataset.rotate === 'left' ? 'Rulla kanalen 90° moturs' : 'Rulla kanalen 90° medurs'));
    current = null; // redraw from scratch
    show(input.value, { updateHash: true });
  }
  renderParts();
}

/** Who gets clicks and mouse moves in the 3D view: the measuring tool, the Room tab or the assembly. */
function wireViewer() {
  const inRoom = mode === 'room';
  if (measure.active) {
    viewer.onPick = null;
    viewer.onPointerMove = (r, e) => measure.onMove(r, e.shiftKey);
    viewer.onClickRay = (r, e) => measure.onClick(r, e.shiftKey);
    viewer.onDoubleClick = null;
    viewer.onDragStart = viewer.onDragMove = viewer.onDragEnd = null;
    return;
  }
  viewer.onPick = mode === 'assembly' ? (hit) => asm.pick(hit) : null;
  viewer.onPointerMove = inRoom ? (r) => room.onMove(r) : null;
  viewer.onClickRay = inRoom ? (r) => room.onClick(r) : null;
  viewer.onDoubleClick = inRoom ? () => room.onDoubleClick() : null;
  viewer.onDragStart = inRoom ? (r, hit) => room.dragStart(r, hit) : null;
  viewer.onDragMove = inRoom ? (r) => room.dragMove(r) : null;
  viewer.onDragEnd = inRoom ? () => room.dragEnd() : null;
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
  if (measure.onKey(e)) {
    e.preventDefault();
    return;
  }
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
renderProjectBar();
setMode('part');

// Phones only get the Part tab (Assembly and Room need a bigger screen)
const narrow = window.matchMedia('(max-width: 800px)');
narrow.addEventListener('change', () => {
  if (narrow.matches && mode !== 'part') setMode('part');
});
