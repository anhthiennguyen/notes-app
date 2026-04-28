import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function makeSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 120);
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + query.length + 80);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export async function GET(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get("notebookId");
    const search = req.nextUrl.searchParams.get("search")?.trim();

    if (search) {
      const notes = await prisma.note.findMany({
        where: {
          ...(notebookId ? { notebookId: Number(notebookId) } : {}),
          OR: [
            { title: { contains: search } },
            { content: { contains: search } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, updatedAt: true, content: true },
      });
      return NextResponse.json(notes.map(n => {
        const text = stripHtml(n.content);
        return { id: n.id, title: n.title, updatedAt: n.updatedAt, snippet: makeSnippet(text, search) };
      }));
    }

    const notes = await prisma.note.findMany({
      where: notebookId ? { notebookId: Number(notebookId) } : undefined,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    });
    return NextResponse.json(notes);
  } catch (e) {
    console.error("GET /api/notes error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const note = await prisma.note.create({
    data: {
      ...(body.notebookId !== undefined && { notebookId: Number(body.notebookId) }),
    },
  });
  return NextResponse.json(note, { status: 201 });
}
