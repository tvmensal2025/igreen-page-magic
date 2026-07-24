#!/usr/bin/env bash
# Valida paridade Cursor rules ↔ Kiro steering (anti-drift).
# Exit 1 se faltar espelho obrigatório ou se AGENTS.md mentir sobre inclusion.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
say() { printf '%s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; fail=1; }

# Pares obrigatórios: .cursor/rules/<file>.mdc → trecho/arquivo em .kiro/steering
declare -A REQUIRED=(
  [whatsapp-whapi-primario.mdc]="regras-duras.md|wa-webhook.md"
  [crm-vs-lead-analise.mdc]="regras-duras.md"
  [campanha-uuid-nao-texto.mdc]="regras-duras.md"
  [nome-cliente-seguro.mdc]="regras-duras.md|nomes-e-tema.md"
  [consultor-nome-publico.mdc]="regras-duras.md|nomes-e-tema.md"
  [producao-sem-envio-automatico.mdc]="regras-duras.md"
  [idioma-pt-br.mdc]="idioma.md|regras-duras.md"
  [portal-igreen-api-oficial.mdc]="portal2-fluxo-canonico.md"
  [club-igreen-api-oficial.mdc]="club-api-oficial.md"
  [igreen-sync-worker-oficial.mdc]="igreen-sync-oficial.md"
  [ads-contraste-status.mdc]="ads-contraste.md"
  [cerebro-campanhas-mg.mdc]="cerebro-mg-e-rodizio.md"
  [rodizio-avisos-parceiro.mdc]="cerebro-mg-e-rodizio.md"
  [tema-light-only.mdc]="nomes-e-tema.md|regras-duras.md"
)

say "== Cursor → Kiro mirrors =="
for rule in "${!REQUIRED[@]}"; do
  rule_path=".cursor/rules/$rule"
  if [[ ! -f "$rule_path" ]]; then
    err "rule ausente: $rule_path"
    continue
  fi
  ok=0
  IFS='|' read -r -a steers <<< "${REQUIRED[$rule]}"
  for s in "${steers[@]}"; do
    if [[ -f ".kiro/steering/$s" ]]; then ok=1; break; fi
  done
  if [[ "$ok" -eq 1 ]]; then
    say "OK  $rule → ${REQUIRED[$rule]}"
  else
    err "$rule sem espelho em .kiro/steering (${REQUIRED[$rule]})"
  fi
done

# cursor-model-pools é só Cursor — não exige espelho Kiro
if [[ -f .cursor/rules/cursor-model-pools.mdc ]]; then
  say "SKIP cursor-model-pools.mdc (específico Cursor IDE)"
fi

say "== AGENTS.md inclusion vs frontmatter =="
check_inclusion() {
  local name="$1"
  local expected="$2"
  local file=".kiro/steering/${name}.md"
  [[ -f "$file" ]] || { err "steering ausente: $file"; return; }
  local actual
  actual="$(awk '/^inclusion:/{print $2; exit}' "$file")"
  if [[ "$actual" != "$expected" ]]; then
    err "$name: frontmatter=$actual esperado=$expected (AGENTS index)"
  else
    say "OK  $name inclusion=$actual"
  fi
  # AGENTS não pode listar como 'auto' se for fileMatch
  if [[ "$expected" == "fileMatch" ]] && grep -E "\`$name\` \| auto" AGENTS.md >/dev/null 2>&1; then
    err "AGENTS.md lista $name como auto mas frontmatter é fileMatch"
  fi
}

check_inclusion ads-contraste auto
check_inclusion cerebro-mg-e-rodizio auto
check_inclusion minio-storage auto
check_inclusion wa-webhook fileMatch
check_inclusion pos-venda fileMatch

say "== name+description em steers =="
while IFS= read -r f; do
  base="$(basename "$f")"
  [[ "$base" == "AUDITORIA-STEERING.md" ]] && continue
  if ! grep -q '^name:' "$f" || ! grep -q '^description:' "$f"; then
    err "faltando name/description: $f"
  fi
done < <(find .kiro/steering -maxdepth 1 -name '*.md' | sort)
say "OK  name/description checados"

say "== mapa-dominios.json domains → steering files =="
python3 - <<'PY' || fail=1
import json, sys
from pathlib import Path
data=json.loads(Path('.kiro/steering/mapa-dominios.json').read_text())
ok=True
for d in data.get('domains',[]):
    steers=d.get('steering') or []
    if not steers:
        # cross-sell now has steering
        print(f"ERROR: domain {d['id']} sem steering[]", file=sys.stderr)
        ok=False
        continue
    for s in steers:
        # allow bare name or .md
        name=s if s.endswith('.md') else f"{s}.md"
        # strip # if any
        name=name.lstrip('#')
        p=Path('.kiro/steering')/name
        if not p.exists():
            # try without path prefix
            alt=Path('.kiro/steering')/Path(name).name
            if not alt.exists():
                print(f"ERROR: {d['id']} aponta steering ausente: {s}", file=sys.stderr)
                ok=False
if ok:
    print('OK  mapa-dominios steering refs')
else:
    sys.exit(1)
PY

say "== Nested AGENTS quentes =="
for f in \
  supabase/functions/whapi-webhook/AGENTS.md \
  supabase/functions/evolution-webhook/AGENTS.md \
  supabase/functions/cadence-tick/AGENTS.md \
  supabase/functions/pos-venda-auto-progress/AGENTS.md \
  supabase/functions/sync-igreen-customers/AGENTS.md \
  supabase/functions/_shared/bot/AGENTS.md \
  supabase/functions/_shared/cerebro/AGENTS.md \
  supabase/functions/bulk-scheduler/AGENTS.md \
  supabase/functions/finalize-capture/AGENTS.md \
  supabase/functions/send-scheduled-messages/AGENTS.md \
  supabase/functions/voice-dialer-webhook/AGENTS.md \
  src/lib/AGENTS.md \
  src/components/whatsapp/AGENTS.md
do
  [[ -f "$f" ]] && say "OK  $f" || err "faltando $f"
done

say "== Artefatos round 6 =="
for f in \
  .kiro/steering/mapa-dominios.json \
  .kiro/steering/EVIDENCIA-PROD.md \
  .kiro/steering/wa-webhook.md \
  .kiro/steering/cerebro-fluxo-b.md \
  .kiro/steering/voz-sms.md \
  .kiro/steering/agendamentos-hub.md \
  .kiro/steering/cross-sell.md \
  .kiro/specs/STATUS.md
do
  [[ -f "$f" ]] && say "OK  $f" || err "faltando $f"
done

say "== UI: label DNC proibida em strings de usuário =="
# Falha se UI mostrar 'DNC' como rótulo visível (não comentarios internos de código ok em testes)
if rg -n '>([^<]*\bDNC\b[^<]*)<|"[^"]*\bDNC\b[^"]*"|`[^`]*\bDNC\b[^`]*`' \
  src/components --glob '*.tsx' \
  | rg -v 'outbound-dnc|do_not_contact|voice_dnc|/\*|^\s*\*|value="dnc"|TabsTrigger value' \
  | rg -n '\bDNC\b' >/tmp/dnc-ui.txt 2>/dev/null; then
  if [[ -s /tmp/dnc-ui.txt ]]; then
    err "Possível label DNC na UI:"
    cat /tmp/dnc-ui.txt >&2 || true
  fi
fi
# Checagem mais direta nos arquivos já auditados
for pair in \
  'src/components/admin/voz/VozTab.tsx:sm:hidden">DNC' \
  'src/components/admin/HandoffLeadsDialog.tsx:telefone inválido, DNC' \
  'src/components/admin/voz/VoiceDashboardPanel.tsx:Bloqueados (DNC)' \
  'src/components/captacao/CloseAttendanceBatchDialog.tsx:Não contato (DNC)' \
  'src/components/admin/voz/VoiceDncPanel.tsx:Não Perturbe (DNC)'
do
  file="${pair%%:*}"
  needle="${pair#*:}"
  if [[ -f "$file" ]] && grep -F "$needle" "$file" >/dev/null 2>&1; then
    err "label DNC ainda presente: $file ($needle)"
  fi
done
say "OK  checks DNC conhecidos limpos (ou reportados acima)"

say "== mapa-dominios.json code_anchors existentes =="
python3 - <<'PY' || fail=1
import json
from pathlib import Path

root = Path.cwd()
data = json.loads((root / '.kiro/steering/mapa-dominios.json').read_text())
ok = True
for domain in data.get('domains', []):
    domain_id = domain.get('id', '<sem id>')
    for anchor in domain.get('code_anchors', []):
        if not isinstance(anchor, str) or not anchor:
            print(f"ERROR: {domain_id} possui code_anchor inválido: {anchor!r}")
            ok = False
            continue
        if '*' in anchor:
            print(f"SKIP {domain_id} code_anchor com glob: {anchor}")
            continue
        path = Path('supabase/functions') / anchor if anchor.startswith('_shared/') else Path(anchor)
        if path.is_absolute() or not (root / path).exists():
            print(f"ERROR: {domain_id} aponta code_anchor ausente: {anchor} (resolvido: {path})")
            ok = False
if ok:
    print('OK  code_anchors sem glob existem')
else:
    raise SystemExit(1)
PY

say "== God-files: linhas dentro de ±8% =="
python3 - <<'PY' || fail=1
import json
import math
import os
import re
import subprocess
from pathlib import Path

map_path = Path('.kiro/steering/mapa-dominios.json')
raw = map_path.read_text()
data = json.loads(raw)
update = os.environ.get('UPDATE_GOD_LINES') == '1'
ok = True
updates = []
for entry in data.get('god_files_lines', []):
    path = Path(entry['path'])
    expected = entry['lines']
    if not isinstance(expected, int) or expected < 1:
        print(f"ERROR: god_files_lines inválido para {path}: {expected!r}")
        ok = False
        continue
    if not path.exists():
        print(f"ERROR: god-file ausente: {path}")
        ok = False
        continue
    actual = int(subprocess.check_output(['wc', '-l', str(path)], text=True).split()[0])
    tolerance = math.ceil(expected * 0.08)
    if abs(actual - expected) > tolerance:
        if update:
            updates.append((str(path), actual))
            print(f"UPDATE {path}: {expected} → {actual}")
        else:
            print(f"ERROR: {path}: registrado={expected}, atual={actual}, tolerância=±{tolerance}")
            ok = False
    else:
        print(f"OK  {path}: {actual} (referência {expected}, ±{tolerance})")

if updates:
    for path, actual in updates:
        escaped = re.escape(json.dumps(path))
        pattern = rf'("path"\s*:\s*{escaped}\s*,\s*"lines"\s*:\s*)\d+'
        raw, count = re.subn(pattern, rf'\g<1>{actual}', raw, count=1)
        if count != 1:
            raise SystemExit(f'ERROR: não foi possível atualizar god-file {path}')
    map_path.write_text(raw)
    print('OK  referências god_files_lines atualizadas (UPDATE_GOD_LINES=1)')

if not ok:
    raise SystemExit(1)
PY

say "== Símbolos canônicos no código =="
require_symbol() {
  local alternatives=("$@")
  local symbol
  for symbol in "${alternatives[@]}"; do
    if rg -Fq "$symbol" \
      --glob '*.ts' --glob '*.tsx' --glob '*.sql' \
      --glob '!node_modules/**' --glob '!dist/**' .; then
      say "OK  símbolo: $symbol"
      return
    fi
  done
  err "símbolo canônico ausente: ${alternatives[*]}"
}
require_symbol activatePosVendaRecadastro
require_symbol isBotGloballyEnabled
require_symbol claim_scheduled_messages
require_symbol CROSS_SELL_SHADOW isCrossSellShadowMode
require_symbol runEngineV3IfEnabled
require_symbol checkPhoneDeadForChannel
require_symbol safeFirstNameForAddress

say "== V3 documentado como sombra =="
for f in .kiro/steering/wa-webhook.md .kiro/steering/cerebro-fluxo-b.md; do
  if rg -qi '\bV3\b' "$f" && ! rg -qi '\bsombra\b' "$f"; then
    err "$f menciona V3 sem declarar que ainda é sombra"
  else
    say "OK  $f: V3 sem alegação de assumir turno"
  fi
done

say "== Evidência de advisors remediada =="
if rg -Fq 'Advisors ERROR: 5 views' .kiro/steering/AUDITORIA-STEERING.md; then
  err 'AUDITORIA-STEERING.md ainda contém o baseline obsoleto "Advisors ERROR: 5 views"'
else
  say 'OK  baseline obsoleto de advisors ausente'
fi

if [[ "$fail" -ne 0 ]]; then
  say "FALHOU drift check"
  exit 1
fi
say "PASS agent-docs-drift"
