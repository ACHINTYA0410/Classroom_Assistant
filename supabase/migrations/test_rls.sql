DO $$
DECLARE
  user_a_id uuid := gen_random_uuid();
  user_b_id uuid := gen_random_uuid();
  session_id_val uuid := gen_random_uuid();
  week_id_val uuid := gen_random_uuid();
  chapter_id_val uuid := gen_random_uuid();
  subject_id_val uuid := gen_random_uuid();
  user_a_count int;
  user_b_count int;
BEGIN
  -- Insert into subjects, chapters, weeks, sessions to satisfy FKs
  INSERT INTO subjects (id, name, slug) VALUES (subject_id_val, 'Math', 'math');
  INSERT INTO chapters (id, subject_id, name, grade_level, order_index) VALUES (chapter_id_val, subject_id_val, 'Chapter 1', 2, 1);
  INSERT INTO weeks (id, chapter_id, week_number) VALUES (week_id_val, chapter_id_val, 1);
  INSERT INTO sessions (id, week_id, day_number, session_type, title, order_index) VALUES (session_id_val, week_id_val, 1, 'lesson', 'Session 1', 1);

  -- Insert into auth.users
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  VALUES
    ('00000000-0000-0000-0000-000000000000', user_a_id, 'authenticated', 'authenticated', 'usera@example.com', 'dummy', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', user_b_id, 'authenticated', 'authenticated', 'userb@example.com', 'dummy', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  -- Insert profiles
  INSERT INTO profiles (id, name, email) VALUES (user_a_id, 'User A', 'usera@example.com');
  INSERT INTO profiles (id, name, email) VALUES (user_b_id, 'User B', 'userb@example.com');

  -- Insert session_progress for both users
  INSERT INTO session_progress (student_id, session_id) VALUES (user_a_id, session_id_val);
  INSERT INTO session_progress (student_id, session_id) VALUES (user_b_id, session_id_val);

  -- Simulate User A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', user_a_id), true);

  -- Query as User A
  SELECT count(*) INTO user_a_count FROM session_progress;

  -- Verify User A only sees their own rows (count = 1)
  IF user_a_count != 1 THEN
    RAISE EXCEPTION 'RLS failed for User A! Expected 1 row, got %', user_a_count;
  END IF;

  -- Verify User A does not see User B's row
  SELECT count(*) INTO user_b_count FROM session_progress WHERE student_id = user_b_id;
  IF user_b_count != 0 THEN
    RAISE EXCEPTION 'RLS failed for User A! User A can see User B data.';
  END IF;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

END $$;
