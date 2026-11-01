// The Assembly tab: selection, where the next part goes, and the actions on parts.

import * as THREE from 'three';
import { parseCode, summary } from '../codes';
import type { Materials } from '../geometry/materials';
import { portSize, type PortId } from '../geometry/ports';
import { newId, type AsmPart, type Store } from '../store';
import type { Viewer } from '../viewer';
import { addQuarterTurn, bestFit, bestRoll, canCut, layout, MIN_CUT, portsOf, type Layout } from './layout';
import { buildOrder, lineText, orderText as orderTextOf, type Order } from './order';
import { buildAssemblyScene, type PortRef } from './scene';
import { findCollisions, type Collision } from '../room/collide';
import { buildRoomGroup } from '../room/model';

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
}

export class AssemblyController {
  selectedPart: string | null = null;
  target: PortRef | null = null;
  private lay: Layout | null = null;
  /** The order list for the current assembly. */
  order: Order | null = null;
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
    const lay = layout(this.parts, this.mat);
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

    this.order = buildOrder(this.store.project);
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
    // The room is drawn in the same space, at the same scale (mm)
    if (room && room.points.length >= 2) {
      const g = buildRoomGroup(room);
      scene.model.root.add(g);
      scene.model.bounds.union(new THREE.Box3().setFromObject(g));
    }
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
    const order = this.order;
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
        nr.append(this.detailInput(l.code, l.detail, l.manual));
        const codeCell = td(l.base, 'order-code');
        codeCell.title = lineText(l);
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
      return c.target === 'roof' ? `${who} går upp i taket.` : `${who} går igenom vägg ${c.wall! + 1}.`;
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
    if (asm.parent) {
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
    button('roll-left', '↺', 'Vrid den här delen 90° runt skarven');
    button('roll-right', '↻', 'Vrid den här delen 90° åt andra hållet');
    if (asm.parent && laid.model.ports.filter((p) => p.open).length > 1) {
      button('turn', '⇄ Vänd', 'Fäst med en annan ände');
    }
    button('view', 'Visa', 'Öppna under fliken Del');
    button('remove', below ? `Ta bort (+${below})` : 'Ta bort', below ? `Tar även bort ${below} del(ar) som sitter efter den` : 'Ta bort den här delen', 'danger');

    const head = el('div', 'sel-head');
    head.append(el('span', 'tok', laid.product.kind), el('strong', '', summary(laid.product)));
    box.replaceChildren(el('h2', '', 'Vald del'), head, el('div', 'sel-code', asm.code), el('p', jointCls, joint));
    const line = this.order?.lines.find((l) => l.partIds.includes(asm.id));
    if (line) {
      const row = el('div', 'sel-detail');
      const lab = el('label', '', 'Detaljnr');
      lab.append(this.detailInput(line.code, line.detail, line.manual));
      row.append(lab, el('span', 'sel-cut__of', line.count > 1 ? `${line.count} st av den här koden i sammanställningen` : 'bara en av den här koden'));
      box.append(row);
    } else if (this.order?.other.some((o) => o.partIds.includes(asm.id))) {
      box.append(el('div', 'sel-detail sel-cut--hint', 'Inte en Crenna-del – listas under ”Övrigt” i beställningstexten.'));
    }
    const cut = this.cutSection(asm);
    if (cut) box.append(cut);
    box.append(actions);
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
    if (!a || (!a.roll && !a.tilt)) return;
    this.store.update((p) => {
      const x = p.assembly.find((y) => y.id === id)!;
      x.roll = 0;
      delete x.tilt;
    });
    this.render(true);
  }

  /** True when the selected part is turned or tipped (so Reset has something to do). */
  get selectedIsTurned(): boolean {
    const a = this.find(this.selectedPart);
    return !!a && (a.roll !== 0 || !!a.tilt);
  }

  /** Selected part's roll in degrees, or null when nothing is selected. */
  get selectedRollDegrees(): number | null {
    const a = this.find(this.selectedPart);
    return a ? a.roll * 90 : null;
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
