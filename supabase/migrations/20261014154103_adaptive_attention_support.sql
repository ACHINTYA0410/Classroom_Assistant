-- Backend-only snapshots and atomic offers; no biometric collection or model calls.
CREATE TABLE public.attention_section_visits (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES public.profiles(id),
 section_id uuid NOT NULL REFERENCES public.session_sections(id),
 session_id uuid NOT NULL REFERENCES public.sessions(id),
 visible_seconds integer NOT NULL DEFAULT 0 CHECK(visible_seconds BETWEEN 0 AND 86400),
 continuous_seconds integer NOT NULL DEFAULT 0 CHECK(continuous_seconds BETWEEN 0 AND 86400), last_break_at timestamptz,
 finished boolean NOT NULL DEFAULT false, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX attention_visits_student_section ON public.attention_section_visits(student_id,section_id,updated_at DESC);
CREATE INDEX attention_visits_student_session ON public.attention_section_visits(student_id,session_id);
ALTER TABLE public.attention_section_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY attention_visits_own_read ON public.attention_section_visits FOR SELECT TO authenticated
 USING(student_id=(SELECT auth.uid()));
REVOKE ALL ON public.attention_section_visits FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.attention_section_visits TO authenticated;
GRANT ALL ON public.attention_section_visits TO service_role;
ALTER TABLE public.attention_events ADD COLUMN signals_snapshot jsonb NOT NULL DEFAULT '{}';

CREATE FUNCTION public.attention_context(p_student uuid,p_section_id uuid,p_visit_id uuid,p_visible_seconds integer,p_finished boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE section record; progress public.session_progress; visit public.attention_section_visits;
 last_event public.attention_events; pending public.attention_events; delta integer; increase integer; baseline jsonb; wrong integer; last_break timestamptz;
BEGIN
 SELECT ss.*,s.topic_id,s.topic_name,s.title INTO section FROM public.session_sections ss
 JOIN public.sessions s ON s.id=ss.session_id JOIN public.weeks w ON w.id=s.week_id
 JOIN public.chapters c ON c.id=w.chapter_id JOIN public.profiles u ON u.id=p_student AND u.grade_level=c.grade_level
 WHERE ss.id=p_section_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Section not owned' USING ERRCODE='42501'; END IF;
 SELECT * INTO progress FROM public.session_progress WHERE student_id=p_student AND session_id=section.session_id;
 IF progress.id IS NULL OR progress.status<>'in_progress' OR progress.completed_via<>'lesson_flow' THEN
  RETURN jsonb_build_object('blocked','No active real lesson.'); END IF;
 IF EXISTS(SELECT 1 FROM public.sessions earlier JOIN public.sessions target ON target.id=section.session_id
  WHERE earlier.week_id=target.week_id AND earlier.order_index<target.order_index AND NOT EXISTS(
   SELECT 1 FROM public.session_progress sp WHERE sp.student_id=p_student AND sp.session_id=earlier.id AND sp.status='completed'))
 THEN RETURN jsonb_build_object('blocked','Earlier lessons must be completed.'); END IF;
 IF EXISTS(SELECT 1 FROM public.break_records WHERE student_id=p_student AND break_end IS NULL
  AND clock_timestamp()<break_start+make_interval(secs=>allowed_seconds))
 OR EXISTS(SELECT 1 FROM public.quiz_attempts WHERE student_id=p_student AND status='in_progress'
  AND clock_timestamp()<started_at+make_interval(secs=>time_limit_seconds))
 THEN RETURN jsonb_build_object('blocked','A break or assessment is active.'); END IF;
 IF p_visible_seconds NOT BETWEEN 0 AND 86400 THEN RAISE EXCEPTION 'Invalid section time'; END IF;
 -- Lock per student, including simultaneous tabs, to keep visit updates monotonic.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_student::text||':attention',0));
 SELECT * INTO visit FROM public.attention_section_visits WHERE id=p_visit_id FOR UPDATE;
 IF visit.id IS NOT NULL AND (visit.student_id<>p_student OR visit.section_id<>p_section_id) THEN
  RAISE EXCEPTION 'Visit not owned' USING ERRCODE='42501'; END IF;
 IF visit.id IS NULL THEN
  INSERT INTO public.attention_section_visits(id,student_id,section_id,session_id)
  VALUES(p_visit_id,p_student,p_section_id,section.session_id) RETURNING * INTO visit;
 END IF;
 delta:=LEAST(30,GREATEST(0,floor(extract(epoch FROM clock_timestamp()-visit.updated_at))::integer));
 increase:=GREATEST(0,LEAST(p_visible_seconds,visit.visible_seconds+delta)-visit.visible_seconds);
 SELECT max(break_end) INTO last_break FROM public.break_records WHERE student_id=p_student AND session_progress_id=progress.id;
 IF NOT visit.finished THEN
  UPDATE public.attention_section_visits SET
   visible_seconds=GREATEST(visible_seconds,LEAST(p_visible_seconds,visible_seconds+delta)),
   continuous_seconds=CASE WHEN last_break IS DISTINCT FROM last_break_at THEN increase ELSE continuous_seconds+increase END,
   last_break_at=last_break,
   finished=p_finished,updated_at=clock_timestamp() WHERE id=visit.id RETURNING * INTO visit;
 END IF;
 IF p_finished THEN
  -- A late offer must not follow the student into a different section.
  UPDATE public.attention_events SET outcome='skipped',answered_at=clock_timestamp(),
   response_time_seconds=GREATEST(0,extract(epoch FROM clock_timestamp()-shown_at))
  WHERE student_id=p_student AND section_id=p_section_id AND outcome IS NULL;
 END IF;
 -- Compare this student's completed sections with the same section type and topic.
 -- Aggregate repeated visits of a section; exclude testing provenance.
 SELECT COALESCE(jsonb_agg(seconds),'[]') INTO baseline FROM (
  SELECT sum(v.visible_seconds) AS seconds FROM public.attention_section_visits v
  JOIN public.session_sections ss ON ss.id=v.section_id JOIN public.sessions s ON s.id=v.session_id
  JOIN public.session_progress sp ON sp.student_id=v.student_id AND sp.session_id=v.session_id
  WHERE v.student_id=p_student AND v.section_id<>p_section_id AND ss.section_type=section.section_type
   AND s.topic_id IS NOT DISTINCT FROM section.topic_id AND sp.completed_via='lesson_flow'
  GROUP BY v.section_id HAVING bool_or(v.finished) AND sum(v.visible_seconds) BETWEEN 15 AND 1800
  ORDER BY max(v.updated_at) DESC LIMIT 30
 ) samples;
 SELECT COALESCE(sum(wrong_attempts),0)::integer INTO wrong FROM (
  SELECT r.wrong_attempts FROM public.session_responses r WHERE r.student_id=p_student
   AND r.session_id=section.session_id AND r.created_at>clock_timestamp()-interval '10 minutes'
  ORDER BY r.created_at DESC LIMIT 3
 ) recent;
 SELECT * INTO last_event FROM public.attention_events WHERE student_id=p_student AND session_id=section.session_id ORDER BY shown_at DESC LIMIT 1;
 SELECT * INTO pending FROM public.attention_events WHERE student_id=p_student AND section_id=p_section_id
  AND outcome IS NULL AND shown_at>clock_timestamp()-interval '10 minutes' ORDER BY shown_at DESC LIMIT 1;
 RETURN jsonb_build_object('section',to_jsonb(section),'visible_seconds',visit.visible_seconds,'baseline_seconds',baseline,
  'recent_wrong_attempts',wrong,'continuous_seconds',(SELECT COALESCE(sum(continuous_seconds),0)
   FROM public.attention_section_visits WHERE student_id=p_student AND session_id=section.session_id AND last_break_at IS NOT DISTINCT FROM last_break),
  'session_prompt_count',(SELECT count(*) FROM public.attention_events WHERE student_id=p_student AND session_id=section.session_id),
  'daily_prompt_count',(SELECT count(*) FROM public.attention_events WHERE student_id=p_student AND shown_at>clock_timestamp()-interval '24 hours'),
  'seconds_since_prompt',extract(epoch FROM clock_timestamp()-GREATEST(last_event.shown_at,last_event.answered_at)),
  'last_outcome',last_event.outcome,'pending_event',CASE WHEN pending.id IS NULL THEN NULL ELSE to_jsonb(pending) END);
