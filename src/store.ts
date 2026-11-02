// Projects: each project (a job) has its saved parts ("My parts"), detail numbers, and one or
// more rooms. Each room has its own walls, openings, pipes, measurements and assembly.
// Kept in the browser's localStorage, with export/import to a file and an undo history.
//
// The rest of the app works on `store.project`: a live view of the active room together with
// the project's shared parts and detail numbers, so code written for one room keeps working.

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

/** The working view: the active room's content plus the project's shared parts and detail numbers. */
export interface Project {
  parts: SavedPart[];
  /** Detail numbers set by hand on the order list, per code. Codes left out are numbered automatically. */
  details?: Record<string, number>;
  assembly: AsmPart[];
  /** Walls, floor and roof drawn around the assembly. */
  room?: Room;
  /** Where the whole assembly is moved to in the room, [x, y, z] mm. */
  place?: [number, number, number];
  /** Measurements kept in the room. */
  measures?: Measure[];
}

/** A saved measurement between two points, mm. */
export interface Measure {
  id: string;
  a: [number, number, number];
  b: [number, number, number];
}

/** One room of a project. */
export interface RoomData {
  id: string;
  name: string;
  assembly: AsmPart[];
  room?: Room;
  place?: [number, number, number];
  measures?: Measure[];
}

/** A whole project (job) – also the export file format. */
export interface Job {
  version: 2;
  id: string;
  name: string;
  parts: SavedPart[];
  details?: Record<string, number>;
  rooms: RoomData[];
  active: string;
}

/** Entry in the list of projects. */
export interface JobInfo {
  id: string;
  name: string;
  updated: number;
}

const OLD_KEY = 'duct-viewer:project';
const INDEX_KEY = 'duct-viewer:jobs';
const ACTIVE_KEY = 'duct-viewer:active-job';
const jobKey = (id: string) => `duct-viewer:job:${id}`;
const MAX_UNDO = 50;

export const newId = () => Math.random().toString(36).slice(2, 10);

const ROOM_KEYS = ['assembly', 'room', 'place', 'measures'] as const;
const SHARED_KEYS = ['parts', 'details'] as const;

function newRoom(name: string): RoomData {
  return { id: newId(), name, assembly: [] };
}

function newJob(name: string): Job {
  const room = newRoom('Rum 1');
  return { version: 2, id: newId(), name, parts: [], rooms: [room], active: room.id };
}

/** Old one-room project (version 1). */
interface ProjectV1 {
  version: 1;
  parts: SavedPart[];
  assembly: AsmPart[];
  details?: Record<string, number>;
  room?: Room;
  place?: [number, number, number];
}

function isV1(x: unknown): x is ProjectV1 {
  const p = x as ProjectV1;
  return !!p && p.version === 1 && Array.isArray(p.parts) && Array.isArray(p.assembly);
}

function isJob(x: unknown): x is Job {
  const j = x as Job;
  return !!j && j.version === 2 && Array.isArray(j.parts) && Array.isArray(j.rooms) && j.rooms.length > 0 && j.rooms.every((r) => Array.isArray(r.assembly));
}

/** A version 1 project becomes a project with one room. */
function fromV1(p: ProjectV1, name: string): Job {
  const room: RoomData = { id: newId(), name: 'Rum 1', assembly: p.assembly, room: p.room, place: p.place };
  return { version: 2, id: newId(), name, parts: p.parts, details: p.details, rooms: [room], active: room.id };
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked – not fatal, the change just won't survive a reload
  }
}

export class Store {
  job: Job;
  /** Live view of the active room + shared parts (see the top of this file). */
  readonly project: Project;
  private undoStack: string[] = [];
  private listeners: (() => void)[] = [];

  constructor() {
    this.job = this.loadInitial();
    const store = this;
    const target = (key: string | symbol): Record<string, unknown> | null => {
      if ((SHARED_KEYS as readonly (string | symbol)[]).includes(key)) return store.job as unknown as Record<string, unknown>;
      if ((ROOM_KEYS as readonly (string | symbol)[]).includes(key)) return store.activeRoom as unknown as Record<string, unknown>;
      return null;
    };
    this.project = new Proxy({} as Project, {
      get: (_, key) => target(key)?.[key as string],
      set: (_, key, value) => {
        const t = target(key);
        if (t) t[key as string] = value;
        return true;
      },
      deleteProperty: (_, key) => {
        const t = target(key);
        if (t) delete t[key as string];
        return true;
      },
      has: (_, key) => !!target(key) && target(key)![key as string] !== undefined,
    });
  }

