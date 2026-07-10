-- Religa leads do rodízio Uberlândia sem campaign_match_log (órfãos após unmix).
-- NÃO preenche source_campaign_id / meta_ads — só vínculo para contagem do parceiro.

INSERT INTO public.campaign_match_log (customer_id, campaign_id, method, message_sample)
SELECT v.customer_id,
       'ce44a165-d380-4934-8dee-c9e1c9114775'::uuid,
       'rodizio_next',
       '[relink_orphan_rodizio] pool Uberlândia — vínculo restaurado p/ contagem do parceiro'
FROM (VALUES
  ('f68d78ab-5e5c-4166-95ba-274e41a58493'::uuid), -- morvanamaral / Francisco
  ('3ab5d189-b1bc-4179-a071-7187e64b8a74'::uuid), -- Meire Vailant / Abel
  ('e26bfc76-82ff-49c4-8566-95192e3cff50'::uuid)  -- De Santa Luzia / Abel
) AS v(customer_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.campaign_match_log l
  WHERE l.customer_id = v.customer_id
    AND l.campaign_id = 'ce44a165-d380-4934-8dee-c9e1c9114775'
);
