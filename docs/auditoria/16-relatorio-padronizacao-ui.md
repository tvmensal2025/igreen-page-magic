# Relatório de Auditoria de UI/UX — Padronização iGreen

> Documento de diagnóstico, **reescrito e reverificado em 14/06/2026** contra o
> código atual (não contra a versão anterior do relatório). Os números antigos
> estavam desatualizados; esta versão reflete o que foi medido e confirmado hoje.
>
> Verificação feita com: leitura de código, contagem real por busca, build
> (`tsc --noEmit`), suíte de testes (`vitest`), inspeção ao vivo via navegador
> em `http://localhost:8080/` e revisão das migrations RLS do banco.

## Resumo em uma frase

A maior parte dos problemas de UI apontados na auditoria anterior **já foi
corrigida**: a paleta foi unificada no verde de marca, a estética "terminal"
sumiu do que está em uso, e o tema concorrente `painel-elite` agora herda os
tokens oficiais. O que sobra é faxina pontual de cor e **um risco real de
segurança no banco** (escalonamento de privilégio via RLS) que merece prioridade.

---

## 0. Estado de saúde técnico (novo)

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` | ✅ Passa, exit 0, sem erros |
| App sobe (`npm run dev`) | ✅ Vite limpo na porta 8080 |
| Testes (`vitest`) | ⚠️ 182/185 passam; 3 falhas por testes desatualizados |
| Lint (`eslint`) | ⚠️ 19 erros (`prefer-const`) + 1108 warnings (`no-explicit-any`) |

As 3 falhas de teste **não são bug de produção**:
- `evolutionApi.test.ts` — payload esperado não inclui o evento `MESSAGES_UPDATE`
  que o código passou a enviar (teste atrás do código).
- 2 testes do `evolution-kill-switch-guard` — usam assertion de posição de byte
  (`expected 12016 to be less than 5200`) que quebrou porque o arquivo cresceu.
  A guarda continua presente; só mudou de offset.

---

## 1. Rotas / páginas (em `src/App.tsx`)

Público / consultor: `/` → `/auth`; `/auth`; `/:licenca` (catch-all);
`/licenciado/:licenca` e `/licenciado/preview`; `/cadastro/:licenca`; `/crm`;
`/politica-privacidade`, `/install`, `/reset`; `/assistente`.

Admin (`/admin/...`): painel principal com abas internas, `whatsapp-clients`,
`fluxos`, `fluxo-b`, `saude-bot`, `saude-producao`, `conhecimento`,
`reaquecimento`, `conversao`, `meta-ads`, `faq` (+ rotas legadas que redirecionam).

Super admin: `/super-admin`, `/super-admin/suporte`.

Total: **433 arquivos `.tsx`** em `src/` (eram 403 na auditoria anterior).

## 2. Componentes globais

- Biblioteca **shadcn/ui** completa em `src/components/ui/`.
- Layout próprio em `src/components/layout/` (AppSidebar, AppHeader, AppTopbar,
  ResizableShell).
- Toasts via **sonner** + toaster do shadcn.
- Abordagem de token `hsl(var(--token))` no Tailwind — é exatamente o padrão
  recomendado pelo shadcn/ui atual. ✅

## 3. Arquivos de tema / design system

- `tailwind.config.ts` — mapeia tokens via `hsl(var(--...))`. Centralizado. ✅
- `src/index.css` — tokens light + dark + utilitárias + tema escopado
  `.ads-central-2026`.
- `src/styles/painel-elite.css` — tema do painel admin.

➡️ **Mudança importante vs. auditoria anterior:** os temas deixaram de ser
"paletas concorrentes". O `painel-elite.css` hoje define os mesmos verdes
oficiais (`#00A859` / `#007A3D`) e **sobrescreve os tokens shadcn com os mesmos
valores** do tema global. Não há mais conflito de identidade entre eles.

## 4. Cores — token global (`index.css`), valores atuais

- `--primary` verde `152 100% 33%` (= `#00A859`, marca) ✅
- `--accent` verde claro `152 55% 94%` (= `#E8F8EF`) ✅ **— era laranja, foi corrigido**
- `--destructive` vermelho `0 72% 51%` ✅
- Semânticos definidos: `--success`, `--warning`, `--info` ✅
- Dark theme oficial (`#111111` / `#1A1A1A`) presente e coerente ✅

## 5. Cores fora da paleta (números reais de hoje)

| Família | Ocorrências |
|---|---|
| amber | 27 |
| orange | 11 |
| blue | 10 |
| cyan | 10 |
| violet | 8 |
| sky | 8 |
| rose | 7 |
| red | 7 |
| yellow | 5 |
| purple | 4 |
| indigo | 2 |
| teal | 2 |
| **Subtotal não-neutro** | **~127** |

Neutros (geralmente legítimos): zinc 33, gray 32, neutral 13, slate 12, stone 2
(≈ 92).

**Total geral de classes de cor com escala numérica: ~219** (era ~566).
Cores hex cravadas (`[#...]`): **104 em 17 arquivos**. Estilos inline com
cor/background: **214**. `font-mono`: **129 ocorrências em 63 arquivos** —
amostragem mostra uso legítimo (números, moeda, telefone), não estética de código.

## 6. Estética "terminal hacker" — RESOLVIDO ✅

