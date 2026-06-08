# Ajustes Extensão iGreen + Sincronização XLSX

## Diagnóstico (o que está errado hoje)

Conferi 1.060 clientes sincronizados via extensão e a planilha enviada:

| Sintoma reportado | Causa real |
|---|---|
| Top Licenciado vazio / cadastros não aparecem | `igreen-ingest-xlsx` **não lê** as colunas `Licenciado` e `Código Licenciado` do XLSX → `registered_by_name`/`registered_by_igreen_id` ficam `NULL` em 100% dos registros. O `useAnalytics` agrupa Top Licenciado por `registered_by_name`, por isso aparece zerado. |
| "Vejo cliente validado que não foi" | O status é derivado **só** de `Andamento`. As colunas `Data Validado` / `Data Ativo` / `Data Cadastro` são ignoradas. Quando `Andamento` vem vazio (acontece nos primeiros itens da planilha), cai em `pending` mas a UI mostra como "Validado" em outros pontos porque não há fallback nas datas. |
| Telefone faltando | 880/1060 clientes ficaram com `phone_whatsapp = sem_celular_<código>`. A planilha **tem** `Celular` preenchido em todas as linhas — esses 880 vieram do sync antigo via API (`sync-igreen-customers`), antes da extensão. O ingest novo está correto, mas precisa **re-popular telefone quando o registro já existe sem celular real**. |
| Devolutiva crua ("caminhoarquivodoc1:…") | Ingest grava o texto bruto da planilha. Precisa de parser que limpa os prefixos `caminhoarquivo:`, `caminhoarquivodoc1:`, `caminhocomprovante:` e devolve só a razão legível. |
| Mapa de Rede sem GP/GI/Graduação/Bonificável | Código procura "GP Qualificados" / "GL Qualificados", mas a planilha usa **"GP Qualificável"**, **"GI Qualificável"** (com acento e singular). Também ignora `Bonificável`, `Green Points 2026`, `GP junho`, `GI junho`, `Clientes Ativos`, `Licenciados Diretos`, `Licenciados Diretos Ativos`, `Data Nascimento`, `Data Ativo`, `PRO`, `Graduação Expansão`. |
| CRM não recebe cliente | Os clientes `igreen_sync` são bloqueados no Kanban CRM por trigger (correto por design). Eles deveriam aparecer no **Pós-Venda Kanban** em `pos_venda_stage='espera'`, mas o card nunca renderizou esse stage. Precisa garantir que a coluna "Em espera (export)" exista e mostre. |
| Card da extensão no Dashboard | Hoje o `IGreenExtensionCard` está dentro do `DashboardTab.tsx`. Deve ser movido para o Sheet de **Configurações** (engrenagem) — junto do `DadosTab`. |
| "Revogar" token não exclui | Hoje só marca `revoked_at`. Token continua no banco, aparece como "Revogado" na lista. Pedido: **DELETE permanente**. |

---

## O que vou fazer

### 1. Mover Extensão para a engrenagem
- `src/pages/Admin.tsx` (Sheet de Configurações): renderizar `<IGreenExtensionCard userId={userId}/>` abaixo do `<DadosTab/>`.
- `src/components/admin/DashboardTab.tsx`: remover o card (linhas 353-354).

### 2. Excluir token permanentemente
- `src/components/admin/IGreenExtensionCard.tsx`: trocar o handler `revoke` por `delete`:
  ```ts
  await supabase.from("igreen_extension_tokens").delete().eq("id", id);
  ```
- Ícone de lixeira passa a remover de vez. Adicionar `confirm()` antes.
- Remover toda referência a `revoked_at` na renderização (lista agora só mostra ativo/expirado).

### 3. Corrigir mapeamento Clientes (`igreen-ingest-xlsx/index.ts`)
Em `buildCustomerRecord`:
- **Licenciado**: ler `Licenciado` → `registered_by_name`; `Código Licenciado` → `registered_by_igreen_id` (int).
- **Datas**: ler `Data Cadastro`, `Data Ativo`, `Data Validado` → `data_cadastro_igreen`, `data_ativo_igreen`, `data_validado_igreen` (parse `dd/mm/yyyy`).
- **Status melhorado**: se `Data Validado` ou `Data Ativo` preenchidas → `approved`; senão usar o `mapStatus(Andamento)`.
- **Devolutiva limpa**: regex `s.replace(/caminho[a-z0-9]*:\s*/gi, "").replace(/,\s+/g, " | ").trim()`.
- **Demais campos**: `Data Nascimento` → `data_nascimento`; `Nível` → `nivel_licenciado`; `Cashback`, `Status Financeiro`, `Assinatura Cliente`, `Assinatura iGreen`, `Link Assinatura`, `Observação` → colunas correspondentes (criar via migration se não existirem; ver §5).

