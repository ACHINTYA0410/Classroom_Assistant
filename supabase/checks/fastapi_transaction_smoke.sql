-- Deployed SQL/RLS smoke test. Synthetic users and all writes are rolled back.
-- Requires an administrative SQL connection; does not test Supabase Auth HTTP login.
BEGIN;
DO $smoke$
DECLARE
  student_a uuid := gen_random_uuid(); student_b uuid := gen_random_uuid();
  quiz uuid; week uuid; attempt uuid; plan jsonb; result jsonb;
  item jsonb; denied boolean; section uuid; chapter uuid; topic text; grade int;
  answer numeric; vector_value vector(768); found_count int;
BEGIN
  SELECT q.id,q.week_id,c.id,c.grade_level INTO quiz,week,chapter,grade
    FROM public.quizzes q JOIN public.weeks w ON w.id=q.week_id
    JOIN public.chapters c ON c.id=w.chapter_id ORDER BY q.id LIMIT 1;
  IF quiz IS NULL THEN RAISE EXCEPTION 'No curriculum quiz available'; END IF;
  INSERT INTO auth.users(id,email,raw_user_meta_data)
    VALUES(student_a,'smoke-'||student_a||'@example.invalid','{"name":"Rollback smoke A"}'),
          (student_b,'smoke-'||student_b||'@example.invalid','{"name":"Rollback smoke B"}');
  IF (SELECT count(*) FROM public.profiles WHERE id IN(student_a,student_b)) <> 2
    THEN RAISE EXCEPTION 'Signup profile trigger failed'; END IF;
  UPDATE public.profiles SET grade_level=grade WHERE id IN(student_a,student_b);
  PERFORM set_config('request.jwt.claim.sub',student_a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied:=false;
  BEGIN PERFORM public.start_quiz_attempt(quiz);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Incomplete lessons did not gate start'; END IF;
  INSERT INTO public.session_progress(student_id,session_id,status,started_at,completed_at)
    SELECT student_a,id,'completed',now(),now() FROM public.sessions
    WHERE week_id=week AND session_type IN('lesson','revision');
  attempt:=public.start_quiz_attempt(quiz);
  IF public.start_quiz_attempt(quiz)<>attempt THEN RAISE EXCEPTION 'Resume failed'; END IF;
  plan:=public.get_quiz_plan(attempt);
  IF jsonb_array_length(plan->'questions')<>7 OR (plan->>'time_limit_seconds')::int<>630
    THEN RAISE EXCEPTION 'Question count/timer incorrect'; END IF;
  PERFORM set_config('request.jwt.claim.sub',student_b::text,true);
  denied:=false;
  BEGIN PERFORM public.get_quiz_plan(attempt);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-student plan leaked'; END IF;
  denied:=false;
  BEGIN PERFORM public.finish_quiz_attempt(attempt);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-student finish permitted'; END IF;
  PERFORM set_config('request.jwt.claim.sub',student_a::text,true);
  FOR item IN SELECT * FROM jsonb_array_elements(plan->'questions') LOOP
    result:=public.submit_quiz_answer(attempt,(item->>'id')::uuid,
      (item->>'a')::numeric+(item->>'b')::numeric,1);
    IF NOT (result->>'isCorrect')::boolean THEN RAISE EXCEPTION 'Correct answer rejected'; END IF;
    PERFORM public.submit_quiz_answer(attempt,(item->>'id')::uuid,
      (item->>'a')::numeric+(item->>'b')::numeric,1);
  END LOOP;
  IF (SELECT count(*) FROM public.quiz_responses WHERE quiz_attempt_id=attempt)<>7
    THEN RAISE EXCEPTION 'Answer retry duplicated rows'; END IF;
  result:=public.finish_quiz_attempt(attempt);
  IF (result->>'scorePercentage')::numeric<>100 THEN RAISE EXCEPTION 'Scoring failed'; END IF;
  PERFORM public.refresh_student_progress();
  IF NOT EXISTS(SELECT 1 FROM public.student_progress WHERE student_id=student_a)
    THEN RAISE EXCEPTION 'Mastery missing'; END IF;
  result:=public.student_report_input(attempt);
  IF jsonb_array_length(result->'history')<>1 THEN RAISE EXCEPTION 'Report input invalid'; END IF;
  denied:=false;
  BEGIN INSERT INTO public.reports(student_id,quiz_attempt_id) VALUES(student_a,attempt);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Student report write permitted'; END IF;
  denied:=false;
  BEGIN PERFORM 1 FROM public.agent_decisions;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Student audit read permitted'; END IF;
  PERFORM set_config('request.jwt.claim.sub',student_b::text,true);
  denied:=false;
  BEGIN PERFORM public.student_report_input(attempt);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-student report input leaked'; END IF;
  EXECUTE 'RESET ROLE';
  SELECT ss.id,s.topic_id,ss.correct_answer INTO section,topic,answer
    FROM public.session_sections ss JOIN public.sessions s ON s.id=ss.session_id
    WHERE s.week_id=week AND ss.section_type='practice' AND ss.correct_answer IS NOT NULL LIMIT 1;
  IF section IS NULL THEN RAISE EXCEPTION 'No gradable practice section'; END IF;
  PERFORM set_config('request.jwt.claim.sub',student_a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.record_practice_answer(section,answer,1,1);
  IF NOT (result->>'isCorrect')::boolean THEN RAISE EXCEPTION 'Practice grading failed'; END IF;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  INSERT INTO public.reports(student_id,quiz_attempt_id,narrative) VALUES(student_a,attempt,'Rollback smoke report');
  INSERT INTO public.agent_decisions(student_id,agent_name,decision_type)
    SELECT student_a,name,'rollback_smoke' FROM unnest(ARRAY['teaching_agent','quiz_agent','report_agent']) AS name;
  vector_value:=('['||'1,'||repeat('0,',766)||'0]')::vector;
  INSERT INTO public.curriculum_embeddings(session_section_id,grade_level,chapter_id,topic_id,
    embedding,source_text,embedding_model,embedding_dimension)
    VALUES(section,grade,chapter,topic,vector_value,'Rollback smoke curriculum','__rollback_smoke__',768);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO found_count FROM public.match_curriculum(vector_value,topic,chapter,grade,'__rollback_smoke__',768,0.2,4);
  IF found_count<>1 THEN RAISE EXCEPTION 'Versioned retrieval failed'; END IF;
  SELECT count(*) INTO found_count FROM public.match_curriculum(vector_value,'__wrong_topic__',chapter,grade,'__rollback_smoke__',768,0.2,4);
  IF found_count<>0 THEN RAISE EXCEPTION 'Retrieval topic filter failed'; END IF;
  IF (SELECT count(*) FROM public.reports WHERE quiz_attempt_id=attempt)<>1
    THEN RAISE EXCEPTION 'Own report read failed'; END IF;
  PERFORM set_config('request.jwt.claim.sub',student_b::text,true);
  IF EXISTS(SELECT 1 FROM public.reports WHERE quiz_attempt_id=attempt)
    THEN RAISE EXCEPTION 'Cross-student report read leaked'; END IF;
  EXECUTE 'RESET ROLE';
END
$smoke$;
ROLLBACK;
SELECT 'passed' AS deployed_transaction_smoke, 'all synthetic rows rolled back' AS persistence;
