import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const keywords = await prisma.diagramKeyword.findMany();
    return NextResponse.json(keywords);
  } catch (e) {
    console.error("GET /api/diagram-keywords error:", e);
    return NextResponse.json([]);
  }
}

export async function PUT(req: Request) {
  try {
    const keywords: { id: string; text: string; color: string; x?: number | null; y?: number | null }[] = await req.json();
    await prisma.diagramKeyword.deleteMany();
    for (const kw of keywords) {
      await prisma.diagramKeyword.create({ data: kw });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/diagram-keywords error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
