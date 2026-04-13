import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "in","on","at","to","for","of","and","or","but","if","then","else","when",
  "up","out","about","into","through","after","between","each","more","other",
  "such","than","that","this","these","those","no","so","as","by","from","with",
  "what","which","who","whose","how","all","both","few","many","most","some",
  "its","it","their","there","they","we","you","he","she","i","my","our","your",
  "his","her","not","also","any","use","using","used","new","one","two","three",
  "four","five","six","seven","eight","nine","ten","just","like","well","also",
  "very","can","get","has","said","make","know","take","see","come","think",
  "look","want","give","good","first","over","back","time","year","way","even",
  "same","here","because","while","where","however","without","within","during",
  "before","after","above","below","between","under","again","further","once",
]);

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const notes = await prisma.note.findMany({
      where: { notebookId: Number(id) },
      select: { content: true },
    });

    const freq = new Map<string, number>();
    for (const note of notes) {
      const text = stripHtml(note.content);
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
      for (const word of words) {
        if (word.length >= 4 && !STOP_WORDS.has(word)) {
          freq.set(word, (freq.get(word) ?? 0) + 1);
        }
      }
    }

    const sorted = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));

    return NextResponse.json(sorted);
  } catch (e) {
    console.error("GET /api/notebooks/[id]/keyword-suggestions error:", e);
    return NextResponse.json([], { status: 500 });
  }
}
