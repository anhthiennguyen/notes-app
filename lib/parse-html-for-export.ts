export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface Block {
  tag: string; // h1–h6, p, li, drawing
  runs: Run[];
  drawingData?: string; // base64 PNG data URL for drawing blocks
  drawingHeight?: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse inline HTML into runs, preserving bold/italic */
function parseInline(html: string, baseBold = false, baseItalic = false): Run[] {
  const runs: Run[] = [];
  // Normalise <br>
  html = html.replace(/<br\s*\/?>/gi, "\n");

  const re = /<(\/?)(\w+)[^>]*>|([^<]+)/g;
  let bold = baseBold;
  let italic = baseItalic;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const [, closing, tag, text] = m;
    if (text !== undefined) {
      const decoded = decodeEntities(text);
      if (decoded) runs.push({ text: decoded, bold, italic });
    } else if (tag) {
      const t = tag.toLowerCase();
      if (t === "strong" || t === "b") bold = !closing;
      else if (t === "em" || t === "i") italic = !closing;
    }
  }

  return runs;
}

/** Parse block-level HTML into an array of Blocks */
export function parseHtmlForExport(html: string): Block[] {
  const blocks: Block[] = [];

  // Interleave drawing blocks and text blocks in document order
  const drawingRe = /<div[^>]+data-type="drawing-block"[^>]*>/gi;
  const blockRe = /<(h[1-6]|p|li)([^>]*)>([\s\S]*?)<\/\1>/gi;

  // Collect all matches with their positions
  type RawMatch = { index: number; end: number; block: Block };
  const matches: RawMatch[] = [];

  let m: RegExpExecArray | null;

  // Drawing blocks
  while ((m = drawingRe.exec(html)) !== null) {
    const tag = m[0];
    const dataMatch = tag.match(/data-drawing="([^"]*)"/);
    const heightMatch = tag.match(/data-height="(\d+)"/);
    const data = dataMatch ? dataMatch[1] : "";
    const height = heightMatch ? parseInt(heightMatch[1], 10) : 200;
    if (data) {
      matches.push({
        index: m.index,
        end: m.index + m[0].length,
        block: { tag: "drawing", runs: [], drawingData: data, drawingHeight: height },
      });
    }
  }

  // Text blocks
  while ((m = blockRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[3];
    const runs = parseInline(inner, tag.startsWith("h"));
    const hasText = runs.some((r) => r.text.trim().length > 0);
    if (hasText || tag === "p") {
      matches.push({ index: m.index, end: m.index + m[0].length, block: { tag, runs } });
    }
  }

  // Sort by document order
  matches.sort((a, b) => a.index - b.index);
  for (const { block } of matches) blocks.push(block);

  // Fallback: plain text
  if (blocks.length === 0) {
    const plain = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (plain) blocks.push({ tag: "p", runs: [{ text: plain, bold: false, italic: false }] });
  }

  return blocks;
}
