// The 3D viewport: renderer, camera, orbit controls, lighting and view presets.

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
  private defaultSection = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private sectionOn = false;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null;
  private timer = new THREE.Timer();
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

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  setModel(model: DuctModel) {
    if (this.model) {
      this.scene.remove(this.model.root);
      disposeModel(this.model.root);
    }
    this.model = model;
    this.scene.add(model.root);

    const b = model.bounds;
    const size = b.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);

    // Floor + grid under the model
    const floorY = b.min.y - 1;
    this.floor.scale.set(span * 6, span * 6, 1);
    this.floor.position.y = floorY;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
    }
    const step = span > 2500 ? 500 : span > 1000 ? 250 : 100; // grid in round millimetres
    const divisions = Math.ceil((span * 3) / step);
    this.grid = new THREE.GridHelper(divisions * step, divisions, 0xb9bec5, 0xd7dbe0);
    this.grid.position.y = floorY;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(this.grid);

    // Light + shadow camera sized to the model
    this.sun.position.set(span * 0.8, span * 2, span * 1.2);
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
    const sphere = this.model.bounds.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)); // narrowest axis
    const dist = (sphere.radius * 1.25) / Math.sin(fit / 2);
    const dir = view === 'iso' && this.model.iso ? this.model.iso : VIEW_DIRECTIONS[view];
    const to = sphere.center.clone().addScaledVector(dir, dist);

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

  setDimensionsVisible(on: boolean) {
    if (this.model) this.model.dimensions.visible = on;
    this.container.classList.toggle('hide-dims', !on);
  }

  setInsulationVisible(on: boolean) {
    if (this.model) this.model.insulation.visible = on;
  }

  /** Cut the model in half to show the inside. Each model can choose its own cutting plane. */
  setSection(on: boolean) {
    this.sectionOn = on;
    const plane = this.model?.section ?? this.defaultSection;
    for (const m of Object.values(this.materials)) {
      m.clippingPlanes = on ? [plane] : [];
      m.clipShadows = on;
      m.needsUpdate = true;
    }
  }

  /** PNG data URL of the current view. */
  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}