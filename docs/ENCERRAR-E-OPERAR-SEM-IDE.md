# Encerrar código + operar sem Cursor / Kiro

**Data:** 2026-07-25  
**Objetivo:** você **para de mexer em código**. O que sobra é **operação** (painéis externos + SuperAdmin no site).  
**Repo:** `tvmensal2025/igreen-page-magic`  
**Playbook técnico (se um dia abrir IDE de novo):** `.kiro/steering/erros-operacionais.md`

---

## 0) Veredito — pode parar de codar?

| Camada | Status |
|---|---|
| Auditoria P0/P1 (auth crons, V3 manual, CRM≠A/B/C, Evolution paridade) | **OK em prod** (`958f05a91`) |
| Rafael piloto (Cérebro ON, V3 OFF, Ads full, cadência) | **OK** |
| Cérebro × Grupo A (funil manda; IA laterais) | **Documentado + código** |
| Opt-in Cérebro (default off novos + modal) | **Banco OK**; front precisa estar no deploy deste pacote |
| P2/P3 “plataforma perfeita” | **Dívida aceitável** — ver §2 (não bloqueia parar) |

**GO COM RESSALVAS para parar de mexer no código.**  
Ressalvas = ops externos (§3) + dívida P2 conscientemente deixada (§2).

---

## 1) O que JÁ está fechado (não reabrir)

1. Kill switch / cadência / reheat / live / caps A/B/C  
2. Cliente/carteira **proibido** A/B/C (só pós-venda + agenda)  
3. Crons laranja com auth; V3 **não** sobe sozinho (`manual_only`)  
4. Temperatura só com consultor aprovado + JWT  
5. Whapi primário; Evolution `needs_reconnect` **≠** Zap offline  
6. Cérebro: Grupo A determinístico manda no cadastro; IA só laterais  
7. Alertas no seu WhatsApp (`super-admin-alerts` ~15 min)  
8. Ads Cérebro piloto Rafael (`full` + proteções); **não** ligar targeting_patch / create genérico  

**NÃO ligar nunca sem decisão explícita nova:** V3 `on` global, `targeting_patch` Ads, massa novo motor, fechar `finalize-club` “fácil”, rotação Velip token à toa.

---

## 2) O que “falta 100%” — e o que fazer SEM quebrar

### A) Fechar ESTE pacote (último toque de código — já preparado)

| Item | Risco se não | Como (seguro) |
|---|---|---|
| Commit/push modal Cérebro + docs + UI design | Site sem toggle/texto novo; IA em chat novo ok via rules locais só na sua máquina | Push `main` → CI → deploy front (Vercel/host). **Não** mexer edges só por isso |
| Migration file `cerebro_ativo` default off | Já aplicada no banco; arquivo só versiona | Incluir no mesmo commit |

### B) Dívida P2 — **não precisa de Cursor** (ops ou ignore)

| Item | Impacto | Ação sem código |
|---|---|---|
| UI Evolution `needs_reconnect` assusta | Confusão | **Ignore.** Health = Whapi AUTH / alerta WA |
| Fila Club ≠ Redis (já alerta) | Club lento/offline | Easy Panel: health Club; rebuild worker; ver alerta 🚨 Portal2/Club Redis |
| Crons redundantes / ruído | Logs | Deixar; não apagar job sem análise |
| Cap legado `daily_whapi_cap` vs `cap_b` | Já alinhado na UI | Não mexer |
| Outros consultores com `cerebro_ativo=on` antigo | IA neles | No SuperAdmin/SQL só se quiser OFF; **não** precisa |

### C) Dívida P3 — doc/dívida — **ignorar**

Specs Evolution-first em `.kiro/specs` (STATUS archived), hex caça total UI, etc.

### D) Como NÃO quebrar se um dia alguém mexer de novo

1. Rollback estreito → largo: `live_dispatch=false` → `daily_reheat.enabled=false` → `cadence_engine=false` → `bot_global=false`  
2. Cérebro: `UPDATE consultants SET cerebro_ativo='off' WHERE id=…`  
3. Ads: `kill_switch=true` no `brain_config` do consultor  
4. **Nunca** apagar migration/toggle/edge “morta”  
5. E2E com envio real → `dryRun` / só números de teste  

