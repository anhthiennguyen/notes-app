import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name;
  let content = "";

  if (name.endsWith(".docx")) {
    const result = await mammoth.convertToHtml({ buffer });
    content = result.value;
  } else if (name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    content = result.text;
  } else {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a .pdf or .docx file." },
      { status: 400 }
    );
  }

  const title = name.replace(/\.(pdf|docx)$/i, "");
  const note = await prisma.note.create({ data: { title, content } });
  return NextResponse.json(note, { status: 201 });
}
