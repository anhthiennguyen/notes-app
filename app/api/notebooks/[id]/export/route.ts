import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

type Block = { tag: string; text: string };

function parseHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const blockRe = /<(h[1-6]|p|li|br)[^>]*>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  let match;
  while ((match = blockRe.exec(html)) !== null) {
    const tag = (match[1] || "br").toLowerCase();
    const inner = (match[2] || "").replace(/<[^>]+>/g, "").trim();
    if (tag === "br") {
      blocks.push({ tag: "p", text: "" });
    } else if (inner) {
      blocks.push({ tag, text: inner });
    }
  }
  if (blocks.length === 0) {
    const plain = html.replace(/<[^>]+>/g, "").trim();
    if (plain) blocks.push({ tag: "p", text: plain });
  }
  return blocks;
}

const PDF_HEADING_STYLES: Record<string, { fontSize: number; font: string }> = {
  h1: { fontSize: 22, font: "Helvetica-Bold" },
  h2: { fontSize: 18, font: "Helvetica-Bold" },
  h3: { fontSize: 15, font: "Helvetica-Bold" },
  h4: { fontSize: 13, font: "Helvetica-Bold" },
  h5: { fontSize: 12, font: "Helvetica-Bold" },
  h6: { fontSize: 11, font: "Helvetica-Bold" },
};

const DOCX_HEADING_LEVELS: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

async function buildPdf(title: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(24).font("Helvetica-Bold").text(title, { paragraphGap: 8 });
    doc.moveDown(0.5);
    for (const block of parseHtml(content)) {
      const style = PDF_HEADING_STYLES[block.tag];
      if (style) {
        doc.moveDown(0.4);
        doc.fontSize(style.fontSize).font(style.font).text(block.text, { paragraphGap: 4 });
      } else {
        doc.fontSize(12).font("Helvetica").text(block.text || " ", { lineGap: 4, paragraphGap: 4 });
      }
    }
    doc.end();
  });
}

async function buildDocx(title: string, content: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 240 } }),
  ];
  for (const block of parseHtml(content)) {
    const headingLevel = DOCX_HEADING_LEVELS[block.tag];
    if (headingLevel) {
      children.push(new Paragraph({ text: block.text, heading: headingLevel, spacing: { after: 160 } }));
    } else {
      children.push(new Paragraph({ children: [new TextRun({ text: block.text, size: 24 })], spacing: { after: 120 } }));
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format");
  if (format !== "pdf" && format !== "docx") {
    return NextResponse.json({ error: "Use ?format=pdf or ?format=docx" }, { status: 400 });
  }

  const notebook = await prisma.notebook.findUnique({ where: { id: Number(id) } });
  if (!notebook) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const notes = await prisma.note.findMany({ where: { notebookId: Number(id) } });

  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const note of notes) {
    let baseName = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-").trim() || "note";
    let fileName = `${baseName}.${format}`;
    // Deduplicate filenames
    let counter = 2;
    while (usedNames.has(fileName)) {
      fileName = `${baseName} (${counter++}).${format}`;
    }
    usedNames.add(fileName);

    const buffer = format === "pdf"
      ? await buildPdf(note.title, note.content)
      : await buildDocx(note.title, note.content);
    zip.file(fileName, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = notebook.name.replace(/[/\\?%*:|"<>]/g, "-") || "notebook";

  return new NextResponse(zipBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
      },
    });
  } catch (e) {
    console.error("Notebook export error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