---

## 3) Operar SEM Cursor — só estes painéis

Você cuidando disto = plataforma viva. Código não precisa.

### 3.1 Whapi (WhatsApp) — **crítico**

| O quê | Onde | Se falhar |
|---|---|---|
| Sessão AUTH | Painel Whapi Cloud / gate | Reconectar canal; **não** “Evolution reconnect” |
| Token | Secret Supabase / settings | Renovar no Whapi e colar no secret |
| Alerta | Seu Zap (cron) “Whapi sem AUTH” | Tratar na hora |

**Sinal falso:** Evolution `needs_reconnect` no banco → **ignorar**.

### 3.2 Gemini / IA (OCR + modelos)

| O quê | Onde | Se falhar |
|---|---|---|
| `GEMINI_API_KEY` | Secrets Supabase Edge | Renovar key Google AI; cadastro/OCR para |
| Cérebro (Sofia) | Já no Rafael ON; outros opt-in no modal | Se mudou sozinho: handoff, kill switch, Whapi, prefs |
| Lovable / outro provedor LLM | Conta Lovable / OpenRouter se usado | Saldo/crédito na conta do provedor; não é bug do funil |

### 3.3 Velip (voz / SMS)

| O quê | Onde | Se falhar |
|---|---|---|
| **Crédito** | **Painel Velip** (API não mostra saldo) | Recarregar → testar 1 SMS / 1 call |
| Procon / BK | Painel + alerta WA | Não é “sem crédito”; content/compliance |
| SMS “sumiu” | Operadora (UNDELIV) | Aceito Velip ≠ entregue; não martelar o mesmo número |

O sistema **não pausa sozinho** por saldo Velip zerado.

### 3.4 Evolution — **legado**

| O quê | Fazer |
|---|---|
| Instância `needs_reconnect` | **Não** tratar como Zap do Rafael offline |
| Só se ainda tiver consultor Evolution real | Painel Evolution daquele consultor |

### 3.5 Easy Panel — **3 workers** (nunca misturar URL)

| Worker | Papel | Se cair |
|---|---|---|
| **Portal 2** | Cadastro OTP/facial | Rebuild + health; alerta “worker offline” |
| **Club** | Club API | Health + Evomi se Cloudflare 403 |
| **Sync** | Carteira iGreen | Health `d9v63q` (não typo `d9v83a`); WAF → proxy |

Você recebe alerta no Zap se offline / fila Redis errada.

### 3.6 Outros (rápido)

| Item | Cuidado |
|---|---|
| Meta / Ads | Saldo carteira consultor; waste já protege; não ligar targeting automático |
| Stripe | Top-up carteira no painel |
| MinIO | Alerta % armazenamento |
| Domínio / DNS / host do front | Painel do host (Vercel etc.) |

---

## 4) Checklist semanal (2 minutos, no celular)

1. Chegou alerta estranho no Zap? → agir na tabela §3  
2. Whapi ainda manda? → mandar “oi” de número de teste  
3. Velip: olhar crédito no **painel Velip**  
4. Easy Panel: 3 health verdes  
5. Meta Ads: carteira Rafael não no vermelho  

**Não precisa:** abrir Cursor, Kiro, SQL, GitHub Actions (salvo deploy que você mesmo disparou).

---

## 5) Emergência (ordem)

1. Algo enviando errado em massa → SuperAdmin: **kill bot global** (ou só `live_dispatch`)  
2. IA falando demais → `cerebro_ativo=off` no consultor (SQL/SuperAdmin)  
3. Zap morto → Whapi AUTH (não Evolution)  
4. Cadastro parado → Easy Panel Portal2 health  
5. Sem voz/SMS → Velip crédito  

---

## 6) Onde ler no GitHub (sem IDE)

- Este arquivo: `docs/ENCERRAR-E-OPERAR-SEM-IDE.md`  
- Playbook longo: `.kiro/steering/erros-operacionais.md`  
- Cérebro × Grupo A: `.kiro/steering/cerebro-fluxo-b.md`  
- Ads o que não ligar: `.kiro/steering/ads-sql-pendente.md`  

Fim. Depois do push deste pacote: **código encerrado**; só ops.
