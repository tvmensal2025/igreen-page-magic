ALTER TABLE public.igreen_automation_settings
  ALTER COLUMN capture_boletos SET DEFAULT true,
  ALTER COLUMN capture_devolutivas SET DEFAULT true,
  ALTER COLUMN capture_telecom SET DEFAULT true,
  ALTER COLUMN capture_seguros SET DEFAULT true,
  ALTER COLUMN capture_cashback SET DEFAULT true,
  ALTER COLUMN alert_boletos_vencendo SET DEFAULT true,
  ALTER COLUMN alert_devolutivas SET DEFAULT true,
  ALTER COLUMN alert_licencas_expirando SET DEFAULT true;