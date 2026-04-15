"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideData } from "@/app/api/pptx-preview/route";

const VIRTUAL_W = 960;

interface Props {
  onClose: () => void;
}

export default function FileViewer({ onClose }: Props) {
  const [mode, setMode] = useState<"none" | "pptx" | "pdf" | "docx">("none");
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke PDF object URL on unmount or when replaced
  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  async function handleFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    const ext = file.name.toLowerCase().split(".").pop();

    if (ext === "pdf") {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(file));
      setMode("pdf");
      setSlides([]);
      setDocxHtml(null);
      setLoading(false);
      return;
    }

    if (ext === "docx") {
      const arrayBuffer = await file.arrayBuffer();
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setDocxHtml(result.value);
      setMode("docx");
      setSlides([]);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
      setLoading(false);
      return;
    }

    // PPTX
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/pptx-preview", { method: "POST", body: form });
    const data = await res.json();
    if (data.slides) {
      setSlides(data.slides);
      setAspectRatio(data.aspectRatio ?? 4 / 3);
      setActiveSlide(0);
      setMode("pptx");
      setDocxHtml(null);
    }
    setLoading(false);
  }

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 shrink-0">File Viewer</span>
          {fileName && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{fileName}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mode === "pptx" && slides.length > 0 && <CopySlideTextButton slide={slides[activeSlide]} />}
          <button
            onClick={() => inputRef.current?.click()}
            className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300"
          >
            {mode !== "none" ? "Change" : "Open file"}
          </button>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors text-sm">✕</button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pptx,.pdf,.docx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
          Parsing file…
        </div>
      )}

      {!loading && mode === "none" && (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 dark:text-zinc-500 cursor-pointer"
          onClick={() => inputRef.current?.click()}
        >
          <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="14" height="14" rx="2"/>
            <path d="M5 8h6M8 5v6"/>
          </svg>
          <p className="text-sm">Click to open a .pptx, .pdf, or .docx</p>
        </div>
      )}

      {!loading && mode === "pdf" && pdfUrl && (
        <iframe
          src={pdfUrl}
          className="flex-1 w-full border-0"
          title={fileName ?? "PDF"}
        />
      )}

      {!loading && mode === "docx" && docxHtml !== null && (
        <div className="flex-1 overflow-auto bg-white dark:bg-zinc-900 p-6">
          <div
            className="max-w-3xl mx-auto prose prose-sm dark:prose-invert prose-zinc"
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        </div>
      )}

      {!loading && mode === "pptx" && slides.length > 0 && (
        <div className="flex flex-1 min-h-0">
          {/* Thumbnail rail */}
          <div className="w-20 shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col gap-2 p-2">
            {slides.map((slide, i) => (
              <button
                key={i}
                onClick={() => setActiveSlide(i)}
                className={`w-full rounded overflow-hidden border-2 transition-colors ${activeSlide === i ? "border-blue-500" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"}`}
              >
                <SlideCanvas slide={slide} aspectRatio={aspectRatio} />
              </button>
            ))}
          </div>

          {/* Main slide view */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-4">
            <div className="w-full">
              <SlideCanvas slide={slides[activeSlide]} aspectRatio={aspectRatio} />
              <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                Slide {activeSlide + 1} of {slides.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CopySlideTextButton({ slide }: { slide: SlideData }) {
  const [copied, setCopied] = useState(false);

  function copyText() {
    const lines: string[] = [];
    for (const shape of slide.shapes) {
      if (shape.type !== "text") continue;
      for (const para of shape.paragraphs) {
        const line = para.runs.map((r) => r.text).join("").trim();
        if (line) lines.push(line);
      }
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={copyText}
      className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300"
    >
      {copied ? "Copied!" : "Copy text"}
    </button>
  );
}

function SlideCanvas({ slide, aspectRatio }: { slide: SlideData; aspectRatio: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const virtualH = VIRTUAL_W / aspectRatio;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(el.offsetWidth / VIRTUAL_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} style={{ width: "100%", aspectRatio, position: "relative", overflow: "visible" }}>
      <div
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: VIRTUAL_W,
          height: virtualH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          backgroundColor: slide.bgColor,
        }}
      >
        {slide.shapes.map((shape, i) => {
          const x = (shape.x / 100) * VIRTUAL_W;
          const y = (shape.y / 100) * virtualH;
          const w = (shape.w / 100) * VIRTUAL_W;
          const h = (shape.h / 100) * virtualH;

          if (shape.type === "image") {
            return (
              <img key={i} src={shape.dataUrl} alt="" draggable={false}
                style={{ position: "absolute", left: x, top: y, width: w, height: h, objectFit: "contain" }}
              />
            );
          }

          return (
            <div key={i} style={{ position: "absolute", left: x, top: y, width: w, backgroundColor: shape.bgColor ?? "transparent", padding: "4px", boxSizing: "border-box" }}>
              {shape.paragraphs.map((para, pi) => (
                <p key={pi} style={{ margin: 0, textAlign: para.align, lineHeight: 1.1 }}>
                  {para.runs.map((run, ri) => (
                    <span key={ri} style={{ fontWeight: run.bold ? "bold" : "normal", fontStyle: run.italic ? "italic" : "normal", fontSize: `${run.fontSize * 0.88}pt`, color: run.color }}>
                      {run.text}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
