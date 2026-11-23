import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Viewer, isSecondaryBone, type ClipInfo, type ModelInfo, type StressReport, type ViewerMode } from "./viewer/Viewer";
import { isNativeFormat, NATIVE_EXTENSIONS } from "./viewer/loaders";
import {
  baseName,
  engine,
  EXPORT_FORMATS,
  extOf,
  isTauri,
  MODEL_EXTENSIONS,
  onProgress,
  pickBvh,
  pickModel,
  pickSavePath,
  readFileBytes,
  tempPath,
  writeFileBytes,
  type SkeletonData,
} from "./engine";
import { applyHeadEdits } from "./skeletonEdit";
import "./App.css";

const STD_BONES = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
];
const REQUIRED_STD = ["Hips", "Neck", "Head", ...["Left", "Right"].flatMap((s) => ["Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot"].map((p) => s + p))];

interface Busy {
  label: string;
  frac: number;
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const browserFileRef = useRef<HTMLInputElement>(null);
  const tauri = isTauri();

  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [playing, setPlaying] = useState(false);

  const [sourcePath, setSourcePath] = useState<string | null>(null); // what the user opened (input to rig)
  const [rigPath, setRigPath] = useState<string | null>(null); // current rigged GLB on disk
  const [skeleton, setSkeleton] = useState<SkeletonData | null>(null);

