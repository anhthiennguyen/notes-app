import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get("notebookId");
    const categories = await prisma.category.findMany({
      where: notebookId ? { notebookId: Number(notebookId) } : undefined,
      orderBy: { order: "asc" },
    });
    return NextResponse.json(categories);
  } catch (e) {
    console.error("GET /api/diagram-categories error:", e);
    return NextResponse.json([]);
  }
}

type CatPayload = { id: string; name: string; order: number; parentId: string | null };

// Insert parents before children so FK constraints are satisfied
function topoSort(cats: CatPayload[]): CatPayload[] {
  const result: CatPayload[] = [];
  const remaining = [...cats];
  const inserted = new Set<string>();
  let guard = cats.length + 1;
  while (remaining.length > 0 && guard-- > 0) {
    const idx = remaining.findIndex((c) => c.parentId === null || inserted.has(c.parentId));
    if (idx === -1) { result.push(...remaining); break; }
    const cat = remaining.splice(idx, 1)[0];
    result.push(cat);
    inserted.add(cat.id);
  }
  return result;
}

export async function PUT(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get("notebookId");
    const categories: CatPayload[] = await req.json();
    const notebookIdNum = notebookId ? Number(notebookId) : null;
    const newIds = categories.map((c) => c.id);

    // Delete categories not in the new list (ON DELETE SET NULL clears keyword.categoryId)
    if (notebookId) {
      await prisma.category.deleteMany({
        where: { notebookId: notebookIdNum, id: { notIn: newIds } },
      });
    }

    // Upsert in topological order
    for (const cat of topoSort(categories)) {
      await prisma.category.upsert({
        where: { id: cat.id },
        create: {
          id: cat.id,
          name: cat.name,
          order: cat.order,
          parentId: cat.parentId,
          ...(notebookIdNum !== null && { notebookId: notebookIdNum }),
        },
        update: { name: cat.name, order: cat.order, parentId: cat.parentId },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/diagram-categories error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
