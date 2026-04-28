"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as d3 from "d3";
import { useTheme } from "@/lib/theme";

type NoteMeta = { id: number; title: string; updatedAt: string };
type Note = NoteMeta & { content: string };

// ── Stop words + keyword extraction ─────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "in","on","at","to","for","of","and","or","but","if","then","else","when",
  "up","out","about","into","through","after","between","each","more","other",
  "such","than","that","this","these","those","no","so","as","by","from","with",
  "what","which","who","whose","how","all","both","few","many","most","some",
  "its","it","their","there","they","we","you","he","she","i","my","our","your",
  "his","her","not","also","any","use","using","used","new","one","two","three",
]);

function keyWords(label: string): Set<string> {
  return new Set(
    label.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

// ── Parse note HTML ──────────────────────────────────────────────────────────

type RawItem = { id: string; label: string; nodeType: string };

function parseNoteHtml(html: string): RawItem[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items: RawItem[] = [];
  let idx = 0;
  doc.body.childNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim() ?? "";
    if (!text) return;
    if (tag === "p") {
      const boldText = [...el.querySelectorAll("strong, b")].map((s) => s.textContent ?? "").join("").trim();
      if (boldText.length > 0 && boldText.length >= text.length * 0.8)
        items.push({ id: `n${idx++}`, label: text, nodeType: "bold" });
    }
  });
  return items;
}

// ── Union-find clustering by shared keywords ─────────────────────────────────

function buildKeywordClusters(items: RawItem[]): number[] {
  const parent = items.map((_, i) => i);
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x: number, y: number) { parent[find(x)] = find(y); }
  for (let i = 0; i < items.length; i++) {
    const wA = keyWords(items[i].label);
    for (let j = i + 1; j < items.length; j++) {
      if ([...wA].some((w) => keyWords(items[j].label).has(w))) union(i, j);
    }
  }
  const rootMap = new Map<number, number>();
  return items.map((_, i) => {
    const r = find(i);
    if (!rootMap.has(r)) rootMap.set(r, rootMap.size);
    return rootMap.get(r)!;
  });
}

// ── Bubble config ────────────────────────────────────────────────────────────

const RADIUS: Record<string, number> = {
  h1: 72, h2: 58, h3: 46, h4: 37, h5: 30, h6: 26, bold: 42,
};

const PALETTE = [
  "#e85d04","#3a86ff","#06d6a0","#8338ec","#f4a261",
  "#ff006e","#4361ee","#2a9d8f","#e9c46a","#e63946",
  "#7209b7","#4cc9f0","#f77f00","#457b9d","#a8dadc",
];

interface Bubble extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  nodeType: string;
  radius: number;
  color: string;       // fill: category color (or keyword color if uncategorized)
  borderColor: string; // stroke: individual keyword color
}

interface CategoryData {
  id: string;
  name: string;
  order: number;
  parentId: string | null;
}

interface CustomKeyword {
  id: string;
  text: string;
  color: string;
  hidden?: boolean;
  x?: number | null;
  y?: number | null;
  categoryId: string | null;
  order: number;
}

interface ContextMenu {
  x: number;
  y: number;
  bubble: Bubble;
}

// Positions for keyword clusters — corners then edge midpoints
const enclosureLine = d3.line<[number, number]>()
  .x((d) => d[0]).y((d) => d[1])
  .curve(d3.curveCatmullRomClosed.alpha(0.5));

function buildEnclosureLayer(
  canvas: d3.Selection<SVGGElement, unknown, null, undefined>,
  keywords: CustomKeyword[]
) {
  canvas.selectAll("g.enclosures").remove();
  const node = (canvas.node() as SVGGElement).insertBefore(
    document.createElementNS("http://www.w3.org/2000/svg", "g"),
    (canvas.node() as SVGGElement).firstChild
  );
  const g = d3.select(node).attr("class", "enclosures");
  keywords.forEach((kw) => {
    g.append("path")
      .attr("class", "kw-enc")
      .attr("data-id", kw.id)
      .attr("fill", kw.color).attr("fill-opacity", 0.1)
      .attr("stroke", kw.color).attr("stroke-width", 2.5).attr("stroke-opacity", 0.75)
      .attr("cursor", "grab")
      .attr("pointer-events", "all");
    g.append("text")
      .attr("class", "kw-enc-label")
      .attr("data-id", kw.id)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("pointer-events", "none")
      .attr("fill", kw.color)
      .attr("fill-opacity", 0.45)
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("letter-spacing", "0.05em")
      .text(kw.text);
  });
}

function attachEnclosureDrags(
  canvas: d3.Selection<SVGGElement, unknown, null, undefined>,
  bubblesRef: React.MutableRefObject<Bubble[]>,
  customKeywordsRef: React.MutableRefObject<CustomKeyword[]>,
  simRef: React.MutableRefObject<d3.Simulation<Bubble, undefined> | null>,
  clusterOverridesRef: React.MutableRefObject<Record<string, { x: number; y: number }>>,
  saveCallbackRef: React.MutableRefObject<() => void>,
  selectedKwIdsRef: React.MutableRefObject<Set<string>>,
  setSelectedKwIds: (fn: (prev: Set<string>) => Set<string>) => void
) {
  canvas.selectAll<SVGPathElement, unknown>("path.kw-enc").each(function() {
    const el = d3.select<SVGPathElement, unknown>(this);
    const kwId = el.attr("data-id");
    let didDrag = false;

    const drag = d3.drag<SVGPathElement, unknown>()
      .on("start", function(event) {
        event.sourceEvent.stopPropagation();
        didDrag = false;

        // Determine which keywords to move: if dragged kw is selected, move all selected; else just this one
        const isSelected = selectedKwIdsRef.current.has(kwId);
        const kwIds = isSelected ? [...selectedKwIdsRef.current] : [kwId];

        kwIds.forEach((id) => {
          const kw = customKeywordsRef.current.find((k) => k.id === id);
          if (!kw) return;
          bubblesRef.current
            .filter((b) => b.label.toLowerCase().includes(kw.text.toLowerCase()))
            .forEach((b) => { b.fx = b.x; b.fy = b.y; });
        });
        simRef.current?.alphaTarget(0.1).restart();
        d3.select(this).attr("cursor", "grabbing");
      })
      .on("drag", function(event) {
        didDrag = true;
        const isSelected = selectedKwIdsRef.current.has(kwId);
        const kwIds = isSelected ? [...selectedKwIdsRef.current] : [kwId];

        kwIds.forEach((id) => {
          const kw = customKeywordsRef.current.find((k) => k.id === id);
          if (!kw) return;
          bubblesRef.current
            .filter((b) => b.label.toLowerCase().includes(kw.text.toLowerCase()))
            .forEach((b) => {
              if (b.fx != null) b.fx += event.dx;
              if (b.fy != null) b.fy += event.dy;
            });
        });
      })
      .on("end", function(event) {
        if (!didDrag) {
          // It was a click — handle selection toggle
          const shift = event.sourceEvent?.shiftKey;
          setSelectedKwIds((prev) => {
            const next = new Set(prev);
            if (shift) {
              if (next.has(kwId)) next.delete(kwId);
              else next.add(kwId);
            } else {
              if (next.has(kwId) && next.size === 1) next.clear();
              else { next.clear(); next.add(kwId); }
            }
            return next;
          });
          d3.select(this).attr("cursor", "grab");
          return;
        }

        const isSelected = selectedKwIdsRef.current.has(kwId);
        const kwIds = isSelected ? [...selectedKwIdsRef.current] : [kwId];

        kwIds.forEach((id) => {
          const kw = customKeywordsRef.current.find((k) => k.id === id);
          if (!kw) return;
          const matching = bubblesRef.current.filter((b) =>
            b.label.toLowerCase().includes(kw.text.toLowerCase())
          );
          if (matching.length > 0 && clusterOverridesRef?.current) {
            const cx = matching.reduce((s, b) => s + (b.fx ?? b.x ?? 0), 0) / matching.length;
            const cy = matching.reduce((s, b) => s + (b.fy ?? b.y ?? 0), 0) / matching.length;
            clusterOverridesRef.current[id] = { x: cx, y: cy };
          }
          matching.forEach((b) => { b.fx = null; b.fy = null; });
        });

        simRef.current?.alphaTarget(0);
        d3.select(this).attr("cursor", "grab");
        saveCallbackRef.current();
      });

    el.call(drag);
  });
}

function clusterTarget(idx: number, w: number, h: number): { x: number; y: number } {
  const pad = 130;
  const corners = [
    { x: w - pad, y: pad },        // top-right
    { x: pad,     y: h - pad },    // bottom-left
    { x: w - pad, y: h - pad },    // bottom-right
    { x: pad,     y: pad },        // top-left
    { x: w / 2,   y: pad },        // top-center
    { x: w / 2,   y: h - pad },    // bottom-center
    { x: pad,     y: h / 2 },      // left-center
    { x: w - pad, y: h / 2 },      // right-center
  ];
  return corners[idx % corners.length];
}

