@AGENTS.md

# Notes App — Project Context

## Stack
- **Frontend/Backend**: Next.js 16 (App Router, `"use client"` where needed), React 19, TypeScript
- **Editor**: TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, extensions below)
- **Database**: SQLite via Prisma + `better-sqlite3` (local file: `notes.db`)
- **Styling**: Tailwind CSS v4

## Data model (Prisma)
- `Notebook` — has many `Note`, has many `DiagramKeyword`
- `Note` — belongs to `Notebook`, stores `content` as raw TipTap HTML, has `title`, `maxWidth`, `titleSetManually`
- `DiagramKeyword` — belongs to `Notebook`, used in diagram/quiz views

## Key files
| Path | What it does |
|---|---|
| `app/page.tsx` | Notebook homepage grid — create, rename, delete, export per-notebook or all |
| `app/notebook/[id]/page.tsx` | Main note editor — TipTap editor, toolbar, TOC, links panel, sidebar |
| `app/api/notebooks/route.ts` | GET all notebooks, POST new notebook |
| `app/api/notebooks/[id]/route.ts` | PATCH (rename, cover, maxWidth), DELETE notebook |
| `app/api/notebooks/[id]/export/route.ts` | GET → ZIP of all notes as PDF or DOCX |
| `app/api/notebooks/export-all/route.ts` | GET → ZIP of ALL notebooks, each with PDF + DOCX per note + keywords.json |
| `app/api/notes/route.ts` | GET notes by notebookId, POST new note |
| `app/api/notes/[id]/route.ts` | GET, PATCH (content/title/maxWidth), DELETE note |
| `app/api/export/[id]/route.ts` | GET single note as PDF or DOCX; exports `buildPdf` and `buildDocx` helpers |
| `app/api/import/route.ts` | POST multipart — imports PDF or DOCX into a note |
| `app/api/diagram-keywords/route.ts` | GET/PUT keywords for a notebook |
| `lib/parse-html-for-export.ts` | Parses TipTap HTML into blocks/runs for PDF and DOCX export |
| `lib/drawing-block.tsx` | TipTap custom node for inline canvas drawings |
| `lib/code-block.tsx` | TipTap custom code block node |
| `lib/foldable-heading.tsx` | TipTap custom heading node with fold/unfold |
| `lib/indent.ts` | TipTap indent extension + CLEANUP_RULES |
| `lib/theme.ts` | Dark/light theme toggle (localStorage) |
| `components/FileViewer.tsx` | Resizable side panel for viewing uploaded PDFs/files |
| `components/ConfirmModal.tsx` | Reusable confirm dialog |

## TipTap editor extensions (in `app/notebook/[id]/page.tsx`)
- `StarterKit` (heading and codeBlock disabled — custom versions used)
- `CustomCodeBlock` — syntax-highlighted code block
- `FoldableHeading` — headings that can be collapsed
- `TextStyle` + `FontSize` — inline font size control
- `Indent` — tab/shift-tab indentation with paragraph spacing
- `DrawingBlock` — embeds a canvas drawing
- `Image` — base64 image embeds
- `Placeholder`
- `Youtube` (extended) — auto-embeds YouTube URLs on paste (`addPasteHandler: true`) and on type (space after URL via `nodeInputRule`); uses a **React NodeView** (`YoutubeNodeView`) with a transparent overlay so right-click → "Edit link" dialog works while left-click still passes through to the iframe

## Export
- Per-note: PDF (`pdfkit`) or DOCX (`docx` package) via `/api/export/[id]`
- Per-notebook: ZIP of all notes via `/api/notebooks/[id]/export`
- All notebooks: ZIP with one folder per notebook, each containing PDF + DOCX per note + `keywords.json` via `/api/notebooks/export-all`

## Patterns to follow
- API routes use `prisma` client from `@/lib/prisma`
- All editor state lives in `app/notebook/[id]/page.tsx` (no separate state store)
- Autosave fires 1.5s after last change; Cmd/Ctrl+S saves immediately
- Note content is stored and loaded as raw TipTap HTML
- Portals (`createPortal`) are used for context menus and modals that need to escape overflow clipping
