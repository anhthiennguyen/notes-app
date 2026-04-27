import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import JSZip from "jszip";
import { buildPdf, buildDocx } from "@/app/api/export/[id]/route";

export async function GET() {
  try {
    const notebooks = await prisma.notebook.findMany({
      orderBy: { updatedAt: "desc" },
      include: { notes: true },
    });

    const zip = new JSZip();

    for (const notebook of notebooks) {
      const folderName = (notebook.name || "Untitled").replace(/[/\\?%*:|"<>]/g, "-").trim() || "notebook";
      const folder = zip.folder(folderName)!;

      const usedNames = new Set<string>();

      for (const note of notebook.notes) {
        let baseName = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-").trim() || "note";
        let counter = 2;
        let safeName = baseName;
        while (usedNames.has(safeName)) {
          safeName = `${baseName} (${counter++})`;
        }
        usedNames.add(safeName);

        const [pdfBuf, docxBuf] = await Promise.all([
          buildPdf(note.title, note.content),
          buildDocx(note.title, note.content),
        ]);
        folder.file(`${safeName}.pdf`, pdfBuf);
        folder.file(`${safeName}.docx`, docxBuf);
      }

      const keywords = await prisma.diagramKeyword.findMany({
        where: { notebookId: notebook.id },
      });
      folder.file("keywords.json", JSON.stringify(keywords, null, 2));
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(zipBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="all-notebooks.zip"`,
      },
    });
  } catch (e) {
    console.error("Export all error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
