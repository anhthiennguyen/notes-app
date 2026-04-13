import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

// ── Types ────────────────────────────────────────────────────────────────────

interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  fontSize: number; // pt
  color: string;
}

interface Paragraph {
  runs: TextRun[];
  align: "left" | "center" | "right";
}

interface TextShape {
  type: "text";
  x: number; y: number; w: number; h: number; // 0–100 %
  paragraphs: Paragraph[];
  bgColor?: string;
}

interface ImageShape {
  type: "image";
  x: number; y: number; w: number; h: number;
  dataUrl: string;
}

type Shape = TextShape | ImageShape;

export interface SlideData {
  index: number;
  bgColor: string;
  shapes: Shape[];
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function attr(xml: string, tag: string, a: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)? ${a}="([^"]*)"`, "i");
  return xml.match(re)?.[1] ?? null;
}

function innerXml(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  return xml.match(re)?.[1] ?? null;
}

function allMatches(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[0]);
  return out;
}

function extractColor(xml: string): string {
  const s = xml.match(/<a:srgbClr[^>]*\bval="([0-9A-Fa-f]{6})"/i);
  if (s) return `#${s[1]}`;
  const t = xml.match(/<a:sysClr[^>]*\blastClr="([0-9A-Fa-f]{6})"/i);
  if (t) return `#${t[1]}`;
  return "";
}

function emuPct(emu: string | null, total: number): number {
  if (!emu) return 0;
  return (parseInt(emu, 10) / total) * 100;
}

// ── Parse a single slide ──────────────────────────────────────────────────────

