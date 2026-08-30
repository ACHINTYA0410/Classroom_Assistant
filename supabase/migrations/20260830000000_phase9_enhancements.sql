-- Alter agent_decisions to add student_id
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES profiles(id) DEFAULT auth.uid();

-- Try to update existing agent_decisions rows using their linked_entity_id
-- 1. For reports: linked_entity_id points to reports.id, which has student_id
UPDATE agent_decisions
SET student_id = reports.student_id
FROM reports
WHERE agent_decisions.linked_entity_id = reports.id
  AND agent_decisions.student_id IS NULL;

-- 2. For quiz_attempts: linked_entity_id points to quiz_attempts.id, which has student_id
UPDATE agent_decisions
SET student_id = quiz_attempts.student_id
FROM quiz_attempts
WHERE agent_decisions.linked_entity_id = quiz_attempts.id
  AND agent_decisions.student_id IS NULL;

-- Set RLS policies for agent_decisions
DROP POLICY IF EXISTS "Students can view own agent_decisions" ON agent_decisions;
CREATE POLICY "Students can view own agent_decisions" ON agent_decisions
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can insert own agent_decisions" ON agent_decisions;
CREATE POLICY "Students can insert own agent_decisions" ON agent_decisions
  FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can update own agent_decisions" ON agent_decisions;
CREATE POLICY "Students can update own agent_decisions" ON agent_decisions
  FOR UPDATE TO authenticated USING (student_id = auth.uid());

-- Drop insecure curriculum_embeddings policies
DROP POLICY IF EXISTS "Anyone can insert curriculum_embeddings" ON curriculum_embeddings;
DROP POLICY IF EXISTS "Anyone can delete curriculum_embeddings" ON curriculum_embeddings;

