
CREATE OR REPLACE FUNCTION public.clear_attendance_auto_close_on_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET attendance_auto_close_at = NULL,
           attendance_auto_close_source = NULL
     WHERE id = NEW.customer_id
       AND attendance_auto_close_at IS NOT NULL
       AND attendance_rating_requested_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_attendance_auto_close_on_inbound ON public.conversations;
CREATE TRIGGER trg_clear_attendance_auto_close_on_inbound
AFTER INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.clear_attendance_auto_close_on_inbound();
