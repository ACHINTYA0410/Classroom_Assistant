-- Read-only deployment preflight. Never repairs/deletes existing data automatically.
SELECT current_user, current_setting('transaction_read_only') AS transaction_read_only;
SELECT quiz_attempt_id, question_id, count(*) FROM public.quiz_responses GROUP BY 1,2 HAVING count(*)>1;
SELECT student_id, quiz_attempt_id, count(*) FROM public.reports GROUP BY 1,2 HAVING count(*)>1;
SELECT student_id, section_id, count(*) FROM public.session_responses GROUP BY 1,2 HAVING count(*)>1;
SELECT extname, extversion FROM pg_extension WHERE extname='vector';
SELECT column_name, data_type, udt_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN ('curriculum_embeddings','quiz_attempts','agent_decisions');
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('start_quiz_attempt','increment_break_count','match_curriculum_embeddings');
SELECT tablename,policyname,cmd,roles FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('agent_decisions','quiz_attempts','quiz_responses','student_progress','reports');
