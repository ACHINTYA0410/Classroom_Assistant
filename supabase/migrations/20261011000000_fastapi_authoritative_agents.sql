-- Forward migration. Apply once after the existing baseline. No student rows are deleted.
-- Unique-index creation intentionally fails if historical duplicates need operator reconciliation.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.session_sections ADD COLUMN IF NOT EXISTS question_prompt text;
ALTER TABLE public.session_sections ADD COLUMN IF NOT EXISTS correct_answer numeric;
ALTER TABLE public.session_sections ADD COLUMN IF NOT EXISTS question_format text DEFAULT 'numeric_input';
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS adaptive_plan jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.curriculum_embeddings ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE public.curriculum_embeddings ADD COLUMN IF NOT EXISTS embedding_dimension integer;
-- NULL provenance means unknown. The retrieval RPC deliberately excludes these old vectors.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_response_once ON public.quiz_responses(quiz_attempt_id, question_id);
CREATE UNIQUE INDEX IF NOT EXISTS report_once ON public.reports(student_id, quiz_attempt_id);
CREATE UNIQUE INDEX IF NOT EXISTS practice_response_once ON public.session_responses(student_id, section_id);
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_embedding_version ON public.curriculum_embeddings(session_section_id, embedding_model);
CREATE INDEX IF NOT EXISTS curriculum_metadata ON public.curriculum_embeddings(topic_id, chapter_id, grade_level, embedding_model);
CREATE INDEX IF NOT EXISTS agent_student_time ON public.agent_decisions(student_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.profiles(id,email,name) VALUES(NEW.id,COALESCE(NEW.email,''),
    COALESCE(NEW.raw_user_meta_data->>'name',NEW.raw_user_meta_data->>'full_name','Student'))
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Audit is backend-only: remove every old policy, then revoke student privileges.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='agent_decisions' LOOP
    EXECUTE format('DROP POLICY %I ON public.agent_decisions',p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agent_decisions TO service_role;

-- Browser cannot forge assessment state or inspect the answer key.
REVOKE INSERT, UPDATE, DELETE ON public.quiz_attempts, public.quiz_responses, public.student_progress, public.session_responses, public.reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reports TO service_role;
REVOKE ALL ON public.quiz_attempt_questions, public.questions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_break_count(progress_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  UPDATE public.session_progress SET break_count=COALESCE(break_count,0)+1
    WHERE id=progress_id AND student_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Progress not owned' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.increment_break_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_break_count(uuid) TO authenticated;

-- Sole timer formula, retained from the original start RPC with actual generated count.
CREATE OR REPLACE FUNCTION public.quiz_timing(p_student uuid, p_count integer) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; n int:=0; acc numeric:=0; elapsed numeric:=0; count_q int:=0;
  scores numeric[]:='{}'; prev_limit numeric:=90; base numeric:=90; trend text:='stable';
  reason text:='Used 90 seconds per question for a first assessment.';
BEGIN
  FOR r IN SELECT a.*, (SELECT count(*) FROM public.quiz_attempt_questions q WHERE q.quiz_attempt_id=a.id) AS q_count
    FROM public.quiz_attempts a WHERE a.student_id=p_student AND a.status='completed'
    ORDER BY a.completed_at DESC, a.id DESC LIMIT 3 LOOP
    n:=n+1; acc:=acc+COALESCE(r.accuracy,0); scores:=array_append(scores,COALESCE(r.accuracy,0));
    elapsed:=elapsed+LEAST(r.time_limit_seconds,GREATEST(0,extract(epoch FROM r.completed_at-r.started_at)));
    count_q:=count_q+GREATEST(r.q_count,1);
    IF n=1 THEN prev_limit:=r.time_limit_seconds::numeric/GREATEST(r.q_count,1); END IF;
  END LOOP;
  IF n>0 THEN
    acc:=acc/n;
    IF n=2 THEN trend:=CASE WHEN scores[1]>scores[2] THEN 'improving' WHEN scores[1]<scores[2] THEN 'declining' ELSE 'stable' END;
    ELSIF n=3 THEN trend:=CASE WHEN scores[1]>(scores[2]+scores[3])/2 THEN 'improving' WHEN scores[1]<(scores[2]+scores[3])/2 THEN 'declining' ELSE 'stable' END; END IF;
    IF acc<60 THEN base:=135; reason:='Added time because recent accuracy is below 60%.';
    ELSIF acc>85 THEN base:=72; reason:='Used a shorter pace because recent accuracy exceeds 85%.';
    ELSE reason:='Kept the standard pace for recent accuracy between 60% and 85%.'; END IF;
    IF trend='declining' THEN base:=CASE WHEN base<117 THEN 117 ELSE base*1.1 END;
      reason:=reason||' Added support for a declining recent trend.'; END IF;
    IF elapsed/GREATEST(count_q,1)>=0.8*prev_limit THEN base:=base*1.2;
      reason:=reason||' Added a buffer for high time usage.'; END IF;
  END IF;
  base:=round(LEAST(150,GREATEST(45,base)));
  RETURN jsonb_build_object('question_count',p_count,'seconds_per_question',base,'time_limit_seconds',base*p_count,
    'prior_attempt_count',n,'rolling_accuracy',acc,'rolling_time_per_question',elapsed/GREATEST(count_q,1),
    'trend',trend,'reason',reason);
END $$;
REVOKE ALL ON FUNCTION public.quiz_timing(uuid,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_quiz_attempt(p_quiz_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE student uuid:=auth.uid(); week uuid; grade int; attempt uuid; t record; a int; b int;
  answer int; needs_carry boolean; needs_hundreds boolean; tries int; rules jsonb; rule jsonb;
  options jsonb; val int; offset_value int; idx int:=0; plan jsonb;
BEGIN
  IF student IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(student::text||p_quiz_id::text,0));
  SELECT q.week_id,c.grade_level INTO week,grade FROM public.quizzes q JOIN public.weeks w ON w.id=q.week_id
    JOIN public.chapters c ON c.id=w.chapter_id WHERE q.id=p_quiz_id;
  IF week IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=student AND grade_level=grade) THEN
    RAISE EXCEPTION 'Quiz unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE week_id=week AND session_type IN ('lesson','revision')) OR EXISTS(
    SELECT 1 FROM public.sessions s WHERE s.week_id=week AND s.session_type IN ('lesson','revision') AND NOT EXISTS(
      SELECT 1 FROM public.session_progress sp WHERE sp.session_id=s.id AND sp.student_id=student AND sp.status='completed')) THEN
    RAISE EXCEPTION 'Complete the required lessons'; END IF;
  SELECT id INTO attempt FROM public.quiz_attempts WHERE student_id=student AND quiz_id=p_quiz_id AND status='in_progress'
    ORDER BY started_at DESC LIMIT 1;
  IF attempt IS NOT NULL THEN RETURN attempt; END IF;
  INSERT INTO public.quiz_attempts(student_id,quiz_id,time_limit_seconds) VALUES(student,p_quiz_id,630) RETURNING id INTO attempt;
  FOR t IN
    WITH candidates AS (
      SELECT q.*, EXISTS(SELECT 1 FROM public.student_progress sp WHERE sp.student_id=student AND sp.mastery_status='weak'
        AND (sp.topic_id=q.topic_id OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.distractor_rules) r
          WHERE r->>'misconceptionTag'=sp.primary_misconception_tag))) AS weak
      FROM public.questions q WHERE q.grade_level=grade AND q.topic_id IN(SELECT topic_id FROM public.sessions WHERE week_id=week)
    ), ranked AS (SELECT *, row_number() OVER(PARTITION BY weak ORDER BY random()) AS rn FROM candidates)
    SELECT * FROM ranked ORDER BY CASE WHEN weak AND rn<=4 THEN 0 WHEN NOT weak THEN 1 ELSE 2 END,rn LIMIT 7
  LOOP
    rules:=COALESCE(t.distractor_rules,'[]');
    needs_carry:=EXISTS(SELECT 1 FROM jsonb_array_elements(rules) r WHERE r->>'type' IN ('forgot_carry','add_regrouped_to_ones'));
    needs_hundreds:=EXISTS(SELECT 1 FROM jsonb_array_elements(rules) r WHERE r->>'type'='forgot_carry_hundreds');
    tries:=0;
    LOOP
      a:=floor(random()*(COALESCE(t.param_a_max,99)-COALESCE(t.param_a_min,10)+1))+COALESCE(t.param_a_min,10);
      b:=floor(random()*(COALESCE(t.param_b_max,99)-COALESCE(t.param_b_min,10)+1))+COALESCE(t.param_b_min,10);
      tries:=tries+1;
      EXIT WHEN (needs_hundreds AND a+b>=100) OR
        (NOT needs_hundreds AND ((needs_carry AND a%10+b%10>=10) OR (NOT needs_carry AND a%10+b%10<10)));
      IF tries>=500 THEN RAISE EXCEPTION 'Invalid template ranges'; END IF;
    END LOOP;
    answer:=a+b; options:='[]';
    FOR rule IN SELECT * FROM jsonb_array_elements(rules) LOOP
      val:=CASE rule->>'type' WHEN 'forgot_carry' THEN answer-10 WHEN 'forgot_carry_hundreds' THEN answer-100
        WHEN 'off_by_one' THEN answer+1 WHEN 'off_by_ten' THEN answer+10 WHEN 'subtract_instead' THEN a-b
        WHEN 'add_regrouped_to_ones' THEN answer+1 ELSE answer+5 END;
      IF val>=0 AND val<>answer AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(options) d WHERE (d->>'value')::int=val)
        AND jsonb_array_length(options)<3 THEN
        options:=options||jsonb_build_array(jsonb_build_object('value',val,'misconceptionTag',rule->>'misconceptionTag',
          'explanation','Try adding the ones first, then the tens. Remember any regrouped ten.'));
      END IF;
    END LOOP;
    offset_value:=1;
    WHILE jsonb_array_length(options)<3 LOOP
      val:=answer+offset_value; offset_value:=offset_value+1;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(options) d WHERE (d->>'value')::int=val) THEN
        options:=options||jsonb_build_array(jsonb_build_object('value',val,'misconceptionTag','counting_error',
          'explanation','Count carefully and try adding the ones before the tens.')); END IF;
    END LOOP;
    INSERT INTO public.quiz_attempt_questions(quiz_attempt_id,template_id,param_a,param_b,correct_answer,distractors,order_index)
      VALUES(attempt,t.id,a,b,answer,options,idx);
    idx:=idx+1;
  END LOOP;
  IF idx=0 THEN RAISE EXCEPTION 'No matching question templates'; END IF;
  plan:=public.quiz_timing(student,idx);
  UPDATE public.quiz_attempts SET time_limit_seconds=(plan->>'time_limit_seconds')::int,adaptive_plan=plan,started_at=clock_timestamp() WHERE id=attempt;
  RETURN attempt;
