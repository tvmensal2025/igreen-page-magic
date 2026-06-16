# Design — Acompanhamento de Proposta/Venda (Esteira)

## Overview
<!-- Visão Geral -->

Esta feature adiciona uma **esteira de acompanhamento** a cada venda fechada, dentro do módulo Produtos/Vendas (`src/features/produtos/`). A esteira é um conjunto ordenado de **passos** (ex.: Foto e documentação → Visita técnica → Dimensionamento → Contrato enviado) que o consultor executa: marca como concluído/pendente, escreve observações e anexa fotos/documentos.

A sequência de passos vem de um **template global único**, gerenciado por administradores. Quando uma proposta é aceita (e portanto uma venda nasce/é vinculada) ou quando uma venda passa para `fechado`, o sistema **instancia automaticamente** a esteira daquela venda, copiando as etapas do template como passos com estado inicial "pendente". O nome de cada etapa é **fotografado (snapshot)** no momento da instanciação, de modo que mudanças posteriores no template não alteram esteiras já criadas (Requisito 6).

Os anexos ficam em um **bucket novo e dedicado** (`sales-attachments`), organizado por venda (`{sale_id}/...`), com políticas de RLS que isolam o acesso por consultor (dono da venda) e liberam leitura geral para admin/superadmin.

Princípios de projeto:
- **Isolado do CRM**: tudo se atrela a `sales`/`proposals`. Nada de `kanban_stages` nem `crm_deals` (Requisito 7).
- **Reaproveita os padrões do projeto**: camadas `types.ts → api.ts → hooks.ts → componentes`, cliente `@/integrations/supabase/client`, React Query, componentes shadcn/ui, e o helper de `has_role` para RLS.
- **Idempotência**: a instanciação nunca duplica nem apaga progresso já registrado.

## Architecture
<!-- Arquitetura e decisões -->

### Decisão de Arquitetura: Onde Instanciar a Esteira

Há dois caminhos possíveis para instanciar a esteira automaticamente: (a) na edge function `proposal-respond` (no momento do aceite) ou (b) em um **trigger no banco** sobre `public.sales`.

**Decisão: trigger no banco (`AFTER INSERT OR UPDATE OF status ON public.sales`), complementado por uma RPC idempotente `ensure_sale_stage_progress(p_sale_id)`.**

Justificativa:
- **Cobre todas as entradas com uma fonte única de verdade.** A venda pode nascer `fechado` de três formas: pela edge `proposal-respond` (aceite público), pelo `RegistrarVendaDialog` (registro manual) e por um futuro fluxo. Um trigger em `sales` captura todas sem espalhar a lógica. Colocar a regra só na edge deixaria o registro manual de fora.
- **Atende literalmente os Requisitos 2.1 e 2.2.** 2.1 fala em "Orçamento aceito e vinculado a uma Venda (define-se `sale_id`)" e 2.2 em "Venda passa para `fechado`". A condição do trigger é `NEW.status = 'fechado'` (cobrindo o INSERT já fechado vindo do aceite e o UPDATE para fechado vindo do pipeline). O vínculo do `sale_id` na proposta não precisa ser observado: o que importa é a venda existir e estar fechada.
- **Idempotência natural.** A RPC `ensure_sale_stage_progress` só cria a esteira se ainda não existir (verifica `sale_stage_progress` por `sale_id`). O trigger apenas chama a RPC; chamar várias vezes não duplica (Requisito 2.3).
- **Sem alterar o enum nem o fluxo de status** (fora de escopo). O trigger é aditivo e roda como `SECURITY DEFINER`, então o `INSERT` dos passos não esbarra na RLS do consultor.

Consequência: a edge `proposal-respond` **não muda** — ela continua só criando/atualizando a venda como hoje. Isso evita um deploy de edge function (que depende de GitHub Actions, conforme steering de deploy) e mantém a mudança 100% em migrations aplicadas via MCP. Se no futuro for desejável feedback imediato no aceite, a edge pode chamar a mesma RPC, sem retrabalho.

### Fluxo

