#!/usr/bin/env python3
"""Rastreamento estático completo do FluxoBuilder (Iris / mídia / regras / modal).

Varre TS/TSX do módulo flow-builder + página + hooks relacionados e produz
um mapa de imports, símbolos-chave e superfície de UI sem executar o app.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

ROOT = Path("/home/dev/Documents/ultra-cursor/igreen-official-portal")
ENTRY = ROOT / "src/pages/FluxoBuilder.tsx"
FLOW_DIR = ROOT / "src/components/admin/flow-builder"
HOOKS = [
    ROOT / "src/hooks/useFlowSteps.ts",
    ROOT / "src/hooks/useDiagramLayout.ts",
]

IMPORT_RE = re.compile(
    r"""^\s*import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']""",
    re.M,
)
EXPORT_RE = re.compile(
    r"""^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)""",
    re.M,
)
SYMBOL_PATTERNS: dict[str, re.Pattern[str]] = {
    "iris_guided": re.compile(
        r"GuidedStep|GUIDED_CAPTURE|Iris|InlineAi|buildGuided|guidedOpen|guidedIntent",
        re.I,
    ),
    "media": re.compile(
        r"media_order|slot_key|image|video|audio|upload|MediaSlot|mediaCounts|__body_",
        re.I,
    ),
    "texto_mensagem": re.compile(
        r"message_text|text_delay|renderVars|defaultPrompt|conteudo",
        re.I,
    ),
    "regras_transicoes": re.compile(
        r"transition|fallback|trigger_intent|goto_special|DETERMINISTIC|capture|BUTTON_PRESET",
        re.I,
    ),
    "bots_runtime": re.compile(
        r"bot_flow|bot_flow_steps|whapi|manual-step-send|runBotFlow|fluxo-b|variant",
        re.I,
    ),
    "modal_lateral": re.compile(
        r"StepInspector|inspectorId|inspectorTab|Sheet|Drawer|Dialog|WhatsAppPreview|StepCoach",
        re.I,
    ),
    "validacao": re.compile(
        r"useFlowValidation|useFlowConflicts|ambigu|milestone|coverage|VAR_PRODUCER",
        re.I,
    ),
    "diagrama": re.compile(
        r"FlowDiagram|ReactFlow|dagre|layout|Node|Edge|diagram-v2",
        re.I,
    ),
}


@dataclass
class FileReport:
    path: str
    lines: int
    bytes: int
    exports: list[str] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)
    categories: dict[str, int] = field(default_factory=dict)


def collect_files() -> list[Path]:
    files: list[Path] = [ENTRY, *HOOKS]
    files.extend(sorted(FLOW_DIR.rglob("*.ts")))
    files.extend(sorted(FLOW_DIR.rglob("*.tsx")))
    # unique preserve order
    seen: set[Path] = set()
    out: list[Path] = []
    for p in files:
        if p in seen or not p.is_file():
            continue
        seen.add(p)
        out.append(p)
    return out


def analyze_file(path: Path) -> FileReport:
    text = path.read_text(encoding="utf-8", errors="replace")
    rel = str(path.relative_to(ROOT))
    cats = {name: len(pat.findall(text)) for name, pat in SYMBOL_PATTERNS.items()}
    return FileReport(
        path=rel,
        lines=text.count("\n") + (0 if text.endswith("\n") else 1 if text else 0),
        bytes=len(text.encode("utf-8")),
        exports=EXPORT_RE.findall(text),
        imports=IMPORT_RE.findall(text),
        categories=cats,
    )


def resolve_local(importer: Path, spec: str) -> str | None:
    if not (spec.startswith("@/") or spec.startswith(".")):
        return None
    if spec.startswith("@/"):
        target = ROOT / "src" / spec[2:]
    else:
        target = (importer.parent / spec).resolve()
    for cand in (
        target,
        Path(str(target) + ".ts"),
        Path(str(target) + ".tsx"),
        target / "index.ts",
        target / "index.tsx",
    ):
        if cand.is_file():
            try:
                return str(cand.relative_to(ROOT))
            except ValueError:
                return str(cand)
    return None


