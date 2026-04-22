"use client";

import { useEffect } from "react";

export default function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-sm mx-4 p-6 flex flex-col gap-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {message && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{message}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded bg-red-600 text-white text-sm hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
