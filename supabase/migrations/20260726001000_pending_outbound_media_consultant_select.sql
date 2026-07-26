-- Hub de Agendamentos lê a fila de mídia pendente no browser.
-- A tabela só tinha GRANT/policy para service_role → 403 no client autenticado.

GRANT SELECT ON TABLE public.pending_outbound_media TO authenticated;

DROP POLICY IF EXISTS pending_outbound_media_select_own ON public.pending_outbound_media;
CREATE POLICY pending_outbound_media_select_own
  ON public.pending_outbound_media
  FOR SELECT
  TO authenticated
  USING (
    consultant_id = auth.uid()
    OR COALESCE(public.is_super_admin(auth.uid()), false)
  );
