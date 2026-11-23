import { useCallback, useEffect, useRef, useState } from "react";
import { Viewer, type ModelInfo } from "./viewer/Viewer";
import { isNativeFormat, NATIVE_EXTENSIONS } from "./viewer/loaders";
import "./App.css";

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [ikDepth, setIkDepth] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const v = new Viewer(hostRef.current, { onInfo: setInfo, onSelectBone: setSelected });
    viewerRef.current = v;
    return () => {
      v.dispose();
      viewerRef.current = null;
    };
  }, []);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    if (!isNativeFormat(file.name)) {
      setError(`Chưa đọc trực tiếp .${file.name.split(".").pop()}. Hỗ trợ: ${NATIVE_EXTENSIONS.join(", ")}.`);
      return;
    }
    setBusy(true);
    try {
      await viewerRef.current?.loadFile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const hasRig = (info?.bones ?? 0) > 0;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void openFile(f);
      }}
    >
      <header className="toolbar">
        <strong className="brand">AutoBones</strong>
        <button onClick={() => fileRef.current?.click()}>Mở model…</button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={NATIVE_EXTENSIONS.map((e) => "." + e).join(",")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = "";
          }}
        />
        <button disabled={!hasRig} onClick={() => viewerRef.current?.resetPose()}>
          Reset pose
        </button>
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
        <label className="check" title="Số khớp cha di chuyển theo khi kéo một khớp">
          Độ linh hoạt
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
          {ikDepth}
        </label>
        {selected && (
          <button onClick={() => viewerRef.current?.clearSelection()}>Bỏ chọn “{selected}”</button>
        )}
      </header>

      <main className="stage" ref={hostRef}>
        {!info && !busy && (
          <div className="hint">
            <h2>Kéo thả model 3D vào đây</h2>
            <p>{NATIVE_EXTENSIONS.map((e) => "." + e).join("  ")}</p>
          </div>
        )}
        {busy && <div className="hint">Đang tải…</div>}
        {dropping && <div className="drop">Thả file để mở</div>}
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
      </main>

      <footer className="status">
        {info ? (
          <>
            <span>{info.name}</span>
            <span>{info.triangles.toLocaleString()} tam giác</span>
            <span>{info.bones} xương</span>
            <span>{info.skinnedMeshes} mesh skin</span>
            {hasRig ? (
              <span className="tip">Kéo các chấm xanh để thử xương · chuột trái xoay · cuộn để zoom</span>
            ) : (
              <span className="warn">Model chưa có xương (auto-rig sẽ làm ở bước sau)</span>
            )}
          </>
        ) : (
          <span>Sẵn sàng</span>
        )}
      </footer>
    </div>
  );
}
