// The Assembly tab: selection, where the next part goes, and the actions on parts.

import * as THREE from 'three';
import { parseCode, summary } from '../codes';
import type { Materials } from '../geometry/materials';
import { portSize, type Port, type PortId } from '../geometry/ports';
import { newId, type AsmPart, type DuctSide, type Mount, type Store } from '../store';
import type { Viewer } from '../viewer';
import { addQuarterTurn, bestFit, bestRoll, canCut, layout, MIN_CUT, mountFootprint, mountQuarter, portsOf, type Layout } from './layout';
import { buildOrder, lineText, orderText as orderTextOf, projectOrderText, roomOrder, type Order } from './order';
import { buildAssemblyScene, type PortRef } from './scene';
import { findCollisions, type Collision } from '../room/collide';
import { buildRoomGroup, runName } from '../room/model';
import { buildMeasureGroup } from '../measure';

export interface AssemblyUi {
  hint: HTMLElement;
  warnings: HTMLUListElement;
  selected: HTMLElement;
  count: HTMLElement;
  undo: HTMLButtonElement;
  /** Box with the stand up / tip / turn buttons for the whole assembly. */
  orient: HTMLElement;
  /** Order list section (table + notes). */
  order: HTMLElement;
  /** Show a part's code in the Part tab. */
  onView: (code: string) => void;
  /** Called after every redraw (e.g. to update the toolbar). */
  onRender: () => void;
  /** Extra controls at the bottom of "Vald del" (e.g. the Skiss button). */
  selectedExtras?: (asm: AsmPart, laid: Layout['parts'][number]) => HTMLElement[] | null;
}

export class AssemblyController {
  selectedPart: string | null = null;
  target: PortRef | null = null;
  private lay: Layout | null = null;
  /** The current layout (parts placed in the world), for the Room tab. */
  get layout(): Layout | null {
    return this.lay;
  }

  /** Number of parts in the assembly. */
  get partCount(): number {
    return this.parts.length;
  }
  /** The order list for the current room (detail numbers shared with the whole project). */
  order: Order | null = null;
  /** The order list for the whole project. */
  projectOrder: Order | null = null;
  /** What the order list table shows. */
  orderScope: 'room' | 'project' = 'room';
  /** Parts hitting the room's walls or roof. */
  collisions: Collision[] = [];
  /** True in the Room tab: no end markers or selection, the room is being drawn. */
  roomMode = false;
  private store: Store;
  private viewer: Viewer;
  private mat: Materials;
  private ui: AssemblyUi;

  constructor(store: Store, viewer: Viewer, mat: Materials, ui: AssemblyUi) {
    this.store = store;
    this.viewer = viewer;
    this.mat = mat;
    this.ui = ui;
  }

  private get parts(): AsmPart[] {
    return this.store.project.assembly;
  }

  private find(id: string | null): AsmPart | undefined {
    return this.parts.find((a) => a.id === id);
  }

  // ---------- Drawing ----------

  /** Rebuild the 3D scene and the side panel. `fit` re-frames the camera on the whole assembly. */
  render(fit = false) {
    // (The previous scene's models are disposed by the viewer when it gets the new one.)
    const lay = layout(this.parts, this.mat, this.store.project.place);
    this.lay = lay;

    // Drop a selection that no longer exists (after undo / remove)
    if (!this.find(this.selectedPart)) this.selectedPart = null;
    const openPorts = lay.parts.flatMap((p) => p.ports.filter((w) => w.port.open && !w.connected));
    const isOpen = (t: PortRef | null) => !!t && openPorts.some((w) => w.partId === t.partId && w.port.id === t.portId);
    if (!isOpen(this.target)) {
      // Default: the newest part's first free end, so parts chain on naturally
      const last = openPorts.at(-1);
      this.target = last ? { partId: last.partId, portId: last.port.id } : null;
    }

    const job = this.store.job;
    this.projectOrder = buildOrder(job);
    this.order = roomOrder(this.projectOrder, Math.max(0, job.rooms.indexOf(this.store.activeRoom)));
    if (job.rooms.length < 2) this.orderScope = 'room';
    const room = this.store.project.room;
    this.collisions = room ? findCollisions(room, lay) : [];
    const scene = buildAssemblyScene(
      lay,
      this.roomMode ? null : this.selectedPart,
      this.roomMode ? null : this.target,
      this.order.detailOf,
      new Set(this.collisions.map((c) => c.partId)),
      !this.roomMode,
    );
    // The assembly's own content in one group, so the Room tab can slide it around while dragging
    const content = new THREE.Group();
    content.name = 'asm-content';
    if (scene.model.root.children.length) content.add(...scene.model.root.children);
    scene.model.root.add(content);
    // The room is drawn in the same space, at the same scale (mm)
    if (room && room.points.length >= 2) {
      const g = buildRoomGroup(room);
      scene.model.root.add(g);
      scene.model.bounds.union(new THREE.Box3().setFromObject(g));
    }
    // Saved measurements (not counted in the view's bounds)
    scene.model.root.add(buildMeasureGroup(this.store));
    // Nothing built yet (e.g. drawing a room first): frame a 6 × 6 m floor so the camera has a scale
    if (scene.model.bounds.isEmpty()) scene.model.bounds.set(new THREE.Vector3(-3000, 0, -3000), new THREE.Vector3(3000, 0, 3000));
    this.viewer.setModel(scene.model, { resetRotation: true });
    if (fit) this.viewer.fit();

    this.renderPanel(openPorts.length);
    this.ui.onRender();
  }

