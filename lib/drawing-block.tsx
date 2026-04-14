"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type Stroke = { id: string; color: string; width: number; eraser: boolean; points: Point[] };

// ── Drawing NodeView ─────────────────────────────────────────────────────────

const PRESET_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#000000"];
const WIDTHS = [2, 4, 8, 16];

function DrawingBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const sessionStrokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);

  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [sessionStrokes, setSessionStrokes] = useState<Stroke[]>([]);
  const [active, setActive] = useState(false);

  const height: number = node.attrs.height ?? 200;

  // ── Rendering ──────────────────────────────────────────────────────────────

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (baseImageRef.current) {
      ctx.drawImage(baseImageRef.current, 0, 0, canvas.width, canvas.height);
    }
    const all: Stroke[] = [
      ...sessionStrokesRef.current,
      ...(currentStrokeRef.current ? [currentStrokeRef.current] : []),
    ];
    for (const stroke of all) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke.width;
      if (stroke.eraser) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.fillStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
      }
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
          const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
        }
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, []);

  // ── Load existing image on mount ───────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 800;
    canvas.height = height;
    if (node.attrs.data) {
      const img = new Image();
      img.onload = () => {
        baseImageRef.current = img;
        renderAll();
      };
      img.src = node.attrs.data;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render when session strokes change and save PNG to attrs
  useEffect(() => {
    sessionStrokesRef.current = sessionStrokes;
    renderAll();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setTimeout(() => updateAttributes({ data: dataUrl }), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStrokes]);

  // ── Mouse events ───────────────────────────────────────────────────────────

  function getPoint(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.stopPropagation();
    isDrawingRef.current = true;
    currentStrokeRef.current = {
      id: crypto.randomUUID(),
      color,
      width: tool === "eraser" ? strokeWidth * 4 : strokeWidth,
      eraser: tool === "eraser",
      points: [getPoint(e)],
    };
    renderAll();
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    currentStrokeRef.current.points.push(getPoint(e));
    renderAll();
  }

  function finishStroke(e?: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;
    if (e) currentStrokeRef.current.points.push(getPoint(e));
    if (currentStrokeRef.current.points.length > 0) {
      const finished = currentStrokeRef.current;
      currentStrokeRef.current = null;
      setSessionStrokes((prev) => [...prev, finished]);
    } else {
      currentStrokeRef.current = null;
    }
  }

  // ── Drawing toolbar actions ────────────────────────────────────────────────

  function undoLast() {
    setSessionStrokes((prev) => {
      const next = prev.slice(0, -1);
      sessionStrokesRef.current = next;
      renderAll();
      const canvas = canvasRef.current;
      if (canvas) {
        const dataUrl = canvas.toDataURL("image/png");
        setTimeout(() => updateAttributes({ data: dataUrl }), 0);
      }
      return next;
    });
  }

  function clearAll() {
    sessionStrokesRef.current = [];
    setSessionStrokes([]);
    baseImageRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateAttributes({ data: "" });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const btnBase = "px-2 py-1 rounded text-xs border transition-colors";
  const btnOn = `${btnBase} bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200`;
  const btnOff = `${btnBase} border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-300`;

  return (
    <NodeViewWrapper>
      <div
        className={`relative my-2 rounded border select-none ${active || selected ? "border-blue-400 dark:border-blue-500" : "border-zinc-200 dark:border-zinc-700"}`}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => { setActive(false); finishStroke(); }}
        contentEditable={false}
      >
        {/* Toolbar — shown on hover/selected */}
        {(active || selected) && (
          <div className="absolute top-1 left-1 right-1 z-10 flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded px-2 py-1 shadow-sm border border-zinc-200 dark:border-zinc-700 flex-wrap">
            {/* Tool */}
            <button onClick={() => setTool("pen")} className={tool === "pen" ? btnOn : btnOff} title="Pen">✏</button>
            <button onClick={() => setTool("eraser")} className={tool === "eraser" ? btnOn : btnOff} title="Eraser">⌫</button>

            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

            {/* Colors */}
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setTool("pen"); }}
                className={`w-5 h-5 rounded-full border-2 transition-all ${color === c && tool === "pen" ? "border-blue-500 scale-110" : "border-transparent hover:border-zinc-400"}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); setTool("pen"); }}
              className="w-5 h-5 rounded cursor-pointer border border-zinc-300 dark:border-zinc-600 p-0"
              title="Custom color"
            />

            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

            {/* Width */}
            {WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => setStrokeWidth(w)}
                className={`rounded-full transition-all border-2 ${strokeWidth === w ? "border-blue-500" : "border-zinc-300 dark:border-zinc-600"}`}
                style={{ width: `${Math.max(w + 6, 12)}px`, height: `${Math.max(w + 6, 12)}px`, backgroundColor: tool === "eraser" ? "#94a3b8" : color }}
                title={`${w}px`}
              />
            ))}

            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

            {/* Undo / Clear */}
            <button onClick={undoLast} className={btnOff} title="Undo last stroke" disabled={sessionStrokes.length === 0}>↩</button>
            <button onClick={clearAll} className={`${btnOff} hover:text-red-500`} title="Clear all">✕</button>
          </div>
        )}

        <canvas
          ref={canvasRef}
          height={height}
          style={{ width: "100%", height: `${height}px`, display: "block", cursor: active ? (tool === "eraser" ? "cell" : "crosshair") : "default" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={(e) => finishStroke(e)}
          onMouseLeave={() => finishStroke()}
        />
      </div>
    </NodeViewWrapper>
  );
}

// ── TipTap Extension ─────────────────────────────────────────────────────────

export const DrawingBlock = Node.create({
  name: "drawingBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      data: { default: "" },
      height: { default: 200 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="drawing-block"]',
        getAttrs: (el) => ({
          data: (el as HTMLElement).getAttribute("data-drawing") ?? "",
          height: parseInt((el as HTMLElement).getAttribute("data-height") ?? "200", 10),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-type": "drawing-block",
        "data-drawing": HTMLAttributes.data ?? "",
        "data-height": HTMLAttributes.height ?? 200,
        class: "drawing-block",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingBlockView);
  },
});