  /** Open the last used project; move old single-project data into a first project. */
  private loadInitial(): Job {
    const index = load<JobInfo[]>(INDEX_KEY) ?? [];
    const activeId = load<string>(ACTIVE_KEY);
    for (const id of [activeId, ...index.map((j) => j.id)]) {
      if (!id) continue;
      const job = load<Job>(jobKey(id));
      if (isJob(job)) return job;
    }
    const old = load<unknown>(OLD_KEY);
    const job = isV1(old) ? fromV1(old, 'Mitt projekt') : newJob('Mitt projekt');
    this.saveJob(job);
    return job;
  }

  get activeRoom(): RoomData {
    return this.job.rooms.find((r) => r.id === this.job.active) ?? this.job.rooms[0];
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Apply a change. Everything that changes the project goes through here (for undo + saving). */
  update(change: (p: Project) => void) {
    this.undoStack.push(JSON.stringify(this.job));
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
    const active = this.job.active;
    this.job = JSON.parse(prev);
    // Stay in the room you're looking at, if it still exists
    if (this.job.rooms.some((r) => r.id === active)) this.job.active = active;
    this.commit();
  }

  private saveJob(job: Job) {
    save(jobKey(job.id), job);
    const index = (load<JobInfo[]>(INDEX_KEY) ?? []).filter((j) => j.id !== job.id);
    index.push({ id: job.id, name: job.name, updated: Date.now() });
    save(INDEX_KEY, index);
    save(ACTIVE_KEY, job.id);
  }

  private commit() {
    this.saveJob(this.job);
    for (const fn of this.listeners) fn();
  }

  // ---------- Projects ----------

  /** All saved projects, most recently changed first. */
  listJobs(): JobInfo[] {
    return (load<JobInfo[]>(INDEX_KEY) ?? []).filter((j) => load<Job>(jobKey(j.id))).sort((a, b) => b.updated - a.updated);
  }

  private open(job: Job) {
    this.saveJob(this.job);
    this.job = job;
    this.undoStack = [];
    this.commit();
  }

  createJob(name: string) {
    this.open(newJob(name));
  }

  switchJob(id: string) {
    if (id === this.job.id) return;
    const job = load<Job>(jobKey(id));
    if (isJob(job)) this.open(job);
  }

  renameJob(name: string) {
    this.update(() => {
      this.job.name = name;
    });
  }

  /** Delete the current project and open another one (or a fresh one if it was the last). */
  deleteJob() {
    const id = this.job.id;
    try {
      localStorage.removeItem(jobKey(id));
    } catch {
      // ignore
    }
    save(INDEX_KEY, (load<JobInfo[]>(INDEX_KEY) ?? []).filter((j) => j.id !== id));
    const next = this.listJobs()[0];
    const job = next ? load<Job>(jobKey(next.id)) : null;
    this.job = isJob(job) ? job : newJob('Nytt projekt');
    this.undoStack = [];
    this.commit();
  }

  // ---------- Rooms ----------

  /** Switch room (not an undo step). */
  switchRoom(id: string) {
    if (id === this.job.active || !this.job.rooms.some((r) => r.id === id)) return;
    this.job.active = id;
    this.commit();
  }

  addRoom(name: string) {
    const room = newRoom(name);
    this.update(() => {
      this.job.rooms.push(room);
      this.job.active = room.id;
    });
  }

  renameRoom(name: string) {
    this.update(() => {
      this.activeRoom.name = name;
    });
  }

  /** Remove the active room (a project always keeps at least one). */
  removeRoom() {
    if (this.job.rooms.length < 2) return;
    this.update(() => {
      const i = this.job.rooms.findIndex((r) => r.id === this.job.active);
      this.job.rooms.splice(i, 1);
      this.job.active = this.job.rooms[Math.max(0, i - 1)].id;
    });
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

  /** Change the code of a saved part (parts already placed in rooms keep theirs). */
  setPartCode(id: string, code: string, name: string) {
    this.update((p) => {
      const part = p.parts.find((x) => x.id === id);
      if (part) {
        part.code = code;
        part.name = name;
      }
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
    return JSON.stringify(this.job, null, 2);
  }

  /** Load a project file as a new project (nothing is overwritten). Returns an error message, or null. */
  importJson(text: string, fileName = 'Importerat projekt'): string | null {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return 'Filen är inte giltig JSON.';
    }
    let job: Job;
    if (isJob(data)) job = { ...data, id: newId() };
    else if (isV1(data)) job = fromV1(data, fileName.replace(/\.json$/i, ''));
    else return 'Filen är inte ett Duct Viewer-projekt.';
    if (!job.rooms.some((r) => r.id === job.active)) job.active = job.rooms[0].id;
    // Don't clash with a project that's already here
    const names = new Set(this.listJobs().map((j) => j.name));
    let name = job.name;
    for (let n = 2; names.has(name); n++) name = `${job.name} (${n})`;
    job.name = name;
    this.open(job);
    return null;
  }
}
