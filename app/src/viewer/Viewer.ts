import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadModelFile } from "./loaders";
import { solveCCD } from "./ik";
import { applyWeightHeatmap, clearWeightHeatmap } from "./heatmap";

export interface ModelInfo {
  name: string;
  triangles: number;
  skinnedMeshes: number;
  bones: number;
}

export interface ViewerEvents {
  onSelectBone?: (name: string | null) => void;
  onInfo?: (info: ModelInfo | null) => void;
}

const JOINT_COLOR = 0x35d0ff;
const JOINT_HOVER = 0xffd23f;
const JOINT_SELECTED = 0xff5a36;

/** Three.js scene wrapper: loads a model, shows its skeleton, lets the user drag joints with IK. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  readonly controls: OrbitControls;

  private modelRoot: THREE.Group | null = null; // wrapper holding normalized model
  private skinned: THREE.SkinnedMesh[] = [];
  private bones: THREE.Bone[] = [];
  private restPose = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  private joints: THREE.Mesh[] = [];
  private boneLines: THREE.LineSegments | null = null;
  private skeletonGroup = new THREE.Group();
  private jointRadius = 0.02;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: THREE.Mesh | null = null;
  private selected: THREE.Mesh | null = null;
  private dragging: { bone: THREE.Bone; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;

  private ikDepth = 3;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement, private events: ViewerEvents = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1b1f27);
    this.camera.position.set(1.8, 1.4, 3.2);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3040, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    this.scene.add(hemi, key);

    const grid = new THREE.GridHelper(10, 20, 0x3a4152, 0x2a303d);
    this.scene.add(grid);
    this.scene.add(this.skeletonGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1, 0);

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  // ---------- public API ----------

  async loadFile(file: File): Promise<void> {
    const object = await loadModelFile(file);
    this.setModel(object, file.name);
  }

  resetPose(): void {
    for (const [bone, r] of this.restPose) {
      bone.position.copy(r.p);
      bone.quaternion.copy(r.q);
      bone.scale.copy(r.s);
    }
    this.modelRoot?.updateMatrixWorld(true);
  }

  setSkeletonVisible(v: boolean): void {
    this.skeletonGroup.visible = v;
  }

  setIkDepth(n: number): void {
    this.ikDepth = Math.max(1, Math.round(n));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.controls.dispose();
    this.clearModel();
    this.renderer.dispose();
    el.remove();
  }

  // ---------- model setup ----------

  private clearModel(): void {
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat?.dispose());
        }
      });
    }
    for (const j of this.joints) {
      j.geometry.dispose();
      (j.material as THREE.Material).dispose();
    }
    this.skeletonGroup.clear();
    this.boneLines?.geometry.dispose();
    this.boneLines = null;
    this.joints = [];
    this.bones = [];
    this.skinned = [];
    this.restPose.clear();
    this.hovered = this.selected = null;
    this.dragging = null;
    this.modelRoot = null;
  }

  private setModel(object: THREE.Object3D, name: string): void {
    this.clearModel();

    // Normalize: scale so height ~ 2 units, feet on the ground, centered on X/Z.
    const wrapper = new THREE.Group();
    wrapper.add(object);
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2 / maxDim;
    wrapper.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    wrapper.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    wrapper.updateMatrixWorld(true);
    this.scene.add(wrapper);
    this.modelRoot = wrapper;

    let triangles = 0;
    wrapper.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false; // skinned bounds are unreliable after posing
        const idx = m.geometry.index;
        triangles += idx ? idx.count / 3 : (m.geometry.attributes.position?.count ?? 0) / 3;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.skinned.push(o as THREE.SkinnedMesh);
      }
      if ((o as THREE.Bone).isBone) this.bones.push(o as THREE.Bone);
    });

    for (const b of this.bones) {
      this.restPose.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
    }

    this.buildSkeletonOverlay(size.y * scale);
    this.frame(new THREE.Box3().setFromObject(wrapper));
    this.events.onSelectBone?.(null);
    this.events.onInfo?.({
      name,
      triangles: Math.round(triangles),
      skinnedMeshes: this.skinned.length,
      bones: this.bones.length,
    });
  }

  private frame(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.y, size.x, size.z) * 1.6 + 0.5;
    this.camera.position.copy(center).add(new THREE.Vector3(0.6, 0.35, 1).normalize().multiplyScalar(dist));
    this.controls.target.copy(center);
    this.controls.update();
  }

  private buildSkeletonOverlay(modelHeight: number): void {
    this.jointRadius = Math.max(0.008, modelHeight * 0.012);
    const geo = new THREE.SphereGeometry(this.jointRadius, 16, 12);
    for (const bone of this.bones) {
      const mat = new THREE.MeshBasicMaterial({ color: JOINT_COLOR, depthTest: false, transparent: true });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 10;
      m.userData.bone = bone;
      this.joints.push(m);
      this.skeletonGroup.add(m);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.bones.length * 6), 3));
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x8fe3ff, depthTest: false, transparent: true, opacity: 0.8 }),
    );
    lines.renderOrder = 9;
    lines.frustumCulled = false;
    this.boneLines = lines;
    this.skeletonGroup.add(lines);
  }

  private syncSkeletonOverlay(): void {
    if (!this.boneLines) return;
    const pos = this.boneLines.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    this.bones.forEach((bone, i) => {
      bone.getWorldPosition(v);
      this.joints[i].position.copy(v);
      const parent = bone.parent as THREE.Bone | null;
      if (parent && parent.isBone) parent.getWorldPosition(p);
      else p.copy(v);
      pos.setXYZ(i * 2, p.x, p.y, p.z);
      pos.setXYZ(i * 2 + 1, v.x, v.y, v.z);
    });
    pos.needsUpdate = true;
  }

  // ---------- interaction ----------

  private setPointer(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickJoint(): THREE.Mesh | null {
    if (!this.skeletonGroup.visible) return null;
    const hits = this.raycaster.intersectObjects(this.joints, false);
    return (hits[0]?.object as THREE.Mesh) ?? null;
  }

  private paintJoint(j: THREE.Mesh | null, color: number): void {
    if (j) (j.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (this.dragging) {
      this.dragTo();
      return;
    }
    const hit = this.pickJoint();
    if (hit !== this.hovered) {
      if (this.hovered !== this.selected) this.paintJoint(this.hovered, JOINT_COLOR);
      this.hovered = hit;
      if (hit && hit !== this.selected) this.paintJoint(hit, JOINT_HOVER);
      this.renderer.domElement.style.cursor = hit ? "grab" : "";
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.setPointer(e);
    const hit = this.pickJoint();
    if (!hit) return;

    this.paintJoint(this.selected, JOINT_COLOR);
    this.selected = hit;
    this.paintJoint(hit, JOINT_SELECTED);
    const bone = hit.userData.bone as THREE.Bone;
    this.events.onSelectBone?.(bone.name || `bone_${this.bones.indexOf(bone)}`);
    this.showHeatmap(bone);

    const world = bone.getWorldPosition(new THREE.Vector3());
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
    const hitPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, hitPoint);
    this.dragging = { bone, plane, offset: world.clone().sub(hitPoint) };
    this.controls.enabled = false; // stop orbiting while dragging a joint
    this.renderer.domElement.style.cursor = "grabbing";
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = this.hovered ? "grab" : "";
  };

  private dragTo(): void {
    const d = this.dragging;
    if (!d) return;
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
    p.add(d.offset);

    const { bone } = d;
    const parent = bone.parent as THREE.Bone | null;
    if (!parent || !parent.isBone) {
      // Root joint: translate the whole rig.
      const local = bone.parent ? bone.parent.worldToLocal(p.clone()) : p.clone();
      bone.position.copy(local);
      bone.updateMatrixWorld(true);
      return;
    }
    const chain: THREE.Bone[] = [];
    let cur: THREE.Bone | null = parent;
    while (cur && cur.isBone && chain.length < this.ikDepth) {
      chain.push(cur);
      cur = cur.parent as THREE.Bone | null;
    }
    solveCCD(bone, chain, p);
  }

  private showHeatmap(bone: THREE.Bone): void {
    for (const m of this.skinned) {
      // skinIndex refers to the mesh's own skeleton bone order
      const local = m.skeleton.bones.indexOf(bone);
      if (local >= 0) applyWeightHeatmap(m, local);
      else clearWeightHeatmap(m);
    }
  }

  clearSelection(): void {
    this.paintJoint(this.selected, JOINT_COLOR);
    this.selected = null;
    this.skinned.forEach(clearWeightHeatmap);
    this.events.onSelectBone?.(null);
  }

  // ---------- render loop ----------

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.modelRoot?.updateMatrixWorld(true);
    this.syncSkeletonOverlay();
    this.renderer.render(this.scene, this.camera);
  };
}
