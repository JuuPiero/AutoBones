import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

/** Formats the viewer reads directly. Others (blend, usd, abc...) go through the Blender converter. */
export const NATIVE_EXTENSIONS = ["glb", "gltf", "fbx", "obj", "stl", "ply", "dae"] as const;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function isNativeFormat(name: string): boolean {
  return (NATIVE_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

function meshFromGeometry(geometry: THREE.BufferGeometry): THREE.Object3D {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const hasColor = !!geometry.getAttribute("color");
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xbfc7d5, roughness: 0.6, metalness: 0.05, vertexColors: hasColor }),
  );
}

export async function loadModelBuffer(buffer: ArrayBuffer, ext: string): Promise<LoadedModel> {
  switch (ext) {
    case "glb":
    case "gltf": {
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return { object: gltf.scene, animations: gltf.animations };
    }
    case "fbx": {
      const o = new FBXLoader().parse(buffer, "");
      return { object: o, animations: o.animations ?? [] };
    }
    case "obj":
      return { object: new OBJLoader().parse(new TextDecoder().decode(buffer)), animations: [] };
    case "stl":
      return { object: meshFromGeometry(new STLLoader().parse(buffer)), animations: [] };
    case "ply":
      return { object: meshFromGeometry(new PLYLoader().parse(buffer)), animations: [] };
    case "dae": {
      const c = new ColladaLoader().parse(new TextDecoder().decode(buffer), "");
      return { object: c.scene, animations: (c as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [] };
    }
    default:
      throw new Error(`Định dạng .${ext} chưa đọc trực tiếp được (sẽ qua bộ chuyển đổi Blender).`);
  }
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  return loadModelBuffer(await file.arrayBuffer(), extensionOf(file.name));
}
