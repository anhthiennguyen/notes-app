"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTheme } from "@/lib/theme";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { FoldableHeading } from "@/lib/foldable-heading";
import { Indent, CLEANUP_RULES } from "@/lib/indent";
import { DrawingBlock } from "@/lib/drawing-block";
import { CustomCodeBlock } from "@/lib/code-block";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import FileViewer from "@/components/FileViewer";
import ConfirmModal from "@/components/ConfirmModal";

type NoteMeta = { id: number; title: string; updatedAt: string };
type Note = NoteMeta & { content: string; maxWidth?: number | null; titleSetManually: boolean };
type HeadingEntry = { level: number; text: string; pos: number; type: "heading" | "bold" };
type TocSettings = { h1: boolean; h2: boolean; h3: boolean; bold: boolean };

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
  activeLineSpacing,
  activeSpacingBefore,
  activeSpacingAfter,
  maxWidth,
  onMaxWidthChange,
  tocVisible,
  onToggleToc,
  linksVisible,
  onToggleLinks,
}: {
  editor: ReturnType<typeof useEditor> | null;
  activeLevel: number;
  activeFontSize: string;
  activeLineSpacing: string;
  activeSpacingBefore: string;
  activeSpacingAfter: string;
  maxWidth: number;
  onMaxWidthChange: (v: number) => void;
  tocVisible: boolean;
  onToggleToc: () => void;
  linksVisible: boolean;
  onToggleLinks: () => void;
}) {
  const [paraSpacingOpen, setParaSpacingOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const paraSpacingRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (paraSpacingRef.current && !paraSpacingRef.current.contains(e.target as Node)) {
        setParaSpacingOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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

  const sel = "border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-sm bg-white dark:bg-zinc-800 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer outline-none";
  const btn = "px-3 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200";

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm">
      <div className="flex items-center gap-3 px-8 py-2">
      <button
        onClick={() => setFormatOpen((o) => !o)}
        className={`px-3 py-1 rounded border text-sm transition-colors ${
          formatOpen
            ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
            : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"
        }`}
        title="Show formatting options"
      >
        Format {formatOpen ? "▴" : "▾"}
      </button>

      <button onClick={() => editor.chain().focus().selectAll().run()} className={btn} style={{marginLeft: "auto"}}>
        Select all
      </button>

      <button
        onClick={() => {
          if (!editor) return;
          const { state } = editor;
          const { from, to } = state.selection;
          if (from === to) return;

          // Collect the paragraphs that are fully or partially within the selection
          const paras: { pos: number; size: number; text: string }[] = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === "paragraph") {
              const text = node.textContent.trim();
              if (text) paras.push({ pos, size: node.nodeSize, text });
            }
          });
          if (paras.length === 0) return;

          const schema = state.schema;
          const { bulletList, listItem, paragraph: paraNode } = schema.nodes;
          if (!bulletList || !listItem) return;

          // Build sentences: add period if missing
          const sentences = paras.map(({ text }) =>
            /[.!?,;:]$/.test(text) ? text : text + "."
          );

          const replaceFrom = paras[0].pos;
          const replaceTo = paras[paras.length - 1].pos + paras[paras.length - 1].size;

          const items = sentences.map((sentence) =>
            listItem.create({}, paraNode.create({}, schema.text(sentence)))
          );
          const list = bulletList.create({}, items);
          editor.view.dispatch(state.tr.replaceWith(replaceFrom, replaceTo, list));
        }}
        className={btn}
        title="Add periods then convert to bullet points"
      >
        Bulletize
      </button>

      <button
        onClick={() => {
          if (!editor) return;
          const { state, view } = editor;

          const blocks: { node: Parameters<Parameters<typeof state.doc.forEach>[0]>[0]; pos: number }[] = [];
          state.doc.forEach((node, pos) => {
            if (node.type.name === "paragraph" || node.type.name === "heading") {
              blocks.push({ node, pos });
            }
          });

          let tr = state.tr;
          let offset = 0;

          blocks.forEach(({ node, pos }, i) => {
            const isFirst = i === 0;
            const nextNode = blocks[i + 1]?.node;

            const prevNode = blocks[i - 1]?.node;
            const prevIsBlank = prevNode?.type.name === "paragraph" && prevNode.textContent.trim() === "";
            if (prevIsBlank && node.type.name === "paragraph" && node.textContent.trim() !== "") {
              const boldMark = state.schema.marks.bold;
              if (boldMark) {
                const from = pos + offset + 1;
                const to = pos + offset + node.nodeSize - 1;
                tr = tr.addMark(from, to, boldMark.create());
              }
            }
            const nextIsHeading = nextNode?.type.name === "heading";

            const currentStartsBold = node.type.name === "paragraph" &&
              node.firstChild?.marks.some((m: { type: { name: string } }) => m.type.name === "bold");
            const isHeading = node.type.name === "heading";

            const key = isHeading ? `heading_${node.attrs.level}` : "paragraph";
            const rule = CLEANUP_RULES[key] ?? CLEANUP_RULES.paragraph;

            tr = tr.setNodeMarkup(pos + offset, undefined, {
              ...node.attrs,
              indent: (isHeading || currentStartsBold) ? 0 : node.attrs.indent,
              spacingBefore: isFirst ? null : rule.before,
              spacingAfter: rule.after,
            });

            const nextStartsBold = nextNode?.type.name === "paragraph" &&
              nextNode.firstChild?.marks.some((m: { type: { name: string } }) => m.type.name === "bold");

            const isEmpty = node.type.name === "paragraph" && node.textContent.trim() === "";

            if (node.type.name === "paragraph" && !currentStartsBold && !isEmpty && (nextIsHeading || nextStartsBold)) {
              const emptyPara = state.schema.nodes.paragraph.create();
              const insertAt = pos + offset + node.nodeSize;
              tr = tr.insert(insertAt, emptyPara);
              offset += emptyPara.nodeSize;
            }
          });

          view.dispatch(tr);
        }}
        className={btn}
        title="Auto-space headings and paragraphs"
      >
        Clean up
      </button>

      <button
        onClick={() => (editor.chain().focus() as any).toggleCodeBlock().run()}
        className={btn}
        title="Insert code block"
      >
        {"</>"}
      </button>

      <button
        onClick={() =>
          editor.chain().focus().insertContent({ type: "drawingBlock", attrs: { data: "", height: 200 } }).run()
        }
        className={btn}
        title="Insert a drawing box"
      >
        ✏ Draw
      </button>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const src = reader.result as string;
            editor.chain().focus().setImage({ src }).run();
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => imageInputRef.current?.click()}
        className={btn}
        title="Insert image"
      >
        Image
      </button>

      <div className="flex items-center gap-1">
        <label className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Width</label>
        <input
          type="number"
          min={20}
          max={200}
          step={5}
          value={maxWidth}
          onChange={(e) => onMaxWidthChange(Number(e.target.value))}
          className="border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-sm w-16 outline-none bg-white dark:bg-zinc-800 dark:text-zinc-100"
          title="Max content width (rem)"
        />
      </div>

      <button
        onClick={onToggleToc}
        className={`px-3 py-1 rounded border text-sm transition-colors ${
          tocVisible
            ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
            : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"
        }`}
      >
        Contents
      </button>
      <button
        onClick={onToggleLinks}
        className={`px-3 py-1 rounded border text-sm transition-colors ${
          linksVisible
            ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
            : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"
        }`}
      >
        Links
      </button>
      </div>

      {formatOpen && (
        <div className="flex items-center gap-3 px-8 py-2 border-t border-zinc-100 dark:border-zinc-800">
          <select value={activeLevel} onChange={(e) => setFormat(Number(e.target.value))} className={sel}>
            {HEADING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select value={activeFontSize} onChange={(e) => handleFontSize(e.target.value)} className={`${sel} w-20`}>
            <option value="">Size</option>
            {[10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map((s) => (
              <option key={s} value={`${s}px`}>{s}</option>
            ))}
          </select>

          <select
            value={activeLineSpacing}
            onChange={(e) => {
              if (!editor) return;
              const val = e.target.value;
              const cmd = editor.chain().focus() as any;
              if (val) cmd.setLineSpacing(val).run();
              else cmd.unsetLineSpacing().run();
            }}
            className={`${sel} w-24`}
          >
            <option value="">Spacing</option>
            {[["1", "Single"], ["1.15", "1.15"], ["1.5", "1.5×"], ["2", "Double"], ["2.5", "2.5×"], ["3", "Triple"]].map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>

          <div ref={paraSpacingRef} className="relative">
            <button
              onClick={() => setParaSpacingOpen((o) => !o)}
              className={`px-3 py-1 rounded border text-sm transition-colors ${
                paraSpacingOpen
                  ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                  : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"
              }`}
              title="Paragraph spacing"
            >
              ¶
            </button>
            {paraSpacingOpen && (
              <div className="absolute left-0 mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-md z-20 p-3 flex flex-col gap-2 w-48">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Paragraph spacing</p>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Space before</label>
                <select
                  value={activeSpacingBefore}
                  onChange={(e) => (editor.chain().focus() as any).setParaSpacing(e.target.value, activeSpacingAfter).run()}
                  className={sel}
                >
                  <option value="">None</option>
                  {["4pt","8pt","12pt","16pt","24pt","32pt","48pt"].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Space after</label>
                <select
                  value={activeSpacingAfter}
                  onChange={(e) => (editor.chain().focus() as any).setParaSpacing(activeSpacingBefore, e.target.value).run()}
                  className={sel}
                >
                  <option value="">None</option>
                  {["4pt","8pt","12pt","16pt","24pt","32pt","48pt"].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Table of contents ────────────────────────────────────────────────────────

function TableOfContents({
  headings,
  tocSettings,
  onTocSettingsChange,
  onJump,
}: {
  headings: HeadingEntry[];
  tocSettings: TocSettings;
  onTocSettingsChange: (s: TocSettings) => void;
  onJump: (pos: number) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filtered = headings.filter((h) => {
    if (h.type === "bold") return tocSettings.bold;
    if (h.level === 1) return tocSettings.h1;
    if (h.level === 2) return tocSettings.h2;
    if (h.level === 3) return tocSettings.h3;
    return true;
  });

  const minLevel = filtered.length > 0
    ? Math.min(...filtered.filter((h) => h.type === "heading").map((h) => h.level).concat([99]))
    : 1;

  const toggle = (key: keyof TocSettings) =>
    onTocSettingsChange({ ...tocSettings, [key]: !tocSettings[key] });

  return (
    <div className="px-8 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">
          Table of Contents
        </p>
        <div className="relative">
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            title="TOC settings"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2"/>
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
            </svg>
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-lg z-20 p-2 flex flex-col gap-1 min-w-[110px]">
              {(["h1", "h2", "h3", "bold"] as (keyof TocSettings)[]).map((key) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-xs text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-zinc-100 px-1 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700">
                  <input
                    type="checkbox"
                    checked={tocSettings[key]}
                    onChange={() => toggle(key)}
                    className="accent-zinc-800 dark:accent-zinc-200"
                  />
                  {key === "h1" ? "Heading 1" : key === "h2" ? "Heading 2" : key === "h3" ? "Heading 3" : "Bold"}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-zinc-400 dark:text-zinc-500 text-sm italic">Nothing to show — adjust settings or add headings.</p>
      ) : (
        <ul className="space-y-0.5">
          {filtered.map((h, i) => (
            <li
              key={i}
              style={{ paddingLeft: h.type === "bold" ? "0px" : `${(h.level - minLevel) * 16}px` }}
            >
              <button
                onClick={() => onJump(h.pos)}
                className={`text-sm hover:underline text-left truncate max-w-full ${
                  h.type === "bold"
                    ? "font-semibold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100"
                    : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Links panel ──────────────────────────────────────────────────────────────

function getYoutubeEmbedUrl(src: string): string | null {
  const match = src.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!match) return null;
  return `https://www.youtube.com/embed/${match[1]}`;
}

type VideoItem = { src: string; title: string | null; embedUrl: string };

function LinksPanel({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  const [videos, setVideos] = useState<VideoItem[]>([]);

  useEffect(() => {
    if (!editor) return;
    const collected: VideoItem[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name === "youtube") {
        const embedUrl = getYoutubeEmbedUrl(node.attrs.src);
        if (embedUrl) collected.push({ src: node.attrs.src, title: null, embedUrl });
      }
    });
    setVideos(collected);

    collected.forEach((item, i) => {
      fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(item.src)}&format=json`)
        .then((r) => r.json())
        .then((data) => {
          setVideos((prev) => prev.map((v, j) => j === i ? { ...v, title: data.title } : v));
        })
        .catch(() => {});
    });
  }, [editor?.state.doc]);

  return (
    <div className="px-8 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
      <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-3">
        Links
      </p>
      {videos.length === 0 ? (
        <p className="text-zinc-400 dark:text-zinc-500 text-sm italic">No YouTube videos in this note.</p>
      ) : (
        <ul className="space-y-1">
          {videos.map((v, i) => (
            <li key={i}>
              <a
                href={v.src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline truncate block"
              >
                {v.title ?? v.src}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function NotebookPage() {
  const params = useParams();
  const notebookId = Number(params.id);

  const { dark, toggle: toggleTheme } = useTheme();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [linksVisible, setLinksVisible] = useState(false);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [tocSettings, setTocSettings] = useState<TocSettings>({ h1: true, h2: true, h3: true, bold: false });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeLevel, setActiveLevel] = useState(0);
  const [activeFontSize, setActiveFontSize] = useState("");
  const [activeLineSpacing, setActiveLineSpacing] = useState("");
  const [activeSpacingBefore, setActiveSpacingBefore] = useState("");
  const [activeSpacingAfter, setActiveSpacingAfter] = useState("");
  const [maxWidth, setMaxWidth] = useState(56);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [renamingNoteId, setRenamingNoteId] = useState<number | null>(null);
  const [deleteNoteConfirm, setDeleteNoteConfirm] = useState<number | null>(null);
  const [newNoteMenuOpen, setNewNoteMenuOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);
  const [fileViewerPos, setFileViewerPos] = useState(40);
  const fileViewerDraggingRef = useRef(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const titleIsManualRef = useRef(false);

  const extractHeadings = useCallback(
    (ed: NonNullable<ReturnType<typeof useEditor>>) => {
      const found: HeadingEntry[] = [];
      ed.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading") {
          found.push({ level: node.attrs.level, text: node.textContent, pos: offset, type: "heading" });
        } else if (node.type.name === "paragraph") {
          let hasText = false;
          let allBold = true;
          node.forEach((inline) => {
            if (inline.type.name === "text" && inline.text?.trim()) {
              hasText = true;
              if (!inline.marks.some((m) => m.type.name === "bold")) allBold = false;
            }
          });
          if (hasText && allBold) {
            found.push({ level: 0, text: node.textContent, pos: offset, type: "bold" });
          }
        }
      });
      setHeadings(found);
    },
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      CustomCodeBlock,
      Image.configure({ inline: false, allowBase64: true }),
      FoldableHeading,
      TextStyle,
      FontSize,
      Indent,
      DrawingBlock,
      Placeholder.configure({ placeholder: "Start writing…" }),
      Youtube.configure({ width: 640, height: 360, autoplay: false }),
    ],
    editorProps: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
        const ytMatch = text.match(
          /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/
        );
        if (ytMatch) {
          event.preventDefault();
          const { state, dispatch } = view;
          const node = state.schema.nodes.youtube?.create({ src: text });
          if (node) {
            const tr = state.tr.replaceSelectionWith(node);
            dispatch(tr);
            return true;
          }
        }
        return false;
      },
    },
    content: "",
    onUpdate({ editor }) {
      if (!activeNote) return;
      setDirty(true);
      extractHeadings(editor);
      syncToolbarState(editor);
      if (!titleIsManualRef.current) {
        const firstLine = editor.state.doc.firstChild?.textContent.trim() ?? "";
        setTitle(firstLine || "Untitled");
      }
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
    const node = ed.state.selection.$from.node();
    setActiveLineSpacing(node?.attrs?.lineSpacing ?? "");
    setActiveSpacingBefore(node?.attrs?.spacingBefore ?? "");
    setActiveSpacingAfter(node?.attrs?.spacingAfter ?? "");
  }

  useEffect(() => {
    fetchNotes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Read URL params on mount — defer actual open until editor is ready
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const noteId = urlParams.get("note");
    const scroll = urlParams.get("scroll");
    if (noteId) {
      setPendingNoteId(parseInt(noteId, 10));
      if (scroll) setPendingScroll(decodeURIComponent(scroll));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Open pending note once editor is initialised
  useEffect(() => {
    if (!editor || pendingNoteId === null) return;
    openNote(pendingNoteId);
    setPendingNoteId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, pendingNoteId]);

  // Scroll to heading once editor + note are loaded
  useEffect(() => {
    if (!pendingScroll || !editor || !activeNote) return;
    const target = pendingScroll;
    setPendingScroll(null);
    setTimeout(() => {
      let found = -1;
      editor.state.doc.forEach((node, pos) => {
        if (found !== -1) return;
        if (
          (node.type.name === "heading" || node.type.name === "paragraph") &&
          node.textContent.toLowerCase().includes(target.toLowerCase())
        ) {
          found = pos;
        }
      });
      if (found !== -1) {
        const node = editor.state.doc.nodeAt(found);
        const from = found + 1;
        const to = found + 1 + (node?.content.size ?? 0);
        const dom = editor.view.nodeDOM(found);
        if (dom instanceof Element) {
          dom.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        editor.chain().focus().setTextSelection({ from, to }).run();
      }
    }, 300);
  }, [pendingScroll, editor, activeNote]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, activeNote, title, editor]);

  useEffect(() => {
    if (!activeNote) return;
    const id = activeNote.id;
    const t = setTimeout(() => {
      fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxWidth }),
      });
    }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxWidth]);

  // Autosave content + title 1.5s after last change
  useEffect(() => {
    if (!dirty || !activeNote || !editor) return;
    const t = setTimeout(() => save(), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, activeNote?.id]);

  async function fetchNotes() {
    const res = await fetch(`/api/notes?notebookId=${notebookId}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    setNotes(list);
    return list as NoteMeta[];
  }

  async function openNote(id: number) {
    const res = await fetch(`/api/notes/${id}`);
    const note: Note = await res.json();
    titleIsManualRef.current = note.titleSetManually;
    setActiveNote(note);
    setTitle(note.title);
    setMaxWidth(note.maxWidth ?? 56);
    setDirty(false);
    setSidebarVisible(false);
    editor?.commands.setContent(note.content);
    if (editor) extractHeadings(editor);
  }

  async function newNote() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebookId }),
    });
    const note: Note = await res.json();
    titleIsManualRef.current = false;
    await fetchNotes();
    openNote(note.id);
  }

  async function importNote(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("notebookId", String(notebookId));
    const res = await fetch("/api/import", { method: "POST", body: formData });
    if (!res.ok) { alert("Import failed: " + (await res.text().catch(() => res.statusText))); return; }
    const note: Note = await res.json();
    await fetchNotes();
    openNote(note.id);
  }

  async function save() {
    if (!activeNote || !editor) return;
    const data = { title, content: editor.getHTML(), titleSetManually: titleIsManualRef.current };
    const res = await fetch(`/api/notes/${activeNote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      console.error("Save failed:", res.status, msg);
      alert(`Save failed (${res.status}): ${msg}`);
      return;
    }
    setDirty(false);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === activeNote.id
          ? { ...n, ...data, updatedAt: new Date().toISOString() }
          : n
      )
    );
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    titleIsManualRef.current = true;
    setTitle(e.target.value);
    setDirty(true);
  }

  async function commitRename(id: number) {
    const newTitle = renameVal.trim() || "Untitled";
    setRenamingNoteId(null);
    if (activeNote?.id === id) titleIsManualRef.current = true;
    await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, titleSetManually: true }),
    });
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, title: newTitle } : n));
    if (activeNote?.id === id) setTitle(newTitle);
  }

  async function deleteNote(id: number) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    await fetchNotes();
    if (activeNote?.id === id) {
      setActiveNote(null);
      setTitle("");
      setHeadings([]);
      editor?.commands.clearContent();
    }
  }

  function exportNote(format: "pdf" | "docx") {
    if (!activeNote) return;
    setExportOpen(false);
    window.location.href = `/api/export/${activeNote.id}?format=${format}`;
  }

  function jumpToHeading(pos: number) {
    if (!editor) return;

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
    <div className="flex h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 transition-all duration-200 overflow-hidden ${sidebarVisible ? "w-64" : "w-0"}`}>
        <div className="p-3 flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
          <Link
            href="/"
            className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-center dark:text-zinc-300"
            title="Back to notebooks"
          >
            ←
          </Link>
          <Link
            href={`/notebook/${notebookId}/diagram`}
            className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-center dark:text-zinc-300"
            title="Open diagram view"
          >
            ⬡
          </Link>
          <Link
            href={`/notebook/${notebookId}/quiz`}
            className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-center dark:text-zinc-300"
            title="Open quiz view"
          >
            ?
          </Link>
          <button
            onClick={() => setFileViewerOpen((v) => !v)}
            className={`text-sm border rounded px-3 py-1.5 transition-colors text-center ${fileViewerOpen ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-300"}`}
            title="Open file viewer"
          >
            ⊞
          </button>
          <div className="relative flex-1">
            <input
              ref={importInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importNote(file);
                e.target.value = "";
                setNewNoteMenuOpen(false);
              }}
            />
            <button
              onClick={() => setNewNoteMenuOpen((o) => !o)}
              className="w-full text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors rounded"
            >
              +
            </button>
            {newNoteMenuOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-lg z-20 overflow-hidden">
                <button
                  onClick={() => { newNote(); setNewNoteMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors"
                >
                  Blank note
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors border-t border-zinc-100 dark:border-zinc-700"
                >
                  Import PDF or Word
                </button>
              </div>
            )}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <li
              key={note.id}
              onClick={() => renamingNoteId !== note.id && openNote(note.id)}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                activeNote?.id === note.id ? "bg-zinc-200 dark:bg-zinc-700" : ""
              }`}
            >
              {renamingNoteId === note.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(note.id);
                    if (e.key === "Escape") setRenamingNoteId(null);
                    e.stopPropagation();
                  }}
                  onBlur={() => commitRename(note.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm flex-1 bg-transparent outline-none border-b border-zinc-400 dark:border-zinc-500 dark:text-zinc-100 min-w-0"
                />
              ) : (
                <span
                  className="text-sm truncate flex-1 dark:text-zinc-200"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingNoteId(note.id);
                    setRenameVal(note.title || "Untitled");
                  }}
                >
                  {note.title || "Untitled"}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteNoteConfirm(note.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 ml-2 text-xs transition-opacity"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* File viewer + editor split */}
      <div className="flex flex-1 overflow-hidden">
        {fileViewerOpen && (
          <>
            <div style={{ width: `${fileViewerPos}%` }} className="h-full shrink-0 overflow-hidden">
              <FileViewer onClose={() => setFileViewerOpen(false)} />
            </div>
            <div
              className="w-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                fileViewerDraggingRef.current = true;
                const onMove = (ev: MouseEvent) => {
                  if (!fileViewerDraggingRef.current) return;
                  const container = (e.target as HTMLElement).parentElement!;
                  const rect = container.getBoundingClientRect();
                  const pct = ((ev.clientX - rect.left) / rect.width) * 100;
                  setFileViewerPos(Math.min(80, Math.max(15, pct)));
                };
                const onUp = () => {
                  fileViewerDraggingRef.current = false;
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
          </>
        )}
        <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeNote ? (
          <>
            <div className="border-b border-zinc-200 dark:border-zinc-700 px-4 py-3 flex items-center gap-3">
              <button
                onClick={() => setSidebarVisible((v) => !v)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0"
                title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              >
                ☰
              </button>
              <input
                value={title}
                onChange={handleTitleChange}
                onKeyDown={(e) => e.key === "Enter" && save()}
                onBlur={save}
                placeholder="Note title"
                className="flex-1 text-xl font-semibold outline-none bg-transparent placeholder-zinc-300 dark:placeholder-zinc-600 dark:text-zinc-100"
              />
              {dirty && <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">Unsaved</span>}
              <button
                onClick={save}
                disabled={!dirty}
                className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300 disabled:opacity-40 disabled:cursor-default"
              >
                Save
              </button>
              <button
                onClick={toggleTheme}
                className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300"
                title="Toggle dark mode"
              >
                {dark ? "☀" : "☾"}
              </button>
              <div ref={exportRef} className="relative">
                <button
                  onClick={() => setExportOpen((o) => !o)}
                  className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-300 transition-colors"
                >
                  Export ↓
                </button>
                {exportOpen && (
                  <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-md z-10">
                    <button
                      onClick={() => exportNote("pdf")}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors"
                    >
                      Download PDF
                    </button>
                    <button
                      onClick={() => exportNote("docx")}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors"
                    >
                      Download Word
                    </button>
                  </div>
                )}
              </div>
            </div>

            <Toolbar
              editor={editor}
              activeLevel={activeLevel}
              activeFontSize={activeFontSize}
              activeLineSpacing={activeLineSpacing}
              activeSpacingBefore={activeSpacingBefore}
              activeSpacingAfter={activeSpacingAfter}
              maxWidth={maxWidth}
              onMaxWidthChange={setMaxWidth}
              tocVisible={tocVisible}
              onToggleToc={() => setTocVisible((v) => !v)}
              linksVisible={linksVisible}
              onToggleLinks={() => setLinksVisible((v) => !v)}
            />

            {tocVisible && (
              <TableOfContents headings={headings} tocSettings={tocSettings} onTocSettingsChange={setTocSettings} onJump={jumpToHeading} />
            )}
            {linksVisible && <LinksPanel editor={editor} />}

            <div className="flex-1 overflow-y-auto bg-zinc-100 dark:bg-zinc-950 py-8">
              <EditorContent
                editor={editor}
                style={{ maxWidth: `${maxWidth}rem`, zoom }}
                className="mx-auto bg-white dark:bg-zinc-900 prose prose-zinc dark:prose-invert px-16 py-12 min-h-full focus:outline-none"
              />
            </div>
            {/* Zoom slider — outside scroll area so it stays fixed */}
            <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 shadow-sm z-10">
              <button
                onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-sm leading-none select-none"
              >−</button>
              <input
                type="range"
                min={0.25} max={3} step={0.05}
                value={zoom}
                onChange={(e) => setZoom(+e.target.value)}
                className="w-24 accent-zinc-600 dark:accent-zinc-400 cursor-pointer"
              />
              <button
                onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-sm leading-none select-none"
              >+</button>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 w-8 text-right tabular-nums">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(1)}
                className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                title="Reset zoom"
              >↺</button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <button
                onClick={() => setSidebarVisible((v) => !v)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              >
                ☰
              </button>
              <button
                onClick={toggleTheme}
                className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300"
                title="Toggle dark mode"
              >
                {dark ? "☀" : "☾"}
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
              Select a note or create a new one
            </div>
          </div>
        )}
      </main>
      </div>

      <ConfirmModal
        open={deleteNoteConfirm !== null}
        title="Delete note?"
        message="This cannot be undone."
        onConfirm={() => { deleteNote(deleteNoteConfirm!); setDeleteNoteConfirm(null); }}
        onCancel={() => setDeleteNoteConfirm(null)}
      />
    </div>
  );
}