  const [mode, setMode] = useState<ViewerMode>("pose");
  const [mirror, setMirror] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showAllBones, setShowAllBones] = useState(false);
  const [ikDepth, setIkDepth] = useState(3);
  const [stress, setStress] = useState<StressReport[] | null>(null);
  const [stressShown, setStressShown] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(4);
  const [exportExt, setExportExt] = useState("glb");

  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const hasBones = (info?.bones ?? 0) > 0;
  const canRig = tauri && !!sourcePath && !hasBones;
  const foreign = skeleton?.kind === "foreign";
  const boneMap = (skeleton?.meta?.bone_map ?? null) as Record<string, string> | null;
  const missingStd = foreign && boneMap ? REQUIRED_STD.filter((r) => !boneMap[r]) : [];
  const canReplace = tauri && !!sourcePath && hasBones && (!skeleton || foreign);
  const rigged = hasBones && !!rigPath;

  // ----- viewer lifecycle -----
  useEffect(() => {
    if (!hostRef.current) return;
    const v = new Viewer(hostRef.current, {
      onInfo: setInfo,
      onSelectBone: setSelected,
      onHoverBone: setHovered,
      onClips: setClips,
    });
    viewerRef.current = v;
    if (import.meta.env.DEV) (window as unknown as { __viewer: Viewer }).__viewer = v; // for UI smoke tests
    return () => {
      v.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tauri) return;
    let off: (() => void) | undefined;
    void onProgress((frac, label) => setBusy((b) => (b ? { label, frac } : b))).then((u) => (off = u));
    return () => off?.();
  }, [tauri]);

  const resetSession = () => {
    setShowAllBones(false);
    setStress(null);
    setStressShown(null);
    setMode("pose");
    setPlaying(false);
    setError(null);
    setNotice(null);
  };

  const showError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy({ label, frac: 0 });
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }, []);

  // ----- open -----
  /** Load a GLB produced by the engine (keeps the user's file name) and tell the viewer how bones map to humanoid roles. */
  const loadWorking = async (path: string, name: string, map: Record<string, string> | null) => {
    const bytes = await readFileBytes(path);
    await viewerRef.current?.loadBuffer(bytes, "glb", name);
    viewerRef.current?.setBoneMap(map);
    setRigPath(path);
    setStress(null);
    setStressShown(null);
    setMode("pose");
  };

  /** A model that already has a skeleton: export a clean working copy and map its bones to the standard humanoid. */
  const prepareForeign = async (path: string) => {
    setBusy({ label: "Phân tích xương gốc của model", frac: 0.1 });
    const out = await tempPath(`working_${Date.now()}.glb`);
    const res = await engine.prepare(path, out);
    if (!res.skeleton) return;
    await loadWorking(res.output, baseName(path), (res.skeleton.meta.bone_map ?? null) as Record<string, string> | null);
    setSkeleton(res.skeleton);
  };

  const openPath = useCallback(
    (path: string) =>
      run("Đang mở model", async () => {
        resetSession();
        const ext = extOf(path);
        let loadPath = path;
        if (!isNativeFormat(path)) {
          loadPath = await tempPath(`converted_${Date.now()}.glb`);
          setBusy({ label: `Chuyển .${ext} bằng Blender`, frac: 0.1 });
          await engine.convert(path, loadPath);
        }
        const bytes = await readFileBytes(loadPath);
        await viewerRef.current?.loadBuffer(bytes, extOf(loadPath), baseName(path));
        setSourcePath(path);
        setRigPath(null);
        setSkeleton(null);
        if (viewerRef.current && viewerRef.current.getBoneCount() > 0 && ["fbx", "glb", "gltf", "obj"].includes(ext)) {
          await prepareForeign(path);
        }
      }),
    [run],
  );

  // Models that already contain a skeleton are usable for testing/animation directly.
  useEffect(() => {
    if (info && info.bones > 0 && sourcePath && !rigPath) setRigPath(isNativeFormat(sourcePath) && extOf(sourcePath) === "glb" ? sourcePath : null);
  }, [info, sourcePath, rigPath]);

  const openDialog = async () => {
    if (!tauri) return browserFileRef.current?.click();
    const p = await pickModel();
    if (p) void openPath(p);
  };

  useEffect(() => {
    if (!tauri) return;
    let off: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const t = e.payload.type;
        if (t === "over" || t === "enter") setDropping(true);
        else if (t === "leave") setDropping(false);
        else if (t === "drop") {
          setDropping(false);
          const p = e.payload.paths?.[0];
          if (p && MODEL_EXTENSIONS.includes(extOf(p))) void openPath(p);
          else if (p) setError(`Chưa hỗ trợ .${extOf(p)}`);
        }
      })
      .then((u) => (off = u));
    return () => off?.();
  }, [tauri, openPath]);

  const openBrowserFile = async (file: File) => {
    await run("Đang mở model", async () => {
      resetSession();
      if (!isNativeFormat(file.name)) throw new Error(`Bản trình duyệt chỉ đọc: ${NATIVE_EXTENSIONS.join(", ")}`);
      await viewerRef.current?.loadFile(file);
    });
  };

  // ----- rig / edit / smooth -----
  const loadRigged = async (path: string, map: Record<string, string> | null = null) =>
    loadWorking(path, baseName(sourcePath ?? path), map);

  const autoRig = (replaceSkeleton = false) =>
    run("Đang phân tích model", async () => {
      if (!sourcePath) return;
      const out = await tempPath(`rigged_${Date.now()}.glb`);
      const res = await engine.rig(sourcePath, out, "humanoid", replaceSkeleton);
      await loadRigged(res.output);
      setSkeleton(res.skeleton);
      if (res.skeleton.warnings.length) setNotice(res.skeleton.warnings.join(" "));
    });

  const applyEdit = () =>
    run(foreign ? "Dời khớp trên rig gốc" : "Tính lại skin weight", async () => {
      const v = viewerRef.current;
      if (!v || !skeleton || !sourcePath) return;
      if (foreign) {
        // keep the artist's weights: only move pivots of the bones the user dragged
        const original = new Map(skeleton.bones.map((b) => [b.name, b]));
        const bySan = new Map(skeleton.bones.map((b) => [Viewer.sanitizeName(b.name), b.name]));
        const changed: Record<string, [number, number, number]> = {};
        for (const [k, h] of Object.entries(v.getEditedHeads())) {
          const name = bySan.get(k);
          const o = name ? original.get(name) : undefined;
          if (name && o && Math.hypot(h[0] - o.head[0], h[1] - o.head[1], h[2] - o.head[2]) > 1e-4) changed[name] = h;
        }
        if (!Object.keys(changed).length) {
          setNotice("Chưa có khớp nào được dời.");
          v.setMode("pose");
          setMode("pose");
          return;
        }
        const edited = applyHeadEdits(skeleton, changed);
        const moved = edited.bones.filter(
          (b, i) =>
            b.head.some((x, k) => Math.abs(x - skeleton.bones[i].head[k]) > 1e-6) ||
            b.tail.some((x, k) => Math.abs(x - skeleton.bones[i].tail[k]) > 1e-6),
        );
        const editsPath = await tempPath(`edits_${Date.now()}.json`);
        await writeFileBytes(
          editsPath,
          new TextEncoder().encode(JSON.stringify({ bones: moved.map((b) => ({ name: b.name, head: b.head, tail: b.tail })) })),
        );
        const out = await tempPath(`working_${Date.now()}.glb`);
        const res = await engine.editRig(rigPath ?? sourcePath, editsPath, out);
        await loadRigged(res.output, boneMap);
        setSkeleton(edited);
        setNotice(`Đã dời ${moved.length} xương. Mesh và weight gốc được giữ nguyên.`);
        return;
      }
      const edited = applyHeadEdits(skeleton, v.getEditedHeads());
      const skelPath = await tempPath(`skeleton_${Date.now()}.json`);
      await writeFileBytes(skelPath, new TextEncoder().encode(JSON.stringify(edited)));
      const out = await tempPath(`rigged_${Date.now()}.glb`);
      const res = await engine.reskin(sourcePath, skelPath, out);
      await loadRigged(res.output);
      setSkeleton(res.skeleton);
    });

  const smoothWeights = () =>
    run("Làm mượt weight", async () => {
      if (!rigPath) return;
      const out = await tempPath(`smooth_${Date.now()}.glb`);
      const res = await engine.smooth(rigPath, out, 3);
      await loadRigged(res.output);
    });

  const changeMode = (m: ViewerMode) => {
    setMode(m);
    viewerRef.current?.setMode(m);
  };

  const runStress = () =>
    run("Đang kiểm tra các tư thế", async () => {
      await new Promise((r) => setTimeout(r, 30)); // let the busy overlay paint first
      const rep = viewerRef.current?.runStressTest() ?? [];
      setStress(rep);
      setStressShown(null);
    });

  const showStress = (id: string | null) => {
    setStressShown(id);
    viewerRef.current?.showStressPose(id);
  };

  // ----- phase 2: motion -----
  const writeSkeleton = async () => {
    const p = await tempPath(`skeleton_${Date.now()}.json`);
    await writeFileBytes(p, new TextEncoder().encode(JSON.stringify(skeleton)));
    return p;
  };

  const playResult = async (path: string) => {
    await loadRigged(path);
    viewerRef.current?.playClip(0);
    setPlaying(true);
  };

  const generateMotion = () =>
    run("Đang tạo animation", async () => {
      if (!rigPath || !skeleton) return;
      const out = await tempPath(`motion_${Date.now()}.glb`);
      const res = await engine.motion(rigPath, await writeSkeleton(), prompt, seconds, out);
      await playResult(res.output);
    });

  const importBvh = async () => {
    const bvh = await pickBvh();
    if (!bvh) return;
    await run("Đang áp chuyển động", async () => {
      if (!rigPath || !skeleton) return;
      const out = await tempPath(`motion_${Date.now()}.glb`);
      const res = await engine.motionBvh(rigPath, await writeSkeleton(), bvh, out);
      await playResult(res.output);
    });
  };

  const togglePlay = () => {
    const v = viewerRef.current;
    if (!v) return;
    if (v.isPlaying()) {
      v.stopClip();
      setPlaying(false);
    } else {
      v.playClip(0);
      setPlaying(true);
    }
  };

  // ----- export -----
  const doExport = () =>
    run("Đang xuất file", async () => {
      const src = rigPath ?? sourcePath;
      if (!src) return;
      const stem = baseName(sourcePath ?? src).replace(/\.[^.]+$/, "");
      const dest = await pickSavePath(`${stem}_rigged.${exportExt}`, exportExt);
      if (!dest) return;
      if (exportExt === "glb" && extOf(src) === "glb") {
        await writeFileBytes(dest, await readFileBytes(src));
      } else {
        await engine.convert(src, dest);
      }
      const meshOnly = ["obj", "stl", "ply"].includes(exportExt);
      setNotice(`Đã xuất: ${dest}${meshOnly ? " (định dạng này không chứa xương)" : ""}`);
    });

  if (import.meta.env.DEV) {
    (window as unknown as { __app: unknown }).__app = { openPath, autoRig, applyEdit, smoothWeights, importBvhPath: async (bvh: string) => {
      await run("Đang áp chuyển động", async () => {
        if (!rigPath || !skeleton) return;
        const out = await tempPath(`motion_${Date.now()}.glb`);
        const res = await engine.motionBvh(rigPath, await writeSkeleton(), bvh, out);
        await playResult(res.output);
      });
    } };
  }

  const editing = mode === "edit";

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">AutoBones</strong>
        <span className="muted">{info ? info.name : "Chưa mở model"}</span>
        {hovered && <span className="hover">⦿ {hovered}</span>}
      </header>

      <div className="body">
        <main className="stage" ref={hostRef}>
          {!info && !busy && (
            <div className="hint">
              <h2>Kéo thả model 3D vào đây</h2>
              <p>{MODEL_EXTENSIONS.map((e) => "." + e).join("  ")}</p>
            </div>
          )}
          {dropping && <div className="drop">Thả file để mở</div>}
          {busy && (
            <div className="busy">
              <div className="busy-label">{busy.label}</div>
              <div className="bar">
                <div style={{ width: `${Math.max(4, busy.frac * 100)}%` }} />
              </div>
            </div>
          )}
          {error && (
            <div className="toast error" onClick={() => setError(null)}>
              {error}
            </div>
          )}
          {notice && !error && (
            <div className="toast notice" onClick={() => setNotice(null)}>
              {notice}
            </div>
          )}
        </main>

        <aside className="panel">
          <Step n={1} title="Model">
            <button className="primary" onClick={openDialog} disabled={!!busy}>
              Mở model…
            </button>
            <input
              ref={browserFileRef}
              type="file"
              hidden
              accept={NATIVE_EXTENSIONS.map((e) => "." + e).join(",")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openBrowserFile(f);
                e.target.value = "";
              }}
            />
            {info && (
              <p className="meta">
                {info.triangles.toLocaleString()} tam giác · {info.bones} xương
              </p>
            )}
          </Step>

          <Step n={2} title="Gắn xương tự động" disabled={!info}>
            {hasBones ? (
              <>
                <p className="meta ok">
                  ✓ Model đã có xương{foreign ? ` gốc (${skeleton?.bones.length})` : skeleton ? " (do AutoBones tạo)" : ` (${info?.bones})`}.
                </p>
                {foreign && boneMap && (
                  <>
                    <p className={`meta ${missingStd.length ? "warn" : "ok"}`}>
                      Ánh xạ sang xương người chuẩn: {STD_BONES.filter((b) => boneMap[b]).length}/{STD_BONES.length}
                      {missingStd.length ? ` — thiếu: ${missingStd.join(", ")}` : " ✓"}
                    </p>
                    <details className="map">
                      <summary>Xem / sửa ánh xạ</summary>
                      {STD_BONES.map((std) => (
                        <label key={std} className="maprow">
                          <span>{std}</span>
                          <select
                            value={boneMap[std] ?? ""}
                            onChange={(e) => {
                              const next = { ...boneMap };
                              if (e.target.value) next[std] = e.target.value;
                              else delete next[std];
                              setSkeleton({
                                ...skeleton!,
                                meta: { ...skeleton!.meta, bone_map: next, missing: REQUIRED_STD.filter((r) => !next[r]) },
                              });
                              viewerRef.current?.setBoneMap(next);
                              setStress(null);
                            }}
                          >
                            <option value="">—</option>
                            {skeleton!.bones
                              .filter((b) => !isSecondaryBone(Viewer.sanitizeName(b.name)) || b.name === boneMap[std])
                              .map((b) => (
                                <option key={b.name} value={b.name}>
                                  {b.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </details>
                  </>
                )}
                {(!skeleton || foreign) && (
                  <>
                    <p className="meta">
                      {foreign
                        ? "Bạn có thể làm việc trực tiếp trên rig gốc (chỉnh khớp, kiểm tra tư thế, áp chuyển động). Chỉ khi muốn bộ xương người chuẩn gọn 22 xương mới cần thay (sẽ mất xương tóc/váy; file gốc không bị sửa)."
                        : "Muốn chỉnh khớp, kiểm tra tư thế chuẩn hoặc áp chuyển động? Hãy thay bằng bộ xương người chuẩn của AutoBones (mesh, texture và biểu cảm được giữ nguyên; file gốc không bị sửa)."}
                    </p>
                    <button disabled={!canReplace || !!busy} onClick={() => autoRig(true)}>
                      Thay bằng xương AutoBones
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="meta">Hỗ trợ nhân vật dáng người đứng, tư thế chữ T hoặc chữ A.</p>
                <button className="primary" disabled={!canRig || !!busy} onClick={() => autoRig(false)}>
                  Tự động gắn xương
                </button>
                {!tauri && <p className="meta warn">Cần chạy bằng app desktop để gắn xương.</p>}
              </>
            )}
          </Step>

          <Step n={3} title="Thử &amp; chỉnh" disabled={!hasBones}>
            <div className="seg">
              <button className={!editing ? "on" : ""} onClick={() => changeMode("pose")}>
                Kéo thử
              </button>
              <button className={editing ? "on" : ""} disabled={!skeleton} onClick={() => changeMode("edit")} title={skeleton ? (foreign ? "Dời pivot khớp trên rig gốc, giữ nguyên weight" : "") : "Cần phân tích xương trước"}>
                Chỉnh khớp
              </button>
            </div>

            {!editing ? (
              <>
                <p className="meta">Kéo các chấm xanh để uốn thử. Bấm vào khớp để xem vùng da khớp đó điều khiển.</p>
                <div className="row">
                  <button disabled={!hasBones} onClick={() => viewerRef.current?.resetPose()}>
                    Reset pose
                  </button>
                  {selected && <button onClick={() => viewerRef.current?.clearSelection()}>Bỏ chọn</button>}
                </div>
                <label className="check" title="Số khớp cha di chuyển theo khi kéo một khớp">
                  Độ linh hoạt {ikDepth}
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={ikDepth}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setIkDepth(n);
                      viewerRef.current?.setIkDepth(n);
                    }}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showSkeleton}
                    onChange={(e) => {
                      setShowSkeleton(e.target.checked);
                      viewerRef.current?.setSkeletonVisible(e.target.checked);
                    }}
                  />
                  Hiện xương
                </label>
                {(info?.secondaryBones ?? 0) > 0 && (
                  <label className="check" title="Xương tóc, váy, xương phụ trợ đang được ẩn cho gọn">
                    <input
                      type="checkbox"
                      checked={showAllBones}
                      onChange={(e) => {
                        setShowAllBones(e.target.checked);
                        viewerRef.current?.setShowAllBones(e.target.checked);
                      }}
                    />
                    Hiện cả {info?.secondaryBones} xương phụ (tóc, váy…)
                  </label>
                )}

                <div className="sub">Kiểm tra tự động</div>
                <button disabled={!rigged || !!busy} onClick={runStress}>
                  Thử các tư thế chuẩn
                </button>
                {stress && (
                  <ul className="stress">
                    {stress.map((r) => (
                      <li key={r.id} className={stressShown === r.id ? "on" : ""}>
                        <button disabled={!r.applicable} onClick={() => showStress(stressShown === r.id ? null : r.id)}>
                          <span>{r.label}</span>
                          <span className={r.fraction > 0.1 ? "bad" : r.fraction > 0.04 ? "mid" : "good"}>
                            {r.applicable ? `${(r.fraction * 100).toFixed(1)}%` : "—"}
                          </span>
                        </button>
                      </li>
                    ))}
                    <li className="meta">% đỉnh bị kéo giãn/bóp méo. Bấm để xem vùng đỏ.</li>
                  </ul>
                )}
                <button disabled={!rigged || !!busy || foreign} onClick={smoothWeights} title={foreign ? "Tắt với rig gốc để giữ nguyên weight của họa sĩ" : "Làm mềm vùng chuyển giữa các xương"}>
                  Làm mượt weight
                </button>
              </>
            ) : (
              <>
                <p className="meta">Kéo chấm xanh lá để đặt lại vị trí khớp (đầu gối, vai…). Xong bấm Áp dụng để tính lại da.</p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={mirror}
                    onChange={(e) => {
                      setMirror(e.target.checked);
                      viewerRef.current?.setMirror(e.target.checked);
                    }}
                  />
                  Đối xứng trái/phải
                </label>
                <div className="row">
                  <button className="primary" disabled={!!busy} onClick={applyEdit}>
                    Áp dụng
                  </button>
                  <button onClick={() => viewerRef.current?.resetEdits()}>Hoàn tác</button>
                </div>
              </>
            )}
          </Step>

          <Step n={4} title="Animation từ mô tả" disabled={!rigged || !skeleton || missingStd.length > 0}>
            <textarea
              rows={3}
              placeholder="Mô tả bằng tiếng Anh, ví dụ: a person walks forward and waves"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <label className="check">
              Thời lượng {seconds}s
              <input type="range" min={2} max={9} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
            </label>
            <button className="primary" disabled={!prompt.trim() || !!busy} onClick={generateMotion}>
              Tạo animation
            </button>
            <button disabled={!!busy} onClick={importBvh} title="Dùng chuyển động có sẵn (Mixamo, mocap, model AI khác xuất BVH)">
              Nhập chuyển động từ file BVH…
            </button>
            {clips.length > 0 && (
              <button onClick={togglePlay}>{playing ? "⏸ Dừng" : "▶ Phát"} ({clips[0].duration.toFixed(1)}s)</button>
            )}
          </Step>

          <Step n={5} title="Xuất file" disabled={!info}>
            <select value={exportExt} onChange={(e) => setExportExt(e.target.value)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f.ext} value={f.ext}>
                  {f.label}
                </option>
              ))}
            </select>
            <button className="primary" disabled={!tauri || !!busy || !(rigPath ?? sourcePath)} onClick={doExport}>
              Xuất…
            </button>
          </Step>
        </aside>
      </div>
    </div>
  );
}

function Step(props: { n: number; title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <section className={`step ${props.disabled ? "off" : ""}`}>
      <h3>
        <span className="num">{props.n}</span>
        {props.title}
      </h3>
      <div className="step-body">{props.children}</div>
    </section>
  );
}
