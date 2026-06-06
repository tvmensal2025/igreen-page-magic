
-- 1. pgvector
create extension if not exists vector;

-- 2. customers: estado da venda + variante A/B
alter table public.customers
  add column if not exists fluxo_b_state jsonb not null default '{}'::jsonb,
  add column if not exists fluxo_b_variant text not null default 'legacy';

-- 3. ai_knowledge_sections: embedding (1536 dims pra caber em HNSW)
alter table public.ai_knowledge_sections
  add column if not exists embedding vector(1536),
  add column if not exists embedding_updated_at timestamptz;

create index if not exists ai_knowledge_sections_embedding_idx
  on public.ai_knowledge_sections using hnsw (embedding vector_cosine_ops);

-- 4. conversas vencedoras (few-shot dinâmico)
create table if not exists public.ai_winning_conversations (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid references public.consultants(id) on delete cascade,
  etapa text not null,
  snippet text not null,
  outcome text,
  embedding vector(1536),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.ai_winning_conversations to authenticated;
grant all on public.ai_winning_conversations to service_role;

alter table public.ai_winning_conversations enable row level security;

create policy "winning_conv admin manage"
  on public.ai_winning_conversations for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create index if not exists ai_winning_conversations_embedding_idx
  on public.ai_winning_conversations using hnsw (embedding vector_cosine_ops);

create index if not exists ai_winning_conversations_consultant_etapa_idx
  on public.ai_winning_conversations (consultant_id, etapa);

-- 5. updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists trg_winning_conv_updated_at on public.ai_winning_conversations;
create trigger trg_winning_conv_updated_at
  before update on public.ai_winning_conversations
  for each row execute function public.set_updated_at();

-- 6. RPC: match_knowledge (FAQ semântica)
create or replace function public.match_knowledge(
  p_consultant_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 3
)
returns table (
  id uuid,
  title text,
  content text,
  similarity float
)
language sql stable
security definer
set search_path = public
as $$
  select
    k.id,
    k.title,
    k.content,
    1 - (k.embedding <=> p_query_embedding) as similarity
  from public.ai_knowledge_sections k
  where k.is_active = true
    and k.embedding is not null
    and (k.consultant_id is null or k.consultant_id = p_consultant_id)
  order by k.embedding <=> p_query_embedding
  limit p_match_count;
$$;

grant execute on function public.match_knowledge(uuid, vector, int) to authenticated, service_role;

-- 7. RPC: match_winning (exemplos vencedores)
create or replace function public.match_winning(
  p_consultant_id uuid,
  p_etapa text,
  p_query_embedding vector(1536),
  p_match_count int default 2
)
returns table (
  id uuid,
  etapa text,
  snippet text,
  outcome text,
  similarity float
)
language sql stable
security definer
set search_path = public
as $$
  select
    w.id,
    w.etapa,
    w.snippet,
    w.outcome,
    1 - (w.embedding <=> p_query_embedding) as similarity
  from public.ai_winning_conversations w
  where w.embedding is not null
    and (p_consultant_id is null or w.consultant_id is null or w.consultant_id = p_consultant_id)
    and (p_etapa is null or w.etapa = p_etapa)
  order by w.embedding <=> p_query_embedding
  limit p_match_count;
$$;

grant execute on function public.match_winning(uuid, text, vector, int) to authenticated, service_role;
