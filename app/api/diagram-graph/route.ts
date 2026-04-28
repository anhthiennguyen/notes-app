import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const notebookId = Number(req.nextUrl.searchParams.get("notebookId"));
    if (!notebookId) return NextResponse.json({ manualEdges: [], edgeLabels: {} });
    const nb = await prisma.notebook.findUnique({ where: { id: notebookId }, select: { graphManualEdges: true, graphEdgeLabels: true } });
    if (!nb) return NextResponse.json({ manualEdges: [], edgeLabels: {} });
    return NextResponse.json({
      manualEdges: JSON.parse(nb.graphManualEdges || "[]"),
      edgeLabels: JSON.parse(nb.graphEdgeLabels || "{}"),
    });
  } catch (e) {
    console.error("GET /api/diagram-graph error:", e);
    return NextResponse.json({ manualEdges: [], edgeLabels: {} });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const notebookId = Number(req.nextUrl.searchParams.get("notebookId"));
    if (!notebookId) return NextResponse.json({ error: "notebookId required" }, { status: 400 });
    const { manualEdges, edgeLabels } = await req.json();
    await prisma.notebook.update({
      where: { id: notebookId },
      data: {
        graphManualEdges: JSON.stringify(manualEdges ?? []),
        graphEdgeLabels: JSON.stringify(edgeLabels ?? {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/diagram-graph error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
