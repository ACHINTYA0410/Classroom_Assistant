-- Enforce the same order for genuine attendance and the development shortcut.
-- Called by existing owned SECURITY DEFINER RPCs; no new privileged public API.
CREATE FUNCTION public.enforce_session_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.sessions target
  JOIN public.sessions earlier ON earlier.week_id = target.week_id
   AND earlier.order_index < target.order_index
  WHERE target.id = NEW.session_id
   AND NOT EXISTS (
    SELECT 1 FROM public.session_progress progress
    WHERE progress.student_id = NEW.student_id AND progress.session_id = earlier.id
     AND progress.status = 'completed'
   )
 ) THEN
  RAISE EXCEPTION 'Complete the earlier sessions in order before attending this lesson.' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enforce_session_order() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER session_progress_sequential_access
 BEFORE INSERT OR UPDATE ON public.session_progress
 FOR EACH ROW EXECUTE FUNCTION public.enforce_session_order();