-- Re-create start_quiz_attempt with student_id populated
CREATE OR REPLACE FUNCTION start_quiz_attempt(p_quiz_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_student_id uuid;
  v_week_id uuid;
  v_incomplete_count int;
  v_question_count int;
  v_attempt_id uuid;
  
  -- Quiz Agent Adaptive Time Limit variables
  v_prior_attempts RECORD;
  v_count INT := 0;
  v_acc_sum NUMERIC := 0;
  v_time_sum NUMERIC := 0;
  v_q_count_sum INT := 0;
  v_acc1 NUMERIC := 0;
  v_acc2 NUMERIC := 0;
  v_acc3 NUMERIC := 0;
  v_prev_limit1 NUMERIC := 90;
  
  v_rolling_accuracy NUMERIC := 0;
  v_rolling_time_per_question NUMERIC := 0;
  v_trend TEXT := 'stable';
  v_base_per_question NUMERIC := 90;
  v_reasoning TEXT := 'Used default base time limit for first-ever quiz attempt (cold-start).';
  v_time_limit INT;
BEGIN
  -- 1. Verify auth.uid() is not null
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Lookup the quiz's week_id
  SELECT week_id INTO v_week_id
  FROM quizzes
  WHERE id = p_quiz_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz not found';
  END IF;

  -- 3. Check that ALL sessions for that week (lesson and revision) are completed
  SELECT count(*) INTO v_incomplete_count
  FROM sessions s
  LEFT JOIN session_progress sp 
    ON sp.session_id = s.id 
   AND sp.student_id = v_student_id 
   AND sp.status = 'completed'
  WHERE s.week_id = v_week_id
    AND sp.id IS NULL;

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'Cannot start quiz. Complete all Week 1 learning sessions and revision to unlock your assessment';
  END IF;

  -- 4. Get the question count for the active quiz
  SELECT count(*) INTO v_question_count
  FROM questions
  WHERE topic_id IN (
    SELECT DISTINCT topic_id 
    FROM sessions 
    WHERE week_id = v_week_id
  );

  IF v_question_count = 0 THEN
    v_question_count := 5; -- default placeholder if no questions found
  END IF;

  -- 5. QUIZ AGENT - CALCULATE ADAPTIVE TIME LIMIT
  -- Loop through up to the last 3 completed attempts for the current user
  FOR v_prior_attempts IN (
    SELECT a.id, a.accuracy, a.time_limit_seconds, a.started_at, a.completed_at,
           (SELECT count(*) FROM quiz_responses r WHERE r.quiz_attempt_id = a.id) as response_count
    FROM quiz_attempts a
    WHERE a.student_id = v_student_id
      AND a.status = 'completed'
    ORDER BY a.completed_at DESC
    LIMIT 3
  ) LOOP
    v_count := v_count + 1;
    v_acc_sum := v_acc_sum + v_prior_attempts.accuracy;
    
    DECLARE
      v_time_used NUMERIC;
    BEGIN
      v_time_used := EXTRACT(EPOCH FROM (v_prior_attempts.completed_at - v_prior_attempts.started_at));
      v_time_sum := v_time_sum + v_time_used;
      v_q_count_sum := v_q_count_sum + COALESCE(NULLIF(v_prior_attempts.response_count, 0), 1);
    END;
    
    IF v_count = 1 THEN
      v_acc1 := v_prior_attempts.accuracy;
      v_prev_limit1 := v_prior_attempts.time_limit_seconds / COALESCE(NULLIF(v_prior_attempts.response_count, 0), 1);
    ELSIF v_count = 2 THEN
      v_acc2 := v_prior_attempts.accuracy;
    ELSIF v_count = 3 THEN
      v_acc3 := v_prior_attempts.accuracy;
    END IF;
  END LOOP;

  IF v_count > 0 THEN
    -- Calculate averages
    v_rolling_accuracy := v_acc_sum / v_count;
    v_rolling_time_per_question := v_time_sum / COALESCE(NULLIF(v_q_count_sum, 0), 1);
    
    -- Calculate Trend
    IF v_count = 2 THEN
      IF v_acc1 > v_acc2 THEN
        v_trend := 'improving';
      ELSIF v_acc1 < v_acc2 THEN
        v_trend := 'declining';
      ELSE
        v_trend := 'stable';
      END IF;
    ELSIF v_count = 3 THEN
      IF v_acc1 > ((v_acc2 + v_acc3) / 2.0) THEN
        v_trend := 'improving';
      ELSIF v_acc1 < ((v_acc2 + v_acc3) / 2.0) THEN
        v_trend := 'declining';
      ELSE
        v_trend := 'stable';
      END IF;
    ELSE
      v_trend := 'stable';
    END IF;

    -- Adjust per-question base time
    -- Rolling accuracy boundaries (accuracy is stored 0-100)
    IF v_rolling_accuracy < 60.0 THEN
      v_base_per_question := 90 * 1.5; -- +50%
      v_reasoning := 'Increased time limit per question by 50% due to low accuracy (< 60%).';
    ELSIF v_rolling_accuracy > 85.0 THEN
      v_base_per_question := 90 * 0.8; -- -20%
      v_reasoning := 'Decreased time limit per question by 20% due to high accuracy (> 85%).';
    ELSE
      v_base_per_question := 90;
      v_reasoning := 'Kept base time limit of 90s per question (accuracy between 60% and 85%).';
    END IF;

    -- Declining trend override
    IF v_trend = 'declining' THEN
      IF v_base_per_question < 90 * 1.3 THEN
        v_base_per_question := 90 * 1.3;
        v_reasoning := 'Increased time limit per question by 30% due to a declining performance trend.';
      ELSE
        v_base_per_question := v_base_per_question * 1.1; -- extra 10% pacing buffer
        v_reasoning := v_reasoning || ' Added a 10% declining trend buffer.';
      END IF;
    END IF;

    -- Time usage safeguard
    IF v_rolling_time_per_question >= 0.8 * v_prev_limit1 THEN
      v_base_per_question := v_base_per_question * 1.2;
      v_reasoning := v_reasoning || ' Added 20% time buffer since student is using most of their allocated time.';
    END IF;
  END IF;

  -- Clamp per-question time within [45, 150] seconds
  IF v_base_per_question < 45 THEN
    v_base_per_question := 45;
  ELSIF v_base_per_question > 150 THEN
    v_base_per_question := 150;
  END IF;

  -- Compute final time limit
  v_time_limit := round(v_base_per_question) * v_question_count;

  -- 6. Insert new quiz_attempts row
  INSERT INTO quiz_attempts (
    student_id,
    quiz_id,
    started_at,
    time_limit_seconds,
    score,
    accuracy,
    status
  ) VALUES (
    v_student_id,
    p_quiz_id,
    now(),
    v_time_limit,
    NULL,
    NULL,
    'in_progress'
  )
  RETURNING id INTO v_attempt_id;

  -- 7. Log agent decision
  INSERT INTO agent_decisions (
    student_id,
    agent_name,
    decision_type,
    linked_entity_id,
    input_snapshot,
    output,
    reasoning_summary
  ) VALUES (
    v_student_id,
    'quiz_agent',
    'time_limit_set',
    v_attempt_id,
    jsonb_build_object(
      'rolling_accuracy', v_rolling_accuracy,
      'rolling_time_per_question', v_rolling_time_per_question,
      'trend', v_trend,
      'prior_attempt_count', v_count
    ),
    jsonb_build_object(
      'time_limit_seconds', v_time_limit,
      'base_used', v_base_per_question
    ),
    v_reasoning
  );

  RETURN v_attempt_id;
END;
$$;
