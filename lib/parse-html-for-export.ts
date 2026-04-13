export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface Block {
  tag: string; // h1–h6, p, li
  runs: Run[];
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
  // Match block tags
  const blockRe = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    // Heading tags: treat entire heading as bold
    const runs = parseInline(inner, tag.startsWith("h"));
    const hasText = runs.some((r) => r.text.trim().length > 0);
    // Always push paragraphs, even empty ones (they become blank lines)
    if (hasText || tag === "p") blocks.push({ tag, runs });
  }

  // Fallback: plain text
  if (blocks.length === 0) {
    const plain = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (plain) blocks.push({ tag: "p", runs: [{ text: plain, bold: false, italic: false }] });
  }

  return blocks;
}