END $$;
REVOKE ALL ON FUNCTION public.start_quiz_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_quiz_attempt(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_quiz_plan(p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.quiz_attempts; questions_json jsonb;
BEGIN
  SELECT * INTO a FROM public.quiz_attempts WHERE id=p_attempt_id AND student_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not owned' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',q.id,'template',t.template,'a',q.param_a,'b',q.param_b,
    'options',(SELECT jsonb_agg(v ORDER BY v) FROM (SELECT q.correct_answer AS v UNION
      SELECT (d->>'value')::numeric FROM jsonb_array_elements(q.distractors) d) opts)) ORDER BY q.order_index),'[]')
    INTO questions_json FROM public.quiz_attempt_questions q JOIN public.questions t ON t.id=q.template_id WHERE q.quiz_attempt_id=a.id;
  RETURN jsonb_build_object('attempt_id',a.id,'started_at',a.started_at,'time_limit_seconds',a.time_limit_seconds,
    'remaining_seconds',GREATEST(0,ceil(a.time_limit_seconds-extract(epoch FROM clock_timestamp()-a.started_at))),
    'status',a.status,'adaptive',CASE WHEN a.adaptive_plan='{}' THEN jsonb_build_object('question_count',jsonb_array_length(questions_json),
      'seconds_per_question',a.time_limit_seconds/GREATEST(jsonb_array_length(questions_json),1),'reason','Resumed an earlier assessment.') ELSE a.adaptive_plan END,
    'questions',questions_json,'answered_question_ids',COALESCE((SELECT jsonb_agg(question_id) FROM public.quiz_responses WHERE quiz_attempt_id=a.id),'[]'));