  private renderPanel(openCount: number) {
    const n = this.parts.length;
    const saved = this.store.project.parts.length;
    this.ui.count.textContent = n ? String(n) : '';
    this.ui.undo.disabled = !this.store.canUndo;
    this.ui.orient.querySelectorAll('button').forEach((b) => (b.disabled = n === 0));

    // Hint
    let hint: string;
    if (n === 0) hint = saved ? 'Lägg till en del från Mina delar för att börja.' : 'Spara delar under fliken Del först, och lägg sedan till dem här.';
    else if (this.target) hint = 'Nästa del hamnar på den markerade änden. Klicka på en annan orange ände för att byta.';
    else if (openCount === 0) hint = 'Alla ändar är anslutna eller stängda.';
    else hint = 'Klicka på en orange ände för att välja var nästa del hamnar.';
    this.ui.hint.textContent = `${n} ${n === 1 ? 'del' : 'delar'} · ${openCount} ${openCount === 1 ? 'öppen ände' : 'öppna ändar'}. ${hint}`;

    // Warnings: parts that couldn't be placed, joints that don't fit
    const notes: string[] = [];
    for (const p of this.lay?.problems ?? []) notes.push(`${p.code}: ${p.message}`);
    const bad = this.lay?.joints.filter((j) => !j.ok) ?? [];
    if (bad.length) notes.push(`${bad.length} ${bad.length === 1 ? 'skarv' : 'skarvar'} där dimensionerna inte stämmer (röda flaggor).`);
    notes.push(...this.collisionTexts());
    this.ui.warnings.replaceChildren(
      ...notes.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );

    this.renderSelected();
    this.renderOrder();
  }

  /** The order list table: detail no. (editable) – qty – code – end types. */
  private renderOrder() {
    const box = this.ui.order;
    const multi = this.store.job.rooms.length > 1;
    const scope = box.querySelector<HTMLElement>('.order-scope');
    if (scope) {
      scope.hidden = !multi;
      scope.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((b) => b.classList.toggle('is-active', b.dataset.scope === this.orderScope));
    }
    const order = this.orderScope === 'project' ? this.projectOrder : this.order;
    const table = box.querySelector<HTMLTableSectionElement>('tbody')!;
    const note = box.querySelector<HTMLElement>('.order-note')!;
    const empty = !order || (order.lines.length === 0 && order.other.length === 0);
    box.classList.toggle('is-empty', empty);
    box.querySelectorAll<HTMLButtonElement>('[data-order]').forEach((b) => (b.disabled = empty));
    if (!order) return;

    table.replaceChildren(
      ...order.lines.map((l) => {
        const tr = document.createElement('tr');
        tr.dataset.code = l.code;
        if (l.partIds.includes(this.selectedPart ?? '')) tr.classList.add('is-selected');
        if (order.duplicates.includes(l.detail)) tr.classList.add('is-dup');
        const td = (text: string, cls = '') => {
          const c = document.createElement('td');
          c.className = cls;
          c.textContent = text;
          return c;
        };
        const nr = document.createElement('td');
        nr.append(this.detailInput(l.key, l.detail, l.manual));
        const codeCell = td(l.base, 'order-code');
        codeCell.title = lineText(l);
        if (l.note) {
          const small = document.createElement('small');
          small.className = 'order-note-inline';
          small.textContent = l.note;
          codeCell.append(small);
        }
        tr.append(nr, td(String(l.count), 'order-qty'), codeCell, td(l.ends || '–', 'order-ends'));
        return tr;
      }),
    );

    const notes: string[] = [];
    if (order.duplicates.length) notes.push(`Detaljnr ${order.duplicates.join(', ')} används mer än en gång.`);
    const cuts = order.lines.reduce((n, l) => n + l.cuts.length, 0);
    if (cuts) notes.push(`${cuts} ${cuts === 1 ? 'planerad kapning' : 'planerade kapningar'} på plats – listas i den exporterade texten.`);
    if (order.other.length) {
      const n = order.other.reduce((s, o) => s + o.count, 0);
      notes.push(`${n} ${n === 1 ? 'del' : 'delar'} som inte är från Crenna (aggregat, ljuddämpare, spjäll) listas separat i texten.`);
    }
    note.textContent = notes.join(' ');
  }

