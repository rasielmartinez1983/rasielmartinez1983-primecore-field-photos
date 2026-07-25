"use client";

import { useRef, useState } from "react";

type Box = { x: number; y: number; w: number; h: number };
type Corner = "nw" | "ne" | "sw" | "se";

// A plain drag/resize crop box over a photo -- no library, works with mouse
// or touch (pointer events). The user drags the yellow box to move it and
// the four corner handles to trim each edge independently, which is more
// direct than a fixed-aspect pan/zoom cropper for irregular nameplate shots
// (bad lighting, odd angles) where automatic detection isn't reliable.
export default function ManualCropBox({
  src,
  onConfirm,
  onSkip,
}: {
  src: string;
  onConfirm: (croppedDataUrl: string) => void;
  onSkip: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 0, h: 0 });
  const dragState = useRef<{ mode: "move" | Corner; startPointer: { x: number; y: number }; startBox: Box } | null>(
    null
  );

  function handleImgLoad() {
    const el = imgRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setDisplaySize({ w, h });
    const inset = 0.1;
    setBox({ x: w * inset, y: h * inset, w: w * (1 - inset * 2), h: h * (1 - inset * 2) });
  }

  function clampBox(b: Box): Box {
    const MIN = 30;
    let { x, y, w, h } = b;
    w = Math.max(MIN, Math.min(w, displaySize.w));
    h = Math.max(MIN, Math.min(h, displaySize.h));
    x = Math.max(0, Math.min(x, displaySize.w - w));
    y = Math.max(0, Math.min(y, displaySize.h - h));
    return { x, y, w, h };
  }

  function startDrag(mode: "move" | Corner) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode, startPointer: { x: e.clientX, y: e.clientY }, startBox: box };
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startPointer.x;
    const dy = e.clientY - drag.startPointer.y;
    const s = drag.startBox;
    let next: Box = s;
    if (drag.mode === "move") next = { ...s, x: s.x + dx, y: s.y + dy };
    else if (drag.mode === "nw") next = { x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy };
    else if (drag.mode === "ne") next = { x: s.x, y: s.y + dy, w: s.w + dx, h: s.h - dy };
    else if (drag.mode === "sw") next = { x: s.x + dx, y: s.y, w: s.w - dx, h: s.h + dy };
    else if (drag.mode === "se") next = { x: s.x, y: s.y, w: s.w + dx, h: s.h + dy };
    setBox(clampBox(next));
  }

  function onPointerUp() {
    dragState.current = null;
  }

  function confirm() {
    const el = imgRef.current;
    if (!el || displaySize.w === 0) {
      onSkip();
      return;
    }
    const scale = el.naturalWidth / displaySize.w;
    const sx = box.x * scale;
    const sy = box.y * scale;
    const sw = box.w * scale;
    const sh = box.h * scale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onSkip();
      return;
    }
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    onConfirm(canvas.toDataURL("image/jpeg", 0.85));
  }

  const handleStyle = (corner: Corner): React.CSSProperties => ({
    position: "absolute",
    width: 24,
    height: 24,
    background: "#f7c51e",
    border: "2px solid #101828",
    borderRadius: 999,
    touchAction: "none",
    cursor: `${corner}-resize`,
    ...(corner === "nw" ? { left: -12, top: -12 } : {}),
    ...(corner === "ne" ? { right: -12, top: -12 } : {}),
    ...(corner === "sw" ? { left: -12, bottom: -12 } : {}),
    ...(corner === "se" ? { right: -12, bottom: -12 } : {}),
  });

  return (
    <div>
      <div
        style={{ position: "relative", width: "100%", userSelect: "none", touchAction: "none" }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          src={src}
          alt="Crop preview"
          onLoad={handleImgLoad}
          style={{ display: "block", width: "100%", height: "auto", borderRadius: 8 }}
          draggable={false}
        />
        {displaySize.w > 0 && (
          <div
            onPointerDown={startDrag("move")}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              border: "2px solid #f7c51e",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              cursor: "move",
              touchAction: "none",
            }}
          >
            {(["nw", "ne", "sw", "se"] as const).map((corner) => (
              <div key={corner} onPointerDown={startDrag(corner)} style={handleStyle(corner)} />
            ))}
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
        Drag the yellow corners to trim the edges, or drag the middle to move the box.
      </p>
      <button type="button" className="camera-button" onClick={confirm}>
        Crop photo
      </button>
      <div style={{ height: 10 }} />
      <button type="button" className="secondary-button" onClick={onSkip} style={{ width: "100%" }}>
        Skip crop (use full photo)
      </button>
    </div>
  );
}
