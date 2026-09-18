"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  isEmpty(): boolean;
  clear(): void;
  /** 여백을 잘라낸 PNG 데이터 URL. 서명이 없으면 null. */
  toPng(): string | null;
}

interface Props {
  onInkChange?: (hasInk: boolean) => void;
}

const HEIGHT = 190;

/** 손가락 서명 캡처. 마우스·터치·펜을 pointer 이벤트 하나로 받는다. */
const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad({ onInkChange }, ref) {
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
    // 크기가 바뀌면 픽셀 버퍼가 초기화된다. 그리던 중에 리사이즈가 오는 일은
    // 드물지만, 왔을 때 서명이 조용히 사라지는 것보다 유지하는 쪽이 낫다.
    const prev = inked.current ? canvas.toDataURL("image/png") : null;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#111827";
    if (prev) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, width, HEIGHT);
      img.src = prev;
    }
  }, []);

  useEffect(() => {
    setup();
    const onResize = () => setup();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setup]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFrom(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const from = last.current;
    if (!ctx || !from) return;
    const to = pointFrom(e);
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
  };

  const end = () => {
    drawing.current = false;
    last.current = null;
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
    toPng: () => {
      const canvas = canvasRef.current;
      if (!canvas || !inked.current) return null;
      return trim(canvas);
    },
  }));

  return (
    <>
      <div className={`sign-pad-wrap${hasInk ? " has-ink" : ""}`}>
        <canvas
          ref={canvasRef}
          className="sign-pad"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          role="img"
          aria-label="서명란"
        />
        <span className="sign-pad-line" aria-hidden />
        <span className="sign-pad-hint">이 칸에 손가락으로 서명하세요</span>
      </div>
      <div className="od-row" style={{ ["--od-gap" as string]: "10px", marginTop: 10 }}>
        <button
          type="button"
          className="btn od-touch"
          style={{ minHeight: 46, fontSize: 16 }}
          onClick={clear}
          disabled={!hasInk}
        >
          지우기
        </button>
      </div>
    </>
  );
});

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
