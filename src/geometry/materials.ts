import * as THREE from 'three';

/** Canvas texture with soft transverse stripes, used as a bump map for the corrugated sheet. */
function makeRibTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(4, size);
  for (let y = 0; y < size; y++) {
    // Trapezoid-ish profile: flat, ramp up, flat top, ramp down
    const t = y / size;
    let v: number;
    if (t < 0.35) v = 0;
    else if (t < 0.45) v = (t - 0.35) / 0.1;
    else if (t < 0.55) v = 1;
    else if (t < 0.65) v = 1 - (t - 0.55) / 0.1;
    else v = 0;
    const c = Math.round(v * 255);
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Spacing between corrugation ribs along the duct, mm (visual only). */
export const RIB_SPACING = 70;

export function createMaterials() {
  const ribs = makeRibTexture();
  // Extruded side walls get UVs in mm: u = across, v = along the duct.
  ribs.repeat.set(1 / 1000, 1 / RIB_SPACING);

  const galvanized = new THREE.MeshStandardMaterial({
    color: 0xc7cbd0,
    metalness: 0.85,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });

  const ductSheet = galvanized.clone();
  ductSheet.bumpMap = ribs;
  ductSheet.bumpScale = 2.5;

  return {
    ductSheet,
    galvanized,
    profile: new THREE.MeshStandardMaterial({ color: 0xb3b8be, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }),
    corner: new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.8, roughness: 0.5 }),
    bolt: new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.9, roughness: 0.3 }),
    gasket: new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0, roughness: 0.9 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.4 }),
    loose: new THREE.MeshStandardMaterial({
      color: 0xe8590c,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
    sound: new THREE.MeshStandardMaterial({ color: 0xe9cf7a, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    fire: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    armaflex: new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    liner: new THREE.MeshStandardMaterial({ color: 0xa9aeb4, metalness: 0.8, roughness: 0.55, side: THREE.DoubleSide }),
    // Ventilation unit (generic, unbranded)
    unitCasing: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.25, roughness: 0.55 }),
    unitDoor: new THREE.MeshStandardMaterial({ color: 0xd9dde1, metalness: 0.25, roughness: 0.5 }),
    unitEdge: new THREE.MeshStandardMaterial({ color: 0xa9afb6, metalness: 0.8, roughness: 0.35 }),
    unitFrame: new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 0.5, roughness: 0.5 }),
    unitHandle: new THREE.MeshStandardMaterial({ color: 0x25282c, metalness: 0.2, roughness: 0.6 }),
    unitRecess: new THREE.MeshStandardMaterial({ color: 0x1d2024, metalness: 0, roughness: 0.95, side: THREE.DoubleSide }),
    // Air stream colours on the connection collars
    connUTE: new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.5 }),
    connAVL: new THREE.MeshStandardMaterial({ color: 0x9c5b2e, roughness: 0.5 }),
    connTILL: new THREE.MeshStandardMaterial({ color: 0x1971c2, roughness: 0.5 }),
    connFRAN: new THREE.MeshStandardMaterial({ color: 0xe0a800, roughness: 0.5 }),
    // Damper actuators
    actuator: new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.2, roughness: 0.6 }),
    fireRed: new THREE.MeshStandardMaterial({ color: 0xc92a2a, metalness: 0.2, roughness: 0.55 }),
  };
}

export type Materials = ReturnType<typeof createMaterials>;
