import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const notebookId = Number(req.nextUrl.searchParams.get("notebookId"));
    if (!notebookId) return NextResponse.json({ manualEdges: [], edgeLabels: {} });
    const nb = await prisma.notebook.findUnique({ where: { id: notebookId }, select: { graphManualEdges: true, graphEdgeLabels: true, graphNodePositions: true } });
    if (!nb) return NextResponse.json({ manualEdges: [], edgeLabels: {}, nodePositions: {} });
    return NextResponse.json({
      manualEdges: JSON.parse(nb.graphManualEdges || "[]"),
      edgeLabels: JSON.parse(nb.graphEdgeLabels || "{}"),
      nodePositions: JSON.parse(nb.graphNodePositions || "{}"),
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
    const { manualEdges, edgeLabels, nodePositions } = await req.json();
    const data: Record<string, string> = {
      graphManualEdges: JSON.stringify(manualEdges ?? []),
      graphEdgeLabels: JSON.stringify(edgeLabels ?? {}),
    };
    if (nodePositions !== undefined) data.graphNodePositions = JSON.stringify(nodePositions);
    await prisma.notebook.update({ where: { id: notebookId }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/diagram-graph error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
