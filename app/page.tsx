"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/theme";

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
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
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
    const res = await fetch("/api/notebooks");
    const data = await res.json();
    setNotebooks(Array.isArray(data) ? data : []);
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
            onClick={createNotebook}
            className="text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded px-4 py-1.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
          >
            + New Notebook
          </button>
        </div>
      </header>

      {/* Grid */}
      <main className="px-10 py-8">
        {notebooks.length === 0 ? (
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

                  {/* Name + count */}
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
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                      {nb._count.notes} {nb._count.notes === 1 ? "note" : "notes"}
                    </p>
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
                      if (confirm(`Delete "${nb.name}"? This will also delete all its notes and diagram.`)) {
                        deleteNotebook(nb.id);
                      }
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
    </div>
  );
}
