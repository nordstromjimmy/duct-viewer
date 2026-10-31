// Turns a layout into one scene the viewer can show: all parts in place, orange markers on the
// open ends, an outline around the selected part and red flags on joints that don't fit.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { DuctModel } from '../geometry/duct';
import type { PortId } from '../geometry/ports';
import type { Layout, WorldPort } from './layout';

export interface PortRef {
  partId: string;
  portId: PortId;
}

const ACCENT = 0xe8590c;
const markerFill = new THREE.MeshBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const markerFillActive = markerFill.clone();
markerFillActive.opacity = 0.85;
const markerEdge = new THREE.LineBasicMaterial({ color: ACCENT });
const outlineMat = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.9 });

/** How far in front of the opening the marker floats, mm (clear of PG profiles and flanges). */
const MARKER_GAP = 30;
/** Marker margin around the opening, mm – so it shows past the PG profile. */
const MARKER_MARGIN = 30;

function label(text: string, className: string, pos: THREE.Vector3): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.copy(pos);
  return obj;
}

/** A flat marker covering an open end, facing outwards. Clicking it picks that end. */
function portMarker(wp: WorldPort, active: boolean): THREE.Group {
  const g = new THREE.Group();
  const { port } = wp;
  const shape =
    port.shape === 'round'
      ? new THREE.CircleGeometry(port.w / 2 + MARKER_MARGIN / 2, 48)
      : new THREE.PlaneGeometry(port.w + 2 * MARKER_MARGIN, port.h + 2 * MARKER_MARGIN);
  const fill = new THREE.Mesh(shape, active ? markerFillActive : markerFill);
  fill.userData.port = { partId: wp.partId, portId: port.id } satisfies PortRef;
  fill.renderOrder = 5;
  g.add(fill);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(shape), markerEdge);
  edge.raycast = () => {}; // only the fill is clickable
  g.add(edge);

  // Orient: local X across the opening, Y along its height, Z out through it
  const across = new THREE.Vector3().crossVectors(wp.up, wp.normal);
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(across, wp.up, wp.normal);
  g.matrix.setPosition(wp.position.clone().addScaledVector(wp.normal, MARKER_GAP));
  return g;
}

export interface AssemblyScene {
  model: DuctModel;
  /** Open ends that are free to attach to. */
  openPorts: WorldPort[];
}

export function buildAssemblyScene(
  lay: Layout,
  selectedPart: string | null,
  target: PortRef | null,
  /** Detail number per part id, shown as a small badge on each part. */
  details: Map<string, number> = new Map(),
): AssemblyScene {
  const root = new THREE.Group();
  const bounds = new THREE.Box3();
  const openPorts: WorldPort[] = [];

  for (const part of lay.parts) {
    const r = part.model.root;
    r.userData.partId = part.asm.id;
    r.matrixAutoUpdate = false;

    // Detail number badge in the middle of the part (like the label on the real part)
    const detail = details.get(part.asm.id);
    if (detail !== undefined) {
      const centre = part.model.bounds.getCenter(new THREE.Vector3()).applyMatrix4(part.matrix);
      root.add(label(String(detail), 'detail-badge', centre));
    }
    r.matrix.copy(part.matrix);
    root.add(r);
    bounds.union(part.model.bounds.clone().applyMatrix4(part.matrix));

    if (part.asm.id === selectedPart) {
      // Outline around the selected part, in its own coordinates so it turns with it
      const box = part.model.bounds.clone().expandByScalar(20);
      const helper = new THREE.Box3Helper(box, ACCENT);
      helper.material = outlineMat;
      helper.renderOrder = 10;
      helper.raycast = () => {};
      helper.userData.helper = true;
      r.add(helper);
    }

    for (const wp of part.ports) {
      if (wp.connected || !wp.port.open) continue;
      openPorts.push(wp);
      const active = !!target && target.partId === wp.partId && target.portId === wp.port.id;
      const marker = portMarker(wp, active);
      marker.userData.helper = true;
      root.add(marker);
      if (active) {
        const pos = wp.position.clone().addScaledVector(wp.normal, MARKER_GAP + 40).addScaledVector(wp.up, wp.port.h / 2 + MARKER_MARGIN + 40);
        root.add(label('Next part goes here', 'scene-label scene-label--accent port-label', pos));
      }
    }
  }

  // Flag joints where the sizes don't match
  for (const j of lay.joints) {
    if (!j.ok) root.add(label(`≠ ${j.text}`, 'joint-warn', j.position));
  }

  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-500, -500, -500), new THREE.Vector3(500, 500, 500));

  const empty = () => new THREE.Group();
  return {
    model: {
      root,
      insulation: empty(),
      dimensions: empty(),
      bounds,
      // Cut horizontally, so Section shows the layout from above
      section: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
      ports: [],
    },
    openPorts,
  };
}
