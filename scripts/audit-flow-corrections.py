#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auditoria reproduzível das correções apontadas no relatório de fluxos.

Não confia na leitura manual: abre os arquivos reais e verifica, de forma
independente, cada afirmação feita sobre /admin/fluxos, o validador
(useFlowValidation) e o runtime (render-vars.ts).

Uso:
    python3 scripts/audit-flow-corrections.py

Saída: veredicto PASS/FAIL por item + resumo final. Exit code 0 se todas as
afirmações conferem, 1 caso alguma divergência inesperada apareça.

Nenhuma dependência externa (só stdlib). Read-only: não altera nenhum arquivo.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Raiz do repo = pai da pasta scripts/ (independe de onde o script é chamado).
ROOT = Path(__file__).resolve().parent.parent

VALIDATION = ROOT / "src/components/admin/flow-builder/useFlowValidation.ts"
RENDER_VARS = ROOT / "supabase/functions/_shared/render-vars.ts"
FLUXO_BUILDER = ROOT / "src/pages/FluxoBuilder.tsx"
STEP_INSPECTOR = ROOT / "src/components/admin/flow-builder/StepInspector.tsx"
FLOW_TYPES = ROOT / "src/components/admin/flow-builder/flowTypes.ts"

# Códigos ANSI para deixar o veredicto legível no terminal.
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"


def read(path: Path) -> str:
    """Lê um arquivo como texto UTF-8. Falha cedo e claro se não existir."""
    if not path.exists():
        print(f"{RED}ARQUIVO AUSENTE:{RESET} {path}")
        sys.exit(2)
    return path.read_text(encoding="utf-8")


def extract_set(src: str, nome: str) -> set[str]:
    """
    Extrai o conteúdo de um `const <nome> = new Set([...])` do validador.

    Genérico para suportar tanto `KNOWN_VARS` (conjunto canônico, usado na
    lógica de ordem de captura) quanto `RECOGNIZED_VARS` (conjunto amplo, usado
    no aviso "variável desconhecida"). Aceita acentos nas chaves (ex.: "número").
    """
    m = re.search(rf"{nome}\s*=\s*new\s+Set\(\[(.*?)\]\)", src, re.DOTALL)
    if not m:
        return set()
    corpo = m.group(1)
    # Pega cada string entre aspas dentro do array (tolera acentos/underscore).
    return {c.lower() for c in re.findall(r'"([^"]+)"', corpo)}


def extract_known_vars(src: str) -> set[str]:
    """Conjunto CANÔNICO (`KNOWN_VARS`) — lógica de ordem de captura."""
    return extract_set(src, "KNOWN_VARS")


def extract_recognized_vars(src: str) -> set[str]:
    """Conjunto AMPLO (`RECOGNIZED_VARS`) — aviso 'variável desconhecida'."""
    return extract_set(src, "RECOGNIZED_VARS")


def extract_runtime_vars(src: str) -> set[str]:
    """
    Extrai TODAS as chaves de variável que o runtime (render-vars.ts) resolve.

    Cobre três formas de declaração no arquivo:
      1. `const XXX_KEYS = new Set([...])`  (grupos: NAME, PHONE, CPF, REP, BILL)
      2. `if (key === "economia_mensal")`   (chaves diretas por igualdade)
      3. `key === "economia_range" || key === "economia_faixa"` (encadeadas)
    """
    chaves: set[str] = set()

    # 1) Todos os conjuntos *_KEYS declarados com new Set([...]).
    for bloco in re.findall(r"_KEYS\s*=\s*new\s+Set\(\[(.*?)\]\)", src, re.DOTALL):
        chaves.update(re.findall(r'"([^"]+)"', bloco))

    # 2 + 3) Qualquer comparação key === "alguma_coisa" no corpo do lookup.
    for chave in re.findall(r'key\s*===\s*"([^"]+)"', src):
        chaves.add(chave)

    return {c.lower() for c in chaves}


