"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

type CardScore = { right: number; wrong: number };
type ScoreMap = Record<string, CardScore>;

type ContextMenu = { x: number; y: number; item: QuizItem };

function parseQuizItems(html: string): QuizItem[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const children = [...doc.body.childNodes].filter((n) => n.nodeType === 1) as Element[];
  const items: QuizItem[] = [];
  let idx = 0;
  let i = 0;
  while (i < children.length) {
    const el = children[i];
    const boldEls = [...el.querySelectorAll("strong, b")];
    if (boldEls.length === 0) { i++; continue; }

    const question = boldEls.map((b) => b.textContent ?? "").join(" ").trim();
    if (!question) { i++; continue; }

    const boldSet = new Set(boldEls);
    const inline = [...el.childNodes]
      .filter((c) => !boldSet.has(c as Element))
      .map((c) => c.textContent ?? "")
      .join("")
      .trim();

    const answerLines: string[] = [];
    let j = i + 1;
    while (j < children.length && children[j].querySelectorAll("strong, b").length === 0) {
      const t = children[j].textContent?.trim() ?? "";
      if (t) answerLines.push(t);
      j++;
    }
    const answer = inline || answerLines.join("\n");
    items.push({ id: `q${idx++}`, question, answer });
    i = answerLines.length > 0 ? j : i + 1;
  }
  return items;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoresKey(notebookId: number, noteId: number) {
  return `quiz-scores-${notebookId}-${noteId}`;
}

function loadScores(notebookId: number, noteId: number): ScoreMap {
  try {
    const raw = localStorage.getItem(scoresKey(notebookId, noteId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveScores(notebookId: number, noteId: number, scores: ScoreMap) {
  localStorage.setItem(scoresKey(notebookId, noteId), JSON.stringify(scores));
}

function clearScores(notebookId: number, noteId: number) {
  localStorage.removeItem(scoresKey(notebookId, noteId));
}

function buildQueue(items: QuizItem[], count: number, scores: ScoreMap): QuizItem[] {
  const weighted = items.map((item) => {
    const s = scores[item.question] ?? { right: 0, wrong: 0 };
    const total = s.right + s.wrong;
    const wrongRatio = total === 0 ? 0.5 : s.wrong / total;
    return { item, wrongRatio };
  });
  weighted.sort((a, b) => {
    if (b.wrongRatio !== a.wrongRatio) return b.wrongRatio - a.wrongRatio;
    return Math.random() - 0.5;
  });
  return weighted.slice(0, Math.min(count, items.length)).map((w) => w.item);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuizPage() {
  const params = useParams();
  const notebookId = Number(params.id);
  const { dark, toggle: toggleTheme } = useTheme();

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [scores, setScores] = useState<ScoreMap>({});
  const [mode, setMode] = useState<"all" | "flashcard">("all");

  // All mode
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // Flashcard session
  const [sessionCount, setSessionCount] = useState(10);
  const [sessionActive, setSessionActive] = useState(false);
  const [queue, setQueue] = useState<QuizItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [sessionRight, setSessionRight] = useState(0);
  const [sessionWrong, setSessionWrong] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);

  // Split / context menu
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPos, setSplitPos] = useState(50);
  const [splitSrc, setSplitSrc] = useState(`/notebook/${notebookId}`);
  const splitDraggingRef = useRef(false);

  useEffect(() => {
    fetch(`/api/notes?notebookId=${notebookId}`)
      .then((r) => r.json())
      .then((d) => setNotes(Array.isArray(d) ? d : []));
  }, [notebookId]);

  useEffect(() => {
    if (!contextMenu) return;
    function dismiss(e: MouseEvent) {
      if ((e.target as Element)?.closest(".ctx-menu")) return;
      setContextMenu(null);
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [contextMenu]);

  const loadNote = useCallback(async (id: number) => {
    const res = await fetch(`/api/notes/${id}`);
    const note: Note = await res.json();
    setActiveNote(note);
    setItems(parseQuizItems(note.content));
    setAnswers({});
    setRevealed({});
    setSessionActive(false);
    setSessionDone(false);
    setScores(loadScores(notebookId, id));
  }, [notebookId]);

  function revealAll() {
    const all: Record<string, boolean> = {};
    items.forEach((item) => { all[item.id] = true; });
    setRevealed(all);
  }

  function resetAll() { setAnswers({}); setRevealed({}); }

  // ── Session helpers ───────────────────────────────────────────────────────

  function startSession() {
    const q = buildQueue(items, sessionCount, scores);
    setQueue(q);
    setQueueIndex(0);
    setCardRevealed(false);
    setSessionRight(0);
    setSessionWrong(0);
    setSessionDone(false);
    setSessionActive(true);
  }

  function handleGotIt() {
    if (!activeNote) return;
    const card = queue[queueIndex];
    const updated = { ...scores };
    const prev = updated[card.question] ?? { right: 0, wrong: 0 };
    updated[card.question] = { ...prev, right: prev.right + 1 };
    setScores(updated);
    saveScores(notebookId, activeNote.id, updated);
    setSessionRight((n) => n + 1);
    advance(queue, queueIndex + 1);
  }

  function handleMissed() {
    if (!activeNote) return;
    const card = queue[queueIndex];
    const updated = { ...scores };
    const prev = updated[card.question] ?? { right: 0, wrong: 0 };
    updated[card.question] = { ...prev, wrong: prev.wrong + 1 };
    setScores(updated);
    saveScores(notebookId, activeNote.id, updated);
    setSessionWrong((n) => n + 1);
    const newQueue = [...queue.slice(0, queueIndex + 1), ...queue.slice(queueIndex + 1), card];
    setQueue(newQueue);
    advance(newQueue, queueIndex + 1);
  }

  function advance(q: QuizItem[], nextIndex: number) {
    if (nextIndex >= q.length) {
      setSessionDone(true);
    } else {
      setQueueIndex(nextIndex);
      setCardRevealed(false);
      setAnswers((prev) => { const next = { ...prev }; delete next[q[nextIndex].id]; return next; });
    }
  }

  function handleResetScores() {
    if (!activeNote) return;
    clearScores(notebookId, activeNote.id);
    setScores({});
  }

  const currentCard = sessionActive && !sessionDone ? queue[queueIndex] : null;
  const totalSeen = sessionRight + sessionWrong;
  const countOptions = [...new Set([5, 10, 20, items.length])].filter((v) => v > 0);

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Split panel */}
      {splitOpen && (
        <>
          <div style={{ width: `${splitPos}%` }} className="h-full shrink-0 overflow-hidden">
            <iframe src={splitSrc} className="w-full h-full border-0" title="Notes" />
          </div>
          <div
            className="w-1 bg-zinc-300 dark:bg-zinc-600 hover:bg-blue-400 dark:hover:bg-blue-500 cursor-col-resize shrink-0 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              splitDraggingRef.current = true;
              const onMove = (ev: MouseEvent) => {
                if (!splitDraggingRef.current) return;
                setSplitPos(Math.max(20, Math.min(80, (ev.clientX / window.innerWidth) * 100)));
              };
              const onUp = () => {
                splitDraggingRef.current = false;
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />
        </>
      )}

      {/* Sidebar */}
      <aside className="w-56 flex flex-col border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 shrink-0">
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Quiz</span>
            <div className="flex items-center gap-2">
              <button onClick={toggleTheme} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors" title="Toggle dark mode">
                {dark ? "☀" : "☾"}
              </button>
              <Link href={`/notebook/${notebookId}`} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                ← Notes
              </Link>
            </div>
          </div>

          {activeNote && (
            <div className="flex rounded border border-zinc-300 dark:border-zinc-600 overflow-hidden text-xs">
              <button
                onClick={() => { setMode("all"); setSessionActive(false); setSessionDone(false); }}
                className={`flex-1 py-1 transition-colors ${mode === "all" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"}`}
              >
                All
              </button>
              <button
                onClick={() => { setMode("flashcard"); setSessionActive(false); setSessionDone(false); }}
                className={`flex-1 py-1 transition-colors ${mode === "flashcard" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"}`}
              >
                Flashcard
              </button>
            </div>
          )}

          {activeNote && mode === "all" && (
            <div className="flex gap-2">
              <button onClick={revealAll} className="flex-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200">
                Reveal all
              </button>
              <button onClick={resetAll} className="flex-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200">
                Reset
              </button>
            </div>
          )}

          {activeNote && mode === "flashcard" && !sessionActive && (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Cards per session</p>
              <div className="flex gap-1 flex-wrap">
                {countOptions.map((n) => (
                  <button
                    key={n}
                    onClick={() => setSessionCount(n)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${sessionCount === n ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"}`}
                  >
                    {n === items.length ? "All" : n}
                  </button>
                ))}
              </div>
              <button
                onClick={startSession}
                className="text-xs bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded px-3 py-1.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
              >
                Start
              </button>
              <button onClick={handleResetScores} className="text-xs text-zinc-400 hover:text-red-500 transition-colors text-left">
                Reset score history
              </button>
            </>
          )}

          {activeNote && sessionActive && !sessionDone && (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Card {queueIndex + 1} / {queue.length}</p>
              <div className="flex gap-3 text-xs">
                <span className="text-green-600 dark:text-green-400">✓ {sessionRight}</span>
                <span className="text-red-500 dark:text-red-400">✗ {sessionWrong}</span>
              </div>
              <button onClick={() => { setSessionActive(false); setSessionDone(false); }} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors text-left">
                ← End session
              </button>
            </>
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
            Select a note to start
          </div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
            No bold text found in this note
          </div>
        ) : mode === "all" ? (
          <div className="max-w-2xl mx-auto py-10 px-6 flex flex-col gap-6">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 flex flex-col gap-3"
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, item }); }}
              >
                <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide">{i + 1} / {items.length}</p>
                <p className="font-semibold text-base">{item.question}</p>
                <textarea
                  value={answers[item.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="Type your answer…"
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500 dark:text-zinc-100 placeholder:text-zinc-400"
                />
                <div>
                  <button
                    onClick={() => setRevealed((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                    className="text-xs border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200"
                  >
                    {revealed[item.id] ? "Hide answer" : "Show answer"}
                  </button>
                  {revealed[item.id] && (
                    <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300 border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 whitespace-pre-wrap">{item.answer}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : !sessionActive ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <p className="text-base font-semibold dark:text-zinc-200">Ready to study?</p>
            <p>{items.length} cards available — pick a count and hit Start.</p>
          </div>
        ) : sessionDone ? (
          <div className="h-full flex flex-col items-center justify-center gap-5">
            <p className="text-2xl font-bold dark:text-zinc-100">Session complete</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{totalSeen} cards reviewed</p>
            <div className="flex gap-6 text-lg">
              <span className="text-green-600 dark:text-green-400 font-semibold">✓ {sessionRight} correct</span>
              <span className="text-red-500 dark:text-red-400 font-semibold">✗ {sessionWrong} missed</span>
            </div>
            <div className="flex gap-3 mt-2">
              <button onClick={startSession} className="text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded px-4 py-2 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors">
                Go again
              </button>
              <button onClick={() => { setSessionActive(false); setSessionDone(false); }} className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200">
                Back
              </button>
            </div>
          </div>
        ) : currentCard ? (
          <div className="h-full flex items-center justify-center p-6">
            <div
              className="w-full max-w-xl flex flex-col gap-5 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-8"
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, item: currentCard });
              }}
            >
              <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide">
                {queueIndex + 1} / {queue.length}
              </p>
              <p className="text-xl font-semibold leading-snug">{currentCard.question}</p>
              <textarea
                value={answers[currentCard.id] ?? ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [currentCard.id]: e.target.value }))}
                placeholder="Type your answer…"
                rows={3}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500 dark:text-zinc-100 placeholder:text-zinc-400"
              />
              {!cardRevealed ? (
                <button
                  onClick={() => setCardRevealed(true)}
                  className="self-start text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200"
                >
                  Show answer
                </button>
              ) : (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 border-l-2 border-zinc-300 dark:border-zinc-600 pl-4 whitespace-pre-wrap">
                    {currentCard.answer}
                  </p>
                  <div className="flex gap-3 mt-1">
                    <button onClick={handleGotIt} className="flex-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 transition-colors font-medium">
                      ✓ Got it
                    </button>
                    <button onClick={handleMissed} className="flex-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg px-4 py-2 transition-colors font-medium">
                      ✗ Missed
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </main>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="ctx-menu fixed z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-xl py-1 min-w-44"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700 max-w-72 break-words">
            {contextMenu.item.question}
          </div>
          <button
            onClick={() => {
              if (activeNote) {
                setSplitSrc(`/notebook/${notebookId}?note=${activeNote.id}&scroll=${encodeURIComponent(contextMenu.item.question)}`);
                setSplitOpen(true);
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors"
          >
            Open in Notes →
          </button>
        </div>
      )}
    </div>
  );
}
