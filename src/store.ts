// The project: saved parts ("My parts") and the assembly built from them.
// Kept in the browser's localStorage, with export/import to a file and an undo history.

import type { PortId } from './geometry/ports';
import type { Room } from './room/model';

/** A product code saved to "My parts". */
export interface SavedPart {
  id: string;
  code: string;
  name: string;
}

/**
 * One part in the assembly. Parts form a tree: every part except the first hangs off an
 * open end ("port") of another part.
 */
export interface AsmPart {
  id: string;
  code: string;
  /** The part this one is attached to, or null for the first part. */
  parent: string | null;
  /** Which end of the parent it's attached to. */
  parentPort: PortId | null;
  /** Which of its own ends it's attached by. For the first part: the end it rolls around. */
  via: PortId;
  /** Roll around the joint, in quarter turns (0–3). */
  roll: number;
  /** Planned site cut: the length (mm) a part ordered with a loose/plain end is cut to. */
  cut?: number;
  /**
   * First part only: extra tip/turn in world space, as a quaternion [x, y, z, w] made of
   * quarter turns. Tipping the first part tips the whole assembly.
   */
  tilt?: [number, number, number, number];
}

export interface Project {
  version: 1;
  parts: SavedPart[];
  assembly: AsmPart[];
  /** Detail numbers set by hand on the order list, per code. Codes left out are numbered automatically. */
  details?: Record<string, number>;
  /** Walls, floor and roof drawn around the assembly. */
  room?: Room;
}

const KEY = 'duct-viewer:project';
const MAX_UNDO = 50;

export const newId = () => Math.random().toString(36).slice(2, 10);

function empty(): Project {
  return { version: 1, parts: [], assembly: [] };
}

/** Basic shape check for loaded or imported data. */
function isProject(x: unknown): x is Project {
  const p = x as Project;
  return !!p && p.version === 1 && Array.isArray(p.parts) && Array.isArray(p.assembly);
}

export class Store {
  project: Project;
  private undoStack: string[] = [];
  private listeners: (() => void)[] = [];

  constructor() {
    this.project = empty();
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (isProject(data)) this.project = data;
    } catch {
      // Storage blocked or corrupt – start empty
    }
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Apply a change. Everything that changes the project goes through here (for undo + saving). */
  update(change: (p: Project) => void) {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    change(this.project);
    this.commit();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.project = JSON.parse(prev);
    this.commit();
  }

  private commit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.project));
    } catch {
      // Not fatal – the project just won't survive a reload
    }
    for (const fn of this.listeners) fn();
  }

  // ---------- My parts ----------

  /** Save a code to My parts. Returns the existing entry if the code is already there. */
  savePart(code: string, name: string): SavedPart {
    const existing = this.project.parts.find((p) => p.code === code);
    if (existing) return existing;
    const part = { id: newId(), code, name };
    this.update((p) => p.parts.push(part));
    return part;
  }

  renamePart(id: string, name: string) {
    this.update((p) => {
      const part = p.parts.find((x) => x.id === id);
      if (part) part.name = name;
    });
  }

  removePart(id: string) {
    this.update((p) => {
      p.parts = p.parts.filter((x) => x.id !== id);
    });
  }

  // ---------- Assembly ----------

  /** A part and everything attached after it. */
  subtree(id: string): Set<string> {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of this.project.assembly) {
        if (a.parent && out.has(a.parent) && !out.has(a.id)) {
          out.add(a.id);
          grew = true;
        }
      }
    }
    return out;
  }

  /** Set the detail number for a code on the order list, or undefined to number it automatically. */
  setDetail(code: string, detail: number | undefined) {
    if ((this.project.details?.[code] ?? undefined) === detail) return;
    this.update((p) => {
      const d = { ...(p.details ?? {}) };
      if (detail === undefined) delete d[code];
      else d[code] = detail;
      p.details = d;
    });
  }

  // ---------- File ----------

  exportJson(): string {
    return JSON.stringify(this.project, null, 2);
  }

  /** Replace the project with one from a file. Returns an error message, or null on success. */
  importJson(text: string): string | null {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return 'Filen är inte giltig JSON.';
    }
    if (!isProject(data)) return 'Filen är inte ett Duct Viewer-projekt.';
    this.update((p) => {
      p.parts = data.parts;
      p.assembly = data.assembly;
      p.details = data.details;
      p.room = data.room;
    });
    return null;
  }
}