END $$;

CREATE FUNCTION public.offer_attention(p_student uuid,p_section_id uuid,p_visit_id uuid,p_reason text,p_question_type text,p_payload jsonb,p_signals jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE visit public.attention_section_visits; event public.attention_events; last_event public.attention_events; cooldown integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_student::text||':attention',0));
 SELECT v.* INTO visit FROM public.attention_section_visits v JOIN public.session_progress sp
  ON sp.student_id=v.student_id AND sp.session_id=v.session_id AND sp.status='in_progress' AND sp.completed_via='lesson_flow'
 WHERE v.id=p_visit_id AND v.student_id=p_student AND v.section_id=p_section_id AND NOT v.finished
  AND v.updated_at>clock_timestamp()-interval '40 seconds';
 IF visit.id IS NULL THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.break_records WHERE student_id=p_student AND break_end IS NULL
  AND clock_timestamp()<break_start+make_interval(secs=>allowed_seconds))
 OR EXISTS(SELECT 1 FROM public.quiz_attempts WHERE student_id=p_student AND status='in_progress'
  AND clock_timestamp()<started_at+make_interval(secs=>time_limit_seconds)) THEN RETURN NULL; END IF;
 SELECT * INTO event FROM public.attention_events WHERE student_id=p_student AND section_id=p_section_id
  AND outcome IS NULL AND shown_at>clock_timestamp()-interval '10 minutes' ORDER BY shown_at DESC LIMIT 1;
 IF event.id IS NOT NULL THEN RETURN to_jsonb(event); END IF;
 -- Do not stack a second prompt over an outstanding prompt from another section/tab.
 IF EXISTS(SELECT 1 FROM public.attention_events WHERE student_id=p_student AND outcome IS NULL
  AND shown_at>clock_timestamp()-interval '10 minutes') THEN RETURN NULL; END IF;
 SELECT * INTO last_event FROM public.attention_events WHERE student_id=p_student AND session_id=visit.session_id ORDER BY shown_at DESC LIMIT 1;
 cooldown:=CASE WHEN last_event.outcome='skipped' THEN 240 ELSE 120 END;
 IF last_event.id IS NOT NULL AND clock_timestamp()-GREATEST(last_event.shown_at,last_event.answered_at)<make_interval(secs=>cooldown)
 OR (SELECT count(*) FROM public.attention_events WHERE student_id=p_student AND session_id=visit.session_id)>=3
 OR (SELECT count(*) FROM public.attention_events WHERE student_id=p_student AND shown_at>clock_timestamp()-interval '24 hours')>=8
 THEN RETURN NULL; END IF;
 INSERT INTO public.attention_events(student_id,session_id,section_id,trigger_reason,question_type,question_payload,signals_snapshot)
 VALUES(p_student,visit.session_id,p_section_id,p_reason,p_question_type,p_payload||jsonb_build_object('active_seconds',
  (SELECT total_active_seconds FROM public.session_progress WHERE student_id=p_student AND session_id=visit.session_id)),p_signals)
 RETURNING * INTO event;
 RETURN to_jsonb(event);
END $$;

REVOKE ALL ON FUNCTION public.attention_context(uuid,uuid,uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.offer_attention(uuid,uuid,uuid,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attention_context(uuid,uuid,uuid,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.offer_attention(uuid,uuid,uuid,text,text,jsonb,jsonb) TO service_role;