function wrapLabel(text: string, radius: number): string[] {
  const maxChars = Math.max(4, Math.floor(radius * 0.32));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

// ── Keyword co-occurrence graph ───────────────────────────────────────────────

type GNode =
  | { id: string; kind: "keyword"; kw: CustomKeyword }
  | { id: string; kind: "category"; cat: CategoryData };

function KeywordGraphView({
  keywords,
  categories,
  bubbles,
  dark,
  size,
  notebookId,
}: {
  keywords: CustomKeyword[];
  categories: CategoryData[];
  bubbles: Bubble[];
  dark: boolean;
  size: { w: number; h: number };
  notebookId: number;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const dragRef = useRef<{ anchor: string; mx: number; my: number; initialPositions: Record<string, { x: number; y: number }>; hasMoved: boolean } | null>(null);
  const [manualEdges, setManualEdges] = useState<[string, string][]>([]);
  const [linkMode, setLinkMode] = useState(false);
  const [pendingNode, setPendingNode] = useState<string | null>(null);
  const [edgeLabels, setEdgeLabels] = useState<Record<string, string>>({});
  const [editingEdge, setEditingEdge] = useState<{ key: string; x: number; y: number; value: string } | null>(null);
  const [graphTool, setGraphTool] = useState<"hand" | "select">("hand");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [graphSelRect, setGraphSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const graphToolRef = useRef<"hand" | "select">("hand");
  const graphSelStartRef = useRef<{ x: number; y: number } | null>(null);
  const containerDivRef = useRef<HTMLDivElement>(null);

  useEffect(() => { graphToolRef.current = graphTool; }, [graphTool]);

  function edgeKey(a: string, b: string) { return [a, b].sort().join("::"); }

  const { nodes, edges, kwCatPairs, basePositions } = useMemo(() => {
    const allNodes: GNode[] = [
      ...categories.map(c => ({ id: c.id, kind: "category" as const, cat: c })),
      ...keywords.map(k => ({ id: k.id, kind: "keyword" as const, kw: k })),
    ];
    if (!allNodes.length) return { nodes: [] as GNode[], edges: [] as [string, string][], kwCatPairs: [] as [string, string][], basePositions: {} as Record<string, { x: number; y: number }> };

    const boldLabels = bubbles.filter(b => b.nodeType === "bold").map(b => b.label.toLowerCase());

    // Build adjacency
    const adj = new Map<string, Set<string>>();
    allNodes.forEach(n => adj.set(n.id, new Set()));

    // Co-occurrence edges between keywords
    for (const label of boldLabels) {
      const hit = keywords.filter(kw => label.includes(kw.text.toLowerCase()));
      for (let i = 0; i < hit.length; i++)
        for (let j = i + 1; j < hit.length; j++) {
          adj.get(hit[i].id)!.add(hit[j].id);
          adj.get(hit[j].id)!.add(hit[i].id);
        }
    }

    // Build a set of valid category IDs for fast lookup
    const catIdSet = new Set(categories.map(c => c.id));

    // keyword → category edges
    const kwCatPairs: [string, string][] = [];
    for (const kw of keywords) {
      if (kw.categoryId && catIdSet.has(kw.categoryId)) {
        adj.get(kw.id)!.add(kw.categoryId);
        adj.get(kw.categoryId)!.add(kw.id);
        kwCatPairs.push([kw.id, kw.categoryId]);
      }
    }

    // category → parent category edges
    for (const cat of categories) {
      if (cat.parentId && catIdSet.has(cat.parentId)) {
        adj.get(cat.id)!.add(cat.parentId);
        adj.get(cat.parentId)!.add(cat.id);
      }
    }

    // Connected components
    const visited = new Set<string>();
    const components: string[][] = [];
    for (const n of allNodes) {
      if (visited.has(n.id)) continue;
      const comp: string[] = [];
      const q = [n.id];
      visited.add(n.id);
      while (q.length) {
        const id = q.shift()!;
        comp.push(id);
        for (const nb of adj.get(id) ?? []) {
          if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
        }
      }
      components.push(comp);
    }

    // BFS spanning tree per component
    const parentMap = new Map<string, string | null>();
    const spanEdges: [string, string][] = [];
    for (const comp of components) {
      const root = comp.reduce((best, id) => {
        const bc = [...(adj.get(best) ?? [])].filter(n => comp.includes(n)).length;
        const ic = [...(adj.get(id) ?? [])].filter(n => comp.includes(n)).length;
        return ic > bc ? id : best;
      });
      parentMap.set(root, null);
      const vis2 = new Set([root]);
      const q2 = [root];
      while (q2.length) {
        const id = q2.shift()!;
        for (const nb of adj.get(id) ?? []) {
          if (!vis2.has(nb)) { vis2.add(nb); parentMap.set(nb, id); spanEdges.push([id, nb]); q2.push(nb); }
        }
      }
    }

    // d3.tree layout per component
    type TN = { id: string; children: TN[] };
    function buildTree(rootId: string): TN {
      return { id: rootId, children: allNodes.filter(n => parentMap.get(n.id) === rootId).map(n => buildTree(n.id)) };
    }

    const NODE_W = 140, NODE_H = 100;
    const basePositions: Record<string, { x: number; y: number }> = {};
    let xOffset = 0;
    const isolated: string[] = [];

    for (const comp of components) {
      if (comp.length === 1) { isolated.push(comp[0]); continue; }
      const rootId = comp.find(id => parentMap.get(id) === null)!;
      const root = d3.hierarchy(buildTree(rootId));
      d3.tree<TN>().nodeSize([NODE_W, NODE_H])(root);
      let minX = Infinity, maxX = -Infinity;
      root.each(n => { const nx = (n as any).x as number; if (nx < minX) minX = nx; if (nx > maxX) maxX = nx; });
      root.each(n => {
        basePositions[n.data.id] = { x: (n as any).x - minX + xOffset, y: (n as any).y + 60 };
      });
      xOffset += maxX - minX + NODE_W * 1.6;
    }

    isolated.forEach((id, i) => {
      basePositions[id] = { x: xOffset + NODE_W * 0.5, y: 60 + i * 80 };
    });

    return { nodes: allNodes, edges: spanEdges, kwCatPairs, basePositions };
  }, [keywords, categories, bubbles]);


  // Load graph edges from DB on mount; migrate from localStorage if DB is empty
  const graphLoadedRef = useRef(false);
  useEffect(() => {
    if (graphLoadedRef.current) return;
    graphLoadedRef.current = true;
    fetch(`/api/diagram-graph?notebookId=${notebookId}`)
      .then(r => r.json())
      .then(({ manualEdges: me, edgeLabels: el, nodePositions: np }) => {
        if (me?.length) {
          setManualEdges(me);
        } else {
          const stored = localStorage.getItem(`graph-manual-edges-${notebookId}`);
          if (stored) { try { setManualEdges(JSON.parse(stored)); } catch {} }
        }
        if (el && Object.keys(el).length) {
          setEdgeLabels(el);
        } else {
          const stored = localStorage.getItem(`graph-edge-labels-${notebookId}`);
          if (stored) { try { setEdgeLabels(JSON.parse(stored)); } catch {} }
        }
        if (np && Object.keys(np).length) {
          setOverrides(np);
        }
      })
      .catch(() => {});
  }, [notebookId]);

  // Debounced save to DB when edges or labels change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef({ manualEdges, edgeLabels, nodePositions: overrides });
  useEffect(() => { pendingSaveRef.current = { manualEdges, edgeLabels, nodePositions: overrides }; }, [manualEdges, edgeLabels, overrides]);
  useEffect(() => {
    if (!graphLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const { manualEdges: me, edgeLabels: el, nodePositions: np } = pendingSaveRef.current;
      fetch(`/api/diagram-graph?notebookId=${notebookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualEdges: me, edgeLabels: el, nodePositions: np }),
      }).catch(() => {});
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [manualEdges, edgeLabels, overrides, notebookId]);

  // Remove edges/labels for deleted nodes
  useEffect(() => {
    const allIds = new Set([...keywords.map(k => k.id), ...categories.map(c => c.id)]);
    setManualEdges(prev => prev.filter(([a, b]) => allIds.has(a) && allIds.has(b)));
    setEdgeLabels(prev => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const [a, b] = k.split("::");
        if (allIds.has(a) && allIds.has(b)) next[k] = v;
      }
      return next;
    });
  }, [keywords, categories]);

  function getPos(id: string) { return overrides[id] ?? basePositions[id] ?? { x: 0, y: 0 }; }

  function openEdgeLabel(e: React.MouseEvent, a: string, b: string) {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerDivRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    const key = edgeKey(a, b);
    setEditingEdge({ key, x, y, value: edgeLabels[key] ?? "" });
  }

  function onBgDown(e: React.MouseEvent) {
    if (editingEdge) { setEditingEdge(null); return; }
    if (e.button !== 0) return;
    if (graphToolRef.current === "select") {
      const r = containerDivRef.current?.getBoundingClientRect();
      graphSelStartRef.current = { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
    } else {
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    }
  }
  function onNodeDown(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (linkMode) {
      if (pendingNode === null) {
        setPendingNode(id);
      } else if (pendingNode === id) {
        setPendingNode(null);
      } else {
        const a = pendingNode, b = id;
        setManualEdges(prev => {
          const exists = prev.some(([ea, eb]) => (ea === a && eb === b) || (ea === b && eb === a));
          return exists ? prev.filter(([ea, eb]) => !((ea === a && eb === b) || (ea === b && eb === a))) : [...prev, [a, b]];
        });
        setPendingNode(null);
      }
      return;
    }
    const isSelected = selectedNodeIds.has(id);
    const dragIds = isSelected ? [...selectedNodeIds] : [id];
    const initialPositions: Record<string, { x: number; y: number }> = {};
    for (const nid of dragIds) initialPositions[nid] = getPos(nid);
    dragRef.current = { anchor: id, mx: e.clientX, my: e.clientY, initialPositions, hasMoved: false };
  }
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (dragRef.current) {
      dragRef.current.hasMoved = true;
      const { mx, my, initialPositions } = dragRef.current;
      const dx = (e.clientX - mx) / zoom;
      const dy = (e.clientY - my) / zoom;
      setOverrides(p => {
        const next = { ...p };
        for (const [nid, pos] of Object.entries(initialPositions)) next[nid] = { x: pos.x + dx, y: pos.y + dy };
        return next;
      });
    } else if (graphSelStartRef.current) {
      const r = containerDivRef.current?.getBoundingClientRect();
      const cx = e.clientX - (r?.left ?? 0);
      const cy = e.clientY - (r?.top ?? 0);
      const { x: sx, y: sy } = graphSelStartRef.current;
      setGraphSelRect({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
    } else if (panStartRef.current) {
      const { mx, my, px, py } = panStartRef.current;
      setPan({ x: px + e.clientX - mx, y: py + e.clientY - my });
    }
  }
  function onUp() {
    if (graphSelStartRef.current) {
      const rect = graphSelRect;
      setGraphSelRect(null);
      if (rect && rect.w > 4 && rect.h > 4) {
        const minX = (rect.x - pan.x) / zoom;
        const minY = (rect.y - pan.y) / zoom;
        const maxX = (rect.x + rect.w - pan.x) / zoom;
        const maxY = (rect.y + rect.h - pan.y) / zoom;
        const next = new Set<string>();
        for (const node of nodes) {
          if (!basePositions[node.id]) continue;
          const { x: nx, y: ny } = getPos(node.id);
          if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) next.add(node.id);
        }
        setSelectedNodeIds(next);
      } else {
        setSelectedNodeIds(new Set());
      }
      graphSelStartRef.current = null;
    }
    if (dragRef.current && !dragRef.current.hasMoved && graphToolRef.current === "select") {
      const { anchor } = dragRef.current;
      setSelectedNodeIds(prev => {
        const next = new Set(prev);
        if (next.has(anchor)) next.delete(anchor);
        else { next.clear(); next.add(anchor); }
        return next;
      });
    }
    dragRef.current = null;
    panStartRef.current = null;
  }

  const isEmpty = nodes.length === 0;

  return (
    <div ref={containerDivRef} className="relative w-full h-full overflow-hidden">
      <svg
        width={size.w} height={size.h} className="w-full h-full select-none"
        onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onWheel={(e) => { e.preventDefault(); setZoom(z => Math.min(3, Math.max(0.25, +(z * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(3)))); }}
      >
        <rect width={size.w} height={size.h} fill="transparent" style={{ cursor: graphTool === "select" ? "crosshair" : "grab" }} onMouseDown={onBgDown} />
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Keyword → category structural edges: always rendered explicitly */}
          {kwCatPairs.map(([kwId, catId]) => {
            if (!basePositions[kwId] || !basePositions[catId]) return null;
            const pa = getPos(kwId), pb = getPos(catId);
            return (
              <path
                key={`kc-${kwId}`}
                d={`M${pa.x},${pa.y} C${pa.x},${(pa.y + pb.y) / 2} ${pb.x},${(pa.y + pb.y) / 2} ${pb.x},${pb.y}`}
                fill="none"
                stroke={dark ? "#3f3f46" : "#d4d4d8"}
                strokeWidth={2}
                className="cursor-context-menu"
                onContextMenu={(e) => openEdgeLabel(e, kwId, catId)}
              />
            );
          })}
          {/* Co-occurrence spanning-tree edges */}
          {edges.map(([a, b]) => {
            // Skip keyword→category pairs — already drawn above
            const isKwCat = kwCatPairs.some(([k, c]) => (a === k && b === c) || (a === c && b === k));
            if (isKwCat) return null;
            const pa = getPos(a), pb = getPos(b);
            return (
              <path
                key={`${a}-${b}`}
                d={`M${pa.x},${pa.y} C${pa.x},${(pa.y + pb.y) / 2} ${pb.x},${(pa.y + pb.y) / 2} ${pb.x},${pb.y}`}
                fill="none"
                stroke={dark ? "#52525b" : "#d4d4d8"}
                strokeWidth={2}
                className="cursor-context-menu"
                onContextMenu={(e) => openEdgeLabel(e, a, b)}
              />
            );
          })}
          {manualEdges.map(([a, b]) => {
            const pa = getPos(a), pb = getPos(b);
            if (!pa || !pb) return null;
            return (
              <path
                key={`manual-${a}-${b}`}
                d={`M${pa.x},${pa.y} C${pa.x},${(pa.y + pb.y) / 2} ${pb.x},${(pa.y + pb.y) / 2} ${pb.x},${pb.y}`}
                fill="none"
                stroke={dark ? "#a1a1aa" : "#71717a"}
                strokeWidth={2}
                strokeDasharray="5 3"
                className="cursor-pointer"
                onClick={() => setManualEdges(prev => prev.filter(([ea, eb]) => !((ea === a && eb === b) || (ea === b && eb === a))))}
                onContextMenu={(e) => openEdgeLabel(e, a, b)}
              />
            );
          })}
          {nodes.map(node => {
            if (!basePositions[node.id]) return null;
            const { x, y } = getPos(node.id);
            const isPending = node.id === pendingNode;
            const cur = linkMode ? "crosshair" : "grab";

            if (node.kind === "category") {
              const { cat } = node;
              const maxChars = 15;
              const display = cat.name.length > maxChars ? cat.name.slice(0, maxChars - 1) + "…" : cat.name;
              const w = Math.max(72, display.length * 6.5 + 20);
              const h = 28;
              return (
                <g key={cat.id} transform={`translate(${x},${y})`} onMouseDown={(e) => onNodeDown(e, cat.id)} style={{ cursor: cur }}>
                  {selectedNodeIds.has(cat.id) && <rect x={-(w / 2 + 5)} y={-(h / 2 + 5)} width={w + 10} height={h + 10} rx={9} fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth={2} />}
                  {isPending && <rect x={-(w / 2 + 5)} y={-(h / 2 + 5)} width={w + 10} height={h + 10} rx={9} fill="none" stroke={dark ? "#a1a1aa" : "#71717a"} strokeWidth={2} strokeDasharray="4 3" opacity={0.8} />}
                  <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={dark ? "#27272a" : "#f4f4f5"} stroke={dark ? "#71717a" : "#a1a1aa"} strokeWidth={2} />
                  <text textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill={dark ? "#e4e4e7" : "#3f3f46"}>{display}</text>
                </g>
              );
            }

            const { kw } = node;
            const words = kw.text.split(" ");
            const line1 = words.slice(0, Math.ceil(words.length / 2)).join(" ");
            const line2 = words.slice(Math.ceil(words.length / 2)).join(" ");
            return (
              <g key={kw.id} transform={`translate(${x},${y})`} onMouseDown={(e) => onNodeDown(e, kw.id)} style={{ cursor: cur }}>
                {selectedNodeIds.has(kw.id) && <circle r={37} fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth={2} />}
                {isPending && <circle r={38} fill="none" stroke={kw.color} strokeWidth={2} strokeDasharray="4 3" opacity={0.8} />}
                <circle r={32} fill={kw.color} fillOpacity={0.15} stroke={kw.color} strokeWidth={2} />
                {line2 ? (
                  <>
                    <text textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={600} fill={kw.color} dy={-7}>{line1}</text>
                    <text textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={600} fill={kw.color} dy={7}>{line2}</text>
                  </>
                ) : (
                  <text textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={600} fill={kw.color}>{line1}</text>
                )}
              </g>
            );
          })}
          {/* Edge relation labels (auto + manual edges) */}
          {([...edges, ...manualEdges] as [string, string][]).map(([a, b]) => {
            const key = edgeKey(a, b);
            const label = edgeLabels[key];
            if (!label) return null;
            const pa = getPos(a), pb = getPos(b);
            const mx = (pa.x + pb.x) / 2;
            const my = (pa.y + pb.y) / 2;
            const pad = 5;
            const approxW = label.length * 5.5 + pad * 2;
            return (
              <g key={`lbl-${key}`} onContextMenu={(e) => openEdgeLabel(e, a, b)} className="cursor-context-menu">
                <rect
                  x={mx - approxW / 2} y={my - 9} width={approxW} height={18} rx={4}
                  fill={dark ? "#27272a" : "#ffffff"}
                  stroke={dark ? "#52525b" : "#d4d4d8"}
                  strokeWidth={1}
                />
                <text
                  x={mx} y={my}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fill={dark ? "#d4d4d8" : "#52525b"}
                  style={{ pointerEvents: "none" }}
                >{label}</text>
              </g>
            );
          })}
        </g>
      </svg>

      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 gap-2 pointer-events-none">
          <p className="text-sm">No nodes yet</p>
          <p className="text-xs">Add keywords or categories to build a graph</p>
        </div>
      )}

      {editingEdge && (
        <div
          className="absolute z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 flex flex-col gap-2"
          style={{ left: editingEdge.x, top: editingEdge.y, minWidth: 220 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Relation label</p>
          <input
            autoFocus
            type="text"
            value={editingEdge.value}
            onChange={(e) => setEditingEdge(prev => prev ? { ...prev, value: e.target.value } : null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const { key, value } = editingEdge;
                if (value.trim()) setEdgeLabels(prev => ({ ...prev, [key]: value.trim() }));
                else setEdgeLabels(prev => { const n = { ...prev }; delete n[key]; return n; });
                setEditingEdge(null);
              } else if (e.key === "Escape") {
                setEditingEdge(null);
              }
            }}
            placeholder="e.g. causes, uses, has, is part of…"
            className="text-sm px-2 py-1.5 border border-zinc-200 dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const { key, value } = editingEdge;
                if (value.trim()) setEdgeLabels(prev => ({ ...prev, [key]: value.trim() }));
                else setEdgeLabels(prev => { const n = { ...prev }; delete n[key]; return n; });
                setEditingEdge(null);
              }}
              className="flex-1 text-xs px-2 py-1 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded font-medium"
            >Save</button>
            {edgeLabels[editingEdge.key] && (
              <button
                onClick={() => {
                  setEdgeLabels(prev => { const n = { ...prev }; delete n[editingEdge.key]; return n; });
                  setEditingEdge(null);
                }}
                className="text-xs px-2 py-1 text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 rounded"
              >Clear</button>
            )}
            <button
              onClick={() => setEditingEdge(null)}
              className="text-xs px-2 py-1 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            >✕</button>
          </div>
        </div>
      )}

      <div className="absolute top-3 left-3 flex items-center gap-1.5">
        {/* Hand / select tool group */}
        <div className="flex items-center gap-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 shadow-sm">
          <button
            onClick={() => setGraphTool("hand")}
            title="Hand tool (pan)"
            className={`p-1.5 rounded transition-colors ${graphTool === "hand" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1v7M5.5 3.5V7M3 5.5V9a5 5 0 0 0 10 0V7M10.5 3.5V7M13 6v2" />
            </svg>
          </button>
          <button
            onClick={() => setGraphTool("select")}
            title="Selection tool (marquee drag)"
            className={`p-1.5 rounded transition-colors ${graphTool === "select" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
            </svg>
          </button>
        </div>
        {/* Link mode button */}
        <button
          onClick={() => { setLinkMode(m => !m); setPendingNode(null); }}
          title={linkMode ? "Exit link mode" : "Draw/remove manual links"}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors shadow-sm ${
            linkMode
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
              : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="2" cy="6" r="1.5" /><circle cx="10" cy="2" r="1.5" /><circle cx="10" cy="10" r="1.5" />
            <line x1="3.4" y1="5.3" x2="8.6" y2="2.7" /><line x1="3.4" y1="6.7" x2="8.6" y2="9.3" />
          </svg>
          {linkMode ? (pendingNode ? "click another node" : "click a node") : "Link"}
        </button>
      </div>

      {/* Marquee selection rect */}
      {graphSelRect && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <rect
            x={graphSelRect.x} y={graphSelRect.y}
            width={graphSelRect.w} height={graphSelRect.h}
            fill="rgba(59,130,246,0.08)"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
        </svg>
      )}

      <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 shadow-sm">
        <button onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))} className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-sm leading-none select-none">−</button>
        <input type="range" min={0.25} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-24 accent-zinc-600 dark:accent-zinc-400 cursor-pointer" />
        <button onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))} className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-sm leading-none select-none">+</button>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 w-8 text-right tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => { setZoom(1); setPan({ x: 60, y: 60 }); setOverrides({}); setSelectedNodeIds(new Set()); }} className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors" title="Reset view">↺</button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DiagramPage() {
  const params = useParams();
  const notebookId = Number(params.id);
  const { dark, toggle: toggleTheme } = useTheme();

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [customKeywords, setCustomKeywords] = useState<CustomKeyword[]>([]);
  const [kwDirty, setKwDirty] = useState(false);
  const [showBorders, setShowBorders] = useState(true);
  const showBordersRef = useRef(true);
  const [isolatedKwIds, setIsolatedKwIds] = useState<Set<string>>(new Set());
  const isolatedKwIdsRef = useRef<Set<string>>(new Set());
  const [newKw, setNewKw] = useState("");
  const [newKwColor, setNewKwColor] = useState("#f59e0b");
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const [defKwId, setDefKwId] = useState<string | null>(null);
  const [defInput, setDefInput] = useState("");
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [showNewCatFor, setShowNewCatFor] = useState<string | null | false>(false); // false=hidden, null=top-level, string=parentId
  const [newCatInput, setNewCatInput] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatVal, setEditingCatVal] = useState("");
  const [renamingKwId, setRenamingKwId] = useState<string | null>(null);
  const [renamingKwVal, setRenamingKwVal] = useState("");
  const [dragKwId, setDragKwId] = useState<string | null>(null);
  const [dragOverKwId, setDragOverKwId] = useState<string | null>(null);
  const [dragOverCatId, setDragOverCatId] = useState<string | null>(null);
  const [dragCatId, setDragCatId] = useState<string | null>(null);
  const [dragOverCatBeforeId, setDragOverCatBeforeId] = useState<string | null>(null);
  const [dragOverCatNestId, setDragOverCatNestId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ word: string; count: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedKwIds, setSelectedKwIds] = useState<Set<string>>(new Set());
  const selectedKwIdsRef = useRef<Set<string>>(new Set());
  const [tool, setTool] = useState<"hand" | "select">("hand");
  const [activeTab, setActiveTab] = useState<"bubble" | "graph">("bubble");
  const toolRef = useRef<"hand" | "select">("hand");
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const [allNotesMode, setAllNotesMode] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPos, setSplitPos] = useState(50); // percent
  const [splitSrc, setSplitSrc] = useState(`/notebook/${notebookId}`);
  const splitDraggingRef = useRef(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<Bubble, undefined> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const kwImportRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const customKeywordsRef = useRef(customKeywords);
  const bubblesRef = useRef(bubbles);
  const categoriesRef = useRef(categories);
  const definitionsRef = useRef<Record<string, string>>({});
  const clusterOverridesRef = useRef<Record<string, { x: number; y: number }>>({});
  const saveCallbackRef = useRef<() => void>(() => {});

  function applyVisibility(canvas: d3.Selection<SVGGElement, unknown, null, undefined>) {
    const kws = customKeywordsRef.current;
    const isoIds = isolatedKwIdsRef.current;
    const showB = showBordersRef.current;

    // Bubbles
    canvas.selectAll<SVGGElement, Bubble>("g.bubble").attr("display", (d) => {
      const label = d.label.toLowerCase();
      if (isoIds.size > 0) {
        const match = kws.some((k) => isoIds.has(k.id) && label.includes(k.text.toLowerCase()));
        return match ? null : "none";
      }
      // If any visible keyword matches → show; if only hidden keywords match → hide; if no keyword matches → show
      const matchingKw = kws.find((k) => label.includes(k.text.toLowerCase()));
      if (!matchingKw) return null;
      return matchingKw.hidden ? "none" : null;
    });

    // Enclosures
    canvas.selectAll<SVGPathElement, unknown>("path.kw-enc").attr("display", function() {
      if (!showB) return "none";
      const kwId = d3.select(this).attr("data-id");
      if (isoIds.size > 0) return isoIds.has(kwId) ? null : "none";
      const kw = kws.find((k) => k.id === kwId);
      return kw?.hidden ? "none" : null;
    });
  }
  const updateEnclosuresRef = useRef<(() => void)>(() => {
    const c = canvasRef.current;
    if (!c) return;
    customKeywordsRef.current.forEach((kw) => {
      const matching = bubblesRef.current.filter((b) =>
        b.label.toLowerCase().includes(kw.text.toLowerCase())
      );
      const path = c.select<SVGPathElement>(`path.kw-enc[data-id="${kw.id}"]`);
      if (matching.length === 0) { path.attr("d", null); c.select<SVGTextElement>(`text.kw-enc-label[data-id="${kw.id}"]`).attr("display", "none"); return; }
      const pts: [number, number][] = [];
      matching.forEach((b) => {
        const cx = b.x ?? 0, cy = b.y ?? 0, r = b.radius + 18;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
      });
      const hull = d3.polygonHull(pts);
      const label = c.select<SVGTextElement>(`text.kw-enc-label[data-id="${kw.id}"]`);
      if (hull) {
        path.attr("d", enclosureLine(hull));
        const centroid = d3.polygonCentroid(hull);
        label.attr("x", centroid[0]).attr("y", centroid[1]).attr("display", null);
      } else {
        path.attr("d", null);
        label.attr("display", "none");
      }
    });
  });
  const [size, setSize] = useState({ w: 900, h: 700 });

  // Load term definitions from DB
  useEffect(() => {
    fetch("/api/term-definitions") // term definitions are global
      .then((r) => r.json())
      .then((d: { term: string; definition: string }[]) => {
        if (!Array.isArray(d)) return;
        const map: Record<string, string> = {};
        d.forEach(({ term, definition }) => { map[term] = definition; });
        setDefinitions(map);
      });
  }, []);

  // Load keywords + categories from DB
  useEffect(() => {
    Promise.all([
      fetch(`/api/diagram-keywords?notebookId=${notebookId}`).then((r) => r.json()),
      fetch(`/api/diagram-categories?notebookId=${notebookId}`).then((r) => r.json()),
    ]).then(([kws, cats]) => {
      if (Array.isArray(kws)) {
        setCustomKeywords(kws);
        const overrides: Record<string, { x: number; y: number }> = {};
        kws.forEach((kw: CustomKeyword) => {
          if (kw.x != null && kw.y != null) overrides[kw.id] = { x: kw.x, y: kw.y };
        });
        clusterOverridesRef.current = overrides;
      }
      if (Array.isArray(cats)) setCategories(cats);
    });
  }, []);

  // Keep bubbles/categories refs in sync
  useEffect(() => { bubblesRef.current = bubbles; }, [bubbles]);
  useEffect(() => { definitionsRef.current = definitions; }, [definitions]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);

  // Keep tool ref in sync + update bg cursor
  useEffect(() => {
    toolRef.current = tool;
    const svg = svgRef.current;
    if (svg) d3.select(svg).select("rect.bg").attr("cursor", tool === "select" ? "crosshair" : "grab");
  }, [tool]);

  // Keep selection ref in sync + update visual styles
  useEffect(() => {
    selectedKwIdsRef.current = selectedKwIds;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selectAll<SVGPathElement, unknown>("path.kw-enc").each(function() {
      const id = d3.select(this).attr("data-id");
      const selected = selectedKwIds.has(id);
      d3.select(this)
        .attr("stroke-width", selected ? 3.5 : 2.5)
        .attr("stroke-dasharray", selected ? "6 3" : null)
        .attr("stroke-opacity", selected ? 1 : 0.75);
    });
  }, [selectedKwIds]);

  // Keep keyword ref in sync — rebuild enclosure layer, kick simulation
  useEffect(() => {
    customKeywordsRef.current = customKeywords;
    // Keep save callback up to date with latest keywords
    saveCallbackRef.current = () => {
      const withPositions = customKeywordsRef.current.map((kw) => {
        const override = clusterOverridesRef.current[kw.id];
        return { ...kw, x: override?.x ?? kw.x ?? null, y: override?.y ?? kw.y ?? null };
      });
      Promise.all([
        fetch(`/api/diagram-keywords?notebookId=${notebookId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(withPositions),
        }),
        fetch(`/api/diagram-categories?notebookId=${notebookId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(categoriesRef.current),
        }),
      ]).then(() => setKwDirty(false));
    };
    const canvas = canvasRef.current;
    if (canvas) {
      buildEnclosureLayer(canvas, customKeywords);
      attachEnclosureDrags(canvas, bubblesRef, customKeywordsRef, simRef, clusterOverridesRef, saveCallbackRef, selectedKwIdsRef, setSelectedKwIds);
      applyVisibility(canvas);
      // Update bubble color from keyword color
      customKeywords.forEach((kw) => {
        bubblesRef.current
          .filter((b) => b.label.toLowerCase().includes(kw.text.toLowerCase()))
          .forEach((b) => { b.color = kw.color; b.borderColor = kw.color; });
      });
      canvas.selectAll<SVGGElement, Bubble>("g.bubble")
        .select("circle.bubble-main")
        .attr("fill", (d) => d.color)
        .attr("stroke", (d) => d.borderColor);
    }
    if (simRef.current) {
      simRef.current.alphaTarget(0.3).restart();
      setTimeout(() => simRef.current?.alphaTarget(0), 1500);
    }
    updateEnclosuresRef.current();
  }, [customKeywords]);

  useEffect(() => {
    zoomRef.current = zoom;
    canvasRef.current?.attr("transform",
      `translate(${panRef.current.x},${panRef.current.y}) scale(${zoom})`
    );
  }, [zoom]);

  useEffect(() => {
    showBordersRef.current = showBorders;
    if (canvasRef.current) applyVisibility(canvasRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBorders]);

  useEffect(() => {
    isolatedKwIdsRef.current = isolatedKwIds;
    if (canvasRef.current) applyVisibility(canvasRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isolatedKwIds]);

  useEffect(() => {
    fetch(`/api/notes?notebookId=${notebookId}`).then((r) => r.json()).then((d) => setNotes(Array.isArray(d) ? d : []));
    fetch(`/api/notebooks/${notebookId}/keyword-suggestions`).then((r) => r.json()).then((d) => setSuggestions(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll to zoom on diagram canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => Math.min(4, Math.max(0.1, +(z + delta).toFixed(3))));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    function dismiss(e: MouseEvent) {
      if ((e.target as Element)?.closest(".ctx-menu")) return;
      setContextMenu(null);
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [contextMenu]);

  const loadNote = useCallback(async (id: number) => {
    const res = await fetch(`/api/notes/${id}`);
    const note: Note = await res.json();
    setActiveNote(note);
    const items = parseNoteHtml(note.content);
    const clusters = buildKeywordClusters(items);
    const defaultColor = (i: number) => PALETTE[clusters[i] % PALETTE.length];
    const newBubbles = items.map((item, i) => {
      const kw = customKeywordsRef.current.find((k) =>
        item.label.toLowerCase().includes(k.text.toLowerCase())
      );
      const color = kw ? kw.color : defaultColor(i);
      return {
        id: item.id,
        label: item.label,
        nodeType: item.nodeType,
        cluster: clusters[i],
        radius: RADIUS[item.nodeType] ?? 36,
        color,
        borderColor: color,
        x: size.w / 2 + (Math.random() - 0.5) * 200,
        y: size.h / 2 + (Math.random() - 0.5) * 200,
      };
    });
    setBubbles(newBubbles);
  }, [size.w, size.h]);

  const loadAllNotes = useCallback(async () => {
    const res = await fetch(`/api/notes?notebookId=${notebookId}`);
    const metas: NoteMeta[] = await res.json();
    const allContents = await Promise.all(
      metas.map((m) => fetch(`/api/notes/${m.id}`).then((r) => r.json() as Promise<Note>))
    );
    const seen = new Set<string>();
    const combined: RawItem[] = [];
    let idx = 0;
    allContents.forEach((note) => {
      parseNoteHtml(note.content).forEach((item) => {
        const key = item.label.toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); combined.push({ ...item, id: `n${idx++}` }); }
      });
    });
    const clusters = buildKeywordClusters(combined);
    const defaultColor = (i: number) => PALETTE[clusters[i] % PALETTE.length];
    const newBubbles = combined.map((item, i) => {
      const kw = customKeywordsRef.current.find((k) =>
        item.label.toLowerCase().includes(k.text.toLowerCase())
      );
      const color = kw ? kw.color : defaultColor(i);
      return {
        id: item.id, label: item.label, nodeType: item.nodeType,
        cluster: clusters[i], radius: RADIUS[item.nodeType] ?? 36,
        color, borderColor: color,
        x: size.w / 2 + (Math.random() - 0.5) * 200,
        y: size.h / 2 + (Math.random() - 0.5) * 200,
      };
    });
    setBubbles(newBubbles);
  }, [notebookId, size.w, size.h]);

  function randomColor() {
    const usedColors = new Set(customKeywords.map((k) => k.color.toLowerCase()));
    const available = PALETTE.filter((c) => !usedColors.has(c.toLowerCase()));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
    // All palette colors taken — generate a random hex not already in use
    let candidate = "";
    let attempts = 0;
    do {
      candidate = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
      attempts++;
    } while (usedColors.has(candidate) && attempts < 100);
    return candidate;
  }

  function addKeyword() {
    const text = newKw.trim();
    if (!text) return;
    setCustomKeywords((prev) => [...prev, { id: crypto.randomUUID(), text, color: newKwColor, categoryId: null, order: prev.length }]);
    setKwDirty(true);
    setNewKw("");
    setNewKwColor(randomColor());
  }

  async function saveKeywords() {
    saveCallbackRef.current();
  }

  function exportKeywords() {
    const data = JSON.stringify(customKeywords, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keywords-notebook-${notebookId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importKeywords(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!Array.isArray(parsed)) { alert("Invalid keywords file."); return; }
        const imported: CustomKeyword[] = parsed.map((k, i) => ({
          id: k.id ?? crypto.randomUUID(),
          text: k.text ?? "",
          color: k.color ?? "#888888",
          hidden: k.hidden ?? false,
          x: k.x ?? null,
          y: k.y ?? null,
          categoryId: k.categoryId ?? null,
          order: k.order ?? i,
        })).filter((k) => k.text.trim());
        setCustomKeywords(imported);
        setKwDirty(true);
      } catch {
        alert("Failed to parse keywords file.");
      }
    };
    reader.readAsText(file);
  }

  // ── Combined render + simulate + drag effect ───────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    simRef.current?.stop();

    const svg = d3.select(svgRef.current);

    // Defs (shadow filter) — once only
    if (svg.select("defs").empty()) {
      const defs = svg.append("defs");
      const f = defs.append("filter").attr("id", "bshadow")
        .attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
      f.append("feDropShadow").attr("dx", 0).attr("dy", 2).attr("stdDeviation", 3).attr("flood-opacity", 0.18);
    }

    // Background rect for pan (below canvas) — once, resized each run
    if (svg.select("rect.bg").empty()) {
      svg.append("rect").attr("class", "bg").attr("fill", "transparent").attr("cursor", "grab");
    }
    svg.select("rect.bg").attr("width", size.w).attr("height", size.h);

    // Canvas group that holds all content and receives pan transform
    if (svg.select("g.canvas").empty()) {
      svg.append("g").attr("class", "canvas");
    }
    const canvas = svg.select<SVGGElement>("g.canvas");
    canvas.attr("transform", `translate(${panRef.current.x},${panRef.current.y}) scale(${zoomRef.current})`);

    // Pan / select drag on background rect
    let bgDidDrag = false;
    const bgDrag = d3.drag<SVGRectElement, unknown>()
      .on("start", (event) => {
        bgDidDrag = false;
        if (toolRef.current === "select") {
          selStartRef.current = { x: event.x, y: event.y };
          svg.select("rect.bg").attr("cursor", "crosshair");
        } else {
          svg.select("rect.bg").attr("cursor", "grabbing");
        }
      })
      .on("drag", (event) => {
        bgDidDrag = true;
        if (toolRef.current === "select") {
          const x0 = selStartRef.current!.x;
          const y0 = selStartRef.current!.y;
          setSelRect({
            x: Math.min(x0, event.x), y: Math.min(y0, event.y),
            w: Math.abs(event.x - x0), h: Math.abs(event.y - y0),
          });
        } else {
          panRef.current.x += event.dx;
          panRef.current.y += event.dy;
          canvas.attr("transform", `translate(${panRef.current.x},${panRef.current.y}) scale(${zoomRef.current})`);
        }
      })
      .on("end", (event) => {
        if (toolRef.current === "select") {
          setSelRect(null);
          if (bgDidDrag && selStartRef.current) {
            // Convert selection rect from SVG coords → canvas coords
            const px = panRef.current.x, py = panRef.current.y, z = zoomRef.current;
            const x0 = selStartRef.current.x, y0 = selStartRef.current.y;
            const x1 = event.x, y1 = event.y;
            const minX = (Math.min(x0, x1) - px) / z, maxX = (Math.max(x0, x1) - px) / z;
            const minY = (Math.min(y0, y1) - py) / z, maxY = (Math.max(y0, y1) - py) / z;
            const next = new Set<string>();
            customKeywordsRef.current.forEach((kw) => {
              const matching = bubblesRef.current.filter((b) =>
                b.label.toLowerCase().includes(kw.text.toLowerCase())
              );
              if (matching.length === 0) return;
              const cx = matching.reduce((s, b) => s + (b.x ?? 0), 0) / matching.length;
              const cy = matching.reduce((s, b) => s + (b.y ?? 0), 0) / matching.length;
              if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) next.add(kw.id);
            });
            setSelectedKwIds(next);
          } else {
            setSelectedKwIds(new Set());
          }
          selStartRef.current = null;
          svg.select("rect.bg").attr("cursor", "crosshair");
        } else {
          if (!bgDidDrag) setSelectedKwIds(new Set());
          svg.select("rect.bg").attr("cursor", "grab");
        }
      });
    svg.select<SVGRectElement>("rect.bg").call(bgDrag);

    // Store canvas ref so the keyword effect can access it
    canvasRef.current = canvas;

    // Rebuild enclosure paths (keywords may already be loaded from DB)
    buildEnclosureLayer(canvas, customKeywordsRef.current);
    attachEnclosureDrags(canvas, bubblesRef, customKeywordsRef, simRef, clusterOverridesRef, saveCallbackRef, selectedKwIdsRef, setSelectedKwIds);

    // Clear bubble elements
    canvas.selectAll("g.bubble").remove();

    if (bubbles.length === 0) return;

    // Create bubble groups inside canvas
    const groups = canvas.selectAll<SVGGElement, Bubble>("g.bubble")
      .data(bubbles, (d) => d.id)
      .enter()
      .append("g")
      .attr("class", "bubble")
      .attr("cursor", "grab")
      .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

    groups.append("circle")
      .attr("class", "bubble-main")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => d.borderColor)
      .attr("stroke-width", 3)
      .attr("filter", "url(#bshadow)")
      .attr("opacity", 0.92);

    groups.append("circle")
      .attr("r", (d) => d.radius * 0.7)
      .attr("fill", "white")
      .attr("opacity", 0.08)
      .attr("pointer-events", "none");

    groups.each(function(d) {
      const g = d3.select(this);
      const lines = wrapLabel(d.label, d.radius);
      const lineH = Math.min(13, d.radius * 0.32);
      const totalH = lines.length * lineH;
      lines.forEach((line, i) => {
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("y", -totalH / 2 + i * lineH + lineH / 2)
          .attr("fill", "white")
          .attr("font-size", Math.min(12, d.radius * 0.28))
          .attr("font-weight", d.nodeType.startsWith("h") ? "700" : "500")
          .attr("pointer-events", "none")
          .text(line);
      });
    });

    // Bubble drag
    const drag = d3.drag<SVGGElement, Bubble>()
      .on("start", function(event, d) {
        event.sourceEvent.stopPropagation();
        if (!event.active) simRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
        d3.select(this).attr("cursor", "grabbing");
      })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", function(event, d) {
        if (!event.active) simRef.current?.alphaTarget(0);
        d.fx = null; d.fy = null;
        d3.select(this).attr("cursor", "grab");
      });

    groups.call(drag);

    groups.on("contextmenu", (event, d) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, bubble: d });
    });

    // Cluster force: matched bubbles go to their keyword's target; unmatched go to center
    function clusterForce(alpha: number) {
      const kws = customKeywordsRef.current;
      const cx = size.w / 2, cy = size.h / 2;
      for (const b of bubblesRef.current) {
        const idx = kws.findIndex((kw) =>
          b.label.toLowerCase().includes(kw.text.toLowerCase())
        );
        let tx: number, ty: number;
        if (idx >= 0) {
          const kw = kws[idx];
          const override = clusterOverridesRef.current[kw.id];
          const t = override ?? clusterTarget(idx, size.w, size.h);
          tx = t.x; ty = t.y;
        } else {
          tx = cx; ty = cy;
        }
        b.vx = (b.vx ?? 0) + (tx - (b.x ?? 0)) * alpha * 0.12;
        b.vy = (b.vy ?? 0) + (ty - (b.y ?? 0)) * alpha * 0.12;
      }
    }

    // Force simulation
    const sim = d3.forceSimulation(bubbles)
      .force("collide", d3.forceCollide<Bubble>((d) => d.radius + 6).strength(0.9).iterations(4))
      .force("charge", d3.forceManyBody().strength(-20))
      .force("cluster", clusterForce)
      .alphaDecay(0.015)
      .on("tick", () => {
        canvas.selectAll<SVGGElement, Bubble>("g.bubble")
          .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        updateEnclosuresRef.current?.();
      });

    applyVisibility(canvas);
    simRef.current = sim;
    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles, size]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Hidden file input for keyword import */}
      <input
        ref={kwImportRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importKeywords(f);
          e.target.value = "";
        }}
      />
      {/* Notes iframe panel */}
      {splitOpen && (
        <>
          <div style={{ width: `${splitPos}%` }} className="h-full shrink-0 overflow-hidden">
            <iframe
              src={splitSrc}
              className="w-full h-full border-0"
              title="Notes"
            />
          </div>
          {/* Draggable divider */}
          <div
            className="w-1 bg-zinc-300 dark:bg-zinc-600 hover:bg-blue-400 dark:hover:bg-blue-500 cursor-col-resize shrink-0 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              splitDraggingRef.current = true;
              const onMove = (ev: MouseEvent) => {
                if (!splitDraggingRef.current) return;
                const pct = (ev.clientX / window.innerWidth) * 100;
                setSplitPos(Math.max(20, Math.min(80, pct)));
              };
              const onUp = () => {
                splitDraggingRef.current = false;
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />
        </>
      )}
      {/* Diagram panel */}
      <div className="flex flex-1 h-full min-w-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 shrink-0">
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Diagrams</span>
            <div className="flex items-center gap-2">
              <button onClick={toggleTheme} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors" title="Toggle dark mode">
                {dark ? "☀" : "☾"}
              </button>
              <button
                onClick={() => setSplitOpen((v) => !v)}
                title={splitOpen ? "Close split view" : "Open split view with Notes"}
                className={`text-xs transition-colors ${splitOpen ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14"/><rect x="1" y="2" width="14" height="12" rx="2"/></svg>
              </button>
              <Link href={`/notebook/${notebookId}/quiz`} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">Quiz</Link>
              <Link href={`/notebook/${notebookId}`} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">← Notes</Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {kwDirty && <span className="text-xs text-zinc-400 dark:text-zinc-500">Unsaved</span>}
            <button
              onClick={() => saveKeywords()}
              disabled={!kwDirty}
              className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200 disabled:opacity-40 disabled:cursor-default"
            >
              Save
            </button>
            <button
              onClick={exportKeywords}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              title="Export keywords as JSON"
            >
              ↓
            </button>
            <button
              onClick={() => kwImportRef.current?.click()}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              title="Import keywords from JSON"
            >
              ↑
            </button>
            <button
              onClick={() => setShowBorders((v) => !v)}
              className={`text-xs transition-colors ${showBorders ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}
              title={showBorders ? "Hide borders" : "Show borders"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="3" />
              </svg>
            </button>
            {(activeNote || allNotesMode) && (
              <button
                onClick={() => allNotesMode ? loadAllNotes() : loadNote(activeNote!.id)}
                className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                title="Refresh diagram"
              >
                ↺
              </button>
            )}
          </div>
        </div>

        {/* All notes toggle */}
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
          <button
            onClick={() => {
              const next = !allNotesMode;
              setAllNotesMode(next);
              if (next) loadAllNotes();
              else { setActiveNote(null); setBubbles([]); }
            }}
            className={`w-full text-xs rounded px-2 py-1.5 transition-colors border ${
              allNotesMode
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"
            }`}
          >
            {allNotesMode ? "All notes combined" : "All notes"}
          </button>
        </div>

        {/* Notes list */}
        <ul className="overflow-y-auto border-b border-zinc-200 dark:border-zinc-700" style={{ maxHeight: "35%" }}>
          {notes.map((note) => (
            <li
              key={note.id}
              onClick={() => { setAllNotesMode(false); loadNote(note.id); }}
              className={`px-3 py-2 text-sm cursor-pointer truncate ${
                !allNotesMode && activeNote?.id === note.id
                  ? "bg-zinc-200 dark:bg-zinc-700 font-medium"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {note.title || "Untitled"}
            </li>
          ))}
        </ul>

        {/* Custom keywords panel */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Keywords</p>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <button onClick={() => setShowSuggestions((v) => !v)} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mb-1">
                {showSuggestions ? "▾" : "▸"} Suggested
              </button>
              {showSuggestions && (
                <div className="flex flex-wrap gap-1">
                  {suggestions
                    .filter((s) => !customKeywords.some((k) => k.text.toLowerCase() === s.word.toLowerCase()))
                    .map((s) => (
                      <button
                        key={s.word}
                        onClick={() => { setCustomKeywords((prev) => [...prev, { id: crypto.randomUUID(), text: s.word, color: newKwColor, categoryId: null, order: prev.length }]); setKwDirty(true); }}
                        className="text-xs border border-zinc-200 dark:border-zinc-600 rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-300 transition-colors"
                        title={`${s.count} occurrence${s.count !== 1 ? "s" : ""}`}
                      >+ {s.word}</button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Manual input */}
          <div className="flex gap-1">
            <input value={newKw} onChange={(e) => setNewKw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKeyword()} placeholder="keyword…" className="flex-1 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-xs bg-white dark:bg-zinc-700 dark:text-zinc-100 outline-none min-w-0" />
            <input type="color" value={newKwColor} onChange={(e) => setNewKwColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-zinc-300 dark:border-zinc-600 p-0.5 bg-white dark:bg-zinc-700" title="Color" />
            <button onClick={() => setNewKwColor(randomColor())} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200 flex items-center" title="Random color">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h2l8 8h2M12 4h2M2 12h2" /><polyline points="10 4 12 4 12 6" /><polyline points="4 12 2 12 2 10" /></svg>
            </button>
            <button onClick={addKeyword} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors dark:text-zinc-200">+</button>
          </div>

          {/* Category tree + keywords */}
          {(() => {
            function commitRenameKw(id: string, val: string) {
              const name = val.trim();
              if (name) setCustomKeywords((prev) => prev.map((k) => k.id === id ? { ...k, text: name } : k));
              setRenamingKwId(null);
              setRenamingKwVal("");
              setKwDirty(true);
            }

            function renderKw(kw: CustomKeyword) {
              return (
                <li
                  key={kw.id}
                  className={`flex flex-col gap-0.5 rounded transition-colors ${dragOverKwId === kw.id ? "border-t-2 border-black dark:border-white" : ""}`}
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); setDragKwId(kw.id); }}
                  onDragEnd={() => { setDragKwId(null); setDragOverKwId(null); setDragOverCatId(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverKwId(kw.id); setDragOverCatId(null); }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    if (!dragKwId || dragKwId === kw.id) return;
                    setCustomKeywords((prev) => {
                      const dragged = prev.find((k) => k.id === dragKwId);
                      if (!dragged) return prev;
                      const without = prev.filter((k) => k.id !== dragKwId);
                      const idx = without.findIndex((k) => k.id === kw.id);
                      const updated = { ...dragged, categoryId: kw.categoryId };
                      without.splice(idx, 0, updated);
                      return without.map((k, i) => ({ ...k, order: i }));
                    });
                    setKwDirty(true); setDragOverKwId(null);
                  }}
                  onContextMenu={(e) => { e.preventDefault(); setDefKwId((prev) => prev === kw.id ? null : kw.id); setDefInput(definitions[kw.text] ?? ""); }}
                >
                  <div className="flex items-center gap-1 text-xs">
                    <span className="cursor-grab text-zinc-300 dark:text-zinc-600 select-none shrink-0">⠿</span>
                    <label className="relative w-3 h-3 shrink-0 cursor-pointer">
                      <span className="block w-3 h-3 rounded-full border-2" style={{ borderColor: kw.color, backgroundColor: kw.color + "33" }} />
                      <input type="color" value={kw.color} onChange={(e) => { setCustomKeywords((prev) => prev.map((k) => k.id === kw.id ? { ...k, color: e.target.value } : k)); setKwDirty(true); }} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" title="Color" />
                    </label>
                    {renamingKwId === kw.id ? (
                      <input
                        value={renamingKwVal}
                        onChange={(e) => setRenamingKwVal(e.target.value)}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRenameKw(kw.id, renamingKwVal); if (e.key === "Escape") { setRenamingKwId(null); setRenamingKwVal(""); } }}
                        onBlur={() => commitRenameKw(kw.id, renamingKwVal)}
                        autoFocus
                        className="flex-1 min-w-0 text-xs bg-transparent border-b border-zinc-400 dark:border-zinc-500 outline-none dark:text-zinc-100"
                      />
                    ) : (
                      <span
                        className={`flex-1 truncate cursor-text ${kw.hidden ? "text-zinc-400 dark:text-zinc-500 line-through" : "dark:text-zinc-300"}`}
                        onDoubleClick={() => { setRenamingKwId(kw.id); setRenamingKwVal(kw.text); }}
                        title="Double-click to rename"
                      >{kw.text}</span>
                    )}
                    <button onClick={() => { setCustomKeywords((prev) => prev.map((k) => k.id === kw.id ? { ...k, hidden: !k.hidden } : k)); setKwDirty(true); }} className={`transition-colors ${kw.hidden ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`} title={kw.hidden ? "Show" : "Hide"}>
                      {kw.hidden ? <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.5" /><path d="M8 4C4.5 4 2 8 2 8s.8 1.4 2.3 2.7M10.6 10.6C9.6 11.4 8.8 12 8 12c-3.5 0-6-4-6-4" /><path d="M14 8s-.7 1.2-2 2.4" /></svg> : <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2" /></svg>}
                    </button>
                    <button onClick={() => setIsolatedKwIds((prev) => { const next = new Set(prev); next.has(kw.id) ? next.delete(kw.id) : next.add(kw.id); return next; })} className={`transition-colors ${isolatedKwIds.has(kw.id) ? "text-amber-500" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`} title={isolatedKwIds.has(kw.id) ? "Exit isolate" : "Isolate"}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3" /><line x1="8" y1="1" x2="8" y2="4" /><line x1="8" y1="12" x2="8" y2="15" /><line x1="1" y1="8" x2="4" y2="8" /><line x1="12" y1="8" x2="15" y2="8" /></svg>
                    </button>
                    <button onClick={() => { setCustomKeywords((prev) => prev.map((k) => k.id === kw.id ? { ...k, color: randomColor() } : k)); setKwDirty(true); }} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors" title="Random color">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h2l8 8h2M12 4h2M2 12h2" /><polyline points="10 4 12 4 12 6" /><polyline points="4 12 2 12 2 10" /></svg>
                    </button>
                    <button onClick={() => { setCustomKeywords((prev) => prev.filter((k) => k.id !== kw.id)); setKwDirty(true); }} className="text-zinc-400 hover:text-red-500 transition-colors">✕</button>
                  </div>
                  {defKwId === kw.id && (
                    <div className="pl-5">
                      <textarea value={defInput} onChange={(e) => setDefInput(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Add a definition…" rows={3} autoFocus className="w-full text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-200 px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-black" />
                      <div className="flex gap-1 mt-1">
                        <button onClick={() => { const def = defInput.trim(); fetch("/api/term-definitions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term: kw.text, definition: def }) }); setDefinitions((prev) => ({ ...prev, [kw.text]: def })); setDefKwId(null); }} className="text-xs bg-black hover:bg-zinc-800 text-white rounded px-2 py-0.5 transition-colors">Save</button>
                        <button onClick={() => setDefKwId(null)} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            }

            function addCategory(parentId: string | null) {
              const name = newCatInput.trim();
              if (!name) return;
              const siblings = categories.filter((c) => c.parentId === parentId);
              const newCat: CategoryData = { id: crypto.randomUUID(), name, order: siblings.length, parentId };
              setCategories((prev) => [...prev, newCat]);
              setNewCatInput(""); setShowNewCatFor(false); setKwDirty(true);
            }

            function deleteCategory(catId: string) {
              // Collect all descendant ids
              function descendants(id: string): string[] {
                const children = categories.filter((c) => c.parentId === id);
                return [id, ...children.flatMap((c) => descendants(c.id))];
              }
              const toRemove = new Set(descendants(catId));
              setCategories((prev) => prev.filter((c) => !toRemove.has(c.id)));
              setCustomKeywords((prev) => prev.map((k) => toRemove.has(k.categoryId ?? "") ? { ...k, categoryId: null } : k));
              setKwDirty(true);
            }

            function reorderCat(dragId: string, beforeId: string) {
              setCategories((prev) => {
                const dragged = prev.find((c) => c.id === dragId);
                const target = prev.find((c) => c.id === beforeId);
                if (!dragged || !target) return prev;
                const newParentId = target.parentId;
                // Prevent circular: target can't be descendant of dragged
                function isDesc(id: string | null): boolean {
                  if (!id) return false;
                  if (id === dragId) return true;
                  return isDesc(prev.find((c) => c.id === id)?.parentId ?? null);
                }
                if (isDesc(target.id)) return prev;
                const siblings = prev
                  .filter((c) => c.id !== dragId && c.parentId === newParentId)
                  .sort((a, b) => a.order - b.order);
                const insertIdx = siblings.findIndex((c) => c.id === beforeId);
                siblings.splice(insertIdx, 0, { ...dragged, parentId: newParentId });
                return prev.map((c) => {
                  const updated = siblings.find((s) => s.id === c.id);
                  if (updated) return { ...updated, order: siblings.indexOf(updated) };
                  return c;
                });
              });
              setKwDirty(true); setDragCatId(null); setDragOverCatBeforeId(null);
            }

            function renderCategory(cat: CategoryData, depth: number): React.ReactNode {
              const catKws = customKeywords.filter((k) => k.categoryId === cat.id).sort((a, b) => a.order - b.order);
              const children = categories.filter((c) => c.parentId === cat.id).sort((a, b) => a.order - b.order);
              const isEditing = editingCatId === cat.id;

              return (
                <div key={cat.id} style={{ paddingLeft: depth * 10 }}>
                  {/* Drop-before indicator */}
                  {dragOverCatBeforeId === cat.id && dragCatId !== cat.id && (
                    <div className="h-0.5 bg-blue-400 rounded mx-1 mb-0.5" />
                  )}
                  {/* Category header */}
                  <div
                    className={`flex items-center gap-1 mb-0.5 rounded px-1 py-0.5 transition-colors ${dragOverCatId === cat.id ? "bg-zinc-100 dark:bg-zinc-700" : dragOverCatNestId === cat.id ? "bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400" : ""}`}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDragCatId(cat.id); setDragOverCatBeforeId(null); setDragOverCatNestId(null); }}
                    onDragEnd={() => { setDragCatId(null); setDragOverCatBeforeId(null); setDragOverCatNestId(null); setDragOverCatId(null); }}
                    onDragOver={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (dragKwId) { setDragOverCatId(cat.id); return; }
                      if (dragCatId && dragCatId !== cat.id) {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const third = rect.height / 3;
                        if (e.clientY < rect.top + third) {
                          setDragOverCatBeforeId(cat.id); setDragOverCatNestId(null);
                        } else {
                          setDragOverCatNestId(cat.id); setDragOverCatBeforeId(null);
                        }
                      }
                    }}
                    onDragLeave={() => { setDragOverCatId(null); setDragOverCatBeforeId(null); setDragOverCatNestId(null); }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (dragKwId) {
                        setCustomKeywords((prev) => prev.map((k) => k.id === dragKwId ? { ...k, categoryId: cat.id } : k));
                        setKwDirty(true); setDragKwId(null); setDragOverCatId(null); return;
                      }
                      if (dragCatId && dragCatId !== cat.id) {
                        if (dragOverCatNestId === cat.id) {
                          // Nest dragged inside this category
                          setCategories((prev) => {
                            const dragged = prev.find((c) => c.id === dragCatId);
                            if (!dragged) return prev;
                            function isDesc(id: string | null): boolean {
                              if (!id) return false;
                              if (id === dragCatId) return true;
                              return isDesc(prev.find((c) => c.id === id)?.parentId ?? null);
                            }
                            if (isDesc(cat.id)) return prev; // would be circular
                            const siblings = prev.filter((c) => c.parentId === cat.id && c.id !== dragCatId);
                            return prev.map((c) => c.id === dragCatId ? { ...c, parentId: cat.id, order: siblings.length } : c);
                          });
                          setKwDirty(true); setDragCatId(null); setDragOverCatNestId(null);
                        } else {
                          reorderCat(dragCatId, cat.id);
                        }
                      }
                    }}
                  >
                    <span className="cursor-grab text-zinc-300 dark:text-zinc-600 select-none shrink-0 text-xs">⠿</span>
                    {isEditing ? (
                      <>
                        <input
                          value={editingCatVal}
                          onChange={(e) => setEditingCatVal(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              const next = editingCatVal.trim();
                              if (next) { setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, name: next } : c)); setKwDirty(true); }
                              setEditingCatId(null);
                            } else if (e.key === "Escape") setEditingCatId(null);
                          }}
                          onBlur={() => {
                            const next = editingCatVal.trim();
                            if (next) { setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, name: next } : c)); setKwDirty(true); }
                            setEditingCatId(null);
                          }}
                          autoFocus
                          className="flex-1 text-xs font-semibold rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-200 px-1 py-0 focus:outline-none focus:ring-1 focus:ring-black min-w-0"
                        />
                      </>
                    ) : (
                      <span
                        className="flex-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 truncate"
                        onDoubleClick={() => { setEditingCatId(cat.id); setEditingCatVal(cat.name); }}
                        title="Double-click to rename"
                      >{cat.name}</span>
                    )}
                    <button onClick={() => setShowNewCatFor(cat.id)} className="text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors shrink-0" title="Add subcategory">
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
                    </button>
                    <button onClick={() => deleteCategory(cat.id)} className="text-zinc-300 hover:text-red-400 dark:text-zinc-600 dark:hover:text-red-400 text-xs transition-colors shrink-0" title="Remove category">✕</button>
                  </div>

                  {/* New subcategory input */}
                  {showNewCatFor === cat.id && (
                    <div className="flex gap-1 pl-3 mb-1">
                      <input value={newCatInput} onChange={(e) => setNewCatInput(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") addCategory(cat.id); if (e.key === "Escape") { setShowNewCatFor(false); setNewCatInput(""); } }} autoFocus placeholder="Subcategory name…" className="flex-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-200 px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-black min-w-0" />
                      <button onClick={() => addCategory(cat.id)} className="text-xs bg-black hover:bg-zinc-800 text-white rounded px-1.5 py-0.5">Add</button>
                    </div>
                  )}

                  {/* Keywords in this category */}
                  <ul
                    className={`flex flex-col gap-0.5 pl-2 min-h-[4px] rounded transition-colors ${dragOverCatId === cat.id && dragKwId ? "bg-zinc-50 dark:bg-zinc-700/40" : ""}`}
                    onDragOver={(e) => { if (dragKwId) { e.preventDefault(); setDragOverCatId(cat.id); } }}
                    onDragLeave={() => setDragOverCatId(null)}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (!dragKwId) return;
                      setCustomKeywords((prev) => prev.map((k) => k.id === dragKwId ? { ...k, categoryId: cat.id } : k));
                      setKwDirty(true); setDragKwId(null); setDragOverCatId(null);
                    }}
                  >
                    {catKws.map(renderKw)}
                  </ul>

                  {/* Child categories */}
                  <div className="flex flex-col gap-1 mt-0.5">
                    {children.map((child) => renderCategory(child, depth + 1))}
                  </div>
                </div>
              );
            }

            const rootCats = categories.filter((c) => c.parentId === null).sort((a, b) => a.order - b.order);
            const uncategorized = customKeywords.filter((k) => !k.categoryId);

            return (
              <div className="flex flex-col gap-1">
                {rootCats.map((cat) => renderCategory(cat, 0))}

                {/* Uncategorized */}
                {uncategorized.length > 0 && (
                  <div
                    onDragOver={(e) => { if (dragKwId) { e.preventDefault(); setDragOverCatId("__none__"); setDragOverKwId(null); } }}
                    onDragLeave={() => setDragOverCatId(null)}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (!dragKwId) return;
                      setCustomKeywords((prev) => prev.map((k) => k.id === dragKwId ? { ...k, categoryId: null } : k));
                      setKwDirty(true); setDragOverCatId(null);
                    }}
                  >
                    {rootCats.length > 0 && <p className={`text-xs font-semibold uppercase tracking-wide mb-0.5 px-1 py-0.5 rounded transition-colors ${dragOverCatId === "__none__" ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-500" : "text-zinc-400 dark:text-zinc-500"}`}>Uncategorized</p>}
                    <ul className="flex flex-col gap-0.5 pl-1">{uncategorized.map(renderKw)}</ul>
                  </div>
                )}

                {/* New top-level category */}
                <div className="mt-1">
                  {showNewCatFor === null ? (
                    <div className="flex gap-1">
                      <input value={newCatInput} onChange={(e) => setNewCatInput(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") addCategory(null); if (e.key === "Escape") { setShowNewCatFor(false); setNewCatInput(""); } }} autoFocus placeholder="Category name…" className="flex-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-200 px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-black min-w-0" />
                      <button onClick={() => addCategory(null)} className="text-xs bg-black hover:bg-zinc-800 text-white rounded px-2 py-0.5">Add</button>
                    </div>
                  ) : (
                    <button onClick={() => { setShowNewCatFor(null); setNewCatInput(""); }} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">+ New category</button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </aside>

      {/* Canvas */}
      <main ref={containerRef} className="flex-1 relative overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {/* Tab bar */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 shadow-sm">
          <button
            onClick={() => setActiveTab("bubble")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${activeTab === "bubble" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"}`}
          >
            Bubbles
          </button>
          <button
            onClick={() => setActiveTab("graph")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${activeTab === "graph" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"}`}
          >
            Keyword Graph
          </button>
        </div>

        {activeTab === "graph" ? (
          <KeywordGraphView keywords={customKeywords} categories={categories} bubbles={bubbles} dark={dark} size={size} notebookId={notebookId} />
        ) : (activeNote || allNotesMode) ? (
          <svg ref={svgRef} width={size.w} height={size.h} className="w-full h-full" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 gap-2">
            <p className="text-sm">Select a note to generate its bubble diagram</p>
            <p className="text-xs">Nodes sharing keywords cluster together — drag to rearrange, right-click to open in Notes</p>
          </div>
        )}

        {/* Tool switcher — bubble tab only */}
        {activeTab === "bubble" && <div className="absolute top-3 left-3 flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 shadow-sm">
          <button
            onClick={() => setTool("hand")}
            title="Hand tool (pan)"
            className={`p-1.5 rounded transition-colors ${tool === "hand" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1v7M5.5 3.5V7M3 5.5V9a5 5 0 0 0 10 0V7M10.5 3.5V7M13 6v2" />
            </svg>
          </button>
          <button
            onClick={() => setTool("select")}
            title="Selection tool"
            className={`p-1.5 rounded transition-colors ${tool === "select" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
            </svg>
          </button>
        </div>}

        {/* Marquee selection rect — bubble tab only */}
        {activeTab === "bubble" && selRect && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <rect
              x={selRect.x} y={selRect.y}
              width={selRect.w} height={selRect.h}
              fill="rgba(59,130,246,0.08)"
              stroke="#3b82f6"
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          </svg>
        )}
        {/* Zoom slider — bubble tab only */}
        {activeTab === "bubble" && (
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 shadow-sm">
            <button
              onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}
              className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-sm leading-none select-none"
            >−</button>
            <input
              type="range"
              min={0.25} max={3} step={0.05}
              value={zoom}
              onChange={(e) => setZoom(+e.target.value)}
              className="w-24 accent-zinc-600 dark:accent-zinc-400 cursor-pointer"
            />
            <button
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
              className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-sm leading-none select-none"
            >+</button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500 w-8 text-right tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(1)}
              className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              title="Reset zoom"
            >↺</button>
          </div>
        )}
      </main>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="ctx-menu fixed z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-xl py-1 min-w-44"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700 max-w-72 break-words">
            {contextMenu.bubble.label}
          </div>
          {/* Change this circle's color */}
          <div className="flex items-center gap-1 px-3 py-2 text-sm dark:text-zinc-200">
            <label className="flex items-center gap-2 flex-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors py-0.5 px-1 -mx-1">
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-zinc-300"
                style={{ backgroundColor: contextMenu.bubble.color }}
              />
              Change color
              <input
                type="color"
                value={contextMenu.bubble.color}
                onChange={(e) => {
                  const color = e.target.value;
                  setBubbles((prev) =>
                    prev.map((b) => b.id === contextMenu.bubble.id ? { ...b, color } : b)
                  );
                  setContextMenu((prev) => prev ? { ...prev, bubble: { ...prev.bubble, color } } : null);
                }}
                className="absolute opacity-0 w-0 h-0"
              />
            </label>
            <button
              onClick={() => {
                const color = randomColor();
                setBubbles((prev) =>
                  prev.map((b) => b.id === contextMenu.bubble.id ? { ...b, color } : b)
                );
                setContextMenu((prev) => prev ? { ...prev, bubble: { ...prev.bubble, color } } : null);
              }}
              className="shrink-0 border border-zinc-300 dark:border-zinc-600 rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              title="Random color"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h2l8 8h2M12 4h2M2 12h2" />
                <polyline points="10 4 12 4 12 6" />
                <polyline points="4 12 2 12 2 10" />
              </svg>
            </button>
          </div>
          {/* Change all circles of the same color */}
          <div className="flex items-center gap-1 px-3 py-2 text-sm dark:text-zinc-200">
            <label className="flex items-center gap-2 flex-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors py-0.5 px-1 -mx-1">
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-zinc-300"
                style={{ backgroundColor: contextMenu.bubble.color }}
              />
              Change all same color
              <input
                type="color"
                value={contextMenu.bubble.color}
                onChange={(e) => {
                  const next = e.target.value;
                  const orig = contextMenu.bubble.color;
                  setBubbles((prev) =>
                    prev.map((b) => b.color === orig ? { ...b, color: next } : b)
                  );
                  setContextMenu((prev) => prev ? { ...prev, bubble: { ...prev.bubble, color: next } } : null);
                }}
                className="absolute opacity-0 w-0 h-0"
              />
            </label>
            <button
              onClick={() => {
                const next = randomColor();
                const orig = contextMenu.bubble.color;
                setBubbles((prev) =>
                  prev.map((b) => b.color === orig ? { ...b, color: next } : b)
                );
                setContextMenu((prev) => prev ? { ...prev, bubble: { ...prev.bubble, color: next } } : null);
              }}
              className="shrink-0 border border-zinc-300 dark:border-zinc-600 rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              title="Random color"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h2l8 8h2M12 4h2M2 12h2" />
                <polyline points="10 4 12 4 12 6" />
                <polyline points="4 12 2 12 2 10" />
              </svg>
            </button>
          </div>
          <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />
          <button
            onClick={() => {
              const noteId = activeNote?.id;
              if (noteId) {
                setSplitSrc(`/notebook/${notebookId}?note=${noteId}&scroll=${encodeURIComponent(contextMenu.bubble.label)}`);
                setSplitOpen(true);
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200 transition-colors"
          >
            Open in Notes →
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