def has_superadmin_guard_on_card(builder_src: str) -> bool:
    """
    Verifica se o <AiPreferencesCard .../> está protegido por checagem de
    superadmin no FluxoBuilder. Procura por uma condição (isSuperAdmin /
    is_super_admin) na MESMA linha ou imediatamente antes do componente.
    """
    linhas = builder_src.splitlines()
    for i, linha in enumerate(linhas):
        if "AiPreferencesCard" in linha and "import" not in linha:
            # Janela de 2 linhas antes + a própria linha.
            janela = "\n".join(linhas[max(0, i - 2): i + 1])
            if re.search(r"isSuperAdmin|is_super_admin", janela):
                return True
    return False


def inspector_has_repeat_option(inspector_src: str) -> bool:
    """
    O aviso goto_no_wait manda o consultor trocar para "Esperar e repetir".
    Confirma que essa opção existe de fato no StepInspector.
    """
    return "Esperar e repetir" in inspector_src


def linha_de(src: str, agulha: str) -> int | None:
    """Número da primeira linha (1-based) que contém `agulha`, ou None."""
    for i, linha in enumerate(src.splitlines(), start=1):
        if agulha in linha:
            return i
    return None


class Resultado:
    """Acumula veredictos e imprime de forma uniforme."""

    def __init__(self) -> None:
        self.itens: list[tuple[str, bool, str]] = []

    def check(self, titulo: str, condicao: bool, detalhe: str) -> None:
        self.itens.append((titulo, condicao, detalhe))
        marca = f"{GREEN}PASS{RESET}" if condicao else f"{RED}FAIL{RESET}"
        print(f"  [{marca}] {titulo}")
        print(f"         {detalhe}")

    @property
    def todos_ok(self) -> bool:
        return all(ok for _, ok, _ in self.itens)


# Conjunto canônico esperado (nomes "oficiais" usados na lógica de ordem de
# captura). A correção mantém este conjunto enxuto de propósito.
CANONICO_ESPERADO = {
    "nome", "valor_conta", "economia_range", "telefone", "cpf", "representante", "email",
}


