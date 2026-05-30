// Auto-layout via dagre (top-down).
// Recebe nodes/edges do React Flow + dimensões aproximadas e devolve nodes
// com `position.x/y` calculados. Usado pelo botão "Organizar" do toolbar e
// como fallback quando o passo nunca foi posicionado manualmente.

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

export type LayoutDirection = "TB" | "LR";

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  opts: { direction?: LayoutDirection; nodeWidth?: number; nodeHeight?: number } = {},
): Node[] {
  const direction = opts.direction ?? "TB";
  const nodeWidth = opts.nodeWidth ?? 320;
  const nodeHeight = opts.nodeHeight ?? 140;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 90, marginx: 40, marginy: 40 });

  nodes.forEach((n) => {
    const w = (n.data as any)?.expanded ? nodeWidth + 40 : nodeWidth;
    const h = (n.data as any)?.expanded ? nodeHeight + 120 : nodeHeight;
    g.setNode(n.id, { width: w, height: h });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    return {
      ...n,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
    };
  });
}