function parseSlide(
  slideXml: string,
  rels: Record<string, string>,      // rId → mime+dataUrl
  slideW: number,                    // EMU
  slideH: number,
): SlideData {
  // Background colour
  let bgColor = "#ffffff";
  const bgSolid = slideXml.match(/<p:bg>[\s\S]*?<a:solidFill>([\s\S]*?)<\/a:solidFill>/i);
  if (bgSolid) {
    const c = extractColor(bgSolid[1]);
    if (c) bgColor = c;
  }

  const shapes: Shape[] = [];

  // ── Text shapes (p:sp) ───────────────────────────────────────────
  const spRe = /<p:sp[\s>][\s\S]*?<\/p:sp>/gi;
  let spM: RegExpExecArray | null;
  while ((spM = spRe.exec(slideXml)) !== null) {
    const sp = spM[0];

    // Position / size from <a:xfrm>
    const xfrm = sp.match(/<a:xfrm[^>]*?>([\s\S]*?)<\/a:xfrm>/i)?.[0] ?? "";
    const x = emuPct(attr(xfrm, "a:off", "x"), slideW);
    const y = emuPct(attr(xfrm, "a:off", "y"), slideH);
    const w = emuPct(attr(xfrm, "a:ext", "cx"), slideW);
    const h = emuPct(attr(xfrm, "a:ext", "cy"), slideH);

    // Background fill
    let bgC: string | undefined;
    const fillXml = sp.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/i)?.[1];
    if (fillXml) { const c = extractColor(fillXml); if (c) bgC = c; }

    // Parse text body
    const txBody = innerXml(sp, "p:txBody");
    if (!txBody) continue;

    const paragraphs: Paragraph[] = [];
    const pMatches = allMatches(txBody, "a:p");

    for (const pXml of pMatches) {
      const pPr = pXml.match(/<a:pPr([^>]*)>/i)?.[1] ?? "";
      const rawAlign = pPr.match(/\balgn="([^"]*)"/i)?.[1] ?? "l";
      const align: Paragraph["align"] =
        rawAlign === "ctr" ? "center" : rawAlign === "r" ? "right" : "left";

      const runs: TextRun[] = [];
      const rMatches = allMatches(pXml, "a:r");

      for (const rXml of rMatches) {
        const text = innerXml(rXml, "a:t") ?? "";
        if (!text) continue;

        const rPr = rXml.match(/<a:rPr([^>]*)>/i)?.[1] ?? "";
        const bold = /\bb="1"/.test(rPr);
        const italic = /\bi="1"/.test(rPr);
        const szRaw = rPr.match(/\bsz="(\d+)"/i)?.[1];
        const fontSize = szRaw ? parseInt(szRaw, 10) / 100 : 14;
        const runClr = rXml.match(/<a:rPr[^>]*?>([\s\S]*?)<\/a:rPr>/i)?.[1] ?? "";
        const color = extractColor(runClr) || "#000000";

        runs.push({ text, bold, italic, fontSize, color });
      }

      if (runs.length > 0 || pMatches.length === 1) {
        paragraphs.push({ runs, align });
      }
    }

    if (paragraphs.length > 0) {
      shapes.push({ type: "text", x, y, w, h, paragraphs, bgColor: bgC });
    }
  }

  // ── Images (p:pic) ────────────────────────────────────────────────
  const picRe = /<p:pic[\s>][\s\S]*?<\/p:pic>/gi;
  let picM: RegExpExecArray | null;
  while ((picM = picRe.exec(slideXml)) !== null) {
    const pic = picM[0];
    const rId = pic.match(/<a:blip[^>]*\br:embed="([^"]*)"/i)?.[1];
    if (!rId || !rels[rId]) continue;

    const xfrm = pic.match(/<a:xfrm[^>]*?>([\s\S]*?)<\/a:xfrm>/i)?.[0] ?? "";
    const x = emuPct(attr(xfrm, "a:off", "x"), slideW);
    const y = emuPct(attr(xfrm, "a:off", "y"), slideH);
    const w = emuPct(attr(xfrm, "a:ext", "cx"), slideW);
    const h = emuPct(attr(xfrm, "a:ext", "cy"), slideH);

    shapes.push({ type: "image", x, y, w, h, dataUrl: rels[rId] });
  }

  return { index: 0, bgColor, shapes };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);

    // Slide size from presentation.xml
    const presXml = await zip.file("ppt/presentation.xml")?.async("string") ?? "";
    const sldSz = presXml.match(/<p:sldSz[^>]*/i)?.[0] ?? "";
    const slideW = parseInt(sldSz.match(/\bcx="(\d+)"/i)?.[1] ?? "9144000", 10);
    const slideH = parseInt(sldSz.match(/\bcy="(\d+)"/i)?.[1] ?? "6858000", 10);

    // Find all slide files in order
    const slideFiles = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
        return na - nb;
      });

    const slides: SlideData[] = [];

    for (let i = 0; i < slideFiles.length; i++) {
      const slidePath = slideFiles[i];
      const slideXml = await zip.file(slidePath)!.async("string");

      // Load relationships for this slide
      const slideFile = slidePath.split("/").pop()!;
      const relsPath = `ppt/slides/_rels/${slideFile}.rels`;
      const relsXml = await zip.file(relsPath)?.async("string") ?? "";
      const rels: Record<string, string> = {};
      const relRe = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"[^>]*(?:Type="([^"]*)")?[^>]*>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = relRe.exec(relsXml)) !== null) {
        const rId = rm[1];
        const target = rm[2];
        const type = rm[3] ?? "";
        if (type.includes("image") || /\.(png|jpg|jpeg|gif|svg|webp|bmp)/i.test(target)) {
          const imgPath = target.startsWith("../")
            ? `ppt/${target.slice(3)}`
            : `ppt/slides/${target}`;
          const imgFile = zip.file(imgPath);
          if (imgFile) {
            const imgBuffer = await imgFile.async("base64");
            const ext = imgPath.split(".").pop()?.toLowerCase() ?? "png";
            const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
              : ext === "gif" ? "image/gif"
              : ext === "svg" ? "image/svg+xml"
              : "image/png";
            rels[rId] = `data:${mime};base64,${imgBuffer}`;
          }
        }
      }

      const slide = parseSlide(slideXml, rels, slideW, slideH);
      slide.index = i;
      slides.push(slide);
    }

    return NextResponse.json({ slides, aspectRatio: slideW / slideH });
  } catch (e) {
    console.error("PPTX preview error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
