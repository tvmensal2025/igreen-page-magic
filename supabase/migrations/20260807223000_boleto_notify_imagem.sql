-- Aviso "boleto chegou": imagem opcional em mensagem própria.
-- Opt-in (default off), com legenda e posição escolhidas pelo consultor na UI —
-- sem precisar mexer em código para trocar arte, legenda ou ordem.

alter table boleto_notify_config
  add column if not exists send_image boolean not null default false,
  add column if not exists image_url text,
  add column if not exists image_caption text not null default '',
  add column if not exists image_position text not null default 'first';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'boleto_notify_config_image_position_chk'
  ) then
    alter table boleto_notify_config
      add constraint boleto_notify_config_image_position_chk
      check (image_position in ('first', 'after_audio', 'after_text', 'last'));
  end if;
end $$;

comment on column boleto_notify_config.send_image is
  'Enviar imagem no aviso de boleto (mensagem própria). Default off.';
comment on column boleto_notify_config.image_url is
  'URL https da imagem (upload pela UI ou link colado).';
comment on column boleto_notify_config.image_caption is
  'Legenda da imagem. Aceita as mesmas variáveis do texto ({{nome}}, {{mes}}…).';
comment on column boleto_notify_config.image_position is
  'first = antes do áudio · after_audio · after_text · last = depois dos apps.';
