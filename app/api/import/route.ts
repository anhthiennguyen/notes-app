import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";

// Private-use Unicode delimiters — won't appear in normal text and won't be HTML-escaped
const S_START = "\uE001";
const S_END   = "\uE002";

interface ParaStyle {
  indentLevel: number;
  marginTop: number;    // pt
  marginBottom: number; // pt
  lineHeight: number | null;
}

/** Read indent + spacing from raw DOCX XML for each paragraph (in body order) */
async function extractParaStyles(buffer: Buffer): Promise<ParaStyle[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) return [];

  const xml = await xmlFile.async("string");
  const body = xml.match(/<w:body>([\s\S]*?)<\/w:body>/)?.[1] ?? "";
  const styles: ParaStyle[] = [];
  const re = /<w:p[ >]([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(body)) !== null) {
    const p = m[1];

    const indMatch = p.match(/w:ind\b[^>]*?w:left="(\d+)"/);
    const indTwips = indMatch ? parseInt(indMatch[1], 10) : 0;
    const indentLevel = Math.max(0, Math.min(8, Math.round(indTwips / 720)));

    const spMatch = p.match(/<w:spacing\b([^/]*\/|[^>]*>)/);
    let marginTop = 0, marginBottom = 0, lineHeight: number | null = null;

    if (spMatch) {
      const sp = spMatch[1];
      const before = sp.match(/w:before="(\d+)"/);
      const after  = sp.match(/w:after="(\d+)"/);
      const line   = sp.match(/w:line="(\d+)"/);
      if (before) marginTop    = Math.round(parseInt(before[1], 10) / 20);
      if (after)  marginBottom = Math.round(parseInt(after[1], 10) / 20);
      if (line) {
        const v = parseInt(line[1], 10);
        if (v > 240) lineHeight = parseFloat((v / 240).toFixed(2));
      }
    }

    styles.push({ indentLevel, marginTop, marginBottom, lineHeight });
  }

  return styles;
}

/** Build a mammoth run node carrying a style sentinel */
function makeSentinelRun(encoding: string): object {
  return {
    type: "run",
    children: [{ type: "text", value: `${S_START}${encoding}${S_END}` }],
    styleId: null, styleName: null, isBold: false, isUnderline: false,
    isItalic: false, isStrikethrough: false, isAllCaps: false,
    isSmallCaps: false, verticalAlignment: "baseline",
    font: null, fontSize: null, highlight: null,
  };
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file)
    return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name;
  let content = "";

  if (name.endsWith(".docx")) {
    const paraStyles = await extractParaStyles(buffer);
    let paraIndex = 0;

    const result = await mammoth.convertToHtml(
      { buffer },
      {
        transformDocument: (mammoth as any).transforms.paragraph((p: any) => {
          const style = paraStyles[paraIndex++];

          // Preserve empty paragraphs — mammoth drops them otherwise.
          // Also treat image-only paragraphs as having content so we don't erase them.
          const hasContent = (p.children ?? []).some(
            (c: any) =>
              c.type === "image" ||
              (c.type === "run" &&
                c.children?.some(
                  (t: any) => (t.type === "text" && t.value) || t.type === "image"
                ))
          );
          if (!hasContent && p.numbering == null) {
            return {
              ...p,
              children: [{
                type: "run", children: [{ type: "text", value: "\u00a0" }],
                styleId: null, styleName: null, isBold: false, isUnderline: false,
                isItalic: false, isStrikethrough: false, isAllCaps: false,
                isSmallCaps: false, verticalAlignment: "baseline",
                font: null, fontSize: null, highlight: null,
              }],
            };
          }

          // Skip list items — mammoth renders them as <li>, our regex won't match
          // and the sentinel would appear as visible text.
          if (!style || p.numbering != null) return p;

          const parts: string[] = [];
          if (style.indentLevel > 0)    parts.push(`indent=${style.indentLevel}`);
          if (style.marginTop > 0)      parts.push(`mt=${style.marginTop}`);
          if (style.marginBottom > 0)   parts.push(`mb=${style.marginBottom}`);
          if (style.lineHeight !== null) parts.push(`lh=${style.lineHeight}`);

          if (parts.length === 0) return p;

          return {
            ...p,
            children: [makeSentinelRun(parts.join(",")), ...(p.children ?? [])],
          };
        }),
      }
    );

    content = postProcessDocxHtml(result.value);
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
  const notebookId = formData.get("notebookId") as string | null;
  const note = await prisma.note.create({
    data: {
      title,
      content,
      ...(notebookId && { notebookId: Number(notebookId) }),
    },
  });
  return NextResponse.json(note, { status: 201 });
}

/**
 * Find sentinel markers embedded in paragraph text by transformDocument,
 * convert them to data-indent / inline style attributes, and remove the marker.
 */
function postProcessDocxHtml(html: string): string {
  // Match: <p/hN attrs>\uE001encoding\uE002
  const SENTINEL_RE = new RegExp(
    `<(p|h[1-6])([^>]*?)>${S_START}([^${S_END}]*)${S_END}`,
    "gi"
  );

  return html.replace(SENTINEL_RE, (_, tag, attrs, encoding) => {
    const params: Record<string, number> = {};
    for (const part of encoding.split(",")) {
      const [k, v] = part.split("=");
      if (k && v) params[k] = parseFloat(v);
    }

    const indent = params.indent ?? 0;
    const mt     = params.mt ?? 0;
    const mb     = params.mb ?? 0;
    const lh     = params.lh ?? null;

    const styles: string[] = [];
    if (indent > 0) styles.push(`padding-left:${indent * 2}rem`);
    if (mt > 0)     styles.push(`margin-top:${mt}pt`);
    if (mb > 0)     styles.push(`margin-bottom:${mb}pt`);
    if (lh)         styles.push(`line-height:${lh}`);

    const existingStyleMatch = attrs.match(/style="([^"]*)"/i);
    const existingStyle = existingStyleMatch ? existingStyleMatch[1] : "";
    const mergedStyle = [existingStyle, ...styles].filter(Boolean).join(";");

    const attrsWithoutStyle = attrs.replace(/\s*style="[^"]*"/i, "").trim();
    const indentAttr = indent > 0 ? ` data-indent="${indent}"` : "";
    const styleAttr  = mergedStyle ? ` style="${mergedStyle}"` : "";

    // Return new opening tag (sentinel text is consumed by the replace)
    return `<${tag}${attrsWithoutStyle ? " " + attrsWithoutStyle : ""}${indentAttr}${styleAttr}>`;
  })
  // Strip any sentinel remnants that weren't matched (e.g. inside <li>)
  .replace(new RegExp(`${S_START}[^${S_END}]*${S_END}`, "g"), "");
}
