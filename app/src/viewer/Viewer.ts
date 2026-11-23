import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadModelBuffer, loadModelFile, type LoadedModel } from "./loaders";
import { solveCCD } from "./ik";
import { applyWeightHeatmap, applyProblemColors, clearWeightHeatmap } from "./heatmap";
import { TEST_POSES, mirrorBone } from "./poses";
import {
  applyPoseSteps,
  captureRestFrames,
  measureSeverity,
  problemFraction,
  resetToRest,
  type RestFrame,
} from "./stress";

export interface ModelInfo {
  name: string;
  triangles: number;
  skinnedMeshes: number;
  bones: number;
  /** bones hidden by default (hair, skirt, helper/twist bones) when the rig is dense */
  secondaryBones: number;
}

export interface StressReport {
  id: string;
  label: string;
  /** fraction (0..1) of vertices whose edges stretch/squash badly in this pose */
  fraction: number;
  /** false when the rig lacks the bones this pose needs (non-humanoid) */
  applicable: boolean;
}

export interface ClipInfo {
  name: string;
  duration: number;
}

export type ViewerMode = "pose" | "edit";

export interface ViewerEvents {
  onSelectBone?: (name: string | null) => void;
  onHoverBone?: (name: string | null) => void;
  onInfo?: (info: ModelInfo | null) => void;
  onClips?: (clips: ClipInfo[]) => void;
}

/** Hair, skirt, cloth, helper/twist and leaf bones: real but noisy to edit by hand. */
const SECONDARY_BONE = new RegExp(
  "(hair|daimao|cloth|skirt|dress|cape|cloak|coat|scarf|sleeve|strap|ribbon|chain|cord|rope|tail|necklace|earring|pendant|" +
    "accessor|weapon|jiggle|dyn|phy|breast|bust|chestbone|twist|finger|thumb|_end$|^z[a-z]|^leg_[lr]_[a-z]$|^eye|^[a-z]+_\\d+_\\d+$)",
  "i",
);
export function isSecondaryBone(name: string): boolean {
  return SECONDARY_BONE.test(name);
}

/** Some FBX files import with opacity 0 (inverted TransparencyFactor) which makes the whole model invisible. */
function sanitizeMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat.opacity < 0.01) {
        mat.opacity = 1;
        mat.transparent = !!(mat as THREE.MeshStandardMaterial).alphaMap;
        mat.needsUpdate = true;
      }
    }
  });
}

const JOINT_COLOR = 0x35d0ff;
const JOINT_HOVER = 0xffd23f;
const JOINT_SELECTED = 0xff5a36;
const JOINT_EDIT = 0x7dff8a;

