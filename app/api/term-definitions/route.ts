import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const defs = await prisma.termDefinition.findMany();
    return NextResponse.json(defs);
  } catch (e) {
    console.error("GET /api/term-definitions error:", e);
    return NextResponse.json([]);
  }
}

export async function PUT(req: Request) {
  try {
    const { term, definition }: { term: string; definition: string } = await req.json();
    const record = await prisma.termDefinition.upsert({
      where: { term },
      update: { definition },
      create: { term, definition },
    });
    return NextResponse.json(record);
  } catch (e) {
    console.error("PUT /api/term-definitions error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
