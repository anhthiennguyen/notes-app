import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import JSZip from "jszip";
import { buildPdf, buildDocx } from "@/app/api/export/[id]/route";

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
