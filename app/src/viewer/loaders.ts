import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

/** Formats the browser can read directly. Others (blend, usd, 3ds...) go through the Blender converter. */
export const NATIVE_EXTENSIONS = ["glb", "gltf", "fbx", "obj", "stl", "ply", "dae"] as const;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function isNativeFormat(name: string): boolean {
  return (NATIVE_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

function meshFromGeometry(geometry: THREE.BufferGeometry): THREE.Object3D {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const hasColor = !!geometry.getAttribute("color");
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xbfc7d5, roughness: 0.6, metalness: 0.05, vertexColors: hasColor }),
  );
}

export async function loadModelFile(file: File): Promise<THREE.Object3D> {
  const ext = extensionOf(file.name);
  const buffer = await file.arrayBuffer();

  switch (ext) {
    case "glb":
    case "gltf": {
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return gltf.scene;
    }
    case "fbx":
      return new FBXLoader().parse(buffer, "");
    case "obj":
      return new OBJLoader().parse(new TextDecoder().decode(buffer));
    case "stl":
      return meshFromGeometry(new STLLoader().parse(buffer));
    case "ply":
      return meshFromGeometry(new PLYLoader().parse(buffer));
    case "dae":
      return new ColladaLoader().parse(new TextDecoder().decode(buffer), "").scene;
    default:
      throw new Error(`Định dạng .${ext} chưa đọc trực tiếp được (sẽ qua bộ chuyển đổi Blender).`);
  }
}
