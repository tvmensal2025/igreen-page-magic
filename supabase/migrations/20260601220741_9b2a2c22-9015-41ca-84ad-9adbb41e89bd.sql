-- Auto-cria crm_deal para todo novo lead WhatsApp/manual e faz backfill dos pendentes.

CREATE OR REPLACE FUNCTION public.create_lead_deal_on_customer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jid text;
BEGIN
  -- Só cria deal para leads (não para igreen_sync)
  IF NEW.customer_origin IS NOT NULL AND NEW.customer_origin NOT IN ('whatsapp_lead','manual') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_sandbox, false) OR COALESCE(NEW.is_test_lead, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.consultant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotência
  IF EXISTS (SELECT 1 FROM public.crm_deals WHERE customer_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_jid := CASE
    WHEN NEW.phone_whatsapp IS NOT NULL AND length(regexp_replace(NEW.phone_whatsapp, '\D', '', 'g')) >= 10
      THEN regexp_replace(NEW.phone_whatsapp, '\D', '', 'g') || '@s.whatsapp.net'
    ELSE NULL
  END;

  INSERT INTO public.crm_deals (consultant_id, customer_id, remote_jid, stage, deal_origin)
  VALUES (NEW.consultant_id, NEW.id, v_jid, 'novo_lead', 'whatsapp');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_lead_deal_on_customer_insert failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_lead_deal ON public.customers;
CREATE TRIGGER trg_create_lead_deal
AFTER INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.create_lead_deal_on_customer_insert();

-- Backfill: leads dos últimos 90 dias sem deal
INSERT INTO public.crm_deals (consultant_id, customer_id, remote_jid, stage, deal_origin, created_at)
SELECT
  c.consultant_id,
  c.id,
  CASE
    WHEN length(regexp_replace(coalesce(c.phone_whatsapp,''), '\D', '', 'g')) >= 10
      THEN regexp_replace(c.phone_whatsapp, '\D', '', 'g') || '@s.whatsapp.net'
    ELSE NULL
  END AS remote_jid,
  CASE c.conversation_step
    WHEN 'welcome' THEN 'novo_lead'
    WHEN 'aguardando_nome' THEN 'novo_lead'
    WHEN 'aguardando_valor_conta' THEN 'qualificando'
    WHEN 'aguardando_conta' THEN 'valor_conta'
    WHEN 'aguardando_doc_auto' THEN 'conta_enviada'
    WHEN 'aguardando_documento' THEN 'conta_enviada'
    WHEN 'confirmando_dados_conta' THEN 'doc_enviado'
    WHEN 'confirmando_dados' THEN 'doc_enviado'
    WHEN 'ask_email' THEN 'doc_enviado'
    WHEN 'ask_phone_confirm' THEN 'doc_enviado'
    WHEN 'finalizando' THEN 'finalizando'
    WHEN 'finalizando_cadastro' THEN 'finalizando'
    WHEN 'portal_submitting' THEN 'finalizando'
    WHEN 'aguardando_otp' THEN 'finalizando'
    ELSE 'novo_lead'
  END AS stage,
  'whatsapp' AS deal_origin,
  c.created_at
FROM public.customers c
WHERE c.consultant_id IS NOT NULL
  AND (c.customer_origin IS NULL OR c.customer_origin IN ('whatsapp_lead','manual'))
  AND COALESCE(c.is_sandbox, false) = false
  AND COALESCE(c.is_test_lead, false) = false
  AND c.created_at >= now() - interval '90 days'
  AND NOT EXISTS (SELECT 1 FROM public.crm_deals d WHERE d.customer_id = c.id);