```mermaid
flowchart TD
    subgraph Cliente
      A[Página pública /proposta/:token] -->|aceitar| B[edge proposal-respond]
    end
    subgraph Consultor
      M[RegistrarVendaDialog / Pipeline] -->|cria/move venda| S
    end
    B -->|insert sales status=fechado| S[(public.sales)]
    M --> S
    S -->|AFTER INSERT/UPDATE status=fechado| T{{trigger trg_sales_ensure_stage_progress}}
    T -->|chama| R[[RPC ensure_sale_stage_progress<br/>SECURITY DEFINER, idempotente]]
    R -->|se ainda não existe| G[(sale_stage_progress<br/>snapshot das etapas)]
    G -->|copia etapas ativas| TPL[(sale_stage_templates)]

    subgraph Front src/features/produtos/esteira
      P[SaleStagePanel<br/>consultor] -->|hooks| API[api.ts]
      ADM[StageTemplateAdmin<br/>admin] -->|hooks| API
      API --> G
      API --> TPL
      API --> AT[(sale_stage_attachments)]
      API --> BK[[bucket sales-attachments<br/>{sale_id}/...]]
    end

    SPB[SalesPipelineBoard / Painel Vendas] -.abre.-> P
```

## Components and Interfaces
<!-- Componentes e Camadas -->

### Banco de Dados (Supabase, project-ref `zlzasfhcxcznaprrragl`)

Três tabelas novas no schema `public` + um bucket de storage. Todas com RLS habilitada.

#### `sale_stage_templates` — etapas globais ordenadas
Configuração única e global gerenciada por admin.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `position` | int NOT NULL | ordem na sequência (0..n-1) |
| `name` | text NOT NULL | nome da etapa (não vazio) |
| `is_active` | boolean NOT NULL default true | remoção lógica opcional / só ativas entram na instanciação |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | trigger `set_updated_at` |

#### `sale_stage_progress` — passos por venda (instância da esteira)
Um registro por passo de cada venda. O nome é **snapshot** para preservar histórico (Req 6).

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `sale_id` | uuid NOT NULL FK → `sales(id)` ON DELETE CASCADE | dono da esteira |
| `template_position` | int NOT NULL | posição fotografada do template no momento da criação |
| `name_snapshot` | text NOT NULL | nome fotografado da etapa (não muda se o template mudar) |
| `status` | `sale_stage_status` (enum: `pendente` \| `concluido`) NOT NULL default `pendente` | |
| `note` | text NULL | observação do consultor |
| `completed_at` | timestamptz NULL | carimbo ao concluir |
| `completed_by` | uuid NULL FK → `auth.users(id)` | autoria da conclusão |
| `created_at` | timestamptz default now() | |

Índice: `(sale_id, template_position)`; unique `(sale_id, template_position)` para reforçar idempotência.

#### `sale_stage_attachments` — anexos de um passo
| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `sale_stage_id` | uuid NOT NULL FK → `sale_stage_progress(id)` ON DELETE CASCADE | |
| `storage_path` | text NOT NULL | caminho no bucket, sempre começando por `{sale_id}/` |
| `file_name` | text NOT NULL | nome original (exibição) |
| `mime` | text NOT NULL | tipo do arquivo |
| `size_bytes` | bigint NOT NULL | tamanho |
| `uploaded_by` | uuid NOT NULL FK → `auth.users(id)` | autoria do envio |
| `created_at` | timestamptz default now() | |

#### Bucket `sales-attachments`
Bucket **privado** e novo (não reaproveita buckets existentes — Req 4.6), com `file_size_limit` e `allowed_mime_types` (imagens + PDF). Caminho canônico: `{sale_id}/{sale_stage_id}/{timestamp}-{nome_sanitizado}`.

#### RPC `ensure_sale_stage_progress(p_sale_id uuid)` — instanciação idempotente
`SECURITY DEFINER`. Pseudo-lógica:

```sql
-- 1) se já existe ao menos um passo para a venda, não faz nada (idempotente)
if exists(select 1 from sale_stage_progress where sale_id = p_sale_id) then return;
-- 2) copia as etapas ATIVAS do template vigente, ordenadas por position,
--    fotografando position e name
insert into sale_stage_progress (sale_id, template_position, name_snapshot, status)
select p_sale_id, t.position, t.name, 'pendente'
from sale_stage_templates t
where t.is_active = true
order by t.position;
```

