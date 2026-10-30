// The Assembly tab: selection, where the next part goes, and the actions on parts.

import * as THREE from 'three';
import { parseCode, summary } from '../codes';
import type { Materials } from '../geometry/materials';
import { portSize, type PortId } from '../geometry/ports';
import { newId, type AsmPart, type Store } from '../store';
import type { Viewer } from '../viewer';
import { addQuarterTurn, bestFit, bestRoll, canCut, layout, MIN_CUT, portsOf, type Layout } from './layout';
import { buildAssemblyScene, type PortRef } from './scene';

export interface AssemblyUi {
  hint: HTMLElement;
  warnings: HTMLUListElement;
  selected: HTMLElement;
  count: HTMLElement;
  undo: HTMLButtonElement;
  /** Box with the stand up / tip / turn buttons for the whole assembly. */
  orient: HTMLElement;
  /** Show a part's code in the Part tab. */
  onView: (code: string) => void;
  /** Called after every redraw (e.g. to update the toolbar). */
  onRender: () => void;
}

export class AssemblyController {
  selectedPart: string | null = null;
  target: PortRef | null = null;
  private lay: Layout | null = null;
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

    const scene = buildAssemblyScene(lay, this.selectedPart, this.target);
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
    if (n === 0) hint = saved ? 'Add a part from My parts to start.' : 'Save parts in the Part tab first, then add them here.';
    else if (this.target) hint = 'The next part goes on the highlighted end. Click another orange end to change it.';
    else if (openCount === 0) hint = 'All ends are connected or closed.';
    else hint = 'Click an orange end to choose where the next part goes.';
    this.ui.hint.textContent = `${n} part${n === 1 ? '' : 's'} · ${openCount} open end${openCount === 1 ? '' : 's'}. ${hint}`;

    // Warnings: parts that couldn't be placed, joints that don't fit
    const notes: string[] = [];
    for (const p of this.lay?.problems ?? []) notes.push(`${p.code}: ${p.message}`);
    const bad = this.lay?.joints.filter((j) => !j.ok) ?? [];
    if (bad.length) notes.push(`${bad.length} joint${bad.length === 1 ? '' : 's'} where the sizes don't match (red flags).`);
    this.ui.warnings.replaceChildren(
      ...notes.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );

    this.renderSelected();
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
    let joint = 'First part – everything else is attached to it.';
    let jointCls = 'sel-joint';
    if (asm.parent) {
      const parent = this.lay!.parts.find((p) => p.asm.id === asm.parent);
      const j = this.lay!.joints.find((x) => x.childId === asm.id);
      const pPort = parent?.ports.find((w) => w.port.id === asm.parentPort);
      joint = `${ownPort?.label ?? asm.via} → ${pPort?.port.label ?? asm.parentPort} of ${parent?.asm.code ?? '?'}`;
      if (j?.ok) joint += ` · ${ownPort ? portSize(ownPort) : ''} ✓`;
      else if (j) {
        joint += ` · sizes don't match: ${j.text}`;
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
    button('roll-left', '↺', 'Turn this part 90° around its joint');
    button('roll-right', '↻', 'Turn this part 90° the other way');
    if (asm.parent && laid.model.ports.filter((p) => p.open).length > 1) {
      button('turn', '⇄ Turn around', 'Attach by a different end');
    }
    button('view', 'View', 'Open in the Part tab');
    button('remove', below ? `Remove (+${below})` : 'Remove', below ? `Also removes the ${below} part(s) attached after it` : 'Remove this part', 'danger');

    const head = el('div', 'sel-head');
    head.append(el('span', 'tok', laid.product.kind), el('strong', '', summary(laid.product)));
    box.replaceChildren(el('h2', '', 'Selected part'), head, el('div', 'sel-code', asm.code), el('p', jointCls, joint));
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
      wrap.textContent = 'To cut this duct to length on site, order it with a loose (L) or plain (P) end, e.g. PG/L.';
      return wrap;
    }

    const current = asm.cut && asm.cut < ordered ? asm.cut : ordered;
    const label = document.createElement('label');
    label.textContent = 'Cut length';
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
    unit.textContent = `mm · ordered ${ordered}`;
    wrap.append(label, unit);

    if (current < ordered) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.dataset.act = 'cut-reset';
      reset.textContent = 'Full length';
      wrap.append(reset);
    }
    const msg = document.createElement('p');
    msg.className = 'sel-cut__msg';
    wrap.append(msg);

    // Apply on Enter or when leaving the field
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      if (!(v >= MIN_CUT)) {
        msg.textContent = `At least ${MIN_CUT} mm.`;
        return;
      }
      if (v > ordered) {
        msg.textContent = `Can't be longer than the ordered ${ordered} mm.`;
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

    if (!this.target) return 'Click an orange end first, to choose where the part goes.';
    const target = this.lay?.parts.find((p) => p.asm.id === this.target!.partId)?.ports.find((w) => w.port.id === this.target!.portId);
    if (!target) return 'Click an orange end first, to choose where the part goes.';

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