Na lógica de UPDATE (linha 277-290): se o registro existente tem `phone_whatsapp LIKE 'sem_celular_%'` e o XLSX trouxe celular válido, **substituir** o telefone (e remover o placeholder). Isso recupera os 880 telefones perdidos.

### 4. Corrigir mapeamento Rede (`buildNetworkRecord`)
Trocar os `pick(...)` por:
- `gp_qualificados`: `"GP Qualificável"` / `"GP Qualificavel"`
- `gl_qualificados` → renomear lógico para `gi_qualificados`: `"GI Qualificável"`
- Adicionar: `gt_qualificavel`, `bonificavel`, `green_points_ano`, `gp_mes`, `gi_mes`, `green_points_mes`, `data_nascimento`, `data_ativo`, `graduacao_expansao`, `licenciados_diretos`, `licenciados_diretos_ativos`, `clientes_ativos`, `pro`, `green_telecom_mes`, `livre_mes`, `placas_mes`, `club_mes`, `expansao_mes`.
- No mirror para `network_members`: passar `gp`, `gi`, `graduacao`, `clientes_ativos`, `data_ativo`, `data_nascimento`.

### 5. Migration — colunas que faltam

```sql
-- customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS data_cadastro_igreen date,
  ADD COLUMN IF NOT EXISTS data_ativo_igreen date,
  ADD COLUMN IF NOT EXISTS data_validado_igreen date,
  ADD COLUMN IF NOT EXISTS nivel_licenciado int,
  ADD COLUMN IF NOT EXISTS cashback_igreen text,
  ADD COLUMN IF NOT EXISTS status_financeiro text,
  ADD COLUMN IF NOT EXISTS assinatura_cliente_status text,
  ADD COLUMN IF NOT EXISTS assinatura_igreen_status text,
  ADD COLUMN IF NOT EXISTS link_assinatura text,
  ADD COLUMN IF NOT EXISTS observacao_igreen text;

-- network_members
ALTER TABLE public.network_members
  ADD COLUMN IF NOT EXISTS gt_qualificavel numeric,
  ADD COLUMN IF NOT EXISTS bonificavel numeric,
  ADD COLUMN IF NOT EXISTS green_points_ano numeric,
  ADD COLUMN IF NOT EXISTS gp_mes numeric,
  ADD COLUMN IF NOT EXISTS gi_mes numeric,
  ADD COLUMN IF NOT EXISTS green_points_mes numeric,
  ADD COLUMN IF NOT EXISTS graduacao_expansao text,
  ADD COLUMN IF NOT EXISTS licenciados_diretos int,
  ADD COLUMN IF NOT EXISTS licenciados_diretos_ativos int,
  ADD COLUMN IF NOT EXISTS clientes_ativos int,
  ADD COLUMN IF NOT EXISTS pro text,
  ADD COLUMN IF NOT EXISTS green_telecom_mes numeric,
  ADD COLUMN IF NOT EXISTS livre_mes numeric,
  ADD COLUMN IF NOT EXISTS placas_mes numeric,
  ADD COLUMN IF NOT EXISTS club_mes numeric,
  ADD COLUMN IF NOT EXISTS expansao_mes numeric,
  ADD COLUMN IF NOT EXISTS data_ativo date,
  ADD COLUMN IF NOT EXISTS data_nascimento date;
```

### 6. Backfill dos 1.060 já sincronizados
Após corrigir o ingest, peço para você re-sincronizar pela extensão. O ingest fará UPDATE (já trata duplicata por phone) e vai popular Licenciado/datas/telefone retroativamente. Sem migration de dados separada.

### 7. CRM Pós-Venda — coluna "Em espera"
- `src/components/whatsapp/PosVendaKanban.tsx`: confirmar que existe a coluna `espera` no array de stages. Se não, adicionar como primeira coluna. Cards vêm com `pos_venda_pending_stage` (aprovado/devolutiva/reprovado) já populado para o consultor mover.

### 8. Não mexer
- Lógica do Kanban CRM (continua bloqueando `igreen_sync` por trigger — design correto).
- RLS / policies da `igreen_extension_tokens`.
- Bucket / extensão Chrome em si (apenas o backend de ingest).

---

## Arquivos tocados
- `supabase/migrations/<novo>.sql` — colunas extras (§5)
- `supabase/functions/igreen-ingest-xlsx/index.ts` — mapeamento completo + recuperação de telefone (§3, §4)
- `src/components/admin/IGreenExtensionCard.tsx` — DELETE em vez de revoke (§2)
- `src/pages/Admin.tsx` — card na engrenagem (§1)
- `src/components/admin/DashboardTab.tsx` — remover card (§1)
- `src/components/whatsapp/PosVendaKanban.tsx` — coluna "Em espera" (§7)

## Validação
Após implementar, peço você clicar **Sincronizar agora** na extensão. Depois eu consulto o banco e mostro: % com licenciado preenchido, % com telefone real, top licenciados, devolutivas formatadas, e GP/GI populados na Rede.