#### Trigger em `sales`
```sql
create trigger trg_sales_ensure_stage_progress
  after insert or update of status on public.sales
  for each row when (NEW.status = 'fechado')
  execute function public.tg_ensure_sale_stage_progress();
-- a função apenas chama: perform public.ensure_sale_stage_progress(NEW.id);
```

#### Seed do template padrão (Req 1.6)
A migration insere as 4 etapas padrão **apenas se a tabela estiver vazia**: "Foto e documentação", "Visita técnica", "Dimensionamento", "Contrato enviado" (positions 0..3). A UI de admin também oferece um botão "Inicializar com etapas padrão" que chama a mesma lógica quando o template está vazio.

### Front-end — `src/features/produtos/esteira/`

Segue o padrão do projeto (ver `vendas/` e `catalogo/`): `types.ts → api.ts → hooks.ts → componentes`.

- **`types.ts`** — modelos camelCase + linhas cruas snake_case:
  - `StageTemplateItem`, `StageTemplateRow`
  - `SaleStage` (passo), `SaleStageRow`, `SaleStageStatus = "pendente" | "concluido"`
  - `SaleStageAttachment`, `SaleStageAttachmentRow`
  - Constantes: `SALES_ATTACHMENTS_BUCKET = "sales-attachments"`, `MAX_ATTACHMENT_BYTES`, `ALLOWED_ATTACHMENT_MIMES`, `DEFAULT_TEMPLATE_STAGES`.
- **`logic.ts`** (lógica pura testável, sem I/O) — funções que sustentam as properties:
  - `appendStage(stages, name)` → adiciona na última posição.
  - `normalizePositions(stages)` → reindexa 0..n-1 sem buracos (usado após remover/reordenar).
  - `isValidStageName(name)` → false para vazio/whitespace.
  - `buildAttachmentPath(saleId, saleStageId, fileName)` → `{saleId}/{saleStageId}/{ts}-{sanitizado}`.
  - `validateUpload({sizeBytes, mime})` → aplica limite e lista de mimes.
  - `computeProgress(stages)` → `{ done, total }`.
- **`api.ts`** — acesso ao Supabase (mapeia rows ↔ modelos), espelhando o estilo de `vendas/api.ts`:
  - Template: `fetchTemplate()`, `addStage(name)`, `renameStage(id, name)`, `removeStage(id)`, `reorderStages(orderedIds)`, `seedDefaultTemplate()`.
  - Esteira: `fetchSaleStages(saleId)`, `setStageStatus(stageId, status)`, `setStageNote(stageId, note)`.
  - Anexos: `listAttachments(stageId)`, `uploadAttachment(saleId, stageId, file)`, `removeAttachment(attachment)`.
  - Upload usa `supabase.storage.from(SALES_ATTACHMENTS_BUCKET)` (padrão visto em `services/adImageLibrary.ts`).
- **`hooks.ts`** — React Query: `useStageTemplate`, `useSaleStages(saleId)`, `useStageAttachments(stageId)` + mutations que invalidam as chaves correspondentes (padrão de `vendas/hooks.ts`).
- **Componentes (shadcn/ui)**:
  - `SaleStagePanel.tsx` — painel de execução por venda (consultor): lista de passos com checkbox concluído/pendente, campo de observação, lista/upload/remoção de anexos, barra de progresso `done/total`.
  - `StageTemplateAdmin.tsx` — tela de configuração do template (admin): adicionar/editar/remover/reordenar (drag ou setas) etapas, com validação de nome e botão de inicialização padrão.
  - `index.ts` — re-exports.

### Integração com a UI existente (sem tocar o CRM)
- No `SalesPipelineBoard.tsx` (e/ou no painel de Vendas), o card de uma venda `fechado` ganha um botão/ação "Acompanhamento" que abre o `SaleStagePanel` (Sheet/Dialog) daquela venda. Nenhuma alteração em componentes de CRM.
- A tela de admin do template é exposta na área administrativa de Produtos (entrada de menu/admin), gated por `has_role(admin/super_admin)` na UI **e** na RLS.

## Data Models

<!-- SQL resumido -->