def main() -> int:
    print(f"{BOLD}== Auditoria PÓS-correção dos fluxos (Python, read-only) =={RESET}\n")

    validation_src = read(VALIDATION)
    render_src = read(RENDER_VARS)
    builder_src = read(FLUXO_BUILDER)
    inspector_src = read(STEP_INSPECTOR)
    flowtypes_src = read(FLOW_TYPES)

    known = extract_known_vars(validation_src)
    recognized = extract_recognized_vars(validation_src)
    runtime = extract_runtime_vars(render_src)

    print(f"{BOLD}Dados extraídos dos arquivos reais{RESET}")
    print(f"  KNOWN_VARS (canônico)      : {sorted(known)}")
    print(f"  RECOGNIZED_VARS (amplo)    : {sorted(recognized)}")
    print(f"  Vars do runtime (render)   : {sorted(runtime)}\n")

    r = Resultado()

    # ── 1) Falso positivo das economias resolvido ───────────────────────────
    print(f"{BOLD}1 — economia_mensal/anual deixam de alarmar (falso positivo){RESET}")
    for var in ("economia_mensal", "economia_anual"):
        reconhecida = var in recognized
        r.check(
            f"{var} está em RECOGNIZED_VARS (não alarma mais)",
            reconhecida,
            f"em RECOGNIZED_VARS={reconhecida} → "
            f"{'aviso falso eliminado' if reconhecida else 'AINDA alarma — correção incompleta'}",
        )

    # ── 2) Paridade: validador reconhece tudo que o runtime resolve ─────────
    print(f"\n{BOLD}2 — RECOGNIZED_VARS cobre 100% do runtime (sem divergência){RESET}")
    faltando = sorted(runtime - recognized)
    r.check(
        "Nenhuma variável do runtime fica fora de RECOGNIZED_VARS",
        len(faltando) == 0,
        f"ausentes em RECOGNIZED_VARS: {faltando or 'nenhuma — paridade total'}",
    )

    # ── 3) Conjunto canônico preservado (não inchou com sinônimos) ──────────
    print(f"\n{BOLD}3 — KNOWN_VARS canônico continua enxuto (protege ordem de captura){RESET}")
    canonico_ok = known == CANONICO_ESPERADO
    r.check(
        "KNOWN_VARS mantém exatamente as 7 chaves canônicas",
        canonico_ok,
        f"esperado={sorted(CANONICO_ESPERADO)} · obtido={sorted(known)} → "
        f"{'inalterado (sinônimos não vazaram)' if canonico_ok else 'DIVERGÊNCIA'}",
    )

    # ── 4) Fiação dos usos: cada lista no lugar certo ───────────────────────
    print(f"\n{BOLD}4 — Cada lista é usada no ponto certo do validador{RESET}")
    aviso_usa_recognized = "RECOGNIZED_VARS.has(name)" in validation_src
    ordem_usa_trackable = "TRACKABLE_VARS.has(v)" in validation_src
    trackable_inclui_producers = "Object.values(VAR_PRODUCERS).flat()" in validation_src
    r.check(
        'Aviso "variável desconhecida" usa RECOGNIZED_VARS',
        aviso_usa_recognized,
        f"RECOGNIZED_VARS.has(name) presente={aviso_usa_recognized}",
    )
    r.check(
        "Checagem de ordem usa TRACKABLE_VARS (canônico + produzidas)",
        ordem_usa_trackable and trackable_inclui_producers,
        f"TRACKABLE_VARS.has(v)={ordem_usa_trackable} · "
        f"inclui VAR_PRODUCERS={trackable_inclui_producers}",
    )

    # ── 5) Preview ao vivo e hint do editor cobrem as economias ─────────────
    print(f"\n{BOLD}5 — Editor (hint + preview) menciona as economias{RESET}")
    preview_ok = (
        "economia_mensal" in flowtypes_src and "economia_anual" in flowtypes_src
    )
    hint_ok = (
        "{{economia_mensal}}" in inspector_src and "{{economia_anual}}" in inspector_src
    )
    r.check(
        "renderVarsPreview (flowTypes.ts) substitui economia_mensal/anual",
        preview_ok,
        f"presente no preview={preview_ok}",
    )
    r.check(
        "Hint do StepInspector lista economia_mensal/anual",
        hint_ok,
        f"presente no hint={hint_ok}",
    )

    # ── 6) Achados estruturais que NÃO foram tocados (continuam válidos) ────
    print(f"\n{BOLD}6 — Itens fora do escopo desta correção (informativo){RESET}")
    tem_guarda = has_superadmin_guard_on_card(builder_src)
    ln_card = linha_de(builder_src, "<AiPreferencesCard")
    r.check(
        "AiPreferencesCard segue SEM trava de superadmin (pendente, fora do escopo)",
        not tem_guarda,
        f"FluxoBuilder.tsx:{ln_card} · guarda presente={tem_guarda} "
        f"(decisão: não alterar permissão sem confirmação)",
    )
    aviso_cita = "Esperar e repetir" in validation_src
    opcao_existe = inspector_has_repeat_option(inspector_src)
    r.check(
        'CTA goto_no_wait ("Esperar e repetir") coerente aviso↔UI',
        aviso_cita and opcao_existe,
        f"no aviso={aviso_cita} · na UI={opcao_existe}",
    )

    # ── Resumo ───────────────────────────────────────────────────────────────
    print(f"\n{BOLD}== Resumo =={RESET}")
    total = len(r.itens)
    ok = sum(1 for _, c, _ in r.itens if c)
    cor = GREEN if r.todos_ok else YELLOW
    print(f"  {cor}{ok}/{total} verificações OK.{RESET}")

    if r.todos_ok:
        print(f"\n{GREEN}{BOLD}VEREDICTO: correção aplicada e consistente.{RESET}")
        print("  Validador alinhado ao runtime; canônico preservado; editor atualizado.")
    else:
        print(f"\n{YELLOW}{BOLD}VEREDICTO: há divergências — revisar itens FAIL acima.{RESET}")

    return 0 if r.todos_ok else 1


if __name__ == "__main__":
    sys.exit(main())
