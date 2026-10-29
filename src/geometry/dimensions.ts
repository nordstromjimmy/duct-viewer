import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const lineMat = new THREE.LineBasicMaterial({ color: 0xe8590c, depthTest: false, transparent: true });

/**
 * A dimension line between p1 and p2, pushed out by `offset`,
 * with extension lines, architectural tick marks and a text label.
 * `field` is the code field the value comes from (e.g. "bbbb"), shown in front of the value.
 */
export function dimension(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  offset: THREE.Vector3,
  text: string,
  field?: string,
): THREE.Group {
  const g = new THREE.Group();
  const a = p1.clone().add(offset);
  const b = p2.clone().add(offset);
  const dir = offset.clone().normalize();
  const along = b.clone().sub(a).normalize();
  const tick = 14;
  const overshoot = 18;

  const pts: THREE.Vector3[] = [
    // extension lines (small gap at the object, small overshoot past the dimension line)
    p1.clone().addScaledVector(dir, 8), a.clone().addScaledVector(dir, overshoot),
    p2.clone().addScaledVector(dir, 8), b.clone().addScaledVector(dir, overshoot),
    // dimension line
    a.clone().addScaledVector(along, -overshoot), b.clone().addScaledVector(along, overshoot),
  ];
  // 45° ticks
  const slash = along.clone().add(dir).normalize().multiplyScalar(tick);
  for (const p of [a, b]) pts.push(p.clone().sub(slash), p.clone().add(slash));

  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const lines = new THREE.LineSegments(geo, lineMat);
  lines.renderOrder = 10;
  g.add(lines);

  const el = document.createElement('div');
  el.className = 'dim-label';
  if (field) {
    const f = document.createElement('span');
    f.className = 'dim-field';
    f.textContent = field;
    el.append(f);
  }
  el.append(text);
  const label = new CSS2DObject(el);
  label.position.copy(a.clone().add(b).multiplyScalar(0.5));
  g.add(label);
  return g;
}