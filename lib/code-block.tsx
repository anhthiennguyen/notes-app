"use client";

import { CodeBlock } from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const PRESET_COLORS = [
  { label: "Dark",  value: "#1e1e2e" },
  { label: "Slate", value: "#1e293b" },
  { label: "Light", value: "#f8f8f8" },
  { label: "Warm",  value: "#fdf6ec" },
  { label: "Blue",  value: "#0f172a" },
  { label: "Green", value: "#052e16" },
];

function CodeBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalText, setModalText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const bgColor: string = node.attrs.backgroundColor ?? "#1e1e2e";
  const isLight = isLightColor(bgColor);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (modalOpen) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [modalOpen]);

  function openModal() {
    setModalText(node.textContent);
    setModalOpen(true);
  }

  function saveModal() {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined || !editor) return;
    const schema = editor.state.schema;
    const newNode = schema.nodes.codeBlock.create(
      { ...node.attrs },
      modalText ? schema.text(modalText) : undefined
    );
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, newNode));
    setModalOpen(false);
  }

  function convertToPlain() {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined || !editor) return;
    const schema = editor.state.schema;
    const lines = node.textContent.split("\n");
    const paras = lines.map((line) =>
      schema.nodes.paragraph.create({}, line.trim() ? schema.text(line) : undefined)
    );
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, paras));
  }

  const modal = modalOpen && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl flex flex-col w-[75vw] h-[70vh] p-5 gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Edit code block</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={modalText}
              onChange={(e) => setModalText(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
              className="flex-1 font-mono text-sm rounded border border-zinc-200 dark:border-zinc-700 p-3 resize-none outline-none bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100"
              style={{ backgroundColor: bgColor, color: isLight ? "#1e1e2e" : "#e2e8f0" }}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveModal}
                className="px-4 py-1.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <NodeViewWrapper className="my-4">
      {/* Action bar — always visible above the block */}
      <div
        contentEditable={false}
        className="flex items-center gap-1 px-2 py-1 rounded-t border border-b-0 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800"
      >
        <span className="text-xs text-zinc-400 dark:text-zinc-500 mr-1">Code block</span>
        <button
          onClick={openModal}
          className="px-2 py-0.5 rounded text-xs border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          Edit
        </button>

        <div ref={pickerRef} className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="px-2 py-0.5 rounded text-xs border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors flex items-center gap-1"
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full border border-zinc-400" style={{ background: bgColor }} />
            Color
          </button>
          {pickerOpen && (
            <div className="absolute left-0 mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-lg z-20 p-2 flex flex-col gap-2 w-36">
              <div className="grid grid-cols-3 gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.label}
                    onClick={() => { updateAttributes({ backgroundColor: c.value }); setPickerOpen(false); }}
                    className="w-full h-6 rounded border border-zinc-200 dark:border-zinc-600 transition-transform hover:scale-110"
                    style={{ background: c.value }}
                  />
                ))}
              </div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400">Custom</label>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => updateAttributes({ backgroundColor: e.target.value })}
                className="w-full h-7 rounded cursor-pointer border-0 p-0"
              />
            </div>
          )}
        </div>

        <button
          onClick={convertToPlain}
          className="px-2 py-0.5 rounded text-xs border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          Plain text
        </button>
      </div>

      <pre
        className="rounded-b overflow-auto not-prose mt-0"
        style={{ backgroundColor: bgColor, color: isLight ? "#1e1e2e" : "#e2e8f0", padding: "1rem", margin: 0, borderRadius: "0 0 0.375rem 0.375rem" }}
      >
        <NodeViewContent style={{ fontFamily: "inherit", background: "transparent", padding: 0, whiteSpace: "pre" }} />
      </pre>

      {modal}
    </NodeViewWrapper>
  );
}

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export const CustomCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-bg-color") ?? null,
        renderHTML: (attrs) =>
          attrs.backgroundColor ? { "data-bg-color": attrs.backgroundColor } : {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
