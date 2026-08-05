-- Cota diária de disparo por consultor.
--
-- Antes: `daily_reheat_settings` tinha só a linha 'global' e o motor contava
-- os envios do dia sem separar por dono. Com dois consultores, quem o tick
-- processasse primeiro consumia os 200 envios e o outro ficava adiado para o
-- dia seguinte.
--
-- Agora a mesma tabela aceita uma linha por consultor (id = uuid do
-- consultor). Quem não tiver linha própria herda os valores da linha 'global'.
-- A linha 'global' passa a ter dois papéis: valores padrão de cada consultor e
-- teto do NÚMERO de WhatsApp compartilhado (trava anti-ban, aplicada por cima
-- da cota individual).
--
-- Nada é apagado: sem linha nova, o comportamento é idêntico ao anterior.

comment on table public.daily_reheat_settings is
  'Configuração de disparo. Linha id=''global'': padrão dos consultores + teto '
  'anti-ban do número compartilhado. Linha id=<uuid do consultor>: cota própria '
  'daquele consultor (cap_b / cap_c / cap_global_outreach).';

comment on column public.daily_reheat_settings.cap_global_outreach is
  'Na linha global: teto diário do número de WhatsApp (B+C somados, protege '
  'contra ban). Na linha de um consultor: teto diário daquele consultor.';

-- Índice para o lookup por consultor no tick (id é PK text, mas o motor
-- consulta por lista de ids num único round-trip).
create index if not exists daily_reheat_settings_id_idx
  on public.daily_reheat_settings (id);

-- Consulta o log do dia agrupado por consultor. O motor usava um SELECT amplo
-- e contava em memória; com vários consultores isso vira contagem por dono.
-- SECURITY INVOKER de propósito: quem chama é o service_role do cron.
create or replace function public.outreach_touches_today(p_stages text[])
returns table (consultant_id uuid, stage_group text, leads integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.consultant_id,
    -- `stage` é enum `cadence_stage`: sem cast não existe operador LIKE.
    case when l.stage::text like 'RECALL\_%' then 'C' else 'B' end as stage_group,
    count(distinct l.customer_id)::int as leads
  from public.cadence_action_log l
  where l.status = 'sent'
    and l.stage::text = any(p_stages)
    and l.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
                        at time zone 'America/Sao_Paulo'
  group by 1, 2;
$$;

revoke all on function public.outreach_touches_today(text[]) from public, anon;
grant execute on function public.outreach_touches_today(text[]) to service_role;
