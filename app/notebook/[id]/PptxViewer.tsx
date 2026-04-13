"use client";

import { useRef, useState } from "react";
import type { SlideData } from "@/app/api/pptx-preview/route";

interface Props {
  onClose: () => void;
}

export default function PptxViewer({ onClose }: Props) {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/pptx-preview", { method: "POST", body: form });
    const data = await res.json();
    if (data.slides) {
      setSlides(data.slides);
      setAspectRatio(data.aspectRatio ?? 4 / 3);
      setActiveSlide(0);
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
          <button
            onClick={() => inputRef.current?.click()}
            className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300"
          >
            {slides.length ? "Change" : "Open .pptx"}
          </button>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors text-sm">✕</button>
        </div>
        <input ref={inputRef} type="file" accept=".pptx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
          Parsing slides…
        </div>
      )}

      {!loading && slides.length === 0 && (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 dark:text-zinc-500 cursor-pointer"
          onClick={() => inputRef.current?.click()}
        >
          <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="14" height="14" rx="2"/>
            <path d="M5 8h6M8 5v6"/>
          </svg>
          <p className="text-sm">Click to open a .pptx file</p>
        </div>
      )}

      {!loading && slides.length > 0 && (
        <div className="flex flex-1 min-h-0">
          {/* Slide thumbnails */}
          <div className="w-20 shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col gap-2 p-2">
            {slides.map((slide, i) => (
              <button
                key={i}
                onClick={() => setActiveSlide(i)}
                className={`w-full rounded overflow-hidden border-2 transition-colors ${activeSlide === i ? "border-blue-500" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"}`}
                style={{ aspectRatio }}
              >
                <SlideCanvas slide={slide} aspectRatio={aspectRatio} scale={0.15} />
              </button>
            ))}
          </div>

          {/* Main slide view */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-4">
            <div className="w-full" style={{ maxWidth: "100%" }}>
              <SlideCanvas slide={slides[activeSlide]} aspectRatio={aspectRatio} scale={1} />
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

function SlideCanvas({ slide, aspectRatio, scale }: { slide: SlideData; aspectRatio: number; scale: number }) {
  return (
    <div
      className="relative w-full overflow-hidden select-text"
      style={{ aspectRatio, backgroundColor: slide.bgColor, fontSize: `${scale * 100}%` }}
    >
      {slide.shapes.map((shape, i) => {
        if (shape.type === "image") {
          return (
            <img
              key={i}
              src={shape.dataUrl}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: `${shape.x}%`, top: `${shape.y}%`,
                width: `${shape.w}%`, height: `${shape.h}%`,
                objectFit: "contain",
              }}
            />
          );
        }
        // text shape
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${shape.x}%`, top: `${shape.y}%`,
              width: `${shape.w}%`, minHeight: `${shape.h}%`,
              backgroundColor: shape.bgColor ?? "transparent",
              overflow: "hidden",
              padding: "0.5%",
              boxSizing: "border-box",
            }}
          >
            {shape.paragraphs.map((para, pi) => (
              <p key={pi} style={{ margin: 0, textAlign: para.align, lineHeight: 1.2 }}>
                {para.runs.map((run, ri) => (
                  <span
                    key={ri}
                    style={{
                      fontWeight: run.bold ? "bold" : "normal",
                      fontStyle: run.italic ? "italic" : "normal",
                      fontSize: `${run.fontSize * scale}pt`,
                      color: run.color,
                    }}
                  >
                    {run.text}
                  </span>
                ))}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
