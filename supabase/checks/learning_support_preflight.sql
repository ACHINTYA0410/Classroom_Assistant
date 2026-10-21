-- Read-only preflight before applying 20261012000000_learning_support.sql.
-- Run with an admin connection; no student rows are changed.
SELECT count(*) AS duplicate_open_break_groups FROM (
 SELECT p.student_id FROM public.break_records b JOIN public.session_progress p ON p.id=b.session_progress_id
 WHERE b.break_end IS NULL GROUP BY p.student_id HAVING count(*)>1
) duplicates;
SELECT count(*) AS orphan_breaks FROM public.break_records b LEFT JOIN public.session_progress p ON p.id=b.session_progress_id WHERE p.id IS NULL;
SELECT to_regprocedure('public.start_quiz_attempt(uuid)') IS NOT NULL AS authoritative_start_present,
 to_regprocedure('public.quiz_timing(uuid,integer)') IS NOT NULL AS timer_present,
 to_regprocedure('public.refresh_student_progress()') IS NOT NULL AS mastery_present,
 to_regclass('public.attention_events') IS NOT NULL AS new_attention_table_already_exists;
SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
 AND ((table_name='break_records' AND column_name IN ('student_id','allowed_seconds','ended_reason','agent_decision_id','activities'))
 OR (table_name='session_progress' AND column_name IN ('completed_via','active_updated_at'))
 OR (table_name='session_responses' AND column_name IN ('answer_revealed','wrong_attempts','attempts_before_reveal','revealed_at')))
 ORDER BY table_name,column_name;
-- Require zero duplicate groups/orphans. Existing new fields imply a partial/already-applied rollout:
-- review migration tracking instead of replaying CREATE/ALTER statements.
