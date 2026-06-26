-- Corrige o alerta de segurança: search_path mutável na função de trigger.
create or replace function public.tg_captured_leads_touch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
