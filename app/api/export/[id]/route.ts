import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format");

  const note = await prisma.note.findUnique({ where: { id: Number(id) } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const safeTitle = note.title.replace(/[/\\?%*:|"<>]/g, "-") || "note";

  if (format === "pdf") {
    const buffer = await buildPdf(note.title, note.content);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeTitle}.pdf"`,
      },
    });
  }

  if (format === "docx") {
    const buffer = await buildDocx(note.title, note.content);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeTitle}.docx"`,
      },
    });
  }

  return NextResponse.json(
    { error: "Unsupported format. Use ?format=pdf or ?format=docx" },
    { status: 400 }
  );
}

type Block = { tag: string; text: string };

/** Parse HTML into a flat list of {tag, text} blocks */
function parseHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const tagRe = /<(\/?)(\w+)[^>]*>([\s\S]*?)(?=<\w|<\/\w|$)/g;
  // Simple block-level parse: split on block tags
  const blockRe = /<(h[1-6]|p|li|br)[^>]*>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  let match;
  while ((match = blockRe.exec(html)) !== null) {
    const tag = (match[1] || "br").toLowerCase();
    const inner = (match[2] || "").replace(/<[^>]+>/g, "").trim(); // strip inline tags
    if (tag === "br") {
      blocks.push({ tag: "p", text: "" });
    } else if (inner) {
      blocks.push({ tag, text: inner });
    }
  }
  // Fallback: if nothing parsed, treat as plain text
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

    // Title
    doc.fontSize(24).font("Helvetica-Bold").text(title, { paragraphGap: 8 });
    doc.moveDown(0.5);

    const blocks = parseHtml(content);
    for (const block of blocks) {
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
  const blocks = parseHtml(content);

  const children: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
    }),
  ];

  for (const block of blocks) {
    const headingLevel = DOCX_HEADING_LEVELS[block.tag];
    if (headingLevel) {
      children.push(
        new Paragraph({
          text: block.text,
          heading: headingLevel,
          spacing: { after: 160 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: block.text, size: 24 })],
          spacing: { after: 120 },
        })
      );
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
