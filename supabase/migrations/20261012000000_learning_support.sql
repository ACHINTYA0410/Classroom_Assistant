-- Forward-only learning support update. Do not replay historical seeds.
BEGIN;
ALTER TABLE public.session_progress ADD COLUMN completed_via text NOT NULL DEFAULT 'lesson_flow'
 CHECK (completed_via IN ('lesson_flow','calendar_test_shortcut'));
ALTER TABLE public.session_progress ADD COLUMN active_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.session_responses ADD COLUMN wrong_attempts integer NOT NULL DEFAULT 0 CHECK(wrong_attempts>=0);
ALTER TABLE public.session_responses ADD COLUMN answer_revealed boolean NOT NULL DEFAULT false;
ALTER TABLE public.session_responses ADD COLUMN attempts_before_reveal integer;
ALTER TABLE public.session_responses ADD COLUMN revealed_at timestamptz;
ALTER TABLE public.session_responses ADD COLUMN selected_answer numeric;
ALTER TABLE public.session_sections ADD COLUMN worked_explanation text;
ALTER TABLE public.break_records ADD COLUMN student_id uuid REFERENCES public.profiles(id);
UPDATE public.break_records b SET student_id=p.student_id FROM public.session_progress p WHERE p.id=b.session_progress_id;
ALTER TABLE public.break_records ALTER COLUMN student_id SET NOT NULL;
ALTER TABLE public.break_records ADD COLUMN allowed_seconds integer NOT NULL DEFAULT 300
 CHECK(allowed_seconds BETWEEN 300 AND 600 AND allowed_seconds%30=0);
ALTER TABLE public.break_records ADD COLUMN ended_reason text
 CHECK(ended_reason IN ('resumed_early','timeout','expired_while_away'));
ALTER TABLE public.break_records ADD COLUMN agent_decision_id uuid REFERENCES public.agent_decisions(id);
ALTER TABLE public.break_records ADD COLUMN activities jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(activities)='array');
-- Abort rather than silently reconcile duplicate historical open breaks.
CREATE UNIQUE INDEX one_open_break_per_student ON public.break_records(student_id) WHERE break_end IS NULL;
CREATE TABLE public.attention_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid NOT NULL REFERENCES public.profiles(id),
 session_id uuid NOT NULL REFERENCES public.sessions(id), section_id uuid NOT NULL REFERENCES public.session_sections(id),
 trigger_reason text NOT NULL, question_type text NOT NULL, question_payload jsonb NOT NULL,
 shown_at timestamptz NOT NULL DEFAULT clock_timestamp(), answered_at timestamptz,
 response numeric, is_correct boolean, response_time_seconds numeric,
 outcome text CHECK(outcome IN ('answered','skipped'))
);
CREATE INDEX attention_student_session ON public.attention_events(student_id,session_id,shown_at);
ALTER TABLE public.attention_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY attention_own_read ON public.attention_events FOR SELECT TO authenticated USING(student_id=auth.uid());
CREATE POLICY attention_own_insert ON public.attention_events FOR INSERT TO authenticated WITH CHECK(student_id=auth.uid());
CREATE POLICY attention_own_update ON public.attention_events FOR UPDATE TO authenticated USING(student_id=auth.uid()) WITH CHECK(student_id=auth.uid());
GRANT SELECT ON public.attention_events TO authenticated;
GRANT ALL ON public.attention_events TO service_role;
-- Lifecycle fields are writable only through owned RPCs; direct mutation is revoked.
REVOKE INSERT,UPDATE,DELETE ON public.session_progress,public.break_records FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.increment_break_count(uuid) FROM PUBLIC,anon,authenticated;
COMMENT ON COLUMN public.profiles.streak_days IS 'Deprecated; retained for data compatibility, unused by application.';

