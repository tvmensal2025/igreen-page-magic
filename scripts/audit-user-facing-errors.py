#!/usr/bin/env python3
"""Auditoria de toasts/mensagens que vazam erro técnico (inglês/SQL) ao usuário.

Uso:
  python3 scripts/audit-user-facing-errors.py
  python3 scripts/audit-user-facing-errors.py --json

Não altera arquivos — só relata.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

SKIP_DIRS = {"node_modules", "dist", ".git", "coverage"}


@dataclass
class Finding:
    kind: str
    path: str
    line: int
    snippet: str


def iter_source_files() -> list[Path]:
    files: list[Path] = []
    for path in SRC.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        # Testes e o próprio helper de tradução não são vazamento de UI
        if path.name.endswith(".test.ts") or path.name.endswith(".test.tsx"):
            continue
        if path.name in {"userFacingError.ts", "toastSonner.ts"}:
            continue
        files.append(path)
    return sorted(files)


def scan_file(path: Path) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    findings: list[Finding] = []
    lines = text.splitlines()
    rel = path.relative_to(ROOT).as_posix()

    for line_no, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue

        if rel != "src/components/ui/sonner.tsx" and re.search(
            r"""from\s+["']sonner["']""", stripped
        ):
            findings.append(
                Finding(
                    kind="import_sonner_direto",
                    path=rel,
                    line=line_no,
                    snippet=stripped[:160],
                )
            )

        if re.search(r"""title\s*:\s*["']Erro["']""", stripped, re.IGNORECASE):
            findings.append(
                Finding(
                    kind="titulo_erro_generico",
                    path=rel,
                    line=line_no,
                    snippet=stripped[:160],
                )
            )

        if re.search(
            r"""["'`][^"'`]{0,20}(?:Password is known|Invalid login credentials|"""
            r"""duplicate key value|violates unique constraint|Email not confirmed|"""
            r"""User already registered|easy to guess)[^"'`]{0,80}["'`]""",
            stripped,
            re.IGNORECASE,
        ):
            findings.append(
                Finding(
                    kind="padrao_tecnico_literal",
                    path=rel,
                    line=line_no,
                    snippet=stripped[:160],
                )
            )

        # Toast / sonner repassando .message na mesma linha
        if (
            ("toast" in stripped.lower())
            and re.search(r"\.(?:message|msg)\b", stripped)
            and (
                "description" in stripped
                or "toast.error" in stripped
                or "toast(" in stripped
            )
        ):
            findings.append(
                Finding(
                    kind="toast_repassa_message",
                    path=rel,
                    line=line_no,
                    snippet=stripped[:160],
                )
            )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Auditoria de erros técnicos na UI")
    parser.add_argument("--json", action="store_true", help="Saída JSON")
    parser.add_argument("--limit", type=int, default=0, help="Limitar achados (0 = todos)")
    args = parser.parse_args()

    if not SRC.is_dir():
        print("Pasta src/ não encontrada.", file=sys.stderr)
        return 2

    all_findings: list[Finding] = []
    for path in iter_source_files():
        all_findings.extend(scan_file(path))

    # Dedup por path+line+kind
    seen: set[tuple[str, int, str]] = set()
    unique: list[Finding] = []
    for f in all_findings:
        key = (f.path, f.line, f.kind)
        if key in seen:
            continue
        seen.add(key)
        unique.append(f)

    unique.sort(key=lambda f: (f.kind, f.path, f.line))
    if args.limit > 0:
        unique = unique[: args.limit]

    by_kind: dict[str, int] = {}
    for f in unique:
        by_kind[f.kind] = by_kind.get(f.kind, 0) + 1

    if args.json:
        print(
            json.dumps(
                {
                    "total": len(unique),
                    "por_tipo": by_kind,
                    "achados": [asdict(f) for f in unique],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    print("=== Auditoria: mensagens técnicas na UI ===")
    print(f"Arquivos varridos em: {SRC}")
    print(f"Total de achados: {len(unique)}")
    print()
    for kind, count in sorted(by_kind.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {kind}: {count}")
    print()
    print("Detalhes (path:linha):")
    for f in unique:
        print(f"  [{f.kind}] {f.path}:{f.line}")
        print(f"    {f.snippet}")
    print()
    print(
        "Nota: o interceptor toUserFacingError cobre muitos casos em runtime; "
        "estes achados são pontos onde o código ainda passa .message cru."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
