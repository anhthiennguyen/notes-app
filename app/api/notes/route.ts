import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const notes = await prisma.note.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    });
    return NextResponse.json(notes);
  } catch (e) {
    console.error("GET /api/notes error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST() {
  const note = await prisma.note.create({ data: {} });
  return NextResponse.json(note, { status: 201 });
}
