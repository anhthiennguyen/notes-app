import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const notebook = await prisma.notebook.findUnique({ where: { id: Number(id) } });
  if (!notebook) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(notebook);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const notebook = await prisma.notebook.update({
    where: { id: Number(id) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.coverImage !== undefined && { coverImage: body.coverImage }),
    },
  });
  return NextResponse.json(notebook);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Delete all notes and keywords belonging to this notebook first
  await prisma.note.deleteMany({ where: { notebookId: Number(id) } });
  await prisma.diagramKeyword.deleteMany({ where: { notebookId: Number(id) } });
  await prisma.notebook.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}
