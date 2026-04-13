import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get("notebookId");
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