A auditoria anterior apontava `src/components/admin/dashboard/` como "pior
ofensor", com fundo preto, fonte mono e rótulos `FNL_04` / `CHART_01` / `PNL_02`.

Verificação de hoje:
- **Não existe nenhum** `FNL_04`, `CHART_01`, `PNL_02` ou similar no codebase.
- Os componentes vivos do dashboard (`MainChart`, `CpcPanel`, `FunnelStrip`,
  `RecentClicks`, `AdMetricsCards`, `AdMetricsCharts`, `AdAccountSwitcher`) usam
  tokens semânticos (`bg-card`, `border-border`, `hsl(var(--primary))`) e rótulos
  humanos em PT-BR ("Funil de conversão", "Clientes interessados").
- Inspeção ao vivo confirmou: `/auth` é um login dark limpo (Open Sans), sem
  nada de terminal.

## 7. Código morto removido (novo) ✅

Investigação de dependências no diretório `dashboard/` encontrou 4 arquivos sem
nenhuma referência (sem import estático, lazy, barrel ou string) — **já deletados
nesta sessão**, com `tsc --noEmit` passando limpo depois:
- `HeroKpis.tsx` (continha resíduo de fundo preto cravado)
- `TerminalTicker.tsx`
- `ClickValueGrid.tsx`
- `Sparkline.tsx` (morto transitivo — só era usado pelos dois acima)

## 8. Linguagem / textos técnicos

- "Lead"/"Leads" ainda aparece em ~42 pontos. Boa parte das telas já migrou para
  "Cliente interessado" (visto em `MainChart`, `FunnelStrip`), mas a troca não é
  uniforme em todas as tabelas/selects.
- Menu lateral (`AppSidebar`) e títulos: revisar consistência "Dashboard" x
  "Painel".

## 9. SEGURANÇA — pendência de prioridade ALTA (novo)

**Risco: escalonamento de privilégio via RLS na tabela `public.consultants`.**

A policy criada em `20260326121425` e **nunca redefinida**:

```sql
CREATE POLICY "Owner update" ON public.consultants
  FOR UPDATE TO authenticated USING (id = auth.uid());
```

Não tem `WITH CHECK` nem restrição de coluna. Verifiquei todas as migrations
posteriores: **não há** `REVOKE UPDATE (approved)` nem trigger que impeça a
mudança desse campo (o único revoke/grant de coluna é para
`igreen_portal_password` / `igreen_access_token`).

Consequência: um consultor autenticado pode, em tese, dar `UPDATE` na própria
linha setando `approved = true` e furar o gate de aprovação. O guard no front
(`useAdminAuth` → bloqueio quando `!approved`) é **client-side** e não protege o
dado.

> Ressalva honesta: confirmado por leitura das migrations; **não testei o exploit
> ao vivo** contra o banco. O padrão de correção já existe no projeto — a migration
> `20260601030000_owner_update_customers_with_check` fez exatamente isso para a
> tabela `customers`. Falta replicar em `consultants`.

Correção proposta (a aprovar antes de aplicar): substituir a policy por uma
versão com `WITH CHECK` que impeça o próprio dono de alterar `approved` (e
idealmente `id`), mantendo a policy de admin (`Admins update consultants`)
intacta para a aprovação legítima.

## 10. Cadastro aberto (a confirmar)

`/auth` permite "Criar conta" sem gating visível. O signup cria o consultor com
`approved: false` (correto), mas isso só segura se o item 9 for corrigido —
senão a auto-aprovação contorna o fluxo.

---

## 11. Plano de correção por prioridade (atualizado)

1. **[ALTO · segurança]** Migration de RLS em `consultants`: `WITH CHECK` na
   policy "Owner update" para travar `approved`/`id`. Mostrar SQL antes de aplicar.
2. **[MÉDIO · testes]** Atualizar os 3 testes desatualizados (adicionar
   `MESSAGES_UPDATE` no payload esperado; trocar assertions de offset de byte por
   verificação robusta de ordem).
3. **[BAIXO · lint]** `eslint --fix` nos 19 erros `prefer-const`; reduzir
   `no-explicit-any` aos poucos.
4. **[BAIXO · cor]** Trocar as ~127 ocorrências não-neutras (amber/orange/blue…)
   e os 104 hex cravados por tokens semânticos, arquivo a arquivo.
5. **[BAIXO · linguagem]** Uniformizar "Lead" → "Cliente interessado" nas tabelas
   e selects restantes.

## 12. O que NÃO é mais necessário

- Reescrever o design system do zero (já está aplicado e coerente).
- Remover "estética terminal" (não existe mais no que está em uso).
- Corrigir `--accent` laranja e unificar `painel-elite` (já feito).
- Usar Figma para corrigir UI — só agregaria como documentação/Code Connect.

## Riscos / cuidados

- Não mexer em nomes internos de banco/variáveis (só no que o usuário vê).
- Mudanças de token em `painel-elite` e `ads-central-2026` afetam telas inteiras;
  exigem revisão visual.
- Validar sempre com `npx tsc --noEmit` e `npx vite build` antes de commitar.
- A migration de segurança toca RLS de produção: revisar e aprovar o SQL antes de
  aplicar; nunca aplicar direto sem backup/rollback documentado.
