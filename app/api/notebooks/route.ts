import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Auto-assign orphaned notes/keywords to a default notebook on first call
    const orphanedNotes = await prisma.note.count({ where: { notebookId: null } });
    const orphanedKeywords = await prisma.diagramKeyword.count({ where: { notebookId: null } });

    if (orphanedNotes > 0 || orphanedKeywords > 0) {
      let defaultNotebook = await prisma.notebook.findFirst({ where: { name: "Default" } });
      if (!defaultNotebook) {
        defaultNotebook = await prisma.notebook.create({ data: { name: "Default" } });
      }
      if (orphanedNotes > 0) {
        await prisma.note.updateMany({ where: { notebookId: null }, data: { notebookId: defaultNotebook.id } });
      }
      if (orphanedKeywords > 0) {
        await prisma.diagramKeyword.updateMany({ where: { notebookId: null }, data: { notebookId: defaultNotebook.id } });
      }
    }

    const notebooks = await prisma.notebook.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { notes: true } } },
    });
    return NextResponse.json(notebooks);
  } catch (e) {
    console.error("GET /api/notebooks error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const notebook = await prisma.notebook.create({ data: {} });
    return NextResponse.json(notebook, { status: 201 });
  } catch (e) {
    console.error("POST /api/notebooks error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