```sql
-- enum de estado do passo
create type public.sale_stage_status as enum ('pendente', 'concluido');

create table public.sale_stage_templates (
  id uuid primary key default gen_random_uuid(),
  position int not null,
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sale_stage_progress (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  template_position int not null,
  name_snapshot text not null,
  status public.sale_stage_status not null default 'pendente',
  note text,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sale_id, template_position)
);
create index idx_sale_stage_progress_sale on public.sale_stage_progress (sale_id, template_position);

create table public.sale_stage_attachments (
  id uuid primary key default gen_random_uuid(),
  sale_stage_id uuid not null references public.sale_stage_progress(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_sale_stage_attachments_stage on public.sale_stage_attachments (sale_stage_id);
```

## Segurança (RLS e Storage)

Helpers existentes reutilizados: `public.has_role(auth.uid(), 'admin')` e `public.is_super_admin(auth.uid())`. O elo de autorização do consultor é sempre o join `sale_stage_progress.sale_id → sales.consultant_id = auth.uid()`.

### `sale_stage_templates`
- **SELECT**: qualquer usuário autenticado (a esteira é global; consultores precisam ver os nomes). 
- **INSERT/UPDATE/DELETE**: só `has_role(admin)` ou `is_super_admin` (Req 1.7, 3.7).
- `service_role`: full (para a RPC/seed).

```sql
alter table public.sale_stage_templates enable row level security;

create policy "template read auth" on public.sale_stage_templates
  for select to authenticated using (true);

create policy "template admin write" on public.sale_stage_templates
  for all to authenticated
  using (has_role(auth.uid(),'admin') or is_super_admin(auth.uid()))
  with check (has_role(auth.uid(),'admin') or is_super_admin(auth.uid()));

create policy "template service" on public.sale_stage_templates
  for all to service_role using (true) with check (true);
```

### `sale_stage_progress`
- **SELECT/UPDATE**: consultor dono da venda **ou** admin/superadmin (admin só precisa de leitura — Req 5.3; o `WITH CHECK` de update fica restrito ao dono + admin). 
- **INSERT/DELETE**: feito pela RPC/`service_role` (a criação é automática; o consultor não cria passos manualmente).

```sql
alter table public.sale_stage_progress enable row level security;

create policy "progress read own or admin" on public.sale_stage_progress
  for select to authenticated using (
    sale_id in (select id from public.sales where consultant_id = auth.uid())
    or has_role(auth.uid(),'admin') or is_super_admin(auth.uid())
  );

create policy "progress update own" on public.sale_stage_progress
  for update to authenticated using (
    sale_id in (select id from public.sales where consultant_id = auth.uid())
    or has_role(auth.uid(),'admin') or is_super_admin(auth.uid())
  ) with check (
    sale_id in (select id from public.sales where consultant_id = auth.uid())
    or has_role(auth.uid(),'admin') or is_super_admin(auth.uid())
  );

create policy "progress service" on public.sale_stage_progress
  for all to service_role using (true) with check (true);
```

### `sale_stage_attachments`
- **SELECT/INSERT/DELETE**: o anexo pertence a um passo de uma venda do consultor (join encadeado até `sales.consultant_id`); admin/superadmin têm leitura.

```sql
alter table public.sale_stage_attachments enable row level security;

create policy "attach read own or admin" on public.sale_stage_attachments
  for select to authenticated using (
    sale_stage_id in (
      select p.id from public.sale_stage_progress p
      join public.sales s on s.id = p.sale_id
      where s.consultant_id = auth.uid()
    ) or has_role(auth.uid(),'admin') or is_super_admin(auth.uid())
  );

create policy "attach write own" on public.sale_stage_attachments
  for all to authenticated using (
    sale_stage_id in (
      select p.id from public.sale_stage_progress p
      join public.sales s on s.id = p.sale_id
      where s.consultant_id = auth.uid()
    )
  ) with check (
    sale_stage_id in (
      select p.id from public.sale_stage_progress p
      join public.sales s on s.id = p.sale_id
      where s.consultant_id = auth.uid()
    )
  );
```