CREATE FUNCTION public.break_allowance(signals jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT LEAST(600,300
 +30*LEAST(4,GREATEST(0,COALESCE((signals->>'wrong_attempts')::int,0)))
 +30*LEAST(2,GREATEST(0,COALESCE((signals->>'reveals')::int,0)))
 +CASE WHEN (signals->>'practice_accuracy')::numeric<60 THEN 60
       WHEN (signals->>'practice_accuracy')::numeric<85 THEN 30 ELSE 0 END
 +30*LEAST(3,GREATEST(0,COALESCE((signals->>'popup_misses')::int,0)))
 +CASE WHEN COALESCE((signals->>'since_break_seconds')::int,0)>=1200 THEN 60
       WHEN COALESCE((signals->>'since_break_seconds')::int,0)>=600 THEN 30 ELSE 0 END
 +CASE WHEN COALESCE((signals->>'active_seconds')::int,0)>=1800 THEN 30 ELSE 0 END
 +30*LEAST(3,GREATEST(0,COALESCE((signals->>'breaks_today')::int,0))));
$$;

CREATE FUNCTION public.expire_learning_break(p_student uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.break_records;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('learning:'||p_student::text,0));
 SELECT * INTO b FROM public.break_records WHERE student_id=p_student AND break_end IS NULL FOR UPDATE;
 IF FOUND AND clock_timestamp()>=b.break_start+make_interval(secs=>b.allowed_seconds) THEN
  UPDATE public.break_records SET break_end=break_start+make_interval(secs=>allowed_seconds),
   duration_seconds=allowed_seconds,ended_reason='expired_while_away' WHERE id=b.id;
  UPDATE public.session_progress SET active_updated_at=clock_timestamp() WHERE id=b.session_progress_id;
  INSERT INTO public.agent_decisions(student_id,agent_name,decision_type,linked_entity_id,input_snapshot,output,reasoning_summary)
   VALUES(p_student,'teaching_agent','break_expired',b.id,jsonb_build_object('allowed_seconds',b.allowed_seconds),
    jsonb_build_object('ended_reason','expired_while_away','duration_seconds',b.allowed_seconds),'Closed an expired break exactly at its server deadline.');
 END IF;
END $$;


CREATE FUNCTION public.learning_progress(p_session_id uuid,p_total_seconds integer DEFAULT NULL,p_complete boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.session_progress; max_delta int;
BEGIN
 PERFORM public.assert_learning_available(auth.uid());
 IF NOT EXISTS(SELECT 1 FROM public.sessions s JOIN public.weeks w ON w.id=s.week_id
  JOIN public.chapters c ON c.id=w.chapter_id JOIN public.profiles u ON u.id=auth.uid() AND u.grade_level=c.grade_level WHERE s.id=p_session_id)
 THEN RAISE EXCEPTION 'Session not owned' USING ERRCODE='42501'; END IF;
 INSERT INTO public.session_progress(student_id,session_id,status,started_at)
  VALUES(auth.uid(),p_session_id,'in_progress',clock_timestamp()) ON CONFLICT(student_id,session_id) DO NOTHING;
 SELECT * INTO p FROM public.session_progress WHERE student_id=auth.uid() AND session_id=p_session_id FOR UPDATE;
 IF p_total_seconds IS NULL THEN
  UPDATE public.session_progress SET active_updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
 END IF;
 IF p_total_seconds IS NOT NULL THEN
  max_delta:=GREATEST(0,floor(extract(epoch FROM clock_timestamp()-p.active_updated_at))::int);
  UPDATE public.session_progress SET total_active_seconds=GREATEST(total_active_seconds,
   LEAST(GREATEST(0,p_total_seconds),total_active_seconds+max_delta)),
   active_updated_at=active_updated_at+make_interval(secs=>GREATEST(0,LEAST(GREATEST(0,p_total_seconds),total_active_seconds+max_delta)-total_active_seconds)),
   status=CASE WHEN p_complete THEN 'completed' ELSE status END,
   completed_at=CASE WHEN p_complete THEN COALESCE(completed_at,clock_timestamp()) ELSE completed_at END,completed_via='lesson_flow'
   WHERE id=p.id RETURNING * INTO p;
 END IF;
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.calendar_test_complete(p_student uuid,p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.session_progress;
BEGIN
 PERFORM public.assert_learning_available(p_student);
 IF NOT EXISTS(SELECT 1 FROM public.sessions s JOIN public.weeks w ON w.id=s.week_id
  JOIN public.chapters c ON c.id=w.chapter_id JOIN public.profiles u ON u.id=p_student AND u.grade_level=c.grade_level WHERE s.id=p_session_id)
 THEN RAISE EXCEPTION 'Session not owned' USING ERRCODE='42501'; END IF;
 INSERT INTO public.session_progress(student_id,session_id,status,started_at,completed_at,completed_via,total_active_seconds)
  VALUES(p_student,p_session_id,'completed',clock_timestamp(),clock_timestamp(),'calendar_test_shortcut',0)
 ON CONFLICT(student_id,session_id) DO UPDATE SET status='completed',completed_at=clock_timestamp(),
  completed_via=CASE WHEN session_progress.status='completed' AND session_progress.completed_via='lesson_flow' THEN 'lesson_flow' ELSE 'calendar_test_shortcut' END
 RETURNING * INTO p;
 PERFORM public.refresh_student_progress_internal(p_student);
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.practice_state(p_section_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.session_responses;
BEGIN
 SELECT * INTO r FROM public.session_responses WHERE student_id=auth.uid() AND section_id=p_section_id;
 RETURN jsonb_build_object('attempts',COALESCE(r.attempts,0),'wrongAttempts',COALESCE(r.wrong_attempts,0),
  'answerRevealed',COALESCE(r.answer_revealed,false),'isCorrect',COALESCE(r.is_correct,false),'canReveal',COALESCE(r.wrong_attempts,0)>=2);
END $$;

CREATE OR REPLACE FUNCTION public.record_practice_answer(p_section_id uuid,p_answer numeric,p_attempts int,p_seconds int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.session_sections; r public.session_responses; correct boolean;
BEGIN
 PERFORM public.assert_learning_available(auth.uid());
 SELECT ss.* INTO s FROM public.session_sections ss JOIN public.sessions l ON l.id=ss.session_id JOIN public.weeks w ON w.id=l.week_id
  JOIN public.chapters c ON c.id=w.chapter_id JOIN public.profiles u ON u.id=auth.uid() AND u.grade_level=c.grade_level
  WHERE ss.id=p_section_id AND ss.section_type='practice' AND ss.correct_answer IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Practice unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.session_progress WHERE student_id=auth.uid() AND session_id=s.session_id AND completed_via='lesson_flow') THEN
  RAISE EXCEPTION 'Start a real lesson before practice'; END IF;
 SELECT * INTO r FROM public.session_responses WHERE student_id=auth.uid() AND section_id=s.id FOR UPDATE;
 IF r.is_correct OR r.answer_revealed THEN RETURN public.practice_state(s.id)||jsonb_build_object('explanation','This practice question is already complete.'); END IF;
 -- The supplied legacy attempts field is ignored; SQL counts real submissions.
 correct:=p_answer=s.correct_answer;
 INSERT INTO public.session_responses(student_id,session_id,section_id,response_type,is_correct,attempts,wrong_attempts,time_taken_seconds,selected_answer)
  VALUES(auth.uid(),s.session_id,s.id,'practice',correct,1,CASE WHEN correct THEN 0 ELSE 1 END,GREATEST(0,LEAST(86400,p_seconds)),p_answer)
 ON CONFLICT(student_id,section_id) DO UPDATE SET is_correct=excluded.is_correct,attempts=session_responses.attempts+1,
  wrong_attempts=session_responses.wrong_attempts+CASE WHEN excluded.is_correct THEN 0 ELSE 1 END,
  time_taken_seconds=excluded.time_taken_seconds,selected_answer=excluded.selected_answer;
 PERFORM public.refresh_student_progress();
 RETURN public.practice_state(s.id)||jsonb_build_object('explanation',CASE WHEN correct THEN 'Excellent! You got it right.' ELSE 'Try the ones first, then the tens.' END);
END $$;

CREATE FUNCTION public.reveal_practice_answer(p_section_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.session_responses; s public.session_sections; parts text[]; a int; b int; ones int; carry int; tens int; explanation text;
BEGIN
 PERFORM public.assert_learning_available(auth.uid());
 SELECT * INTO r FROM public.session_responses WHERE student_id=auth.uid() AND section_id=p_section_id FOR UPDATE;
 IF NOT FOUND OR r.wrong_attempts<2 OR (r.is_correct AND NOT r.answer_revealed) THEN RAISE EXCEPTION 'Two wrong attempts are required'; END IF;
 SELECT * INTO s FROM public.session_sections WHERE id=p_section_id;
 parts:=regexp_match(s.question_prompt,'([0-9]+)\s*[+]\s*([0-9]+)');
 IF s.worked_explanation IS NOT NULL THEN explanation:=s.worked_explanation;
 ELSIF parts IS NOT NULL AND parts[1]::int+parts[2]::int=s.correct_answer THEN
  a:=parts[1]::int; b:=parts[2]::int; ones:=a%10+b%10; carry:=ones/10; tens:=a/10+b/10+carry;
  explanation:=format('Ones: %s + %s = %s. Write %s in the ones column. Carry %s ten. Tens: %s + %s + %s = %s. Result: %s.',
   a%10,b%10,ones,ones%10,carry,a/10,b/10,carry,tens,s.correct_answer);
 ELSE explanation:=COALESCE(s.content,'Use the worked example for this question.')||format(' The answer is %s.',s.correct_answer); END IF;
 UPDATE public.session_responses SET answer_revealed=true,is_correct=false,
  attempts_before_reveal=COALESCE(attempts_before_reveal,attempts),revealed_at=COALESCE(revealed_at,clock_timestamp()) WHERE id=r.id;
 PERFORM public.refresh_student_progress();
 RETURN public.practice_state(s.id)||jsonb_build_object('answer',s.correct_answer,'explanation',explanation);
END $$;

CREATE FUNCTION public.refresh_student_progress_internal(p_student uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE student uuid:=p_student;
BEGIN
 IF student IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 WITH responses AS (
 SELECT t.topic_id,r.is_correct,r.misconception_tag,false AS supported FROM public.quiz_responses r
  JOIN public.quiz_attempts a ON a.id=r.quiz_attempt_id JOIN public.quiz_attempt_questions q ON q.id=r.question_id
  JOIN public.questions t ON t.id=q.template_id WHERE a.student_id=student AND a.status='completed'
 UNION ALL SELECT s.topic_id,r.is_correct AND NOT r.answer_revealed AND r.wrong_attempts<2,r.misconception_tag,
  r.answer_revealed OR r.wrong_attempts>=2 FROM public.session_responses r JOIN public.sessions s ON s.id=r.session_id
  JOIN public.session_progress p ON p.session_id=r.session_id AND p.student_id=r.student_id
  WHERE r.student_id=student AND s.topic_id IS NOT NULL AND p.completed_via='lesson_flow'
 ), totals AS (SELECT topic_id,count(*) n,100.0*count(*) FILTER(WHERE is_correct)/count(*) accuracy,bool_or(supported) supported FROM responses GROUP BY topic_id),
 mistakes AS (SELECT topic_id,misconception_tag,count(*) n,row_number() OVER(PARTITION BY topic_id ORDER BY count(*) DESC,misconception_tag) ranking
 FROM responses WHERE NOT is_correct AND misconception_tag IS NOT NULL GROUP BY topic_id,misconception_tag)
 INSERT INTO public.student_progress(student_id,topic_id,topic_name,mastery_status,primary_misconception_tag,last_updated)
 SELECT student,t.topic_id,COALESCE((SELECT topic_name FROM public.sessions WHERE topic_id=t.topic_id AND topic_name IS NOT NULL LIMIT 1),t.topic_id),
 CASE WHEN t.supported OR t.accuracy<60 OR COALESCE(m.n,0)>=2 THEN 'weak' WHEN t.accuracy>=85 AND t.n>=3 THEN 'mastered' ELSE 'in_progress' END,
 m.misconception_tag,now() FROM totals t LEFT JOIN mistakes m ON m.topic_id=t.topic_id AND m.ranking=1
 ON CONFLICT(student_id,topic_id) DO UPDATE SET mastery_status=excluded.mastery_status,primary_misconception_tag=excluded.primary_misconception_tag,last_updated=excluded.last_updated;
 DELETE FROM public.student_progress p WHERE p.student_id=student AND NOT EXISTS(
  SELECT 1 FROM public.session_responses r JOIN public.sessions s ON s.id=r.session_id
   JOIN public.session_progress sp ON sp.session_id=r.session_id AND sp.student_id=r.student_id
   WHERE r.student_id=student AND s.topic_id=p.topic_id AND sp.completed_via='lesson_flow'
  UNION ALL SELECT 1 FROM public.quiz_responses r JOIN public.quiz_attempts a ON a.id=r.quiz_attempt_id
   JOIN public.quiz_attempt_questions q ON q.id=r.question_id JOIN public.questions t ON t.id=q.template_id
   WHERE a.student_id=student AND a.status='completed' AND t.topic_id=p.topic_id);
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.student_progress p WHERE student_id=student),'[]');
END $$;
REVOKE ALL ON FUNCTION public.refresh_student_progress_internal(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.refresh_student_progress() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 RETURN public.refresh_student_progress_internal(auth.uid());
END $$;

-- Reuse assessment generation/timing verbatim; wrap only eligibility and support selection.
ALTER FUNCTION public.start_quiz_attempt(uuid) RENAME TO start_quiz_attempt_internal;
REVOKE ALL ON FUNCTION public.start_quiz_attempt_internal(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.start_quiz_attempt(p_quiz_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE aid uuid; support_topics jsonb;
BEGIN
 PERFORM public.assert_learning_available(auth.uid());
 PERFORM public.refresh_student_progress();
 aid:=public.start_quiz_attempt_internal(p_quiz_id);
 SELECT COALESCE(jsonb_agg(DISTINCT s.topic_id),'[]') INTO support_topics FROM public.session_responses r
  JOIN public.sessions s ON s.id=r.session_id JOIN public.session_progress p ON p.session_id=r.session_id AND p.student_id=r.student_id
  WHERE r.student_id=auth.uid() AND p.completed_via='lesson_flow' AND (r.answer_revealed OR r.wrong_attempts>=2);
 UPDATE public.quiz_attempts SET adaptive_plan=adaptive_plan||jsonb_build_object('support_topics',support_topics) WHERE id=aid;
 RETURN aid;
END $$;
ALTER FUNCTION public.finish_quiz_attempt(uuid) RENAME TO finish_quiz_attempt_internal;
REVOKE ALL ON FUNCTION public.finish_quiz_attempt_internal(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.finish_quiz_attempt(p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 result:=public.finish_quiz_attempt_internal(p_attempt_id);
 RETURN result||jsonb_build_object('fullMarks',(result->>'totalQuestions')::int>0 AND (result->>'correctCount')::int=(result->>'totalQuestions')::int);
END $$;

CREATE FUNCTION public.assert_learning_available(p_student uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_student IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM public.expire_learning_break(p_student);
 IF EXISTS(SELECT 1 FROM public.break_records WHERE student_id=p_student AND break_end IS NULL) THEN
  RAISE EXCEPTION 'Resume your break before continuing' USING ERRCODE='P0001';
 END IF;
END $$;

CREATE FUNCTION public.learning_break_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.break_records; ended public.break_records; last_end jsonb; sid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO ended FROM public.break_records WHERE student_id=auth.uid() AND break_end IS NULL;
 PERFORM public.expire_learning_break(auth.uid());
 SELECT * INTO b FROM public.break_records WHERE student_id=auth.uid() AND break_end IS NULL;
 IF b.id IS NOT NULL THEN SELECT session_id INTO sid FROM public.session_progress WHERE id=b.session_progress_id; END IF;
 SELECT jsonb_build_object('id',id,'ended_reason',ended_reason) INTO last_end FROM public.break_records
  WHERE student_id=auth.uid() AND break_end IS NOT NULL ORDER BY break_start DESC LIMIT 1;
 RETURN jsonb_build_object('server_now',clock_timestamp(),'recent_end',last_end,'break',CASE WHEN b.id IS NULL THEN NULL ELSE
  to_jsonb(b)||jsonb_build_object('session_id',sid) END,
  'expired',ended.id IS NOT NULL AND b.id IS NULL);
END $$;

CREATE FUNCTION public.begin_learning_break(p_student uuid,p_progress_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.session_progress; b public.break_records; signals jsonb; allowance int; did uuid;
 last_active int; practice_accuracy numeric; wrongs int; reveals int; misses int; today int;
 reason text:='A calm pause based on your recent learning and rest.';
BEGIN
 PERFORM public.expire_learning_break(p_student);
 SELECT * INTO p FROM public.session_progress WHERE id=p_progress_id AND student_id=p_student FOR UPDATE;
 IF NOT FOUND OR p.status NOT IN ('in_progress','completed') OR p.completed_via<>'lesson_flow' THEN RAISE EXCEPTION 'Active lesson not owned' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.quiz_attempts WHERE student_id=p_student AND status='in_progress' AND clock_timestamp()<started_at+make_interval(secs=>time_limit_seconds)) THEN RAISE EXCEPTION 'No breaks during a timed quiz'; END IF;
 SELECT * INTO b FROM public.break_records WHERE student_id=p_student AND break_end IS NULL;
 IF b.id IS NULL THEN
  SELECT COALESCE(sum(wrong_attempts),0),count(*) FILTER(WHERE answer_revealed) INTO wrongs,reveals
   FROM public.session_responses WHERE student_id=p_student AND session_id=p.session_id;
  SELECT 100.0*count(*) FILTER(WHERE is_correct AND NOT answer_revealed)/NULLIF(count(*),0) INTO practice_accuracy
   FROM (SELECT r.* FROM public.session_responses r JOIN public.session_progress sp ON sp.student_id=r.student_id AND sp.session_id=r.session_id
    WHERE r.student_id=p_student AND sp.completed_via='lesson_flow' ORDER BY r.created_at DESC LIMIT 10) recent;
  SELECT count(*) INTO misses FROM public.attention_events WHERE student_id=p_student AND session_id=p.session_id
   AND (outcome='skipped' OR is_correct=false);
  SELECT count(*) INTO today FROM public.break_records WHERE student_id=p_student AND break_start>=date_trunc('day',clock_timestamp());
  SELECT COALESCE((d.input_snapshot->>'active_seconds')::int,0) INTO last_active FROM public.break_records br
   JOIN public.agent_decisions d ON d.id=br.agent_decision_id WHERE br.session_progress_id=p.id ORDER BY br.break_start DESC LIMIT 1;
  signals:=jsonb_build_object('wrong_attempts',wrongs,'reveals',reveals,'practice_accuracy',practice_accuracy,
   'popup_misses',misses,'active_seconds',p.total_active_seconds,'since_break_seconds',GREATEST(0,p.total_active_seconds-COALESCE(last_active,0)),'breaks_today',today);
  allowance:=public.break_allowance(signals);
  INSERT INTO public.agent_decisions(student_id,agent_name,decision_type,linked_entity_id,input_snapshot,output,reasoning_summary)
   VALUES(p_student,'teaching_agent','break_allowance',p.id,signals,jsonb_build_object('allowed_seconds',allowance),reason) RETURNING id INTO did;
  INSERT INTO public.break_records(student_id,session_progress_id,break_start,allowed_seconds,agent_decision_id)
   VALUES(p_student,p.id,clock_timestamp(),allowance,did) RETURNING * INTO b;
  UPDATE public.session_progress SET break_count=break_count+1,active_updated_at=clock_timestamp() WHERE id=p.id;
 END IF;
 RETURN jsonb_build_object('server_now',clock_timestamp(),'break',to_jsonb(b)||jsonb_build_object('session_id',(SELECT session_id FROM public.session_progress WHERE id=b.session_progress_id)),'reasoning_summary',reason);
END $$;

CREATE FUNCTION public.end_learning_break(p_break_id uuid,p_activities jsonb DEFAULT '[]',p_timeout boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.break_records; activity jsonb; sum_seconds int:=0; elapsed int;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('learning:'||auth.uid()::text,0));
 SELECT * INTO b FROM public.break_records WHERE id=p_break_id AND student_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Break not owned' USING ERRCODE='42501'; END IF;
 IF b.break_end IS NOT NULL THEN RETURN public.learning_break_status(); END IF;
 elapsed:=LEAST(b.allowed_seconds,GREATEST(0,floor(extract(epoch FROM clock_timestamp()-b.break_start))::int));
 IF jsonb_typeof(p_activities)<>'array' OR jsonb_array_length(p_activities)>100 THEN RAISE EXCEPTION 'Invalid activities'; END IF;
 FOR activity IN SELECT * FROM jsonb_array_elements(p_activities) LOOP
  IF jsonb_typeof(activity)<>'object' OR COALESCE(activity->>'id','') NOT IN ('breathing','doodle','bubbles','stretch','riddles') OR
   COALESCE(activity->>'seconds','') !~ '^[0-9]+$' OR (activity->>'seconds')::int>600 THEN RAISE EXCEPTION 'Invalid activity'; END IF;
  sum_seconds:=sum_seconds+(activity->>'seconds')::int;
 END LOOP;
 IF sum_seconds>elapsed THEN RAISE EXCEPTION 'Activity time exceeds break'; END IF;
 UPDATE public.break_records SET break_end=CASE WHEN elapsed>=b.allowed_seconds THEN break_start+make_interval(secs=>allowed_seconds) ELSE clock_timestamp() END,
  duration_seconds=elapsed, ended_reason=CASE WHEN elapsed>=b.allowed_seconds THEN CASE WHEN p_timeout THEN 'timeout' ELSE 'expired_while_away' END ELSE 'resumed_early' END,
  activities=p_activities WHERE id=b.id;
 UPDATE public.session_progress SET active_updated_at=clock_timestamp() WHERE id=b.session_progress_id;
 RETURN public.learning_break_status();
END $$;

CREATE FUNCTION public.save_break_activities(p_break_id uuid,p_activities jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.break_records; item jsonb; total int:=0;
BEGIN
 SELECT * INTO b FROM public.break_records WHERE id=p_break_id AND student_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Break not owned' USING ERRCODE='42501'; END IF;
 IF b.break_end IS NOT NULL THEN RETURN; END IF;
 IF jsonb_typeof(p_activities)<>'array' OR jsonb_array_length(p_activities)>100 THEN RAISE EXCEPTION 'Invalid activities'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_activities) LOOP
  IF jsonb_typeof(item)<>'object' OR COALESCE(item->>'id','') NOT IN ('breathing','doodle','bubbles','stretch','riddles') OR COALESCE(item->>'seconds','') !~ '^[0-9]+$' OR (item->>'seconds')::int>600 THEN RAISE EXCEPTION 'Invalid activity'; END IF;
  total:=total+(item->>'seconds')::int;
 END LOOP;
 IF total>LEAST(b.allowed_seconds,GREATEST(0,floor(extract(epoch FROM clock_timestamp()-b.break_start))::int)) THEN RAISE EXCEPTION 'Activity time exceeds break'; END IF;
 UPDATE public.break_records SET activities=p_activities WHERE id=b.id;
END $$;


CREATE FUNCTION public.show_attention(p_student uuid,p_section_id uuid,p_trigger_reason text,p_question_type text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sid uuid; event public.attention_events;
BEGIN
 PERFORM public.assert_learning_available(p_student);
 SELECT ss.session_id INTO sid FROM public.session_sections ss JOIN public.session_progress sp ON sp.session_id=ss.session_id
  AND sp.student_id=p_student AND sp.completed_via='lesson_flow' WHERE ss.id=p_section_id AND ss.section_type<>'practice';
 IF sid IS NULL OR EXISTS(SELECT 1 FROM public.quiz_attempts WHERE student_id=p_student AND status='in_progress' AND clock_timestamp()<started_at+make_interval(secs=>time_limit_seconds)) THEN RAISE EXCEPTION 'Attention unavailable'; END IF;
 INSERT INTO public.attention_events(student_id,session_id,section_id,trigger_reason,question_type,question_payload)
  VALUES(p_student,sid,p_section_id,p_trigger_reason,p_question_type,p_payload||jsonb_build_object('active_seconds',
   (SELECT total_active_seconds FROM public.session_progress WHERE session_id=sid AND student_id=p_student))) RETURNING * INTO event;
 RETURN to_jsonb(event);
END $$;
CREATE FUNCTION public.answer_attention(p_event_id uuid,p_response numeric DEFAULT NULL,p_skip boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.attention_events;
BEGIN
 PERFORM public.assert_learning_available(auth.uid());
 SELECT * INTO e FROM public.attention_events WHERE id=p_event_id AND student_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not owned' USING ERRCODE='42501'; END IF;
 IF e.outcome IS NULL THEN
  IF NOT p_skip AND p_response IS NULL THEN RAISE EXCEPTION 'Answer or skip is required'; END IF;
  UPDATE public.attention_events SET answered_at=clock_timestamp(),response=CASE WHEN p_skip THEN NULL ELSE p_response END,
   is_correct=CASE WHEN p_skip THEN NULL ELSE p_response=(question_payload->>'answer')::numeric END,
   response_time_seconds=GREATEST(0,extract(epoch FROM clock_timestamp()-shown_at)),
   outcome=CASE WHEN p_skip THEN 'skipped' ELSE 'answered' END WHERE id=e.id RETURNING * INTO e;
 END IF;
 RETURN to_jsonb(e);
END $$;

CREATE OR REPLACE FUNCTION public.student_report_input(p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE student uuid:=auth.uid();
BEGIN
 IF student IS NULL OR NOT EXISTS(SELECT 1 FROM public.quiz_attempts WHERE id=p_attempt_id AND student_id=student AND status='completed')
 THEN RAISE EXCEPTION 'Completed attempt not owned' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
 'history',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.completed_at,a.id) FROM public.quiz_attempts a WHERE a.student_id=student AND a.status='completed'),'[]'),
 'progress',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.student_progress p WHERE p.student_id=student),'[]'),
 'practice',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.session_responses r JOIN public.session_progress sp ON sp.session_id=r.session_id AND sp.student_id=r.student_id WHERE r.student_id=student AND sp.completed_via='lesson_flow'),'[]'),
 'breaks',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM public.break_records b JOIN public.session_progress sp ON sp.id=b.session_progress_id WHERE sp.student_id=student AND sp.completed_via='lesson_flow'),'[]'),
 'attention',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM public.attention_events e JOIN public.session_progress sp ON sp.session_id=e.session_id AND sp.student_id=e.student_id WHERE e.student_id=student AND sp.completed_via='lesson_flow'),'[]'),
 'break_decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.agent_decision_id,'allowed_seconds',b.allowed_seconds)) FROM public.break_records b JOIN public.session_progress sp ON sp.id=b.session_progress_id WHERE b.student_id=student AND sp.completed_via='lesson_flow'),'[]'));
END $$;

CREATE FUNCTION public.check_learning_available() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.assert_learning_available(auth.uid());
 RETURN true;
END $$;

-- Guard direct calls as well as API calls. Internal helpers are never exposed.
REVOKE ALL ON public.attention_events FROM PUBLIC,anon;
REVOKE INSERT,UPDATE,DELETE ON public.attention_events FROM authenticated;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('break_allowance','expire_learning_break','assert_learning_available',
 'check_learning_available','learning_break_status','begin_learning_break','end_learning_break','save_break_activities','learning_progress',
 'calendar_test_complete','practice_state','reveal_practice_answer','start_quiz_attempt','finish_quiz_attempt','show_attention','answer_attention')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  IF f.proname IN ('begin_learning_break','calendar_test_complete','show_attention') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  ELSIF f.proname NOT IN ('break_allowance','expire_learning_break','assert_learning_available') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
