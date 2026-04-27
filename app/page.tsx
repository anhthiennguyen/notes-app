"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/theme";
import ConfirmModal from "@/components/ConfirmModal";

type Notebook = {
  id: number;
  name: string;
  coverImage?: string | null;
  updatedAt: string;
  _count: { notes: number };
};

export default function Home() {
  const router = useRouter();
  const { dark, toggle: toggleTheme } = useTheme();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverTargetId = useRef<number | null>(null);

  useEffect(() => {
    fetchNotebooks();
  }, []);

  useEffect(() => {
    if (renamingId !== null) renameRef.current?.focus();
  }, [renamingId]);


  async function fetchNotebooks() {
    setLoading(true);
    const res = await fetch("/api/notebooks");
    const data = await res.json();
    setNotebooks(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function createNotebook() {
    const res = await fetch("/api/notebooks", { method: "POST" });
    const nb: Notebook = await res.json();
    await fetchNotebooks();
    setRenamingId(nb.id);
    setRenameVal("Untitled Notebook");
  }

  async function renameNotebook(id: number) {
    const name = renameVal.trim() || "Untitled Notebook";
    await fetch(`/api/notebooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenamingId(null);
    setRenameVal("");
    fetchNotebooks();
  }

  async function deleteNotebook(id: number) {
    await fetch(`/api/notebooks/${id}`, { method: "DELETE" });
    fetchNotebooks();
  }

  async function uploadCover(id: number, file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      await fetch(`/api/notebooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverImage: dataUrl }),
      });
      fetchNotebooks();
    };
    reader.readAsDataURL(file);
  }

  async function exportNotebook(id: number, name: string, format: "pdf" | "docx") {
    setExportingId(id);
    try {
      const res = await fetch(`/api/notebooks/${id}/export?format=${format}`);
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        alert("Export failed: " + msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[/\\?%*:|"<>]/g, "-") || "notebook"}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export error: " + err);
    } finally {
      setExportingId(null);
    }
  }

  async function downloadAll() {
    setExportingAll(true);
    try {
      const res = await fetch("/api/notebooks/export-all");
      if (!res.ok) { alert("Export failed: " + await res.text().catch(() => res.statusText)); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "all-notebooks.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export error: " + err);
    } finally {
      setExportingAll(false);
    }
  }

  async function downloadKeywords(id: number, name: string) {
    try {
      const res = await fetch(`/api/diagram-keywords?notebookId=${id}`);
      const keywords = await res.json();
      const blob = new Blob([JSON.stringify(keywords, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `keywords-notebook-${id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Keywords export error: " + err);
    }
  }

  async function removeCover(id: number) {
    await fetch(`/api/notebooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverImage: null }),
    });
    fetchNotebooks();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Hidden file input for cover upload */}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && coverTargetId.current !== null) {
            uploadCover(coverTargetId.current, file);
          }
          e.target.value = "";
        }}
      />

      {/* Header */}
      <header className="px-10 py-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">Notebooks</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300"
            title="Toggle dark mode"
          >
            {dark ? "☀" : "☾"}
          </button>
          <button
            onClick={downloadAll}
            disabled={exportingAll}
            className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-300 disabled:opacity-50 disabled:cursor-wait"
            title="Download all notebooks as PDF, DOCX and keywords"
          >
            {exportingAll ? "Exporting…" : "Download All"}
          </button>
          <button
            onClick={createNotebook}
            className="text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded px-4 py-1.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
          >
            + New Notebook
          </button>
        </div>
      </header>

      {/* Grid */}
      <main className="px-10 py-8">
        {loading ? (
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="relative flex flex-col" style={{ minHeight: "220px" }}>
                {/* Spine */}
                <div className="absolute left-0 top-2 bottom-2 w-3 rounded-l-sm bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
                {/* Cover */}
                <div className="flex-1 ml-3 rounded-r-md rounded-tl-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
                  <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 animate-pulse" style={{ minHeight: "140px" }} />
                  <div className="px-3 py-2 bg-white dark:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-700">
                    <div className="h-3 bg-zinc-200 dark:bg-zinc-600 rounded animate-pulse w-3/4 mb-2" />
                    <div className="h-2 bg-zinc-100 dark:bg-zinc-700 rounded animate-pulse w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : notebooks.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-zinc-400 dark:text-zinc-500 text-sm">
            No notebooks yet — create one to get started
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {notebooks.map((nb) => (
              <div
                key={nb.id}
                onClick={() => renamingId !== nb.id && router.push(`/notebook/${nb.id}`)}
                className="group relative flex flex-col cursor-pointer select-none"
                style={{ minHeight: "220px" }}
              >
                {/* Notebook spine */}
                <div className="absolute left-0 top-2 bottom-2 w-3 rounded-l-sm bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />

                {/* Export loading overlay */}
                {exportingId === nb.id && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-white/80 dark:bg-zinc-900/80 rounded-r-md rounded-tl-sm ml-3">
                    <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Exporting…</span>
                  </div>
                )}

                {/* Notebook cover */}
                <div className="flex-1 ml-3 rounded-r-md rounded-tl-sm border border-zinc-200 dark:border-zinc-700 group-hover:border-zinc-400 dark:group-hover:border-zinc-500 transition-colors shadow-sm overflow-hidden flex flex-col">
                  {/* Cover image or lines */}
                  <div className="flex-1 relative">
                    {nb.coverImage ? (
                      <img
                        src={nb.coverImage}
                        alt=""
                        className="w-full h-full object-cover"
                        style={{ minHeight: "140px" }}
                      />
                    ) : (
                      <div className="w-full h-full bg-white dark:bg-zinc-800 flex flex-col justify-end gap-1.5 p-4 pb-2" style={{ minHeight: "140px" }}>
                        {[...Array(6)].map((_, i) => (
                          <div key={i} className="h-px bg-zinc-100 dark:bg-zinc-700 rounded" />
                        ))}
                      </div>
                    )}

                    {/* Cover image actions — shown on hover */}
                    <div className="absolute inset-0 hidden group-hover:flex items-center justify-center gap-2 bg-black/20">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          coverTargetId.current = nb.id;
                          coverInputRef.current?.click();
                        }}
                        className="bg-white/90 hover:bg-white text-zinc-800 rounded-full p-1.5 transition-colors shadow"
                        title={nb.coverImage ? "Change cover" : "Add cover image"}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="1" y="3" width="14" height="11" rx="2"/>
                          <circle cx="8" cy="8.5" r="2.5"/>
                          <path d="M5 3l1.5-2h3L11 3"/>
                        </svg>
                      </button>
                      {nb.coverImage && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeCover(nb.id); }}
                          className="bg-white/90 hover:bg-white text-zinc-800 rounded-full p-1.5 transition-colors shadow"
                          title="Remove cover"
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Name + count + export */}
                  <div className="px-3 py-2 bg-white dark:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-700">
                    {renamingId === nb.id ? (
                      <input
                        ref={renameRef}
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameNotebook(nb.id);
                          if (e.key === "Escape") { setRenamingId(null); setRenameVal(""); }
                          e.stopPropagation();
                        }}
                        onBlur={() => renameNotebook(nb.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-sm font-semibold bg-transparent border-b border-zinc-400 dark:border-zinc-500 outline-none dark:text-zinc-100 pb-0.5"
                      />
                    ) : (
                      <p className="text-sm font-semibold truncate dark:text-zinc-100 leading-tight">
                        {nb.name}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        {nb._count.notes} {nb._count.notes === 1 ? "note" : "notes"}
                      </p>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => exportNotebook(nb.id, nb.name, "pdf")}
                          disabled={exportingId === nb.id}
                          className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40"
                          title="Export all as PDF"
                        >
                          PDF
                        </button>
                        <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
                        <button
                          onClick={() => exportNotebook(nb.id, nb.name, "docx")}
                          disabled={exportingId === nb.id}
                          className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40"
                          title="Export all as Word"
                        >
                          DOCX
                        </button>
                        <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
                        <button
                          onClick={() => downloadKeywords(nb.id, nb.name)}
                          className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                          title="Download keywords as JSON"
                        >
                          KW
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rename / delete actions */}
                <div className="absolute top-1 right-1 hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(nb.id);
                      setRenameVal(nb.name);
                    }}
                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors p-1 rounded hover:bg-white/80 dark:hover:bg-zinc-700"
                    title="Rename"
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 2l3 3-9 9H2v-3L11 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm({ id: nb.id, name: nb.name });
                    }}
                    className="text-zinc-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-white/80 dark:hover:bg-zinc-700"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <ConfirmModal
        open={deleteConfirm !== null}
        title={`Delete "${deleteConfirm?.name}"?`}
        message="This will also delete all its notes and diagram. This cannot be undone."
        onConfirm={() => { deleteNotebook(deleteConfirm!.id); setDeleteConfirm(null); }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
