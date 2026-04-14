"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type Stroke = { id: string; color: string; width: number; eraser: boolean; points: Point[] };

// ── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = ["#000000"];
const WIDTHS = [2, 4, 8, 16];
const CANVAS_W = 1200; // fixed pixel width; CSS scales to 100%

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadImage(canvas: HTMLCanvasElement, dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return resolve();
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0); resolve(); };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;
  if (stroke.eraser) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = ctx.fillStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
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

type ShapeTool = "rect" | "ellipse" | "line" | "arrow";

function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeTool, from: Point, to: Point, color: string, width: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "source-over";
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  ctx.beginPath();
  if (shape === "rect") {
    ctx.strokeRect(from.x, from.y, dx, dy);
  } else if (shape === "ellipse") {
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2;
    ctx.ellipse(cx, cy, Math.abs(dx) / 2, Math.abs(dy) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === "line") {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  } else if (shape === "arrow") {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    // Arrowhead
    const angle = Math.atan2(dy, dx);
    const headLen = Math.max(width * 4, 16);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
  ctx.restore();
}

const SHAPE_TOOLS: { type: ShapeTool; label: string }[] = [
  { type: "rect",    label: "□  Square" },
  { type: "ellipse", label: "○  Circle" },
  { type: "line",    label: "—  Line"   },
  { type: "arrow",   label: "→  Arrow"  },
];

// ── Drawing NodeView ──────────────────────────────────────────────────────────

function DrawingBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // History: array of data-URL snapshots; index points to current state
  const historyRef = useRef<string[]>([""]);
  const historyIndexRef = useRef(0);
  // ImageData snapshot of the last committed state (for live stroke preview)
  const committedRef = useRef<ImageData | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const shapeStartRef = useRef<Point | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const [tool, setTool] = useState<"pen" | "eraser" | "text" | "rect" | "ellipse" | "line" | "arrow">("pen");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [color, setColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(20);
  const [active, setActive] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [pendingText, setPendingText] = useState<{ cx: number; cy: number; sx: number; sy: number } | null>(null);
  const [textValue, setTextValue] = useState("");

  const height: number = node.attrs.height ?? 200;

  // ── History helpers ───────────────────────────────────────────────────────

  function snapshotCanvas(): string {
    return canvasRef.current?.toDataURL("image/png") ?? "";
  }

  function saveCommitted() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) committedRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function pushHistory() {
    const dataUrl = snapshotCanvas();
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push(dataUrl);
    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
    setTimeout(() => updateAttributes({ data: dataUrl }), 0);
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    const dataUrl = historyRef.current[historyIndexRef.current];
    loadImage(canvasRef.current!, dataUrl).then(() => {
      saveCommitted();
      setTimeout(() => updateAttributes({ data: dataUrl }), 0);
    });
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const dataUrl = historyRef.current[historyIndexRef.current];
    loadImage(canvasRef.current!, dataUrl).then(() => {
      saveCommitted();
      setTimeout(() => updateAttributes({ data: dataUrl }), 0);
    });
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }

  // Refs so keyboard handler never goes stale
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  // ── Keyboard shortcuts (capture phase to beat TipTap) ────────────────────

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undoRef.current(); }
      else if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); e.stopPropagation(); redoRef.current(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active]);

  // ── Mount: load saved image ───────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = height;
    const initial = node.attrs.data ?? "";
    loadImage(canvas, initial).then(() => {
      saveCommitted();
      historyRef.current = [initial];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mouse helpers ─────────────────────────────────────────────────────────

  function getPoint(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  const isShapeTool = (t: typeof tool): t is ShapeTool =>
    t === "rect" || t === "ellipse" || t === "line" || t === "arrow";

  function renderLive(shapeEnd?: Point) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (committedRef.current) ctx.putImageData(committedRef.current, 0, 0);
    if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current);
    if (isShapeTool(tool) && shapeStartRef.current && shapeEnd) {
      drawShape(ctx, tool, shapeStartRef.current, shapeEnd, color, strokeWidth);
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.stopPropagation();
    setShapeMenuOpen(false);

    if (tool === "text") {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const pt = getPoint(e);
      setPendingText({
        cx: pt.x, cy: pt.y,
        sx: e.clientX - rect.left,
        sy: e.clientY - rect.top,
      });
      setTextValue("");
      setTimeout(() => textInputRef.current?.focus(), 0);
      return;
    }

    isDrawingRef.current = true;
    saveCommitted();

    if (isShapeTool(tool)) {
      shapeStartRef.current = getPoint(e);
    } else {
      currentStrokeRef.current = {
        id: crypto.randomUUID(),
        color,
        width: tool === "eraser" ? strokeWidth * 4 : strokeWidth,
        eraser: tool === "eraser",
        points: [getPoint(e)],
      };
      renderLive();
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    if (isShapeTool(tool)) {
      renderLive(getPoint(e));
    } else if (currentStrokeRef.current) {
      currentStrokeRef.current.points.push(getPoint(e));
      renderLive();
    }
  }

  function finishStroke(e?: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (isShapeTool(tool)) {
      if (e && shapeStartRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) drawShape(ctx, tool, shapeStartRef.current, getPoint(e), color, strokeWidth);
      }
      shapeStartRef.current = null;
    } else if (currentStrokeRef.current) {
      if (e) currentStrokeRef.current.points.push(getPoint(e));
      currentStrokeRef.current = null;
    }
    saveCommitted();
    pushHistory();
  }

  // ── Text commit ───────────────────────────────────────────────────────────

  function commitText() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !pendingText) { setPendingText(null); return; }
    if (textValue.trim()) {
      const scaledFont = fontSize; // canvas px
      ctx.save();
      ctx.font = `${scaledFont}px sans-serif`;
      ctx.fillStyle = color;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillText(textValue, pendingText.cx, pendingText.cy);
      ctx.restore();
      saveCommitted();
      pushHistory();
    }
    setPendingText(null);
    setTextValue("");
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  function clearAll() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveCommitted();
    pushHistory();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  const btnBase = "px-2 py-1 rounded text-xs border transition-colors";
  const btnOn  = `${btnBase} bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200`;
  const btnOff = `${btnBase} border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-300`;

  const cursor = active ? (tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair") : "default";
  const currentShapeLabel = SHAPE_TOOLS.find((s) => s.type === tool)?.label.split("\u00a0")[0].trim() ?? "⬡";

  // CSS-space font size for the floating input
  const cssScale = (canvasRef.current?.getBoundingClientRect().width ?? CANVAS_W) / CANVAS_W;
  const fontSizeCss = fontSize * cssScale;

  return (
    <NodeViewWrapper>
      <div
        className={`relative my-2 rounded border select-none ${active || selected ? "border-blue-400 dark:border-blue-500" : "border-zinc-200 dark:border-zinc-700"}`}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => { setActive(false); finishStroke(); }}
        contentEditable={false}
      >
        {/* Floating toolbar */}
        {(active || selected) && (
          <div className="absolute top-1 left-1 right-1 z-10 flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded px-2 py-1 shadow-sm border border-zinc-200 dark:border-zinc-700 flex-wrap">
            {/* Tools */}
            <button onClick={() => setTool("pen")}    className={tool === "pen"    ? btnOn : btnOff} title="Pen">✏</button>
            <button onClick={() => setTool("eraser")} className={tool === "eraser" ? btnOn : btnOff} title="Eraser">⌫</button>
            <button onClick={() => setTool("text")}   className={tool === "text"   ? btnOn : btnOff} title="Text">T</button>

            {/* Shapes dropdown */}
            <div className="relative">
              <button
                onClick={() => setShapeMenuOpen((v) => !v)}
                className={isShapeTool(tool) ? btnOn : btnOff}
                title="Shapes"
              >
                {tool === "rect" ? "□" : tool === "ellipse" ? "○" : tool === "line" ? "—" : tool === "arrow" ? "→" : "⬡"} ▾
              </button>
              {shapeMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-md z-20 py-1 min-w-[110px]">
                  {SHAPE_TOOLS.map(({ type, label }) => (
                    <button
                      key={type}
                      onClick={() => { setTool(type); setShapeMenuOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors ${tool === type ? "font-semibold" : ""}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

            {/* Colors */}
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${color === c ? "border-blue-500 scale-110" : "border-transparent hover:border-zinc-400"}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-5 h-5 rounded cursor-pointer border border-zinc-300 dark:border-zinc-600 p-0"
              title="Custom color"
            />

            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

            {/* Size controls: stroke widths for pen/eraser, font size for text */}
            {tool === "text" ? (
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-zinc-200"
              >
                {[12, 16, 20, 28, 36, 48].map((s) => <option key={s} value={s}>{s}px</option>)}
              </select>
            ) : (
              WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setStrokeWidth(w)}
                  className={`rounded-full transition-all border-2 ${strokeWidth === w ? "border-blue-500" : "border-zinc-300 dark:border-zinc-600"}`}
                  style={{
                    width:  `${Math.max(w + 6, 12)}px`,
                    height: `${Math.max(w + 6, 12)}px`,
                    backgroundColor: tool === "eraser" ? "#94a3b8" : color,
                  }}
                />
              ))
            )}

            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

            {/* History */}
            <button onClick={undo} disabled={!canUndo} className={`${btnOff} disabled:opacity-40`} title="Undo (⌘Z)">↩</button>
            <button onClick={redo} disabled={!canRedo} className={`${btnOff} disabled:opacity-40`} title="Redo (⌘⇧Z)">↪</button>
            <button onClick={clearAll} className={`${btnOff} hover:text-red-500`} title="Clear all">✕</button>
          </div>
        )}

        {/* Canvas + text input overlay */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            height={height}
            style={{ width: "100%", height: `${height}px`, display: "block", cursor }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={(e) => finishStroke(e)}
            onMouseLeave={() => finishStroke()}
          />

          {pendingText && (
            <input
              ref={textInputRef}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  { e.preventDefault(); commitText(); }
                if (e.key === "Escape") { setPendingText(null); }
                e.stopPropagation();
              }}
              onBlur={commitText}
              style={{
                position: "absolute",
                left: `${pendingText.sx}px`,
                top:  `${pendingText.sy - fontSizeCss}px`,
                fontSize: `${fontSizeCss}px`,
                color,
                background: "transparent",
                border: "none",
                outline: "1px dashed rgba(128,128,128,0.5)",
                minWidth: "4ch",
                lineHeight: 1,
                padding: 0,
                caretColor: color,
              }}
            />
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ── TipTap Extension ──────────────────────────────────────────────────────────

export const DrawingBlock = Node.create({
  name: "drawingBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      data:   { default: "" },
      height: { default: 200 },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="drawing-block"]',
      getAttrs: (el) => ({
        data:   (el as HTMLElement).getAttribute("data-drawing") ?? "",
        height: parseInt((el as HTMLElement).getAttribute("data-height") ?? "200", 10),
      }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({
      "data-type":    "drawing-block",
      "data-drawing": HTMLAttributes.data ?? "",
      "data-height":  HTMLAttributes.height ?? 200,
      class:          "drawing-block",
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingBlockView);
  },
});
