import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from "docx";
import { parseHtmlForExport, type Block, type Run } from "@/lib/parse-html-for-export";

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

// ── PDF ──────────────────────────────────────────────────────────────────────

const PDF_HEADING: Record<string, { fontSize: number; baseFont: string }> = {
  h1: { fontSize: 22, baseFont: "Helvetica-Bold" },
  h2: { fontSize: 18, baseFont: "Helvetica-Bold" },
  h3: { fontSize: 15, baseFont: "Helvetica-Bold" },
  h4: { fontSize: 13, baseFont: "Helvetica-Bold" },
  h5: { fontSize: 12, baseFont: "Helvetica-Bold" },
  h6: { fontSize: 11, baseFont: "Helvetica-Bold" },
};

function pdfFont(run: Run, isHeading: boolean): string {
  const b = isHeading || run.bold;
  if (b && run.italic) return "Helvetica-BoldOblique";
  if (b) return "Helvetica-Bold";
  if (run.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function writeRuns(doc: InstanceType<typeof PDFDocument>, runs: Run[], fontSize: number, isHeading: boolean) {
  runs.forEach((run, i) => {
    const continued = i < runs.length - 1;
    doc
      .font(pdfFont(run, isHeading))
      .fontSize(fontSize)
      .text(run.text, { continued, lineGap: 2, paragraphGap: continued ? 0 : 4 });
  });
}

export async function buildPdf(title: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(24).font("Helvetica-Bold").text(title, { paragraphGap: 8 });
    doc.moveDown(0.5);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    for (const block of parseHtmlForExport(content)) {
      if (block.tag === "drawing" && block.drawingData) {
        try {
          const base64 = block.drawingData.split(",")[1];
          const imgBuf = Buffer.from(base64, "base64");
          const imgHeight = Math.min(block.drawingHeight ?? 200, 400);
          doc.moveDown(0.4);
          doc.image(imgBuf, { width: contentWidth, height: imgHeight });
          doc.moveDown(0.4);
        } catch { /* skip malformed */ }
        continue;
      }

      if (block.tag === "image" && block.imageSrc) {
        try {
          const base64 = block.imageSrc.split(",")[1];
          const imgBuf = Buffer.from(base64, "base64");
          doc.moveDown(0.4);
          doc.image(imgBuf, { fit: [contentWidth, 500] });
          doc.moveDown(0.4);
        } catch { /* skip malformed */ }
        continue;
      }
      const heading = PDF_HEADING[block.tag];
      const isEmpty = block.runs.every((r) => !r.text.trim());
      if (heading) {
        doc.moveDown(0.4);
        writeRuns(doc, block.runs, heading.fontSize, true);
      } else if (isEmpty) {
        doc.moveDown(0.6);
      } else {
        doc.moveDown(0.1);
        writeRuns(doc, block.runs, 12, false);
      }
    }

    doc.end();
  });
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

const DOCX_HEADING: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

function blockToDocxParagraph(block: Block): Paragraph {
  const headingLevel = DOCX_HEADING[block.tag];
  const isEmpty = block.runs.every((r) => !r.text.trim());

  if (isEmpty) {
    return new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 120 } });
  }

  const children = block.runs.map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || !!headingLevel,
        italics: r.italic,
        size: headingLevel ? undefined : 24,
      })
  );

  if (headingLevel) {
    return new Paragraph({ heading: headingLevel, children, spacing: { after: 160 } });
  }
  return new Paragraph({ children, spacing: { after: 120 } });
}

export async function buildDocx(title: string, content: string): Promise<Buffer> {
  const bodyChildren: (Paragraph)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 240 } }),
  ];

  const PAGE_WIDTH_PT = 6 * 72; // 6 inches in points

  for (const block of parseHtmlForExport(content)) {
    if (block.tag === "drawing" && block.drawingData) {
      try {
        const base64 = block.drawingData.split(",")[1];
        const imgBuf = Buffer.from(base64, "base64");
        const heightEmu = Math.round(((block.drawingHeight ?? 200) / 96) * 914400);
        const widthEmu = Math.round(6 * 914400);
        bodyChildren.push(new Paragraph({
          children: [new ImageRun({ data: imgBuf, transformation: { width: widthEmu / 9144, height: heightEmu / 9144 }, type: "png" })],
          spacing: { after: 120 },
        }));
      } catch { /* skip malformed */ }
      continue;
    }

    if (block.tag === "image" && block.imageSrc) {
      try {
        const [, base64] = block.imageSrc.split(",");
        const mimeMatch = block.imageSrc.match(/^data:image\/(\w+);/);
        const rawType = mimeMatch?.[1] ?? "png";
        const type = (rawType === "jpeg" ? "jpg" : rawType) as "png" | "jpg" | "gif" | "bmp";
        const imgBuf = Buffer.from(base64, "base64");
        // Scale to fit page width, preserve aspect ratio if dimensions known
        let w = PAGE_WIDTH_PT;
        let h = PAGE_WIDTH_PT * 0.6; // default ~60% ratio
        if (block.imageWidth && block.imageHeight) {
          const ratio = block.imageHeight / block.imageWidth;
          w = Math.min(PAGE_WIDTH_PT, block.imageWidth);
          h = Math.round(w * ratio);
        }
        bodyChildren.push(new Paragraph({
          children: [new ImageRun({ data: imgBuf, transformation: { width: w, height: h }, type })],
          spacing: { after: 120 },
        }));
      } catch { /* skip malformed */ }
      continue;
    }

    bodyChildren.push(blockToDocxParagraph(block));
  }

  return Packer.toBuffer(new Document({ sections: [{ children: bodyChildren }] }));
}
