"use client";

import { useId, useRef, useState } from "react";

type Point = { x: number; y: number };
type CornerIndex = 0 | 1 | 2 | 3; // TL, TR, BR, BL

// --- Piecewise-affine warp -------------------------------------------
// Canvas 2D only supports affine transforms, not full perspective, but
// three point correspondences fully determine an affine transform. So a
// quadrilateral is split into two triangles (TL-TR-BR and TL-BR-BL) and
// each is warped independently onto the destination rectangle -- close
// enough to straighten a tilted title block for OCR, even if there's a
// faint seam along the diagonal on very skewed photos.

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function solve3x3(A: number[][], rhs: number[]): [number, number, number] {
  const D = det3(A);
  if (Math.abs(D) < 1e-9) return [1, 0, 0];
  const out: number[] = [];
  for (let col = 0; col < 3; col++) {
    const Ac = A.map((row) => row.slice());
    for (let r = 0; r < 3; r++) Ac[r][col] = rhs[r];
    out.push(det3(Ac) / D);
  }
  return out as [number, number, number];
}

// Returns [a,b,c,d,e,f] such that dst.x = a*src.x + b*src.y + c and
// dst.y = d*src.x + e*src.y + f for the 3 given point pairs.
function affineFromTriangles(
  src: Point[],
  dst: Point[]
): [number, number, number, number, number, number] {
  const A = src.map((p) => [p.x, p.y, 1]);
  const [a, b, c] = solve3x3(
    A,
    dst.map((p) => p.x)
  );
  const [d, e, f] = solve3x3(
    A,
    dst.map((p) => p.y)
  );
  return [a, b, c, d, e, f];
}

