CREATE UNIQUE INDEX IF NOT EXISTS referral_partners_nome_igreen_uidx
ON public.referral_partners (consultant_id, lower(nome), partner_igreen_id)
WHERE partner_igreen_id IS NOT NULL;