### Políticas de Storage (`storage.objects`, bucket `sales-attachments`)
O isolamento por venda usa o **primeiro segmento do caminho** (`split_part(name,'/',1)`), que é o `sale_id`, casado com `sales.consultant_id = auth.uid()` (ou admin). Bucket privado (sem leitura pública).

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-attachments','sales-attachments', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- SELECT: dono da venda ou admin
create policy "sales-attach read" on storage.objects
  for select to authenticated using (
    bucket_id = 'sales-attachments' and (
      (split_part(name,'/',1))::uuid in (select id from public.sales where consultant_id = auth.uid())
      or has_role(auth.uid(),'admin') or is_super_admin(auth.uid())
    )
  );

-- INSERT/UPDATE/DELETE: só o dono da venda (escrita restrita)
create policy "sales-attach write" on storage.objects
  for all to authenticated using (
    bucket_id = 'sales-attachments' and
    (split_part(name,'/',1))::uuid in (select id from public.sales where consultant_id = auth.uid())
  ) with check (
    bucket_id = 'sales-attachments' and
    (split_part(name,'/',1))::uuid in (select id from public.sales where consultant_id = auth.uid())
  );
```

Notas de segurança:
- **Não autenticado é recusado** por padrão: todas as policies são `to authenticated`; sem sessão, nenhuma policy concede acesso (Req 5.4).
- **Autoria/data-hora**: `completed_by/completed_at` (passos) e `uploaded_by/created_at` (anexos) gravam quem fez e quando (Req 5.5). O front envia `auth.uid()` nesses campos; a RLS garante que só o dono escreve.
- **Validação de upload** acontece no front (`validateUpload`) e é reforçada no bucket por `file_size_limit`/`allowed_mime_types` (Req 4.5).

## Error Handling
<!-- Tratamento de Erros -->

- **Template vazio na instanciação**: a RPC cria zero passos (esteira vazia) sem erro; a UI mostra estado "sem etapas configuradas". O seed padrão evita esse caso na prática.
- **Idempotência/corridas**: o `unique (sale_id, template_position)` + o early-return da RPC impedem duplicação mesmo sob chamadas concorrentes do trigger.
- **Upload inválido**: `validateUpload` rejeita antes de chamar o storage, com mensagem do motivo (tamanho/tipo). Erros do storage são propagados como toast.
- **Remoção de anexo**: remove primeiro o arquivo no bucket e depois o registro; se o arquivo já não existir, ignora o erro de "não encontrado" e segue para apagar o vínculo (best-effort, evita registros órfãos).
- **Sem permissão**: operações negadas pela RLS retornam erro do Supabase, tratado na UI como "sem permissão".

## Estratégia de Migração e Deploy

Conforme o steering de deploy do projeto:
- **Banco**: todas as mudanças (enum, tabelas, índices, RPC, trigger, policies de tabela e de storage, bucket, seed) são aplicadas **na hora via MCP `apply_migration`** (project-ref `zlzasfhcxcznaprrragl`). Não dependem de deploy de edge.
- **Edge functions**: **nenhuma alteração** nesta feature (decisão pelo trigger no banco). Caso uma futura iteração precise mexer na edge, o deploy é feito pelo **GitHub Actions** (`deploy-edge-functions.yml`), nunca pelo CLI local.
- **Front-end**: validar com `npx tsc --noEmit` e `npx vite build` (ambos exit 0) antes de commitar. Não commitar `.kiro/settings/mcp.json`.
- **Sem migração retroativa** de vendas antigas (fora de escopo): a esteira nasce só para vendas fechadas a partir da ativação do trigger; se necessário, um botão admin pode chamar `ensure_sale_stage_progress` pontualmente.

## Testing Strategy
<!-- Estratégia de Testes -->

Abordagem dupla: **testes de propriedade** (lógica pura em `logic.ts`, 100+ iterações) + **testes de exemplo/integração** (UI, RLS, storage). O projeto usa Vitest (ver `src/features/produtos/**/__tests__`).

- **Property tests** (`fast-check` sobre `logic.ts`): cobrem P1–P14 abaixo. Cada teste tem a tag `Feature: acompanhamento-proposta, Property N: ...` e roda no mínimo 100 iterações.
- **Exemplos/UI**: render de `SaleStagePanel`/`StageTemplateAdmin` (ordem, estado, progresso), seed padrão, listagem de anexos.
- **Integração (RLS/storage)**: validar isolamento por consultor, leitura admin, recusa de anônimo e remoção de anexo (1–3 exemplos cada) — não como property.
- **Idempotência/instanciação**: testar `ensure_sale_stage_progress` chamando duas vezes e conferindo que não duplica e preserva progresso.

Rodar suites de teste em modo single-run (ex.: `vitest --run`), nunca em watch.

## Correctness Properties

*Uma propriedade é uma característica ou comportamento que deve valer em todas as execuções válidas do sistema — uma afirmação formal sobre o que o sistema deve fazer. Propriedades fazem a ponte entre a especificação legível por humanos e garantias verificáveis por máquina.*

### Property 1: Adicionar etapa entra no fim
*Para qualquer* template (lista de etapas) e nome válido, adicionar a etapa resulta numa lista com mais um item, em que a nova etapa ocupa a maior `position` e aparece por último na ordem.

**Validates: Requirements 1.2**

### Property 2: Remover/Reordenar normaliza as posições
*Para qualquer* template e qualquer remoção ou permutação de suas etapas, o resultado tem posições contíguas começando em zero (sem buracos nem repetições) e preserva exatamente o conjunto de etapas restantes.

**Validates: Requirements 1.4, 1.5**

### Property 3: Nome inválido é recusado
*Para qualquer* string composta apenas de espaços em branco (incluindo vazia), a validação de nome falha; e para qualquer string com ao menos um caractere não-branco, a validação passa.

**Validates: Requirements 1.8**

### Property 4: Instanciação copia etapas, preserva ordem e inicia pendente
*Para qualquer* conjunto de etapas ativas do template vigente, instanciar a esteira de uma venda produz exatamente um passo por etapa, na mesma ordem, todos com estado "pendente" e com nome igual ao da etapa de origem.

**Validates: Requirements 2.1, 2.4**

### Property 5: Instanciação é idempotente
*Para qualquer* venda, executar a instanciação da esteira mais de uma vez produz o mesmo resultado da primeira execução, sem duplicar passos nem alterar progresso já registrado.

**Validates: Requirements 2.2, 2.3**

### Property 6: Progresso é isolado por venda
*Para quaisquer* duas vendas distintas com esteira instanciada, alterar os passos (estado, observação ou anexos) de uma não modifica nenhum passo da outra.

**Validates: Requirements 2.5**

### Property 7: Alternância de estado registra autoria e data/hora
*Para qualquer* passo, marcá-lo como concluído resulta em estado "concluído" com `completed_at` preenchido e `completed_by` igual ao usuário autor; marcá-lo de volta como pendente resulta em estado "pendente".

**Validates: Requirements 3.2, 3.3, 5.5**

### Property 8: Observação faz round-trip
*Para qualquer* texto de observação, salvá-lo num passo e em seguida lê-lo devolve o mesmo texto.

**Validates: Requirements 3.4**

### Property 9: Progresso geral conta concluídos sobre o total
*Para qualquer* esteira, o progresso exibido tem `total` igual ao número de passos e `done` igual à quantidade de passos com estado "concluído".

**Validates: Requirements 3.5**

### Property 10: Caminho do anexo é organizado por venda
*Para qualquer* `sale_id`, passo e nome de arquivo, o caminho de armazenamento gerado começa com `{sale_id}/` e mantém o restante sanitizado.

**Validates: Requirements 4.2**

### Property 11: Validação de upload respeita tamanho e tipo
*Para qualquer* arquivo, o upload é aceito se e somente se o tamanho está dentro do limite máximo e o tipo (mime) está na lista permitida; caso contrário é recusado com o motivo.

**Validates: Requirements 4.5**

### Property 12: Esteira instanciada é imune a mudanças no template
*Para qualquer* esteira já instanciada, qualquer alteração posterior no template global (adicionar, editar, remover ou reordenar etapas) deixa os passos e o progresso daquela esteira inalterados.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 13: Nome do passo é um snapshot
*Para qualquer* esteira instanciada, renomear no template a etapa de origem de um passo mantém o nome (snapshot) já gravado naquele passo.

**Validates: Requirements 6.4**

### Property 14: Operações na esteira não afetam o CRM
*Para qualquer* operação na esteira (instanciar, alternar estado, observação, anexar/remover), os registros de `kanban_stages` e `crm_deals` permanecem inalterados.

**Validates: Requirements 7.3**