function drawWarpedTriangle(ctx: CanvasRenderingContext2D, img: HTMLImageElement, srcTri: Point[], dstTri: Point[]) {
  const [a, b, c, d, e, f] = affineFromTriangles(srcTri, dstTri);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dstTri[0].x, dstTri[0].y);
  ctx.lineTo(dstTri[1].x, dstTri[1].y);
  ctx.lineTo(dstTri[2].x, dstTri[2].y);
  ctx.closePath();
  ctx.clip();
  // canvas setTransform(a,b,c,d,e,f) maps (x,y) -> (a*x+c*y+e, b*x+d*y+f)
  ctx.setTransform(a, d, b, e, c, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function warpQuadToRect(img: HTMLImageElement, corners: Point[], outW: number, outH: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img.src;
  const [tl, tr, br, bl] = corners;
  const dTl = { x: 0, y: 0 };
  const dTr = { x: outW, y: 0 };
  const dBr = { x: outW, y: outH };
  const dBl = { x: 0, y: outH };
  drawWarpedTriangle(ctx, img, [tl, tr, br], [dTl, dTr, dBr]);
  drawWarpedTriangle(ctx, img, [tl, br, bl], [dTl, dBr, dBl]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// A 4-corner selector, each corner draggable independently (not locked
// to a rectangle) -- for a photo taken at an angle, drag the corners
// onto the actual tilted/trapezoid shape of the area you want and it
// gets straightened automatically on confirm. Drag inside the shape
// (not on a corner) to move the whole selection at once.
export default function QuadCropBox({
  src,
  onConfirm,
  onSkip,
  instructions = "Drag each yellow corner onto the area you want -- it doesn't have to be square, it gets straightened automatically. Drag inside the shape to move the whole thing.",
  confirmLabel = "Use this area",
  skipLabel = "Skip (use full photo)",
}: {
  src: string;
  onConfirm: (croppedDataUrl: string) => void;
  onSkip: () => void;
  instructions?: string;
  confirmLabel?: string;
  skipLabel?: string;
}) {
  const maskId = useId();
  const imgRef = useRef<HTMLImageElement>(null);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [points, setPoints] = useState<Point[]>([]);
  const dragState = useRef<{
    mode: "move" | CornerIndex;
    startPointer: Point;
    startPoints: Point[];
  } | null>(null);

  function handleImgLoad() {
    const el = imgRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setDisplaySize({ w, h });
    const inset = 0.15;
    setPoints([
      { x: w * inset, y: h * inset },
      { x: w * (1 - inset), y: h * inset },
      { x: w * (1 - inset), y: h * (1 - inset) },
      { x: w * inset, y: h * (1 - inset) },
    ]);
  }

  function clampPoint(p: Point): Point {
    return {
      x: Math.max(0, Math.min(p.x, displaySize.w)),
      y: Math.max(0, Math.min(p.y, displaySize.h)),
    };
  }

  function startDragCorner(index: CornerIndex) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode: index, startPointer: { x: e.clientX, y: e.clientY }, startPoints: points };
    };
  }

  function startMoveAll(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { mode: "move", startPointer: { x: e.clientX, y: e.clientY }, startPoints: points };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startPointer.x;
    const dy = e.clientY - drag.startPointer.y;
    if (drag.mode === "move") {
      // Keep the shape from clamping unevenly (which would distort it) --
      // if any corner would hit an edge, cap dx/dy so the whole shape
      // still shifts together, then apply.
      let clampedDx = dx;
      let clampedDy = dy;
      for (const p of drag.startPoints) {
        clampedDx = Math.max(-p.x, Math.min(clampedDx, displaySize.w - p.x));
        clampedDy = Math.max(-p.y, Math.min(clampedDy, displaySize.h - p.y));
      }
      setPoints(drag.startPoints.map((p) => ({ x: p.x + clampedDx, y: p.y + clampedDy })));
    } else {
      const next = drag.startPoints.slice();
      const start = drag.startPoints[drag.mode];
      next[drag.mode] = clampPoint({ x: start.x + dx, y: start.y + dy });
      setPoints(next);
    }
  }

  function onPointerUp() {
    dragState.current = null;
  }

  function confirm() {
    const el = imgRef.current;
    if (!el || displaySize.w === 0 || points.length !== 4) {
      onSkip();
      return;
    }
    const scale = el.naturalWidth / displaySize.w;
    const corners = points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const [tl, tr, br, bl] = corners;
    const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const outW = Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br))));
    const outH = Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br))));
    onConfirm(warpQuadToRect(el, corners, outW, outH));
  }

  const polygonPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

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
        {displaySize.w > 0 && points.length === 4 && (
          <svg
            width={displaySize.w}
            height={displaySize.h}
            style={{ position: "absolute", left: 0, top: 0, touchAction: "none" }}
          >
            <defs>
              <mask id={maskId}>
                <rect x={0} y={0} width={displaySize.w} height={displaySize.h} fill="white" />
                <polygon points={polygonPoints} fill="black" />
              </mask>
            </defs>
            <rect
              x={0}
              y={0}
              width={displaySize.w}
              height={displaySize.h}
              fill="rgba(0,0,0,0.55)"
              mask={`url(#${maskId})`}
              style={{ pointerEvents: "none" }}
            />
            <polygon
              points={polygonPoints}
              fill="rgba(0,0,0,0)"
              stroke="#f7c51e"
              strokeWidth={2}
              onPointerDown={startMoveAll}
              style={{ cursor: "move", touchAction: "none" }}
            />
          </svg>
        )}
        {points.map((p, i) => (
          <div
            key={i}
            onPointerDown={startDragCorner(i as CornerIndex)}
            style={{
              position: "absolute",
              left: p.x - 14,
              top: p.y - 14,
              width: 28,
              height: 28,
              background: "#f7c51e",
              border: "2px solid #101828",
              borderRadius: 999,
              touchAction: "none",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
      <p className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
        {instructions}
      </p>
      <button type="button" className="camera-button" onClick={confirm}>
        {confirmLabel}
      </button>
      <div style={{ height: 10 }} />
      <button type="button" className="secondary-button" onClick={onSkip} style={{ width: "100%" }}>
        {skipLabel}
      </button>
    </div>
  );
}