END $$;

CREATE OR REPLACE FUNCTION public.submit_quiz_answer(p_attempt_id uuid,p_question_id uuid,p_answer numeric,p_seconds int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.quiz_attempts; q public.quiz_attempt_questions; r public.quiz_responses; tag text; explanation text;
BEGIN
  SELECT * INTO a FROM public.quiz_attempts WHERE id=p_attempt_id AND student_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not owned' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM public.quiz_attempt_questions WHERE id=p_question_id AND quiz_attempt_id=a.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not in attempt' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.quiz_responses WHERE quiz_attempt_id=a.id AND question_id=q.id;
  IF FOUND THEN
    IF r.selected_answer<>p_answer THEN RAISE EXCEPTION 'Answer already submitted'; END IF;
  ELSE
    IF a.status<>'in_progress' OR clock_timestamp()>a.started_at+make_interval(secs=>a.time_limit_seconds) THEN RAISE EXCEPTION 'Attempt expired or complete'; END IF;
    IF p_answer<>q.correct_answer AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.distractors) d WHERE (d->>'value')::numeric=p_answer) THEN RAISE EXCEPTION 'Invalid option'; END IF;
    SELECT d->>'misconceptionTag' INTO tag FROM jsonb_array_elements(q.distractors) d WHERE (d->>'value')::numeric=p_answer LIMIT 1;
    INSERT INTO public.quiz_responses(quiz_attempt_id,question_id,selected_answer,is_correct,time_taken_seconds,misconception_tag)
      VALUES(a.id,q.id,p_answer,p_answer=q.correct_answer,GREATEST(0,LEAST(p_seconds,a.time_limit_seconds)),tag) RETURNING * INTO r;
  END IF;
  explanation:=CASE WHEN r.is_correct THEN 'Great job! You got it right.' ELSE 'Try adding the ones first, then the tens. Remember any regrouped ten.' END;
  RETURN jsonb_build_object('isCorrect',r.is_correct,'misconceptionTag',r.misconception_tag,'explanation',explanation);
