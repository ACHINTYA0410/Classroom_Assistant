-- 1. profiles
CREATE TABLE profiles (
  id uuid primary key references auth.users(id),
  name text not null,
  email text not null,
  grade_level int not null default 2,
  preferred_explanation_style text check (preferred_explanation_style in ('text','visual','analogy')) default 'text',
  streak_days int not null default 0,
  created_at timestamptz not null default now()
);

-- 2. subjects
CREATE TABLE subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- 3. chapters
CREATE TABLE chapters (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id),
  name text not null,
  grade_level int not null,
  order_index int not null,
  created_at timestamptz not null default now()
);

-- 4. weeks
CREATE TABLE weeks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id),
  week_number int not null,
  created_at timestamptz not null default now()
);

-- 5. sessions
CREATE TABLE sessions (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id),
  day_number int not null check (day_number between 1 and 7),
  session_type text not null check (session_type in ('lesson','revision','quiz')),
  title text not null,
  topic_id text,
  topic_name text,
  order_index int not null,
  created_at timestamptz not null default now()
);

-- 6. session_sections
CREATE TABLE session_sections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  section_type text not null check (section_type in ('explanation','practice','interaction','reinforcement')),
  order_index int not null,
  estimated_minutes int not null default 5,
  chunk_id text,
  explanation_style text check (explanation_style in ('text','visual','analogy')),
  content text,
  created_at timestamptz not null default now()
);

-- 7. session_progress
CREATE TABLE session_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  session_id uuid not null references sessions(id),
  status text not null check (status in ('not_started','in_progress','completed')) default 'not_started',
  started_at timestamptz,
  completed_at timestamptz,
  total_active_seconds int not null default 0,
  break_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (student_id, session_id)
);

-- 8. break_records
CREATE TABLE break_records (
  id uuid primary key default gen_random_uuid(),
  session_progress_id uuid not null references session_progress(id),
  break_start timestamptz not null,
  break_end timestamptz,
  duration_seconds int,
  created_at timestamptz not null default now()
);

-- 9. session_responses
CREATE TABLE session_responses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  session_id uuid not null references sessions(id),
  section_id uuid references session_sections(id),
  response_type text not null,
  is_correct boolean,
  attempts int not null default 1,
  time_taken_seconds int,
  misconception_tag text,
  created_at timestamptz not null default now()
);

-- 10. questions
CREATE TABLE questions (
  id uuid primary key default gen_random_uuid(),
  topic_id text not null,
  grade_level int not null,
  template text not null,
  param_a numeric,
  param_b numeric,
  correct_answer numeric not null,
  distractors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 11. quizzes
CREATE TABLE quizzes (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id),
  title text not null,
  created_at timestamptz not null default now()
);

-- 12. quiz_attempts
CREATE TABLE quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  quiz_id uuid not null references quizzes(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  time_limit_seconds int not null,
  score numeric,
  accuracy numeric,
  status text not null check (status in ('in_progress','completed','abandoned')) default 'in_progress'
);

-- 13. quiz_responses
CREATE TABLE quiz_responses (
  id uuid primary key default gen_random_uuid(),
  quiz_attempt_id uuid not null references quiz_attempts(id),
  question_id uuid not null references questions(id),
  selected_answer numeric,
  is_correct boolean,
  time_taken_seconds int,
  misconception_tag text,
  created_at timestamptz not null default now()
);

-- 14. student_progress
CREATE TABLE student_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  topic_id text not null,
  topic_name text not null,
  mastery_status text not null check (mastery_status in ('weak','in_progress','mastered')) default 'in_progress',
  primary_misconception_tag text,
  last_updated timestamptz not null default now(),
  unique (student_id, topic_id)
);

-- 15. reports
CREATE TABLE reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  quiz_attempt_id uuid references quiz_attempts(id),
  generated_at timestamptz not null default now(),
  stats_snapshot jsonb not null default '{}'::jsonb,
  narrative text
);

-- 16. agent_decisions
CREATE TABLE agent_decisions (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null check (agent_name in ('teaching_agent','quiz_agent','report_agent')),
  decision_type text not null,
  linked_entity_id uuid,
  input_snapshot jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  reasoning_summary text,
  retrieved_context_ids jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS Activation
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;

-- Policies for Profiles
CREATE POLICY "Students can view own profile" ON profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Students can update own profile" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Students can insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Read-only curriculum tables for authenticated users
CREATE POLICY "Anyone can view subjects" ON subjects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view chapters" ON chapters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view weeks" ON weeks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view sessions" ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view session_sections" ON session_sections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view questions" ON questions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view quizzes" ON quizzes FOR SELECT TO authenticated USING (true);

-- session_progress
CREATE POLICY "Students can view own session_progress" ON session_progress FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY "Students can insert own session_progress" ON session_progress FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own session_progress" ON session_progress FOR UPDATE TO authenticated USING (student_id = auth.uid());

-- break_records
CREATE POLICY "Students can view own break_records" ON break_records FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM session_progress WHERE session_progress.id = break_records.session_progress_id AND session_progress.student_id = auth.uid())
);
CREATE POLICY "Students can insert own break_records" ON break_records FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM session_progress WHERE session_progress.id = break_records.session_progress_id AND session_progress.student_id = auth.uid())
);
CREATE POLICY "Students can update own break_records" ON break_records FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM session_progress WHERE session_progress.id = break_records.session_progress_id AND session_progress.student_id = auth.uid())
);

-- session_responses
CREATE POLICY "Students can view own session_responses" ON session_responses FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY "Students can insert own session_responses" ON session_responses FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own session_responses" ON session_responses FOR UPDATE TO authenticated USING (student_id = auth.uid());

-- quiz_attempts
CREATE POLICY "Students can view own quiz_attempts" ON quiz_attempts FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY "Students can insert own quiz_attempts" ON quiz_attempts FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own quiz_attempts" ON quiz_attempts FOR UPDATE TO authenticated USING (student_id = auth.uid());

-- quiz_responses
CREATE POLICY "Students can view own quiz_responses" ON quiz_responses FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM quiz_attempts WHERE quiz_attempts.id = quiz_responses.quiz_attempt_id AND quiz_attempts.student_id = auth.uid())
);
CREATE POLICY "Students can insert own quiz_responses" ON quiz_responses FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM quiz_attempts WHERE quiz_attempts.id = quiz_responses.quiz_attempt_id AND quiz_attempts.student_id = auth.uid())
);
CREATE POLICY "Students can update own quiz_responses" ON quiz_responses FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM quiz_attempts WHERE quiz_attempts.id = quiz_responses.quiz_attempt_id AND quiz_attempts.student_id = auth.uid())
);

-- student_progress
CREATE POLICY "Students can view own student_progress" ON student_progress FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY "Students can insert own student_progress" ON student_progress FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own student_progress" ON student_progress FOR UPDATE TO authenticated USING (student_id = auth.uid());

-- reports
CREATE POLICY "Students can view own reports" ON reports FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY "Students can insert own reports" ON reports FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own reports" ON reports FOR UPDATE TO authenticated USING (student_id = auth.uid());
