"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTheme } from "@/lib/theme";

type NoteMeta = { id: number; title: string; updatedAt: string };
type Note = NoteMeta & { content: string };

type QuizItem = {
  id: string;
  question: string;
  answer: string;
};

function parseQuizItems(html: string): QuizItem[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items: QuizItem[] = [];
  let idx = 0;
  doc.body.childNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const boldEls = [...el.querySelectorAll("strong, b")];
    if (boldEls.length === 0) return;
    const question = boldEls.map((b) => b.textContent ?? "").join(" ").trim();
    const answer = el.textContent?.trim() ?? "";
    if (!question) return;
    items.push({ id: `q${idx++}`, question, answer });
  });
  return items;
}

export default function QuizPage() {
  const params = useParams();
  const notebookId = Number(params.id);
  const { dark, toggle: toggleTheme } = useTheme();

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`/api/notes?notebookId=${notebookId}`)
      .then((r) => r.json())
      .then((d) => setNotes(Array.isArray(d) ? d : []));
  }, [notebookId]);

  const loadNote = useCallback(async (id: number) => {
    const res = await fetch(`/api/notes/${id}`);
    const note: Note = await res.json();
    setActiveNote(note);
    setItems(parseQuizItems(note.content));
    setAnswers({});
    setRevealed({});
  }, []);

  function toggleReveal(id: string) {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function revealAll() {
    const all: Record<string, boolean> = {};
    items.forEach((item) => { all[item.id] = true; });
    setRevealed(all);
  }

  function resetAll() {
    setAnswers({});
    setRevealed({});
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 shrink-0">
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Quiz</span>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                title="Toggle dark mode"
              >
                {dark ? "☀" : "☾"}
              </button>
              <Link
                href={`/notebook/${notebookId}`}
                className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                ← Notes
              </Link>
            </div>
          </div>
          {activeNote && (
            <div className="flex gap-2">
              <button
                onClick={revealAll}
                className="flex-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200"
              >
                Reveal all
              </button>
              <button
                onClick={resetAll}
                className="flex-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        <ul className="overflow-y-auto flex-1">
          {notes.map((note) => (
            <li
              key={note.id}
              onClick={() => loadNote(note.id)}
              className={`px-3 py-2 text-sm cursor-pointer truncate ${
                activeNote?.id === note.id
                  ? "bg-zinc-200 dark:bg-zinc-700 font-medium"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {note.title || "Untitled"}
            </li>
          ))}
        </ul>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {!activeNote ? (
          <div className="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
            Select a note to start the quiz
          </div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
            No bold text found in this note
          </div>
        ) : (
          <div className="max-w-2xl mx-auto py-10 px-6 flex flex-col gap-6">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 flex flex-col gap-3"
              >
                <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide">
                  {i + 1} / {items.length}
                </p>
                <p className="font-semibold text-base">{item.question}</p>
                <textarea
                  value={answers[item.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                  placeholder="Type your answer…"
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500 dark:text-zinc-100 placeholder:text-zinc-400"
                />
                <div>
                  <button
                    onClick={() => toggleReveal(item.id)}
                    className="text-xs border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200"
                  >
                    {revealed[item.id] ? "Hide answer" : "Show answer"}
                  </button>
                  {revealed[item.id] && (
                    <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300 border-l-2 border-zinc-300 dark:border-zinc-600 pl-3">
                      {item.answer}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