END $$;

CREATE OR REPLACE FUNCTION public.finish_quiz_attempt(p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.quiz_attempts; total int; correct int; submitted int; final_score numeric; final_accuracy numeric; missed jsonb;
BEGIN
  SELECT * INTO a FROM public.quiz_attempts WHERE id=p_attempt_id AND student_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not owned' USING ERRCODE='42501'; END IF;
  IF a.status='abandoned' THEN RAISE EXCEPTION 'Attempt abandoned'; END IF;
  SELECT count(*) INTO total FROM public.quiz_attempt_questions WHERE quiz_attempt_id=a.id;
  SELECT count(*),count(*) FILTER(WHERE is_correct) INTO submitted,correct FROM public.quiz_responses WHERE quiz_attempt_id=a.id;
  final_score:=100.0*correct/GREATEST(total,1); final_accuracy:=100.0*correct/GREATEST(submitted,1);
  IF a.status<>'completed' THEN UPDATE public.quiz_attempts SET status='completed',completed_at=clock_timestamp(),score=final_score,accuracy=final_accuracy WHERE id=a.id; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('questionText',replace(replace(t.template,'{a}',q.param_a::text),'{b}',q.param_b::text),
    'correctAnswer',q.correct_answer,'selectedAnswer',r.selected_answer,'isCorrect',COALESCE(r.is_correct,false),
    'misconceptionTag',r.misconception_tag) ORDER BY q.order_index),'[]') INTO missed
    FROM public.quiz_attempt_questions q JOIN public.questions t ON t.id=q.template_id
    LEFT JOIN public.quiz_responses r ON r.question_id=q.id AND r.quiz_attempt_id=a.id
    WHERE q.quiz_attempt_id=a.id AND NOT COALESCE(r.is_correct,false);
  RETURN jsonb_build_object('correctCount',correct,'totalQuestions',total,'scorePercentage',final_score,'accuracyPercentage',final_accuracy,'missedQuestions',missed);
END $$;

CREATE OR REPLACE FUNCTION public.refresh_student_progress() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE student uuid:=auth.uid();
BEGIN
  IF student IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  WITH responses AS (
    SELECT t.topic_id,r.is_correct,r.misconception_tag FROM public.quiz_responses r
      JOIN public.quiz_attempts a ON a.id=r.quiz_attempt_id JOIN public.quiz_attempt_questions q ON q.id=r.question_id
      JOIN public.questions t ON t.id=q.template_id WHERE a.student_id=student AND a.status='completed'
    UNION ALL SELECT s.topic_id,r.is_correct,r.misconception_tag FROM public.session_responses r JOIN public.sessions s ON s.id=r.session_id
      WHERE r.student_id=student AND s.topic_id IS NOT NULL
  ), totals AS (SELECT topic_id,count(*) n,100.0*count(*) FILTER(WHERE is_correct)/count(*) accuracy FROM responses GROUP BY topic_id),
  mistakes AS (SELECT topic_id,misconception_tag,count(*) n,row_number() OVER(PARTITION BY topic_id ORDER BY count(*) DESC,misconception_tag) ranking
    FROM responses WHERE NOT is_correct AND misconception_tag IS NOT NULL GROUP BY topic_id,misconception_tag)
  INSERT INTO public.student_progress(student_id,topic_id,topic_name,mastery_status,primary_misconception_tag,last_updated)
  SELECT student,t.topic_id,COALESCE((SELECT topic_name FROM public.sessions WHERE topic_id=t.topic_id AND topic_name IS NOT NULL LIMIT 1),t.topic_id),
    CASE WHEN t.accuracy<60 OR COALESCE(m.n,0)>=2 THEN 'weak' WHEN t.accuracy>=85 AND t.n>=3 THEN 'mastered' ELSE 'in_progress' END,
    m.misconception_tag,now() FROM totals t LEFT JOIN mistakes m ON m.topic_id=t.topic_id AND m.ranking=1
  ON CONFLICT(student_id,topic_id) DO UPDATE SET mastery_status=excluded.mastery_status,
    primary_misconception_tag=excluded.primary_misconception_tag,last_updated=excluded.last_updated;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.student_progress p WHERE p.student_id=student),'[]');
