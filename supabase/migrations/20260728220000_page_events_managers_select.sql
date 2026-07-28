-- Paridade com page_views: gestores/dono leem eventos dos próprios links
DROP POLICY IF EXISTS "managers can read page events" ON public.page_events;
CREATE POLICY "managers can read page events"
  ON public.page_events FOR SELECT
  USING (public.can_view_consultant(auth.uid(), consultant_id));
