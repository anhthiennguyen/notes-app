import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get("notebookId");
    const keywords = await prisma.diagramKeyword.findMany({
      where: notebookId ? { notebookId: Number(notebookId) } : undefined,
    });
    return NextResponse.json(keywords);
  } catch (e) {
    console.error("GET /api/diagram-keywords error:", e);
    return NextResponse.json([]);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get("notebookId");
    const keywords: { id: string; text: string; color: string; order?: number; x?: number | null; y?: number | null; categoryId?: string | null }[] = await req.json();
    if (notebookId) {
      await prisma.diagramKeyword.deleteMany({ where: { notebookId: Number(notebookId) } });
    } else {
      await prisma.diagramKeyword.deleteMany();
    }
    for (const kw of keywords) {
      await prisma.diagramKeyword.create({
        data: { ...kw, ...(notebookId && { notebookId: Number(notebookId) }) },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/diagram-keywords error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
