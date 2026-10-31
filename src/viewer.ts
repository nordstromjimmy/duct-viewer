// The 3D viewport: renderer, camera, orbit controls, lighting, view presets and rotation.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { disposeModel, type DuctModel } from './geometry/duct';
import type { Materials } from './geometry/materials';

export type ViewName = 'iso' | 'end' | 'side' | 'top';

const VIEW_DIRECTIONS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(1.1, 0.75, 1.3).normalize(),
  end: new THREE.Vector3(0, 0, -1), // looking into end 1 (the big end on transitions)
  side: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
};

const QUARTER = Math.PI / 2;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private floor: THREE.Mesh;
  private grid: THREE.GridHelper | null = null;
  private model: DuctModel | null = null;

  /**
   * The model hangs in two groups: `pivot` sits on the model's centre line and rolls around
   * the duct axis (Z); `holder` shifts the model so that centre line goes through the pivot.
   */
  private pivot = new THREE.Group();
  private holder = new THREE.Group();
  private roll = 0; // current roll target, radians (multiples of 90°)
  private rollTween: { from: number; to: number; t: number } | null = null;

  private defaultSection = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  /** The plane the materials clip with, kept in world space as the model rolls. */
  private clipPlane = new THREE.Plane();
  private sectionOn = false;

  private tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null;
  private timer = new THREE.Timer();
  private raycaster = new THREE.Raycaster();

  /** Called with the clicked object (or null for empty space) when the user clicks the view. */
  onPick: ((hit: THREE.Object3D | null) => void) | null = null;
  /** Mouse ray hooks, used by the room drawing tool. */
  onPointerMove: ((ray: THREE.Ray) => void) | null = null;
  onClickRay: ((ray: THREE.Ray) => void) | null = null;
  onDoubleClick: ((ray: THREE.Ray) => void) | null = null;
  /** Temporary drawings in world coordinates (e.g. the wall being drawn). Not part of the model. */
  readonly overlay = new THREE.Group();
  private container: HTMLElement;
  private materials: Materials;

  constructor(container: HTMLElement, materials: Materials) {
    this.container = container;
    this.materials = materials;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    // Reflections for the galvanised metal
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;

    this.camera = new THREE.PerspectiveCamera(35, 1, 10, 200000);
    this.camera.position.set(3000, 2000, 3500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.addEventListener('start', () => (this.tween = null));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.9));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.pivot.add(this.holder);
    this.scene.add(this.pivot);

    // Click (not drag) on the model → report what was hit
    const down = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown', (e) => down.set(e.clientX, e.clientY));
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // that was a drag
      this.onClickRay?.(this.rayAt(e.clientX, e.clientY));
      this.onPick?.(this.pick(e.clientX, e.clientY));
    });
    this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove?.(this.rayAt(e.clientX, e.clientY)));
    this.renderer.domElement.addEventListener('dblclick', (e) => this.onDoubleClick?.(this.rayAt(e.clientX, e.clientY)));
    this.scene.add(this.overlay);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  setModel(model: DuctModel, opts: { resetRotation?: boolean } = {}) {
    if (this.model) {
      this.holder.remove(this.model.root);
      disposeModel(this.model.root);
    }
    this.model = model;
    this.holder.add(model.root);

    // A new product starts unrotated; the same product redrawn keeps its rotation
    if (opts.resetRotation) this.roll = 0;

    // Put the pivot on the model's centre line (parallel to Z) so rolling keeps it in place.
    const c = model.bounds.getCenter(new THREE.Vector3());
    this.pivot.position.set(c.x, c.y, 0);
    this.holder.position.set(-c.x, -c.y, 0);
    this.rollTween = null;
    this.pivot.rotation.z = this.roll;

    const size = model.bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);

    // Floor + grid
    this.floor.scale.set(span * 6, span * 6, 1);
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
    }
    const step = span > 2500 ? 500 : span > 1000 ? 250 : 100; // grid in round millimetres
    const divisions = Math.ceil((span * 3) / step);
    this.grid = new THREE.GridHelper(divisions * step, divisions, 0xb9bec5, 0xd7dbe0);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(this.grid);
    this.placeFloor();

    // Light + shadow camera sized to the model
    this.sun.position.set(c.x + span * 0.8, c.y + span * 2, c.z + span * 1.2);
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -span;
    cam.right = cam.top = span;
    cam.near = 1;
    cam.far = span * 5;
    cam.updateProjectionMatrix();

    // A new model may use a different cutting plane
    if (this.sectionOn) this.setSection(true);
  }

  /** Move the camera to a preset view, framing the whole model. */
  setView(view: ViewName, animate = true) {
    if (!this.model) return;
    const dir = view === 'iso' && this.model.iso ? this.model.iso : VIEW_DIRECTIONS[view];
    this.frame(dir, animate);
  }

  /** Point the camera along `dir` (from the model towards the camera) and fit the model in view. */
  private frame(dir: THREE.Vector3, animate = true) {
    const sphere = this.worldBounds(this.roll).getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)); // narrowest axis
    const dist = (sphere.radius * 1.25) / Math.sin(fit / 2);
    const to = sphere.center.clone().addScaledVector(dir.clone().normalize(), dist);

    if (!animate) {
      this.camera.position.copy(to);
      this.controls.target.copy(sphere.center);
      this.controls.update();
      return;
    }
    this.tween = {
      from: this.camera.position.clone(),
      to,
      fromT: this.controls.target.clone(),
      toT: sphere.center.clone(),
      t: 0,
    };
  }

  /**
   * Roll the model 90° around its axis. 'left' = counter-clockwise as seen from the camera,
   * whichever side of the duct the camera is on.
   */
  rotate(direction: 'left' | 'right') {
    const toCamera = this.camera.position.clone().sub(this.controls.target);
    const facing = toCamera.z >= 0 ? 1 : -1; // is the camera looking along -Z or +Z?
    const ccw = direction === 'left' ? 1 : -1;
    const from = this.rollTween ? this.pivot.rotation.z : this.roll;
    this.roll += ccw * facing * QUARTER;
    this.rollTween = { from, to: this.roll, t: 0 };
    this.reframe();
  }

  /** Re-fit the model after rolling, keeping the current viewing angle. */
  private reframe() {
    this.frame(this.camera.position.clone().sub(this.controls.target));
  }

  /** Back to the orientation the model was built in. */
  resetRotation() {
    if (this.roll === 0) return;
    this.rollTween = { from: this.pivot.rotation.z, to: 0, t: 0 };
    this.roll = 0;
    this.reframe();
  }

  /** Current roll in degrees, 0–270. */
  get rotationDegrees(): number {
    return ((Math.round((this.roll * 180) / Math.PI) % 360) + 360) % 360;
  }

  /** Show/hide every group with this name (one per part in an assembly). */
  private setNamedVisible(name: string, on: boolean) {
    this.model?.root.traverse((o) => {
      if (o.name === name) o.visible = on;
    });
  }

  setDimensionsVisible(on: boolean) {
    this.setNamedVisible('dimensions', on);
    this.container.classList.toggle('hide-dims', !on);
  }

  setInsulationVisible(on: boolean) {
    this.setNamedVisible('insulation', on);
  }

  /**
   * The camera's right-hand direction, flattened onto the floor and snapped to the nearest
   * world axis (±X or ±Z). Tipping around this axis tips things towards or away from the viewer.
   */
  cameraRightAxis(): THREE.Vector3 {
    const right = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, new THREE.Vector3(), new THREE.Vector3());
    right.y = 0;
    return Math.abs(right.x) >= Math.abs(right.z)
      ? new THREE.Vector3(Math.sign(right.x) || 1, 0, 0)
      : new THREE.Vector3(0, 0, Math.sign(right.z) || 1);
  }

  /** Re-fit the whole model in view, keeping the current viewing angle. */
  fit() {
    if (this.model) this.reframe();
  }

  /** The camera ray through a screen point. */
  rayAt(clientX: number, clientY: number): THREE.Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.clone();
  }

  /** How many mm one screen pixel covers at a world point (for snapping distances). */
  mmPerPixel(at: THREE.Vector3): number {
    const dist = this.camera.position.distanceTo(at);
    const h = this.renderer.domElement.clientHeight || 1;
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
  }

  /** First visible mesh under a screen point (skipping anything marked noPick, like the room). */
  private pick(clientX: number, clientY: number): THREE.Object3D | null {
    if (!this.model) return null;
    this.rayAt(clientX, clientY);
    const isShown = (o: THREE.Object3D | null): boolean => !o || (o.visible && isShown(o.parent));
    const pickable = (o: THREE.Object3D | null): boolean => !o || (!o.userData.noPick && pickable(o.parent));
    for (const hit of this.raycaster.intersectObject(this.model.root, true)) {
      if ((hit.object as THREE.Mesh).isMesh && isShown(hit.object) && pickable(hit.object)) return hit.object;
    }
    return null;
  }

  /** Cut the model in half to show the inside. Each model can choose its own cutting plane. */
  setSection(on: boolean) {
    this.sectionOn = on;
    this.updateClipPlane();
    for (const m of Object.values(this.materials)) {
      m.clippingPlanes = on ? [this.clipPlane] : [];
      m.clipShadows = on;
      m.needsUpdate = true;
    }
  }

  /**
   * Show/hide all text in the scene (labels, dimension values, warnings) plus the assembly's
   * helpers (orange end markers, selection outline) – for clean pictures.
   */
  setLabelsVisible(on: boolean) {
    this.container.classList.toggle('hide-labels', !on);
    this.model?.root.traverse((o) => {
      if (o.userData.helper) o.visible = on;
    });
  }

  /** Show or hide the drawn room (walls, floor, roof and their labels). */
  setRoomVisible(on: boolean) {
    const room = this.model?.root.getObjectByName('room');
    if (room) room.visible = on;
  }

  /** PNG data URL of the current view, with any visible labels drawn on top. */
  snapshot(): string {
    const gl = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = gl.width;
    out.height = gl.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(gl, 0, 0);
    if (!this.container.classList.contains('hide-labels')) this.drawLabels(ctx, gl);
    return out.toDataURL('image/png');
  }

  /** Paint the HTML labels onto the picture, matching how they look on screen. */
  private drawLabels(ctx: CanvasRenderingContext2D, gl: HTMLCanvasElement) {
    const base = gl.getBoundingClientRect();
    const scale = gl.width / base.width;
    for (const el of Array.from(this.labelRenderer.domElement.children) as HTMLElement[]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.style.display === 'none' || !el.textContent) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right < base.left || r.left > base.right || r.bottom < base.top || r.top > base.bottom) continue;
      const x = (r.left - base.left) * scale;
      const y = (r.top - base.top) * scale;
      const w = r.width * scale;
      const h = r.height * scale;
      const radius = (parseFloat(cs.borderTopLeftRadius) || 0) * scale;

      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = cs.backgroundColor;
      ctx.fill();
      const border = parseFloat(cs.borderTopWidth) || 0;
      if (border > 0) {
        ctx.lineWidth = border * scale;
        ctx.strokeStyle = cs.borderTopColor;
        ctx.stroke();
      }
      const left = parseFloat(cs.borderLeftWidth) || 0;
      if (left > border) {
        ctx.fillStyle = cs.borderLeftColor; // coloured edge on unit connection labels
        ctx.fillRect(x, y, left * scale, h);
      }

      ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * scale}px ${cs.fontFamily}`;
      ctx.fillStyle = cs.color;
      ctx.textBaseline = 'middle';
      const text = cs.textTransform === 'uppercase' ? el.textContent.toUpperCase() : el.textContent;
      const padLeft = (parseFloat(cs.paddingLeft) + left) * scale;
      ctx.fillText(text, x + padLeft, y + h / 2, w - padLeft);
    }
  }

  /** Bounding box of the model in the scene, at the current roll or at a given one. */
  private worldBounds(roll?: number): THREE.Box3 {
    const current = this.pivot.rotation.z;
    if (roll !== undefined) this.pivot.rotation.z = roll;
    this.pivot.updateMatrixWorld(true);
    const box = this.model!.bounds.clone().applyMatrix4(this.holder.matrixWorld);
    this.pivot.rotation.z = current;
    this.pivot.updateMatrixWorld(true);
    return box;
  }

  /** Keep the floor and grid just under the model. */
  private placeFloor() {
    if (!this.model) return;
    const y = this.worldBounds().min.y - 1;
    this.floor.position.y = y;
    if (this.grid) this.grid.position.y = y;
  }

  /** The cutting plane is defined in model space; move it with the model. */
  private updateClipPlane() {
    const src = this.model?.section ?? this.defaultSection;
    this.pivot.updateMatrixWorld(true);
    this.clipPlane.copy(src).applyMatrix4(this.holder.matrixWorld);
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  private render() {
    this.timer.update();
    const dt = this.timer.getDelta();
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.6);
      const e = 1 - Math.pow(1 - tw.t, 3); // ease out
      this.camera.position.lerpVectors(tw.from, tw.to, e);
      this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
      if (tw.t >= 1) this.tween = null;
    }
    if (this.rollTween) {
      const rt = this.rollTween;
      rt.t = Math.min(1, rt.t + dt / 0.45);
      const e = 1 - Math.pow(1 - rt.t, 3);
      this.pivot.rotation.z = rt.from + (rt.to - rt.from) * e;
      this.placeFloor();
      if (this.sectionOn) this.updateClipPlane();
      if (rt.t >= 1) this.rollTween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