  /** Small number field for a line's detail number. Clearing it goes back to automatic. */
  private detailInput(code: string, value: number, manual: boolean): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = String(value);
    input.className = 'detail-input' + (manual ? ' is-manual' : '');
    input.title = manual ? 'Satt för hand – töm fältet för automatisk numrering' : 'Automatiskt – skriv för att sätta ett eget';
    input.setAttribute('aria-label', 'Detaljnummer');
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      this.store.setDetail(code, input.value.trim() === '' || !(v >= 1) ? undefined : v);
      this.render();
    });
    return input;
  }

  /** One line per collision: "Detail 3 · KB-1-800-500-0 passes through wall 2". */
  collisionTexts(): string[] {
    return this.collisions.map((c) => {
      const a = this.find(c.partId);
      const d = this.order?.detailOf.get(c.partId);
      const who = `${d !== undefined ? `Detalj ${d} · ` : ''}${a?.code ?? '?'}`;
      if (c.target === 'roof') return `${who} går upp i taket.`;
      if (c.target === 'run') {
        const run = this.store.project.room?.runs?.find((r) => r.id === c.run);
        return `${who} krockar med ${run ? runName(this.store.project.room!, run).replace(/^./, (ch) => ch.toLowerCase()) : 'ett rör'}.`;
      }
      return `${who} går igenom vägg ${c.wall! + 1}.`;
    });
  }

  /** Lowest point of the assembly (where a room's floor goes by default), mm. */
  assemblyFloorY(): number {
    const parts = this.lay?.parts ?? [];
    if (!parts.length) return 0;
    let min = Infinity;
    for (const p of parts) min = Math.min(min, p.model.bounds.clone().applyMatrix4(p.matrix).min.y);
    return Math.round(min);
  }

  /** Text for the order form, ready to paste or save. */
  orderText(): string {
    if (this.orderScope === 'project' && this.projectOrder) return projectOrderText(this.projectOrder, this.store.job.rooms.map((r) => r.name));
    return this.order ? orderTextOf(this.order) : '';
  }

  private renderSelected() {
    const box = this.ui.selected;
    const asm = this.find(this.selectedPart);
    const laid = this.lay?.parts.find((p) => p.asm.id === this.selectedPart);
    box.hidden = !asm || !laid;
    if (!asm || !laid) return;

    const el = (tag: string, cls: string, text = '') => {
      const e = document.createElement(tag);
      e.className = cls;
      e.textContent = text;
      return e;
    };
    const ownPort = laid.model.ports.find((p) => p.id === asm.via);

    // Joint status
    let joint = 'Första delen – allt annat sitter fast i den.';
    let jointCls = 'sel-joint';
    if (asm.parent && asm.mount) {
      const parent = this.lay!.parts.find((p) => p.asm.id === asm.parent);
      joint = `Monterad på sidan av ${parent?.asm.code ?? '?'}`;
    } else if (asm.parent) {
      const parent = this.lay!.parts.find((p) => p.asm.id === asm.parent);
      const j = this.lay!.joints.find((x) => x.childId === asm.id);
      const pPort = parent?.ports.find((w) => w.port.id === asm.parentPort);
      joint = `${ownPort?.label ?? asm.via} → ${pPort?.port.label ?? asm.parentPort} på ${parent?.asm.code ?? '?'}`;
      if (j?.ok) joint += ` · ${ownPort ? portSize(ownPort) : ''} ✓`;
      else if (j) {
        joint += ` · dimensionerna stämmer inte: ${j.text}`;
        jointCls += ' sel-joint--bad';
      }
    }

    const below = this.store.subtree(asm.id).size - 1;
    const actions = el('div', 'sel-actions');
    const button = (act: string, text: string, title: string, cls = '') => {
      const b = el('button', cls, text) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.act = act;
      b.title = title;
      actions.append(b);
      return b;
    };
    button('roll-left', '↺', asm.mount ? 'Vrid delen 90° på kanalsidan' : 'Vrid den här delen 90° runt skarven');
    button('roll-right', '↻', asm.mount ? 'Vrid delen 90° åt andra hållet' : 'Vrid den här delen 90° åt andra hållet');
    if (asm.parent && !asm.mount && laid.model.ports.filter((p) => p.open).length > 1) {
      button('turn', '⇄ Vänd', 'Fäst med en annan ände');
    }
    button('view', 'Visa', 'Öppna under fliken Del');
    button('remove', below ? `Ta bort (+${below})` : 'Ta bort', below ? `Tar även bort ${below} del(ar) som sitter efter den` : 'Ta bort den här delen', 'danger');

    const head = el('div', 'sel-head');
    head.append(el('span', 'tok', laid.product.kind), el('strong', '', summary(laid.product)));
    box.replaceChildren(el('h2', '', 'Vald del'), head, this.codeForm(asm), el('p', jointCls, joint));
    const line = this.order?.lines.find((l) => l.partIds.includes(asm.id));
    if (line) {
      const row = el('div', 'sel-detail');
      const lab = el('label', '', 'Detaljnr');
      lab.append(this.detailInput(line.key, line.detail, line.manual));
      row.append(lab, el('span', 'sel-cut__of', line.count > 1 ? `${line.count} st av den här koden i sammanställningen` : 'bara en av den här koden'));
      box.append(row);
    } else if (this.order?.other.some((o) => o.partIds.includes(asm.id))) {
      box.append(el('div', 'sel-detail sel-cut--hint', 'Inte en Crenna-del – listas under ”Övrigt” i beställningstexten.'));
    }
    const cut = this.cutSection(asm);
    if (cut) box.append(cut);
    if (asm.mount) box.append(this.mountEditor(asm));
    else if (laid.product.kind === 'KK') box.append(this.shapeEditor(asm, laid.product), this.mountAdder(asm, laid.product.length));
    const extra = this.ui.selectedExtras?.(asm, laid);
    if (extra) box.append(...extra);
    box.append(actions);
  }

  /** Fields for side / along / across of a mounted stosram (shared by "add" and "edit"). */
  private mountFields(m: Mount, onChange: (m: Mount) => void): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'sel-mount__grid';
    const field = (label: string, input: HTMLElement, unit = '') => {
      const l = document.createElement('label');
      const s = document.createElement('span');
      s.textContent = label;
      l.append(s, input);
      if (unit) l.append(unit);
      grid.append(l);
    };
    const side = document.createElement('select');
    for (const [v, t] of [['left', 'Vänster'], ['right', 'Höger'], ['top', 'Ovansida'], ['bottom', 'Undersida']] as [DuctSide, string][]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      o.selected = m.side === v;
      side.append(o);
    }
    const num = (v: number) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = '10';
      i.value = String(v);
      return i;
    };
    const along = num(m.along);
    const across = num(m.across);
    field('Sida (sett från ände 1)', side);
    field('Från ände 1 till kant', along, ' mm');
    field(m.side === 'left' || m.side === 'right' ? 'Från underkant' : 'Från vänster kant', across, ' mm');
    const read = (): Mount => ({
      side: side.value as DuctSide,
      along: Math.round(Number(along.value) || 0),
      across: Math.round(Number(across.value) || 0),
      ...(m.turned ? { turned: true } : {}),
    });
    for (const el of [side, along, across]) el.addEventListener('change', () => onChange(read()));
    for (const el of [along, across]) el.addEventListener('keydown', (e) => e.stopPropagation());
    return grid;
  }

  /** Rectangular ends a part could be mounted by, e.g. a KD's big and small end. */
  private mountablePorts(code: string): Port[] {
    const parsed = parseCode(code);
    return parsed.ok ? portsOf(parsed.product, this.mat).filter((p) => p.shape === 'rect') : [];
  }

  /** Which end of the mounted part sits against the duct. */
  private viaSelect(code: string, via: PortId): HTMLSelectElement {
    const sel = document.createElement('select');
    for (const p of this.mountablePorts(code)) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.label} (${portSize(p)})`;
      o.selected = p.id === via;
      sel.append(o);
    }
    return sel;
  }

  /** On a selected straight duct: mount a part from My parts (stosram, duct, transition …) on one of its sides. */
  private mountAdder(asm: AsmPart, length: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sel-mount';
    const h = document.createElement('h3');
    h.textContent = 'Montera del på sidan';
    wrap.append(h);
    const parts = this.store.project.parts.filter((p) => this.mountablePorts(p.code).length > 0 && !p.code.startsWith('AGG'));
    if (!parts.length) {
      const p = document.createElement('p');
      p.className = 'sel-cut__of';
      p.textContent = 'Spara delen i Mina delar först, t.ex. en stosram KRM-2-1010-150-0-350 F/P.';
      wrap.append(p);
      return wrap;
    }
    const pick = document.createElement('select');
    for (const s of parts) {
      const o = document.createElement('option');
      o.value = s.code;
      o.textContent = `${s.name} · ${s.code}`;
      pick.append(o);
    }
    // Stosramar first in the list is nice, but keep the user's order; preselect the first KR if any
    const firstKR = parts.find((p) => p.code.startsWith('KR'));
    if (firstKR) pick.value = firstKR.code;

    let via: PortId = this.mountablePorts(pick.value)[0]?.id ?? 'end1';
    let m: Mount = { side: 'left', along: 0, across: 0 };
    const centre = () => {
      const port = this.mountablePorts(pick.value).find((p) => p.id === via);
      if (port) m = { ...m, along: Math.max(0, Math.round((length - mountFootprint(port, 0).along) / 2)) };
    };
    centre();
    let viaSel = this.viaSelect(pick.value, via);
    const viaLabel = document.createElement('label');
    viaLabel.className = 'sel-mount__via';
    const viaText = document.createElement('span');
    viaText.textContent = 'Mot kanalen';
    viaLabel.append(viaText, viaSel);
    const bindVia = () => viaSel.addEventListener('change', () => {
      via = viaSel.value as PortId;
      centre();
      refresh();
    });
    bindVia();
    let fields = this.mountFields(m, (x) => (m = x));
    const refresh = () => {
      const next = this.mountFields(m, (x) => (m = x));
      fields.replaceWith(next);
      fields = next;
    };
    pick.addEventListener('change', () => {
      via = this.mountablePorts(pick.value)[0]?.id ?? 'end1';
      const nextVia = this.viaSelect(pick.value, via);
      viaSel.replaceWith(nextVia);
      viaSel = nextVia;
      bindVia();
      centre();
      refresh();
    });
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'sel-mount__go';
    go.textContent = 'Montera';
    go.addEventListener('click', () => {
      const id = newId();
      const code = pick.value;
      this.store.update((p) => p.assembly.push({ id, code, parent: asm.id, parentPort: null, via, roll: 0, mount: m }));
      this.selectedPart = id;
      // Continue building from the mounted part's next free end
      const parsed = parseCode(code);
      const next = parsed.ok ? portsOf(parsed.product, this.mat).find((x) => x.id !== via && x.open) : undefined;
      this.target = next ? { partId: id, portId: next.id } : this.target;
      this.render(true);
    });
    wrap.append(pick, viaLabel, fields, go);
    return wrap;
  }

  /** On a straight duct: close end 2 and round off (or cut) one corner – drawn per skiss. */
  private shapeEditor(asm: AsmPart, duct: { width: number; length: number; ends: string[] }): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sel-mount';
    const h = document.createElement('h3');
    h.textContent = 'Specialanpassad ände 2 (skiss)';
    const on = document.createElement('label');
    on.className = 'sel-mount__check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!asm.shape;
    on.append(box, ' Stängd ände 2 med rundat eller avfasat hörn');
    wrap.append(h, on);
    const save = (shape: AsmPart['shape']) => {
      this.store.update((p) => {
        const a = p.assembly.find((x) => x.id === asm.id);
        if (!a) return;
        if (shape) a.shape = shape;
        else delete a.shape;
      });
      this.render();
    };
    box.addEventListener('change', () =>
      save(box.checked ? { corner: 'right', kind: 'round', along: Math.round(Math.min(300, duct.length / 3)), across: Math.round(duct.width / 2) } : undefined),
    );
    const s = asm.shape;
    if (!s) return wrap;

    const grid = document.createElement('div');
    grid.className = 'sel-mount__grid';
    const sel = (opts: [string, string][], v: string) => {
      const e = document.createElement('select');
      for (const [val, t] of opts) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = t;
        o.selected = val === v;
        e.append(o);
      }
      return e;
    };
    const num = (v: number) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = '10';
      i.min = '0';
      i.value = String(v);
      i.addEventListener('keydown', (e) => e.stopPropagation());
      return i;
    };
    const corner = sel([['left', 'Vänster'], ['right', 'Höger']], s.corner);
    const kind = sel([['round', 'Rundat'], ['chamfer', 'Rak fas']], s.kind);
    const along = num(s.along);
    const across = num(s.across);
    const field = (label: string, input: HTMLElement, unit = '') => {
      const l = document.createElement('label');
      const t = document.createElement('span');
      t.textContent = label;
      l.append(t, input);
      if (unit) l.append(unit);
      grid.append(l);
    };
    field('Hörn (sett från ände 1)', corner);
    field('Form', kind);
    field('Längs sidan från ände 2', along, ' mm');
    field('Tvärs änden', across, ' mm');
    const read = () => ({
      corner: corner.value as 'left' | 'right',
      kind: kind.value as 'round' | 'chamfer',
      along: Math.min(duct.length, Math.max(0, Math.round(Number(along.value) || 0))),
      across: Math.min(duct.width, Math.max(0, Math.round(Number(across.value) || 0))),
    });
    for (const e of [corner, kind, along, across]) e.addEventListener('change', () => save(read()));
    wrap.append(grid);
    if (!/B$/.test(duct.ends[1])) {
      const p = document.createElement('p');
      p.className = 'sel-cut__of';
      p.textContent = 'Tips: beställ ände 2 som stängd, t.ex. PG/Fast B, och bifoga skissen.';
      wrap.append(p);
    }
    return wrap;
  }

  /** On a mounted stosram: move it on the duct's side. */
  private mountEditor(asm: AsmPart): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sel-mount';
    const h = document.createElement('h3');
    h.textContent = 'Placering på kanalen';
    const viaLabel = document.createElement('label');
    viaLabel.className = 'sel-mount__via';
    const viaText = document.createElement('span');
    viaText.textContent = 'Mot kanalen';
    const viaSel = this.viaSelect(asm.code, asm.via);
    viaSel.addEventListener('change', () => {
      this.store.update((p) => {
        const a = p.assembly.find((x) => x.id === asm.id);
        if (a) a.via = viaSel.value as PortId;
      });
      this.render();
    });
    viaLabel.append(viaText, viaSel);
    wrap.append(
      h,
      ...(this.mountablePorts(asm.code).length > 1 ? [viaLabel] : []),
      this.mountFields(asm.mount!, (m) => {
        this.store.update((p) => {
          const a = p.assembly.find((x) => x.id === asm.id);
          if (a) a.mount = m;
        });
        this.render();
      }),
    );
    return wrap;
  }

  /** "Cut length" field for straight ducts with a loose/plain end, or a hint for other straight ducts. */
  private cutSection(asm: AsmPart): HTMLElement | null {
    const parsed = parseCode(asm.code);
    if (!parsed.ok || parsed.product.kind !== 'KK') return null;
    const ordered = parsed.product.length;
    const wrap = document.createElement('div');
    wrap.className = 'sel-cut';

    if (!canCut(parsed.product)) {
      wrap.classList.add('sel-cut--hint');
      wrap.textContent = 'För att kapa kanalen på plats, beställ den med lös (L) eller slät (P) ände, t.ex. PG/L.';
      return wrap;
    }

    const current = asm.cut && asm.cut < ordered ? asm.cut : ordered;
    const label = document.createElement('label');
    label.textContent = 'Kaplängd';
    const input = document.createElement('input');
    input.type = 'number';
    input.name = 'cut';
    input.min = String(MIN_CUT);
    input.max = String(ordered);
    input.step = '10';
    input.value = String(current);
    label.append(input);
    const unit = document.createElement('span');
    unit.className = 'sel-cut__of';
    unit.textContent = `mm · beställd ${ordered}`;
    wrap.append(label, unit);

    if (current < ordered) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.dataset.act = 'cut-reset';
      reset.textContent = 'Full längd';
      wrap.append(reset);
    }
    const msg = document.createElement('p');
    msg.className = 'sel-cut__msg';
    wrap.append(msg);

    // Apply on Enter or when leaving the field
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      if (!(v >= MIN_CUT)) {
        msg.textContent = `Minst ${MIN_CUT} mm.`;
        return;
      }
      if (v > ordered) {
        msg.textContent = `Kan inte vara längre än beställda ${ordered} mm.`;
        input.value = String(current);
        return;
      }
      this.setCut(asm.id, v >= ordered ? undefined : v);
    });
    return wrap;
  }

  /** The selected part's code as an editable field: change it and press Enter (or Ändra). */
  private codeForm(asm: AsmPart): HTMLFormElement {
    const form = document.createElement('form');
    form.className = 'sel-codeform';
    form.autocomplete = 'off';
    const input = document.createElement('input');
    input.name = 'code';
    input.value = asm.code;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Delens kod');
    input.title = 'Ändra koden och tryck Enter – delarna efter följer med';
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = 'Ändra';
    const msg = document.createElement('p');
    msg.className = 'sel-codeform__msg';
    form.append(input, btn, msg);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = this.setCode(asm.id, input.value);
      if (err) msg.textContent = err;
    });
    input.addEventListener('input', () => (msg.textContent = ''));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = asm.code;
        msg.textContent = '';
      }
      e.stopPropagation(); // Backspace/Delete edit the text, not the assembly
    });
    return form;
  }

  /**
   * Change a placed part's code. Parts attached after it stay on the same ends (an end that no
   * longer exists shows a warning). Returns an error message, or null.
   */
  setCode(id: string, code: string): string | null {
    const a = this.find(id);
    if (!a) return null;
    const parsed = parseCode(code);
    if (!parsed.ok) return parsed.error;
    const product = parsed.product;
    if (product.code === a.code) return null;
    const ports = portsOf(product, this.mat);
    const own = ports.find((p) => p.id === a.via) ? a.via : ports[0]?.id;
    if (!own) return 'Den delen har inga ändar att fästa med.';
    this.store.update((p) => {
      const x = p.assembly.find((y) => y.id === id)!;
      x.code = product.code;
      x.via = own;
      // A planned cut only makes sense if the new part can still be cut that short
      if (x.cut !== undefined && (!canCut(product) || product.kind !== 'KK' || x.cut >= product.length)) delete x.cut;
    });
    this.render();
    return null;
  }

  /** Set (or clear, with undefined) the site cut of a part. */
  setCut(id: string, length: number | undefined) {
    if (this.find(id)?.cut === length) return;
    this.store.update((p) => {
      const a = p.assembly.find((x) => x.id === id);
      if (!a) return;
      if (length === undefined) delete a.cut;
      else a.cut = length;
    });
    this.render();
  }

  /** Handle a button in the selected-part card. */
  act(action: string) {
    switch (action) {
      case 'roll-left': return this.roll(1);
      case 'roll-right': return this.roll(-1);
      case 'turn': return this.turnAround();
      // Standing up lifts the far end (end 2), so you keep building upwards
      case 'tip-over': return this.tip(this.tipAxis(), -1);
      case 'tip-back': return this.tip(this.tipAxis(), 1);
      case 'spin': return this.tip(new THREE.Vector3(0, 1, 0), -1);
      case 'view': {
        const asm = this.find(this.selectedPart);
        if (asm) this.ui.onView(asm.code);
        return;
      }
      case 'remove': return this.remove();
      case 'cut-reset': {
        if (this.selectedPart) this.setCut(this.selectedPart, undefined);
        return;
      }
    }
  }

  // ---------- Picking ----------

  /** Click in the view: an orange end picks where the next part goes, a part selects it. */
  pick(hit: THREE.Object3D | null) {
    let o: THREE.Object3D | null = hit;
    while (o) {
      if (o.userData.port) {
        this.target = o.userData.port as PortRef;
        this.render();
        return;
      }
      if (o.userData.partId) {
        this.selectedPart = o.userData.partId === this.selectedPart ? null : o.userData.partId;
        this.render();
        return;
      }
      o = o.parent;
    }
    if (this.selectedPart) {
      this.selectedPart = null;
      this.render();
    }
  }

  // ---------- Actions ----------

  /** Add a part: as the first part, or on the chosen open end. Returns an error message or null. */
  add(code: string): string | null {
    const parsed = parseCode(code);
    if (!parsed.ok) return parsed.error;
    const ports = portsOf(parsed.product, this.mat);
    const id = newId();

    if (this.parts.length === 0) {
      this.store.update((p) => p.assembly.push({ id, code: parsed.product.code, parent: null, parentPort: null, via: 'end1', roll: 0 }));
      this.selectedPart = id;
      const next = ports.find((x) => x.id !== 'end1' && x.open);
      this.target = next ? { partId: id, portId: next.id } : null;
      this.render(true);
      return null;
    }

    if (!this.target) return 'Klicka först på en orange ände för att välja var delen ska sitta.';
    const target = this.lay?.parts.find((p) => p.asm.id === this.target!.partId)?.ports.find((w) => w.port.id === this.target!.portId);
    if (!target) return 'Klicka först på en orange ände för att välja var delen ska sitta.';

    const fit = bestFit(ports, target.port);
    const parentId = this.target.partId;
    const parentPort = this.target.portId;
    this.store.update((p) => p.assembly.push({ id, code: parsed.product.code, parent: parentId, parentPort, via: fit.via, roll: fit.roll }));
    this.selectedPart = id;
    // Continue from the new part's next free end
    const next = ports.find((x) => x.id !== fit.via && x.open);
    this.target = next ? { partId: id, portId: next.id } : null;
    this.render(true);
    return null;
  }

  /** Turn the selected part a quarter turn around its joint (+1 = left, -1 = right). */
  roll(dir: 1 | -1) {
    const id = this.selectedPart;
    if (!this.find(id)) return;
    this.store.update((p) => {
      const a = p.assembly.find((x) => x.id === id)!;
      a.roll = (((a.roll + dir) % 4) + 4) % 4;
    });
    this.render();
  }

  /**
   * Axis to tip the first part around: horizontal and across its main direction (the end it's
   * oriented by), so a lying part stands up and a standing one lies down. When it already
   * stands, it tips towards/away from the viewer instead.
   */
  private tipAxis(): THREE.Vector3 {
    const root = this.lay?.parts.find((p) => p.asm.parent === null);
    const end = root?.ports.find((w) => w.port.id === root.asm.via);
    const axis = end ? new THREE.Vector3().crossVectors(end.normal, new THREE.Vector3(0, 1, 0)) : new THREE.Vector3();
    if (axis.lengthSq() < 0.25) return this.viewer.cameraRightAxis();
    // Snap to the nearest world axis (orientations are always quarter turns)
    const ax = [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)];
    const i = ax.indexOf(Math.max(...ax));
    const out = new THREE.Vector3();
    out.setComponent(i, Math.sign(axis.getComponent(i)));
    return out;
  }

  /**
   * Tip or turn the first part (and with it the whole assembly) a quarter turn around a world
   * axis. Positive = right-hand rule, so around the camera's right axis it tips towards the viewer.
   */
  tip(axis: THREE.Vector3, dir: 1 | -1) {
    const root = this.parts.find((a) => a.parent === null);
    if (!root) return;
    this.store.update((p) => {
      const a = p.assembly.find((x) => x.id === root.id)!;
      a.tilt = addQuarterTurn(a.tilt, axis, dir);
    });
    this.render(true);
  }

  /** Back to 0°. For the first part this also undoes any tipping. */
  resetRoll() {
    const id = this.selectedPart;
    const a = this.find(id);
    if (!a || (!a.roll && !a.tilt && !a.mount?.turned)) return;
    this.store.update((p) => {
      const x = p.assembly.find((y) => y.id === id)!;
      x.roll = 0;
      delete x.tilt;
      if (x.mount) delete x.mount.turned;
    });
    this.render(true);
  }

  /** True when the selected part is turned or tipped (so Reset has something to do). */
  get selectedIsTurned(): boolean {
    const a = this.find(this.selectedPart);
    return !!a && (a.roll !== 0 || !!a.tilt || !!a.mount?.turned);
  }

  /** Selected part's roll in degrees, or null when nothing is selected. */
  get selectedRollDegrees(): number | null {
    const a = this.find(this.selectedPart);
    if (!a) return null;
    return (a.mount ? mountQuarter(a) : a.roll) * 90;
  }

  /** Attach the selected part by its next open end instead. */
  turnAround() {
    const asm = this.find(this.selectedPart);
    const laid = this.lay?.parts.find((p) => p.asm.id === this.selectedPart);
    if (!asm || !laid || !asm.parent) return;
    const open = laid.model.ports.filter((p) => p.open);
    if (open.length < 2) return;
    const i = open.findIndex((p) => p.id === asm.via);
    const nextPort = open[(i + 1) % open.length];
    const parentPort = this.lay!.parts.find((p) => p.asm.id === asm.parent)?.ports.find((w) => w.port.id === asm.parentPort);
    const oldVia: PortId = asm.via;

    this.store.update((p) => {
      const a = p.assembly.find((x) => x.id === asm.id)!;
      a.via = nextPort.id;
      a.roll = parentPort ? bestRoll(nextPort, parentPort.port) : 0;
      // Whatever hung on the new connecting end moves to the old one
      for (const child of p.assembly) {
        if (child.parent === a.id && child.parentPort === nextPort.id) child.parentPort = oldVia;
      }
    });
    if (this.target?.partId === asm.id && this.target.portId === nextPort.id) this.target = { partId: asm.id, portId: oldVia };
    this.render();
  }

  /** Remove the selected part and everything attached after it. */
  remove() {
    const asm = this.find(this.selectedPart);
    if (!asm) return;
    const gone = this.store.subtree(asm.id);
    this.store.update((p) => {
      p.assembly = p.assembly.filter((a) => !gone.has(a.id));
    });
    this.selectedPart = asm.parent && !gone.has(asm.parent) ? asm.parent : null;
    if (this.target && gone.has(this.target.partId)) {
      this.target = asm.parent && asm.parentPort ? { partId: asm.parent, portId: asm.parentPort } : null;
    }
    this.render(true);
  }

  clear() {
    if (!this.parts.length) return;
    this.store.update((p) => {
      p.assembly = [];
    });
    this.selectedPart = null;
    this.target = null;
    this.render(true);
  }
}
