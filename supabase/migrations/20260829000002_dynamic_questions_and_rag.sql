-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Alter questions table to support templates
ALTER TABLE questions ALTER COLUMN correct_answer DROP NOT NULL;
ALTER TABLE questions ALTER COLUMN param_a DROP NOT NULL;
ALTER TABLE questions ALTER COLUMN param_b DROP NOT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS param_a_min numeric;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS param_a_max numeric;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS param_b_min numeric;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS param_b_max numeric;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS distractor_rules jsonb default '[]'::jsonb;
ALTER TABLE questions DROP COLUMN IF EXISTS distractors;

-- 3. Create quiz_attempt_questions table
CREATE TABLE IF NOT EXISTS quiz_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_attempt_id uuid not null references quiz_attempts(id) on delete cascade,
  template_id uuid not null references questions(id),
  param_a numeric not null,
  param_b numeric not null,
  correct_answer numeric not null,
  distractors jsonb not null default '[]'::jsonb,
  order_index int not null,
  created_at timestamptz not null default now()
);

-- 4. Enable RLS and create policies for quiz_attempt_questions
ALTER TABLE quiz_attempt_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own quiz_attempt_questions" ON quiz_attempt_questions
  FOR SELECT TO authenticated USING (
    quiz_attempt_id IN (SELECT id FROM quiz_attempts WHERE student_id = auth.uid())
  );

CREATE POLICY "Students can insert own quiz_attempt_questions" ON quiz_attempt_questions
  FOR INSERT TO authenticated WITH CHECK (
    quiz_attempt_id IN (SELECT id FROM quiz_attempts WHERE student_id = auth.uid())
  );

-- 5. Alter quiz_responses foreign key to point to quiz_attempt_questions
ALTER TABLE quiz_responses DROP CONSTRAINT IF EXISTS quiz_responses_question_id_fkey;
ALTER TABLE quiz_responses ADD CONSTRAINT quiz_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES quiz_attempt_questions(id);

-- 6. Create curriculum_embeddings table
CREATE TABLE IF NOT EXISTS curriculum_embeddings (
  id uuid primary key default gen_random_uuid(),
  session_section_id uuid not null references session_sections(id) on delete cascade,
  grade_level int not null,
  chapter_id uuid not null,
  topic_id text not null,
  embedding vector(768) not null,
  source_text text not null
);

-- 7. Enable RLS and create policies for curriculum_embeddings
ALTER TABLE curriculum_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view curriculum_embeddings" ON curriculum_embeddings
  FOR SELECT TO authenticated USING (true);

-- 8. Create match_curriculum_embeddings function
CREATE OR REPLACE FUNCTION match_curriculum_embeddings(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_topic_id text,
  p_chapter_id uuid
)
RETURNS TABLE (
  id uuid,
  session_section_id uuid,
  grade_level int,
  chapter_id uuid,
  topic_id text,
  source_text text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.session_section_id,
    c.grade_level,
    c.chapter_id,
    c.topic_id,
    c.source_text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM curriculum_embeddings c
  WHERE c.topic_id = p_topic_id
    AND c.chapter_id = p_chapter_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