END $$;

CREATE OR REPLACE FUNCTION public.record_practice_answer(p_section_id uuid,p_answer numeric,p_attempts int,p_seconds int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE section public.session_sections; student uuid:=auth.uid(); correct boolean;
BEGIN
  IF student IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT ss.* INTO section FROM public.session_sections ss JOIN public.sessions s ON s.id=ss.session_id
    JOIN public.weeks w ON w.id=s.week_id JOIN public.chapters c ON c.id=w.chapter_id
    JOIN public.profiles p ON p.id=student AND p.grade_level=c.grade_level
    WHERE ss.id=p_section_id AND ss.section_type='practice' AND ss.correct_answer IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Practice section unavailable'; END IF;
  correct:=p_answer=section.correct_answer;
  INSERT INTO public.session_responses(student_id,session_id,section_id,response_type,is_correct,attempts,time_taken_seconds)
    VALUES(student,section.session_id,section.id,'practice',correct,GREATEST(1,p_attempts),GREATEST(0,p_seconds))
    ON CONFLICT(student_id,section_id) DO UPDATE SET is_correct=excluded.is_correct,attempts=excluded.attempts,time_taken_seconds=excluded.time_taken_seconds;
  PERFORM public.refresh_student_progress();
  RETURN jsonb_build_object('isCorrect',correct,'explanation',CASE WHEN correct THEN 'Excellent! You got it right.' ELSE 'Try the ones first, then the tens.' END);
END $$;

CREATE OR REPLACE FUNCTION public.student_report_input(p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE student uuid:=auth.uid();
BEGIN
  IF student IS NULL OR NOT EXISTS(SELECT 1 FROM public.quiz_attempts WHERE id=p_attempt_id AND student_id=student AND status='completed') THEN
    RAISE EXCEPTION 'Completed attempt not owned' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('history',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.completed_at,a.id) FROM public.quiz_attempts a WHERE a.student_id=student AND a.status='completed'),'[]'),
    'progress',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.student_progress p WHERE p.student_id=student),'[]'),
    'practice',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.session_responses r WHERE r.student_id=student),'[]'),
    'breaks',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM public.break_records b JOIN public.session_progress sp ON sp.id=b.session_progress_id WHERE sp.student_id=student),'[]'));
END $$;

-- Metadata is filtered before similarity. Only explicitly versioned compatible vectors can match.
CREATE OR REPLACE FUNCTION public.match_curriculum(query_embedding vector(768),p_topic_id text,p_chapter_id uuid,
  p_grade int,p_model text,p_dimension int,match_threshold float DEFAULT 0.2,match_count int DEFAULT 4)
RETURNS TABLE(id uuid,session_section_id uuid,source_text text,similarity float)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH eligible AS MATERIALIZED (SELECT c.* FROM public.curriculum_embeddings c
    WHERE c.topic_id=p_topic_id AND c.chapter_id=p_chapter_id AND c.grade_level=p_grade
      AND c.embedding_model=p_model AND c.embedding_dimension=p_dimension AND p_dimension=768
      AND EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND grade_level=p_grade))
  SELECT c.id,c.session_section_id,c.source_text,1-(c.embedding <=> query_embedding) FROM eligible c
    WHERE 1-(c.embedding <=> query_embedding)>match_threshold
    ORDER BY c.embedding <=> query_embedding LIMIT LEAST(10,GREATEST(1,match_count));
$$;
-- Old RPC is deprecated and unavailable to frontend consumers.
REVOKE ALL ON FUNCTION public.match_curriculum_embeddings(vector,double precision,integer,text,uuid) FROM PUBLIC,anon,authenticated;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('get_quiz_plan','submit_quiz_answer','finish_quiz_attempt',
      'refresh_student_progress','record_practice_answer','student_report_input','match_curriculum') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END LOOP;
END $$;
COMMIT;