def build_graph(reports: list[FileReport]) -> dict[str, list[str]]:
    by_path = {r.path: r for r in reports}
    graph: dict[str, list[str]] = defaultdict(list)
    for r in reports:
        importer = ROOT / r.path
        for spec in r.imports:
            resolved = resolve_local(importer, spec)
            if resolved and resolved in by_path:
                graph[r.path].append(resolved)
    return {k: sorted(set(v)) for k, v in graph.items()}


def category_totals(reports: list[FileReport]) -> dict[str, int]:
    totals: Counter[str] = Counter()
    for r in reports:
        for k, v in r.categories.items():
            totals[k] += v
    return dict(totals.most_common())


def top_files_by_category(reports: list[FileReport], cat: str, n: int = 8) -> list[dict]:
    ranked = sorted(reports, key=lambda r: r.categories.get(cat, 0), reverse=True)
    return [
        {"path": r.path, "hits": r.categories.get(cat, 0), "lines": r.lines}
        for r in ranked[:n]
        if r.categories.get(cat, 0) > 0
    ]


def entry_deps(reports: list[FileReport], graph: dict[str, list[str]]) -> dict:
    entry = str(ENTRY.relative_to(ROOT))
    direct = graph.get(entry, [])
    return {
        "entry": entry,
        "direct_local_imports": direct,
        "entry_exports": next((r.exports for r in reports if r.path == entry), []),
        "entry_lines": next((r.lines for r in reports if r.path == entry), 0),
    }


def main() -> None:
    files = collect_files()
    reports = [analyze_file(p) for p in files]
    graph = build_graph(reports)
    totals = category_totals(reports)

    summary = {
        "module": "FluxoBuilder / flow-builder",
        "file_count": len(reports),
        "total_lines": sum(r.lines for r in reports),
        "total_bytes": sum(r.bytes for r in reports),
        "category_hit_totals": totals,
        "entry": entry_deps(reports, graph),
        "top_by_category": {cat: top_files_by_category(reports, cat) for cat in SYMBOL_PATTERNS},
        "largest_files": [
            {"path": r.path, "lines": r.lines, "bytes": r.bytes, "exports": r.exports[:12]}
            for r in sorted(reports, key=lambda x: x.lines, reverse=True)[:15]
        ],
        "export_index": {
            r.path: r.exports for r in reports if r.exports
        },
        "import_graph_edges": sum(len(v) for v in graph.values()),
        "import_graph": graph,
        "files": [asdict(r) for r in reports],
    }

    out_json = ROOT / "scripts/tmp_fluxo_builder_trace.json"
    out_md = ROOT / "scripts/tmp_fluxo_builder_trace.md"
    out_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# FluxoBuilder — rastreamento estático",
        "",
        f"- Arquivos: **{summary['file_count']}**",
        f"- Linhas: **{summary['total_lines']}**",
        f"- Arestas de import local: **{summary['import_graph_edges']}**",
        "",
        "## Hits por categoria",
        "",
    ]
    for k, v in totals.items():
        lines.append(f"- `{k}`: {v}")
    lines.extend(["", "## Maiores arquivos", ""])
    for item in summary["largest_files"]:
        lines.append(f"- `{item['path']}` — {item['lines']} linhas")
    lines.extend(["", "## Top por categoria", ""])
    for cat, items in summary["top_by_category"].items():
        lines.append(f"### {cat}")
        for it in items:
            lines.append(f"- `{it['path']}` ({it['hits']} hits, {it['lines']} linhas)")
        lines.append("")

    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "json": str(out_json),
        "md": str(out_md),
        "file_count": summary["file_count"],
        "total_lines": summary["total_lines"],
        "category_hit_totals": totals,
        "largest_files": summary["largest_files"][:8],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
