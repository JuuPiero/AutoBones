import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SkeletonBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  tag: string;
}
export interface SkeletonData {
  kind: string;
  bones: SkeletonBone[];
  warnings: string[];
  meta: Record<string, unknown>;
}
export interface RigResult {
  output: string;
  skeleton: SkeletonData;
  stats: Record<string, number>;
}

export const MODEL_EXTENSIONS = ["glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "blend", "usd", "usda", "usdc", "usdz", "abc"];
export const EXPORT_FORMATS = [
  { ext: "glb", label: "GLB (web, Unity, Godot, Blender)" },
  { ext: "fbx", label: "FBX (Maya, chung)" },
  { ext: "fbx:unity", label: "FBX cho Unity" },
  { ext: "fbx:unreal", label: "FBX cho Unreal" },
  { ext: "usdc", label: "USD (Omniverse, Apple)" },
  { ext: "obj", label: "OBJ (chỉ mesh, không xương)" },
  { ext: "stl", label: "STL (chỉ mesh, in 3D)" },
  { ext: "ply", label: "PLY (chỉ mesh)" },
  { ext: "blend", label: "Blender (.blend)" },
];

export function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}
export function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export async function pickModel(): Promise<string | null> {
  const r = await open({
    multiple: false,
    filters: [{ name: "Model 3D", extensions: MODEL_EXTENSIONS }],
  });
  return typeof r === "string" ? r : null;
}

export async function pickBvh(): Promise<string | null> {
  const r = await open({ multiple: false, filters: [{ name: "Chuyển động BVH", extensions: ["bvh"] }] });
  return typeof r === "string" ? r : null;
}

export async function pickSavePath(defaultName: string, ext: string): Promise<string | null> {
  return await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
}

export async function readFileBytes(path: string): Promise<ArrayBuffer> {
  return (await invoke("read_file", { path })) as ArrayBuffer;
}

export async function writeFileBytes(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
  await invoke("write_file", data, { headers: { path: encodeURIComponent(path) } });
}

export async function tempPath(name: string): Promise<string> {
  return (await invoke("temp_path", { name })) as string;
}

export async function onProgress(cb: (frac: number, msg: string) => void): Promise<() => void> {
  return await listen<{ frac: number; msg: string }>("engine-progress", (e) => cb(e.payload.frac, e.payload.msg));
}

async function runEngine<T>(args: string[]): Promise<T> {
  const json = (await invoke("run_engine", { args })) as string;
  return JSON.parse(json) as T;
}

export const engine = {
  rig: (input: string, output: string, kind = "humanoid", replaceSkeleton = false, fingers = false) =>
    runEngine<RigResult>([
      "rig", input, output, "--kind", kind,
      ...(replaceSkeleton ? ["--replace-skeleton"] : []),
      ...(fingers ? ["--fingers"] : []),
    ]),
  reskin: (input: string, skeletonJson: string, output: string) =>
    runEngine<RigResult>(["reskin", input, skeletonJson, output]),
  prepare: (input: string, output: string) =>
    runEngine<{ output: string; skeleton: SkeletonData | null }>(["prepare", input, output]),
  editRig: (input: string, editsJson: string, output: string) =>
    runEngine<{ output: string }>(["edit-rig", input, editsJson, output]),
  smooth: (input: string, output: string, iterations = 3) =>
    runEngine<{ output: string }>(["smooth", input, output, "--iterations", String(iterations)]),
  motion: (rigged: string, skeletonJson: string, prompt: string, seconds: number, output: string, inPlace = false, loop = false) =>
    runEngine<{ output: string }>([
      "motion", rigged, output, "--skeleton", skeletonJson, "--prompt", prompt, "--seconds", String(seconds),
      ...(inPlace ? ["--in-place"] : []),
      ...(loop ? ["--loop"] : []),
    ]),
  motionBvh: (rigged: string, skeletonJson: string, bvh: string, output: string, inPlace = false, loop = false) =>
    runEngine<{ output: string }>(["motion-bvh", rigged, bvh, output, "--skeleton", skeletonJson, ...(inPlace ? ["--in-place"] : []), ...(loop ? ["--loop"] : [])]),
  convert: (input: string, output: string, preset = "default") =>
    runEngine<{ output: string }>(["convert", input, output, ...(preset !== "default" ? ["--preset", preset] : [])]),
  check: () => runEngine<{ blender: string }>(["check"]),
};
