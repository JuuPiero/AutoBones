import * as THREE from "three";

const original = new WeakMap<THREE.SkinnedMesh, THREE.Material | THREE.Material[]>();
const heatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

function ramp(t: number, out: THREE.Color): void {
  // 0 = blue, 0.5 = green, 1 = red
  t = Math.min(1, Math.max(0, t));
  if (t < 0.5) out.setRGB(0.1, t * 2, 1 - t * 2);
  else out.setRGB((t - 0.5) * 2, 1 - (t - 0.5) * 2, 0.0);
}

function ensureColorAttr(g: THREE.BufferGeometry, count: number): THREE.BufferAttribute {
  let color = g.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color || color.count !== count || color.itemSize !== 3) {
    color = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    g.setAttribute("color", color);
  }
  return color;
}

function useHeatMaterial(mesh: THREE.SkinnedMesh): void {
  if (!original.has(mesh)) original.set(mesh, mesh.material);
  mesh.material = heatMat;
}

/** Color the mesh by how strongly vertices are influenced by the bone at `boneIndex` (in the mesh's skeleton). */
export function applyWeightHeatmap(mesh: THREE.SkinnedMesh, boneIndex: number): void {
  const g = mesh.geometry;
  const skinIndex = g.getAttribute("skinIndex");
  const skinWeight = g.getAttribute("skinWeight");
  const pos = g.getAttribute("position");
  if (!skinIndex || !skinWeight || !pos) return;

  const color = ensureColorAttr(g, pos.count);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      if (skinIndex.getComponent(i, k) === boneIndex) w += skinWeight.getComponent(i, k);
    }
    ramp(w, c);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  color.needsUpdate = true;
  useHeatMaterial(mesh);
}

/** Paint a per-vertex problem score: grey = fine, orange->red = bad (score 0..1). */
export function applyProblemColors(mesh: THREE.SkinnedMesh, scores: Float32Array): void {
  const pos = mesh.geometry.getAttribute("position");
  const color = ensureColorAttr(mesh.geometry, pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, scores[i]));
    // grey (0.72) -> red (1,0.1,0.1)
    color.setXYZ(i, 0.72 + 0.28 * t, 0.72 - 0.62 * t, 0.72 - 0.62 * t);
  }
  color.needsUpdate = true;
  useHeatMaterial(mesh);
}

export function clearWeightHeatmap(mesh: THREE.SkinnedMesh): void {
  const m = original.get(mesh);
  if (m) {
    mesh.material = m;
    original.delete(mesh);
  }
}
