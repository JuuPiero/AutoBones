import type { SkeletonData } from "./engine";

type V3 = [number, number, number];

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Builds a new skeleton from user-moved joint heads.
 * A bone's tail follows the single child whose head used to coincide with that tail (so chains stay connected);
 * otherwise the tail keeps its original offset from the head (end bones, e.g. Hips/Head/Hand).
 */
export function applyHeadEdits(skel: SkeletonData, heads: Record<string, V3>): SkeletonData {
  const eps = 1e-4 * Math.max(1, Number(skel.meta?.height ?? 1));
  const newHead = (name: string, orig: V3): V3 => heads[name] ?? orig;

  const bones = skel.bones.map((b) => {
    const head = newHead(b.name, b.head);
    const child = skel.bones.find((c) => c.parent === b.name && dist(c.head, b.tail) < eps);
    let tail: V3;
    if (child) {
      tail = newHead(child.name, child.head);
    } else {
      tail = [head[0] + (b.tail[0] - b.head[0]), head[1] + (b.tail[1] - b.head[1]), head[2] + (b.tail[2] - b.head[2])];
    }
    return { ...b, head, tail };
  });
  return { ...skel, bones };
}
