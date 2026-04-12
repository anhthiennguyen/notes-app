"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { FoldableHeading } from "@/lib/foldable-heading";

type NoteMeta = { id: number; title: string; updatedAt: string };
type Note = NoteMeta & { content: string };
type HeadingEntry = { level: number; text: string; pos: number };

// ── Heading dropdown ────────────────────────────────────────────────────────

const HEADING_OPTIONS = [
  { label: "Paragraph", value: 0 },
  { label: "Heading 1", value: 1 },
  { label: "Heading 2", value: 2 },
  { label: "Heading 3", value: 3 },
  { label: "Heading 4", value: 4 },
  { label: "Heading 5", value: 5 },
  { label: "Heading 6", value: 6 },
];

function Toolbar({
  editor,
  activeLevel,
  activeFontSize,
  tocVisible,
  onToggleToc,
}: {
  editor: ReturnType<typeof useEditor> | null;
  activeLevel: number;
  activeFontSize: string;
  tocVisible: boolean;
  onToggleToc: () => void;
}) {
  if (!editor) return null;

  function setFormat(value: number) {
    if (!editor) return;
    if (value === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor
        .chain()
        .focus()
        .toggleHeading({ level: value as 1 | 2 | 3 | 4 | 5 | 6 })
        .run();
    }
  }

  function handleFontSize(val: string) {
    if (!editor) return;
    const chain = editor.chain().focus() as any;
    if (val) {
      chain.setFontSize(val).run();
    } else {
      chain.unsetFontSize().run();
    }
  }

  return (
    <div className="flex items-center gap-3 px-8 py-2 border-b border-zinc-100 bg-zinc-50 text-sm">
      <select
        value={activeLevel}
        onChange={(e) => setFormat(Number(e.target.value))}
        className="border border-zinc-300 rounded px-2 py-1 text-sm bg-white hover:bg-zinc-50 cursor-pointer outline-none"
      >
        {HEADING_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={activeFontSize}
        onChange={(e) => handleFontSize(e.target.value)}
        className="border border-zinc-300 rounded px-2 py-1 text-sm bg-white hover:bg-zinc-50 cursor-pointer outline-none w-20"
      >
        <option value="">Size</option>
        {[10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map((s) => (
          <option key={s} value={`${s}px`}>
            {s}
          </option>
        ))}
      </select>

      <button
        onClick={onToggleToc}
        className={`px-3 py-1 rounded border text-sm transition-colors ${
          tocVisible
            ? "bg-zinc-900 text-white border-zinc-900"
            : "border-zinc-300 hover:bg-zinc-100"
        }`}
      >
        Contents
      </button>
    </div>
  );
}

// ── Table of contents ────────────────────────────────────────────────────────

function TableOfContents({
  headings,
  onJump,
}: {
  headings: HeadingEntry[];
  onJump: (pos: number) => void;
}) {
  if (headings.length === 0) {
    return (
      <div className="px-8 py-3 text-zinc-400 text-sm border-b border-zinc-100 bg-zinc-50 italic">
        No headings yet — add Heading 1/2/3 to populate the table of contents.
      </div>
    );
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <div className="px-8 py-3 border-b border-zinc-200 bg-zinc-50">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
        Table of Contents
      </p>
      <ul className="space-y-0.5">
        {headings.map((h, i) => (
          <li
            key={i}
            style={{ paddingLeft: `${(h.level - minLevel) * 16}px` }}
          >
            <button
              onClick={() => onJump(h.pos)}
              className="text-sm text-zinc-700 hover:text-zinc-900 hover:underline text-left truncate max-w-full"
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeLevel, setActiveLevel] = useState(0);
  const [activeFontSize, setActiveFontSize] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const extractHeadings = useCallback(
    (ed: NonNullable<ReturnType<typeof useEditor>>) => {
      const found: HeadingEntry[] = [];
      ed.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading") {
          found.push({ level: node.attrs.level, text: node.textContent, pos: offset });
        }
      });
      setHeadings(found);
    },
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      FoldableHeading,
      TextStyle,
      FontSize,
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: "",
    onUpdate({ editor }) {
      if (!activeNote) return;
      const content = editor.getHTML();
      scheduleSave({ content });
      extractHeadings(editor);
      syncToolbarState(editor);
    },
    onSelectionUpdate({ editor }) {
      syncToolbarState(editor);
    },
  });

  function syncToolbarState(ed: NonNullable<ReturnType<typeof useEditor>>) {
    const level =
      HEADING_OPTIONS.find(
        (o) => o.value !== 0 && ed.isActive("heading", { level: o.value })
      )?.value ?? 0;
    setActiveLevel(level);
    setActiveFontSize(ed.getAttributes("textStyle").fontSize ?? "");
  }

  useEffect(() => {
    fetchNotes();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function fetchNotes() {
    const res = await fetch("/api/notes");
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    setNotes(list);
    return list as NoteMeta[];
  }

  async function openNote(id: number) {
    const res = await fetch(`/api/notes/${id}`);
    const note: Note = await res.json();
    setActiveNote(note);
    setTitle(note.title);
    editor?.commands.setContent(note.content);
    if (editor) extractHeadings(editor);
  }

  async function newNote() {
    const res = await fetch("/api/notes", { method: "POST" });
    const note: Note = await res.json();
    const updated = await fetchNotes();
    setNotes(updated);
    openNote(note.id);
  }

  function scheduleSave(data: Partial<Note>) {
    if (!activeNote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(data), 600);
  }

  async function save(data: Partial<Note>) {
    if (!activeNote) return;
    await fetch(`/api/notes/${activeNote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setNotes((prev) =>
      prev.map((n) =>
        n.id === activeNote.id
          ? { ...n, ...data, updatedAt: new Date().toISOString() }
          : n
      )
    );
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTitle(e.target.value);
    scheduleSave({ title: e.target.value });
  }

  async function deleteNote(id: number) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    const updated = await fetchNotes();
    setNotes(updated);
    if (activeNote?.id === id) {
      setActiveNote(null);
      setTitle("");
      setHeadings([]);
      editor?.commands.clearContent();
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: form });
    if (res.ok) {
      const note: Note = await res.json();
      const updated = await fetchNotes();
      setNotes(updated);
      openNote(note.id);
    }
    setImporting(false);
    e.target.value = "";
  }

  function exportNote(format: "pdf" | "docx") {
    if (!activeNote) return;
    setExportOpen(false);
    window.location.href = `/api/export/${activeNote.id}?format=${format}`;
  }

  function jumpToHeading(pos: number) {
    if (!editor) return;

    // Unfold any parent headings that are hiding the target
    const { state } = editor;
    let tr = state.tr;
    let changed = false;

    state.doc.forEach((node, nodePos) => {
      if (nodePos >= pos) return false;
      if (node.type.name === "heading" && node.attrs.folded) {
        tr = tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, folded: false });
        changed = true;
      }
    });

    if (changed) editor.view.dispatch(tr);

    setTimeout(() => {
      editor.chain().focus().setTextSelection(pos + 1).run();
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof Element) {
        dom.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, changed ? 50 : 0);
  }

  return (
    <div className="flex h-screen bg-white text-zinc-900 font-sans">
      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-zinc-200 bg-zinc-50 transition-all duration-200 overflow-hidden ${sidebarVisible ? "w-64" : "w-0"}`}>
        <div className="p-3 flex gap-2 border-b border-zinc-200">
          <button
            onClick={newNote}
            className="flex-1 text-sm bg-zinc-900 text-white rounded px-3 py-1.5 hover:bg-zinc-700 transition-colors"
          >
            New note
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="text-sm border border-zinc-300 rounded px-3 py-1.5 hover:bg-zinc-100 transition-colors disabled:opacity-50"
            title="Import PDF or Word doc"
          >
            {importing ? "…" : "Import"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={handleImport}
          />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <li
              key={note.id}
              onClick={() => openNote(note.id)}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-100 ${
                activeNote?.id === note.id ? "bg-zinc-200" : ""
              }`}
            >
              <span className="text-sm truncate flex-1">
                {note.title || "Untitled"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNote(note.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 ml-2 text-xs transition-opacity"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Editor */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeNote ? (
          <>
            {/* Title + export */}
            <div className="border-b border-zinc-200 px-4 py-3 flex items-center gap-3">
              <button
                onClick={() => setSidebarVisible((v) => !v)}
                className="text-zinc-400 hover:text-zinc-700 transition-colors shrink-0"
                title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              >
                ☰
              </button>
              <input
                value={title}
                onChange={handleTitleChange}
                placeholder="Note title"
                className="flex-1 text-xl font-semibold outline-none bg-transparent placeholder-zinc-300"
              />
<div ref={exportRef} className="relative">
                <button
                  onClick={() => setExportOpen((o) => !o)}
                  className="text-sm border border-zinc-300 rounded px-3 py-1.5 hover:bg-zinc-100 transition-colors"
                >
                  Export ↓
                </button>
                {exportOpen && (
                  <div className="absolute right-0 mt-1 w-36 bg-white border border-zinc-200 rounded shadow-md z-10">
                    <button
                      onClick={() => exportNote("pdf")}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 transition-colors"
                    >
                      Download PDF
                    </button>
                    <button
                      onClick={() => exportNote("docx")}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 transition-colors"
                    >
                      Download Word
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Toolbar */}
            <Toolbar
              editor={editor}
              activeLevel={activeLevel}
              activeFontSize={activeFontSize}
              tocVisible={tocVisible}
              onToggleToc={() => setTocVisible((v) => !v)}
            />

            {/* Table of contents */}
            {tocVisible && (
              <TableOfContents headings={headings} onJump={jumpToHeading} />
            )}

            {/* Editor body */}
            <div className="flex-1 overflow-y-auto bg-white py-8">
              <EditorContent
                editor={editor}
                className="mx-auto bg-white prose prose-zinc max-w-4xl px-16 py-12 min-h-full focus:outline-none"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-zinc-200 flex items-center">
              <button
                onClick={() => setSidebarVisible((v) => !v)}
                className="text-zinc-400 hover:text-zinc-700 transition-colors"
                title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              >
                ☰
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
              Select a note or create a new one
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
