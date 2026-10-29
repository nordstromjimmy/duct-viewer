import * as THREE from 'three';

/** A centred rectangle path (counter-clockwise). */
function rectPath(path: THREE.Path, w: number, h: number) {
  path.moveTo(-w / 2, -h / 2);
  path.lineTo(w / 2, -h / 2);
  path.lineTo(w / 2, h / 2);
  path.lineTo(-w / 2, h / 2);
  path.lineTo(-w / 2, -h / 2);
}

/**
 * Rectangular ring (a rectangle with a rectangular hole), extruded along +Z from z = 0 to z = depth.
 * All sizes in mm. Pass innerW/innerH <= 0 for a solid plate.
 */
export function rectRing(
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  rectPath(shape, outerW, outerH);
  if (innerW > 0 && innerH > 0) {
    const hole = new THREE.Path();
    // Holes must wind the other way
    hole.moveTo(-innerW / 2, -innerH / 2);
    hole.lineTo(-innerW / 2, innerH / 2);
    hole.lineTo(innerW / 2, innerH / 2);
    hole.lineTo(innerW / 2, -innerH / 2);
    hole.lineTo(-innerW / 2, -innerH / 2);
    shape.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
}

/** Mesh helper: geometry spanning z0..z1 (z0 < z1). */
export function ringMesh(
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
  z0: number,
  z1: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(rectRing(outerW, outerH, innerW, innerH, z1 - z0), material);
  mesh.position.z = z0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Points spaced roughly `spacing` apart along a line from -len/2 to len/2, always including both ends. */
export function spacedPositions(len: number, spacing: number, margin = 0): number[] {
  const usable = len - 2 * margin;
  if (usable <= 0) return [0];
  const n = Math.max(1, Math.round(usable / spacing));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(-usable / 2 + (usable * i) / n);
  return out;
}