-- Atribuição por QR/keyword do parceiro sobrevive ao guard de AD ID do Meta.
--
-- PROBLEMA REAL (parceiro José, 2026-08-05)
-- ----------------------------------------
-- O guard `enforce_customer_meta_ad_campaign_guard` exige que, quando o lead tem
-- `source_ad_id` de uma campanha conhecida, o `referral_partner_id` pertença à
-- pool de rodízio DAQUELA campanha. Faz sentido para rodízio.
-- Mas parceiro indicador de QR/keyword NUNCA está em pool de rodízio nenhuma.
-- Resultado: se o lead do parceiro ganhasse `source_ad_id`/`source_campaign_id`
-- depois (reconcile de sinal forte do Meta, `bindCustomerCampaign`,
-- `update-lead-origin`), o trigger fazia `NEW.referral_partner_id := NULL`
-- em SILÊNCIO — ou lançava 23514 e o webhook só logava `console.warn`.
-- O parceiro perdia o lead sem nenhum rastro visível.
--
-- REGRA NOVA
-- ----------
-- Se `referral_keyword_matched` é comprovadamente uma marca DO PRÓPRIO parceiro
-- atribuído (keyword cadastrada nele, keyword de um local/banner dele, ou o
-- marcador `#R{short_code}` dele), a atribuição é evidência DIRETA colhida da
-- mensagem do lead — mais forte que a inferência por AD ID. Nesse caso o guard
-- não exige pertencimento a pool e preserva o parceiro.
--
-- Não afrouxa nada além disso: parceiro de OUTRA pool continua sendo limpo /
-- barrado, e a correção de `source_campaign_id` pelo AD ID forte segue igual.
-- Rodízio nunca grava `referral_keyword_matched`, então rodízio segue intacto.

CREATE OR REPLACE FUNCTION public.enforce_customer_meta_ad_campaign_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_partner_is_member boolean := false;
  v_partner_changed boolean := false;
  v_source_or_campaign_changed boolean := false;
  v_keyword_is_own boolean := false;
  v_keyword text;
BEGIN
  IF NEW.source_ad_id IS NULL OR btrim(NEW.source_ad_id::text) = '' OR NEW.consultant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Meta AD IDs podem estar no jsonb como string OU número. jsonb @> com texto
  -- falha quando o array guarda número; jsonb_array_elements_text normaliza ambos.
  SELECT fc.id
    INTO v_campaign_id
  FROM public.facebook_campaigns fc
  WHERE fc.consultant_id = NEW.consultant_id
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(fc.fb_ad_ids) = 'array' THEN fc.fb_ad_ids
          WHEN fc.fb_ad_ids IS NULL THEN '[]'::jsonb
          ELSE jsonb_build_array(fc.fb_ad_ids)
        END
      ) AS ad(value)
      WHERE btrim(ad.value) = btrim(NEW.source_ad_id::text)
    )
  ORDER BY
    CASE fc.status
      WHEN 'active' THEN 0
      WHEN 'pending_review' THEN 1
      WHEN 'paused' THEN 2
      ELSE 3
    END,
    COALESCE(fc.updated_at, fc.created_at) DESC
  LIMIT 1;

  -- Se ainda não temos a campanha cadastrada para esse AD ID, não chuta.
  IF v_campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_partner_changed := TG_OP = 'INSERT' OR OLD.referral_partner_id IS DISTINCT FROM NEW.referral_partner_id;
  v_source_or_campaign_changed := TG_OP = 'INSERT'
    OR OLD.source_ad_id IS DISTINCT FROM NEW.source_ad_id
    OR OLD.source_campaign_id IS DISTINCT FROM NEW.source_campaign_id;

  -- AD ID forte manda na campanha. Nenhum fallback pode manter outra campanha.
  IF NEW.source_campaign_id IS DISTINCT FROM v_campaign_id THEN
    NEW.source_campaign_id := v_campaign_id;
    NEW.lead_source := to_jsonb('meta_ads'::text);
    NEW.needs_manual_review := false;
    IF NEW.manual_review_reason IN ('campaign_ad_id_mismatch', 'strong_meta_unmapped') THEN
      NEW.manual_review_reason := NULL;
    END IF;
  END IF;

  -- A atribuição veio do QR/keyword DO PRÓPRIO parceiro? Então é evidência
  -- direta na mensagem do lead e o pertencimento a pool não se aplica.
  v_keyword := nullif(btrim(coalesce(NEW.referral_keyword_matched, '')), '');
  IF NEW.referral_partner_id IS NOT NULL AND v_keyword IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.referral_partners rp
      WHERE rp.id = NEW.referral_partner_id
        AND (
          -- marcador determinístico `#R{short_code}` (QR antigo já impresso)
          lower(v_keyword) = lower('#R' || coalesce(rp.short_code, ''))
          -- keyword cadastrada no parceiro
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(rp.keywords, ARRAY[]::text[])) AS k(v)
            WHERE lower(btrim(k.v)) = lower(v_keyword)
          )
          -- keyword de um local/banner do parceiro
          OR EXISTS (
            SELECT 1
            FROM public.referral_partner_banner_spots s
            WHERE s.partner_id = rp.id
              AND lower(btrim(coalesce(s.keyword, ''))) = lower(v_keyword)
          )
        )
    ) INTO v_keyword_is_own;
  END IF;

  -- Com AD ID forte, parceiro precisa pertencer à pool da campanha (ativa ou pausada).
  -- is_active só governa o rodízio automático — não a regra de pertencimento.
  -- EXCEÇÃO: atribuição por QR/keyword do próprio parceiro (v_keyword_is_own).
  IF NEW.referral_partner_id IS NOT NULL AND NOT v_keyword_is_own THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.rodizio_pools p
      JOIN public.rodizio_pool_members m ON m.pool_id = p.id
      WHERE p.campaign_id = v_campaign_id
        AND m.partner_id = NEW.referral_partner_id
    ) INTO v_partner_is_member;

    IF NOT v_partner_is_member THEN
      -- Se o AD ID/campanha está chegando junto ou corrigindo atribuição antiga,
      -- limpa o parceiro errado para o webhook recalcular ou mandar para revisão.
      IF v_source_or_campaign_changed OR NOT v_partner_changed THEN
        NEW.referral_partner_id := NULL;
        NEW.referral_detected_at := NULL;
      ELSE
        RAISE EXCEPTION 'campaign_ad_id_mismatch: source_ad_id % belongs to campaign %, partner % is not in that campaign pool',
          NEW.source_ad_id, v_campaign_id, NEW.referral_partner_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_customer_meta_ad_campaign_guard() IS
  'Guard AD ID Meta -> campanha/pool. Preserva atribuição de parceiro feita por QR/keyword própria (referral_keyword_matched pertence ao parceiro), que nunca está em pool de rodízio.';