/** Three.js scene wrapper: loads a model, shows its skeleton, lets the user drag joints with IK or re-place them. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  readonly controls: OrbitControls;

  private modelRoot: THREE.Group | null = null; // wrapper holding the normalized model
  private inner: THREE.Object3D | null = null; // the model as loaded (original units)
  private skinned: THREE.SkinnedMesh[] = [];
  private bones: THREE.Bone[] = [];
  private boneByName = new Map<string, THREE.Bone>();
  /** standard humanoid name -> bone, for rigs whose own bone names differ (set via setBoneMap) */
  private stdBones: Map<string, THREE.Bone> | null = null;
  private basisQ = new THREE.Quaternion(); // character axes (left=+X, up=+Y, forward=+Z) -> world axes of this rig
  private restPose = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  private restFrames = new Map<THREE.Bone, RestFrame>();
  private joints: THREE.Mesh[] = [];
  private boneLines: THREE.LineSegments | null = null;
  private skeletonGroup = new THREE.Group();
  private jointRadius = 0.02;
  private secondary = new Set<THREE.Bone>();
  private showAllBones = false;

  private mode: ViewerMode = "pose";
  private mirror = true;
  private editPos = new Map<THREE.Bone, THREE.Vector3>(); // world-space joint positions while editing
  private centerX = 0;
  private ghosted: { mat: THREE.Material; transparent: boolean; opacity: number; depthWrite: boolean }[] = [];

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: THREE.Mesh | null = null;
  private selected: THREE.Mesh | null = null;
  private dragging: { bone: THREE.Bone; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;

  private stress = new Map<string, Float32Array[]>();

  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[] = [];
  private action: THREE.AnimationAction | null = null;
  private clock = new THREE.Clock();

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

    this.scene.add(new THREE.GridHelper(10, 20, 0x3a4152, 0x2a303d));
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
    this.setModel(await loadModelFile(file), file.name);
  }

  async loadBuffer(buffer: ArrayBuffer, ext: string, name: string): Promise<void> {
    this.setModel(await loadModelBuffer(buffer, ext), name);
  }

  resetPose(): void {
    this.stopClip();
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

  /** Dense game rigs (hair/skirt/helper bones) hide the secondary bones unless this is on. */
  setShowAllBones(on: boolean): void {
    this.showAllBones = on;
  }

  setIkDepth(n: number): void {
    this.ikDepth = Math.max(1, Math.round(n));
  }

  /** Debug/test helper: where a bone's joint marker is on screen (CSS px relative to the page). */
  boneScreenPos(name: string): { x: number; y: number; world: THREE.Vector3 } | null {
    const b = this.boneByName.get(name);
    if (!b) return null;
    const world = this.jointWorld(b, new THREE.Vector3());
    const ndc = world.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((ndc.x + 1) / 2) * r.width, y: r.top + ((1 - ndc.y) / 2) * r.height, world };
  }

  getBoneCount(): number {
    return this.bones.length;
  }

  /** Three.js sanitizes node names (spaces -> "_"); use the same rule to match engine-side names. */
  static sanitizeName(n: string): string {
    return n.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
  }

  /** Tell the viewer which of this rig's bones play the standard humanoid roles (stress poses use them). */
  setBoneMap(map: Record<string, string> | null): void {
    if (!map) {
      this.stdBones = null;
      this.basisQ.identity();
      return;
    }
    const m = new Map<string, THREE.Bone>();
    for (const [std, actual] of Object.entries(map)) {
      const b = this.boneByName.get(Viewer.sanitizeName(actual));
      if (b) m.set(std, b);
    }
    this.stdBones = m;
    // character axes from the rig itself, so a model facing another way (or Z-up converted) still poses correctly
    const wp = (n: string) => m.get(n)?.getWorldPosition(new THREE.Vector3());
    const hips = wp("Hips"), head = wp("Head"), lu = wp("LeftUpLeg"), ru = wp("RightUpLeg");
    if (hips && head && lu && ru) {
      const up = head.clone().sub(hips).normalize();
      const left = lu.clone().sub(ru);
      left.sub(up.clone().multiplyScalar(left.dot(up))).normalize();
      const fwd = new THREE.Vector3().crossVectors(left, up);
      this.basisQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
    } else this.basisQ.identity();
  }

  private poseBones(): Map<string, THREE.Bone> {
    return this.stdBones ?? this.boneByName;
  }

  hasHumanoidBones(): boolean {
    return this.boneByName.has("Hips") && this.boneByName.has("LeftArm") && this.boneByName.has("RightUpLeg");
  }

  // ----- joint editing (re-place joints, then the app re-skins) -----

  setMode(mode: ViewerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.clearSelection();
    if (mode === "edit") {
      this.resetPose();
      this.initEditPositions();
      this.ghostMesh(true);
    } else {
      this.ghostMesh(false);
    }
    this.joints.forEach((j) => this.paintJoint(j, mode === "edit" ? JOINT_EDIT : JOINT_COLOR));
  }

  getMode(): ViewerMode {
    return this.mode;
  }

  setMirror(on: boolean): void {
    this.mirror = on;
  }

  resetEdits(): void {
    this.initEditPositions();
  }

  /** Edited joint head positions in the model's own (file) coordinate space, keyed by bone name. */
  getEditedHeads(): Record<string, [number, number, number]> {
    const out: Record<string, [number, number, number]> = {};
    const v = new THREE.Vector3();
    for (const [bone, p] of this.editPos) {
      v.copy(p);
      (this.inner ?? this.modelRoot)?.worldToLocal(v);
      out[bone.name] = [v.x, v.y, v.z];
    }
    return out;
  }

  // ----- automatic stress test -----

  runStressTest(): StressReport[] {
    this.resetPose();
    this.stress.clear();
    const reports: StressReport[] = [];
    for (const pose of TEST_POSES) {
      const found = applyPoseSteps(this.poseBones(), this.restFrames, pose.steps, this.basisQ);
      const need = new Set(pose.steps.map((s) => s.bone)).size;
      // rigs with fewer spine bones can still do the spine poses with the ones they have
      const applicable = found === need || (found > 0 && (pose.id === "bend" || pose.id === "twist"));
      if (applicable) {
        const scores = this.skinned.map((m) => measureSeverity(m));
        this.stress.set(pose.id, scores);
        reports.push({ id: pose.id, label: pose.label, fraction: problemFraction(scores), applicable });
      } else {
        reports.push({ id: pose.id, label: pose.label, fraction: 0, applicable: false });
      }
      resetToRest(this.restFrames);
    }
    this.resetPose();
    return reports;
  }

  /** Shows a test pose with problem vertices tinted red. Pass null to go back to the rest pose. */
  showStressPose(id: string | null): void {
    this.skinned.forEach(clearWeightHeatmap);
    this.resetPose();
    if (!id) return;
    const pose = TEST_POSES.find((p) => p.id === id);
    const scores = this.stress.get(id);
    if (!pose || !scores) return;
    applyPoseSteps(this.poseBones(), this.restFrames, pose.steps, this.basisQ);
    this.skinned.forEach((m, i) => applyProblemColors(m, scores[i]));
  }

  // ----- animation clips (e.g. generated motion loaded from a GLB) -----

  getClips(): ClipInfo[] {
    return this.clips.map((c) => ({ name: c.name, duration: c.duration }));
  }

  playClip(index = 0): void {
    if (!this.inner || !this.clips[index]) return;
    this.skinned.forEach(clearWeightHeatmap);
    this.mixer?.stopAllAction();
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.action = this.mixer.clipAction(this.clips[index]);
    this.action.reset().play();
    this.clock.getDelta();
  }

  stopClip(): void {
    if (!this.action) return;
    this.mixer?.stopAllAction();
    this.action = null;
    this.mixer = null;
    for (const [bone, r] of this.restPose) {
      bone.position.copy(r.p);
      bone.quaternion.copy(r.q);
      bone.scale.copy(r.s);
    }
  }

  isPlaying(): boolean {
    return !!this.action;
  }

  clearSelection(): void {
    this.paintJoint(this.selected, this.mode === "edit" ? JOINT_EDIT : JOINT_COLOR);
    this.selected = null;
    this.skinned.forEach(clearWeightHeatmap);
    this.events.onSelectBone?.(null);
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
    this.stopClip();
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
    this.boneByName.clear();
    this.stdBones = null;
    this.basisQ.identity();
    this.secondary.clear();
    this.skinned = [];
    this.restPose.clear();
    this.restFrames.clear();
    this.editPos.clear();
    this.ghosted = [];
    this.stress.clear();
    this.clips = [];
    this.mode = "pose";
    this.hovered = this.selected = null;
    this.dragging = null;
    this.modelRoot = null;
    this.inner = null;
  }

  private setModel(loaded: LoadedModel, name: string): void {
    this.clearModel();
    const object = loaded.object;
    this.clips = loaded.animations;
    this.inner = object;

    // Normalize: scale so the largest side is ~2 units, feet on the ground, centered on X/Z.
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

    sanitizeMaterials(wrapper);
    if (this.bones.length > 100) for (const b of this.bones) if (isSecondaryBone(b.name)) this.secondary.add(b);

    for (const b of this.bones) {
      this.restPose.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
      if (b.name) this.boneByName.set(b.name, b);
    }
    this.restFrames = captureRestFrames(this.bones);
    const hips = this.boneByName.get("Hips") ?? this.stdBones?.get("Hips");
    this.centerX = hips ? hips.getWorldPosition(new THREE.Vector3()).x : 0;

    this.buildSkeletonOverlay(size.y * scale);
    this.frame(new THREE.Box3().setFromObject(wrapper));
    this.events.onSelectBone?.(null);
    this.events.onClips?.(this.getClips());
    this.events.onInfo?.({
      name,
      triangles: Math.round(triangles),
      skinnedMeshes: this.skinned.length,
      bones: this.bones.length,
      secondaryBones: this.secondary.size,
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

  private initEditPositions(): void {
    this.modelRoot?.updateMatrixWorld(true);
    this.editPos.clear();
    for (const b of this.bones) this.editPos.set(b, b.getWorldPosition(new THREE.Vector3()));
  }

  private ghostMesh(on: boolean): void {
    if (on) {
      this.ghosted = [];
      for (const m of this.skinned) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          this.ghosted.push({ mat, transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite });
          mat.transparent = true;
          mat.opacity = 0.4;
          mat.depthWrite = false;
          mat.needsUpdate = true;
        }
      }
    } else {
      for (const g of this.ghosted) {
        g.mat.transparent = g.transparent;
        g.mat.opacity = g.opacity;
        g.mat.depthWrite = g.depthWrite;
        g.mat.needsUpdate = true;
      }
      this.ghosted = [];
    }
  }

  private jointWorld(bone: THREE.Bone, out: THREE.Vector3): THREE.Vector3 {
    if (this.mode === "edit") {
      const p = this.editPos.get(bone);
      if (p) return out.copy(p);
    }
    return bone.getWorldPosition(out);
  }

  private syncSkeletonOverlay(): void {
    if (!this.boneLines) return;
    const pos = this.boneLines.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    this.bones.forEach((bone, i) => {
      this.jointWorld(bone, v);
      const visible = this.showAllBones || !this.secondary.has(bone);
      this.joints[i].visible = visible;
      this.joints[i].position.copy(v);
      const parent = bone.parent as THREE.Bone | null;
      if (visible && parent && parent.isBone) this.jointWorld(parent, p);
      else p.copy(v); // hidden bones and roots draw no line
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
    const hits = this.raycaster.intersectObjects(this.joints.filter((j) => j.visible), false);
    return (hits[0]?.object as THREE.Mesh) ?? null;
  }

  private paintJoint(j: THREE.Mesh | null, color: number): void {
    if (j) (j.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  private baseColor(): number {
    return this.mode === "edit" ? JOINT_EDIT : JOINT_COLOR;
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (this.dragging) {
      this.dragTo();
      return;
    }
    const hit = this.pickJoint();
    if (hit !== this.hovered) {
      if (this.hovered !== this.selected) this.paintJoint(this.hovered, this.baseColor());
      this.hovered = hit;
      if (hit && hit !== this.selected) this.paintJoint(hit, JOINT_HOVER);
      this.renderer.domElement.style.cursor = hit ? "grab" : "";
      this.events.onHoverBone?.(hit ? (hit.userData.bone as THREE.Bone).name || null : null);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.action) return; // no joint dragging while a clip plays
    this.setPointer(e);
    const hit = this.pickJoint();
    if (!hit) return;

    this.paintJoint(this.selected, this.baseColor());
    this.selected = hit;
    this.paintJoint(hit, JOINT_SELECTED);
    const bone = hit.userData.bone as THREE.Bone;
    this.events.onSelectBone?.(bone.name || `bone_${this.bones.indexOf(bone)}`);
    if (this.mode === "pose") this.showHeatmap(bone);

    const world = this.jointWorld(bone, new THREE.Vector3());
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

    if (this.mode === "edit") {
      this.editPos.get(bone)?.copy(p);
      if (this.mirror) {
        const other = mirrorBone(bone.name, (n) => this.boneByName.has(n));
        const ob = other ? this.boneByName.get(other) : undefined;
        if (ob) this.editPos.get(ob)?.set(2 * this.centerX - p.x, p.y, p.z);
      }
      return;
    }

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
    if (this.mixer && this.action) this.mixer.update(this.clock.getDelta());
    this.modelRoot?.updateMatrixWorld(true);
    this.syncSkeletonOverlay();
    this.renderer.render(this.scene, this.camera);
  };
}
