// Auto-layout via dagre. PR5: direção horizontal (LR) por padrão para casar
// com handles laterais do novo `ExpandableNode` blueprint e dar mais espaço
// horizontal aos cards expandidos.

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

export type LayoutDirection = "TB" | "LR";

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  opts: { direction?: LayoutDirection; nodeWidth?: number; nodeHeight?: number } = {},
): Node[] {
  const direction = opts.direction ?? "LR";
  const nodeWidth = opts.nodeWidth ?? 260;
  const nodeHeight = opts.nodeHeight ?? 120;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 140, marginx: 40, marginy: 40 });

  nodes.forEach((n) => {
    const w = (n.data as any)?.expanded ? nodeWidth + 100 : nodeWidth;
    const h = (n.data as any)?.expanded ? nodeHeight + 160 : nodeHeight;
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
