"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  isEmpty(): boolean;
  clear(): void;
  /** 여백을 잘라낸 PNG 데이터 URL. 서명이 없으면 null. */
  toPng(): string | null;
}

const HEIGHT = 180;

const SignaturePad = forwardRef<SignaturePadHandle, { onInkChange?: (has: boolean) => void }>(
  function SignaturePad({ onInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const inked = useRef(false);
    const [hasInk, setHasInk] = useState(false);

    const setup = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const previous = inked.current ? canvas.toDataURL("image/png") : null;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = "#111827";
      if (previous) {
        const image = new Image();
        image.onload = () => ctx.drawImage(image, 0, 0, width, HEIGHT);
        image.src = previous;
      }
    }, []);

    useEffect(() => {
      setup();
      const onResize = () => setup();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [setup]);

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const clear = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      inked.current = false;
      setHasInk(false);
      onInkChange?.(false);
    }, [onInkChange]);

    useImperativeHandle(ref, () => ({
      isEmpty: () => !inked.current,
      clear,
      toPng: () => (canvasRef.current && inked.current ? trim(canvasRef.current) : null),
    }));

    return (
      <div className="sig">
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          style={{ height: HEIGHT }}
          aria-label="서명란"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvasRef.current?.getContext("2d");
            const from = last.current;
            if (!ctx || !from) return;
            const to = point(e);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            last.current = to;
            if (!inked.current) {
              inked.current = true;
              setHasInk(true);
              onInkChange?.(true);
            }
          }}
          onPointerUp={() => { drawing.current = false; last.current = null; }}
          onPointerCancel={() => { drawing.current = false; last.current = null; }}
          onPointerLeave={() => { drawing.current = false; last.current = null; }}
        />
        {!hasInk && <p className="sig-hint">여기에 손가락으로 서명해 주세요</p>}
        <button type="button" className="sig-clear" onClick={clear} disabled={!hasInk}>
          지우고 다시
        </button>
      </div>
    );
  },
);

/** 서명 주변 빈 공간을 잘라낸다. 구석에 작게 써도 PDF에서 또렷하게 나온다. */
function trim(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const pad = Math.round((window.devicePixelRatio || 1) * 6);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);

  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext("2d")?.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export default SignaturePad;
