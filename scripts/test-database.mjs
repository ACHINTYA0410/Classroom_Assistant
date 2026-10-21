// Isolated PostgreSQL + pgvector integration. No Docker, network or student data.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function createTestDatabase() {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;`);
  for (const name of ['20260829000000_init_schema.sql','20260829000001_quiz_unlock.sql',
    '20260829000002_dynamic_questions_and_rag.sql','20260829000003_seed_templates.sql','20260830000000_phase9_enhancements.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  }
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;');
  await db.exec(await readFile(new URL('../supabase/migrations/20261011000000_fastapi_authoritative_agents.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261012000000_learning_support.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261014150610_sequential_session_access.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261014154103_adaptive_attention_support.sql',import.meta.url),'utf8'));
  return db;
}

export const fixture = {
  a:'00000000-0000-4000-8000-000000000001', b:'00000000-0000-4000-8000-000000000002',
  subject:'00000000-0000-4000-8000-000000000003', chapter:'00000000-0000-4000-8000-000000000004',
  week:'00000000-0000-4000-8000-000000000005', session:'00000000-0000-4000-8000-000000000006',
  quiz:'00000000-0000-4000-8000-000000000007', section:'00000000-0000-4000-8000-000000000008',
};
export async function seedTestDatabase(db) {
  const f=fixture;
  await db.exec(`INSERT INTO auth.users(id,email) VALUES('${f.a}','a@example.test'),('${f.b}','b@example.test');
    INSERT INTO public.subjects(id,name,slug) VALUES('${f.subject}','Mathematics','mathematics');
    INSERT INTO public.chapters(id,subject_id,name,grade_level,order_index) VALUES('${f.chapter}','${f.subject}','Addition',2,1);
    INSERT INTO public.weeks(id,chapter_id,week_number) VALUES('${f.week}','${f.chapter}',1);
    INSERT INTO public.sessions(id,week_id,day_number,session_type,title,topic_id,topic_name,order_index)
      VALUES('${f.session}','${f.week}',1,'lesson','Addition lesson','addition_2_digit_regrouping','Addition',1);
    INSERT INTO public.session_sections(id,session_id,section_type,order_index,content,question_prompt,correct_answer)
      VALUES('${f.section}','${f.session}','practice',1,'Add the ones and then the tens.','12 + 13 = ?',25);
    INSERT INTO public.quizzes(id,week_id,title) VALUES('${f.quiz}','${f.week}','Test assessment');`);
}

export async function asUser(db, user, operation) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  try { return await operation(); }
  finally { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub','',false)"); }
}

async function main() {
  const db=await createTestDatabase();
  let checks=0;
  const ok=(condition,message)=>{assert.ok(condition,message); checks++;};
  try {
    await seedTestDatabase(db);
    const f=fixture;
    const rpc=async(name,args=[]) => (await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
    await assert.rejects(asUser(db,f.a,()=>rpc('start_quiz_attempt',[f.quiz])),/required lessons/); checks++;
    await db.query("INSERT INTO session_progress(student_id,session_id,status) VALUES($1,$2,'completed')",[f.a,f.session]);
    const attempt=await asUser(db,f.a,()=>rpc('start_quiz_attempt',[f.quiz]));
    ok(attempt===await asUser(db,f.a,()=>rpc('start_quiz_attempt',[f.quiz])),'resume is idempotent');
    const plan=await asUser(db,f.a,()=>rpc('get_quiz_plan',[attempt]));
    ok(plan.questions.length===7,'seven generated questions');
    ok(plan.time_limit_seconds===630,'timer uses actual question count');
    ok(!JSON.stringify(plan).includes('correct_answer'),'plan hides answer key');
    ok(plan.questions.every(q=>new Set(q.options).size===4),'four distinct options');
    await assert.rejects(asUser(db,f.b,()=>rpc('get_quiz_plan',[attempt])),/not owned/); checks++;
    await assert.rejects(asUser(db,f.a,()=>db.query('SELECT * FROM agent_decisions')),/permission denied/); checks++;
    await assert.rejects(asUser(db,f.a,()=>db.query('SELECT * FROM quiz_attempt_questions')),/permission denied/); checks++;
    await assert.rejects(asUser(db,f.a,()=>db.query('UPDATE quiz_attempts SET score=100 WHERE id=$1',[attempt])),/permission denied/); checks++;
    const q=plan.questions[0], answer=q.a+q.b;
    const response=await asUser(db,f.a,()=>rpc('submit_quiz_answer',[attempt,q.id,answer,5]));
    ok(response.isCorrect,'server grades answer');
    await asUser(db,f.a,()=>rpc('submit_quiz_answer',[attempt,q.id,answer,5]));
    ok(Number((await db.query('SELECT count(*) FROM quiz_responses WHERE quiz_attempt_id=$1',[attempt])).rows[0].count)===1,'retry does not duplicate answer');
    await assert.rejects(asUser(db,f.a,()=>rpc('submit_quiz_answer',[attempt,q.id,answer+1,5])),/already submitted/); checks++;
    await assert.rejects(asUser(db,f.b,()=>rpc('finish_quiz_attempt',[attempt])),/not owned/); checks++;
    const finished=await asUser(db,f.a,()=>rpc('finish_quiz_attempt',[attempt]));
    ok(Math.abs(finished.scorePercentage-100/7)<0.001,'score includes unanswered questions');
    ok(finished.missedQuestions.length===6,'review reveals only after finish');
    await asUser(db,f.a,()=>rpc('finish_quiz_attempt',[attempt]));
    const progress=await asUser(db,f.a,()=>rpc('refresh_student_progress'));
    ok(progress.length===1,'mastery refreshed');
    ok((await asUser(db,f.b,()=>db.query('SELECT * FROM student_progress'))).rows.length===0,'RLS isolates progress');
    const source=await asUser(db,f.a,()=>rpc('student_report_input',[attempt]));
    ok(source.history.length===1,'report source is user scoped');
    await assert.rejects(asUser(db,f.a,()=>db.query('INSERT INTO reports(student_id,quiz_attempt_id) VALUES($1,$2)',[f.a,attempt])),/permission denied/); checks++;
    await db.exec('SET ROLE service_role');
    await db.query('INSERT INTO reports(student_id,quiz_attempt_id) VALUES($1,$2)',[f.a,attempt]);
    await db.exec('RESET ROLE');
    ok((await asUser(db,f.a,()=>db.query('SELECT * FROM reports'))).rows.length===1,'student can read backend report');
    ok((await asUser(db,f.b,()=>db.query('SELECT * FROM reports'))).rows.length===0,'cross-student report reads denied');
    await assert.rejects(asUser(db,f.a,()=>db.query("UPDATE reports SET narrative='forged'")),/permission denied/); checks++;
    const practice=await asUser(db,f.a,()=>rpc('record_practice_answer',[f.section,25,1,2]));
    ok(practice.isCorrect,'practice graded server side');
    const progressId=(await db.query('SELECT id FROM session_progress WHERE student_id=$1',[f.a])).rows[0].id;
    await assert.rejects(asUser(db,f.b,()=>rpc('increment_break_count',[progressId])),/permission denied/); checks++;
    await db.exec('SET ROLE anon');
    await assert.rejects(rpc('increment_break_count',[progressId]),/permission denied/); checks++;
    await db.exec('RESET ROLE');
    const vectorValue='['+Array.from({length:768},(_,i)=>i===0?1:0).join(',')+']';
    await db.query(`INSERT INTO curriculum_embeddings(session_section_id,grade_level,chapter_id,topic_id,embedding,source_text,embedding_model,embedding_dimension)
      VALUES($1,2,$2,'addition_2_digit_regrouping',$3,'Add ones, then tens.','test-model',768)`,[f.section,f.chapter,vectorValue]);
    // SQL RETURNS TABLE via SELECT is represented as row values; use SELECT * for direct assertions.
    const retrieve=async(topic,model,grade=2)=>(await asUser(db,f.a,()=>db.query('SELECT * FROM match_curriculum($1,$2,$3,$4,$5,768,0.2,4)',[vectorValue,topic,f.chapter,grade,model]))).rows;
    ok((await retrieve('addition_2_digit_regrouping','test-model')).length===1,'retrieval returns matching topic');
    ok((await retrieve('other','test-model')).length===0,'retrieval excludes other topics');
    ok((await retrieve('addition_2_digit_regrouping','other-model')).length===0,'retrieval excludes different embedding model');
    ok((await retrieve('addition_2_digit_regrouping','test-model',3)).length===0,'retrieval enforces grade');
    const expired=await asUser(db,f.a,()=>rpc('start_quiz_attempt',[f.quiz]));
    const expiredPlan=await asUser(db,f.a,()=>rpc('get_quiz_plan',[expired]));
    await db.query("UPDATE quiz_attempts SET started_at=now()-interval '1 hour' WHERE id=$1",[expired]);
    const eq=expiredPlan.questions[0];
    await assert.rejects(asUser(db,f.a,()=>rpc('submit_quiz_answer',[expired,eq.id,eq.a+eq.b,1])),/expired/); checks++;
    ok((await asUser(db,f.a,()=>rpc('finish_quiz_attempt',[expired]))).scorePercentage===0,'expired unanswered quiz scores zero');
    await assert.rejects(asUser(db,f.a,()=>rpc('submit_quiz_answer',[expired,q.id,answer,1])),/not in attempt/); checks++;
    const historyId=(await db.query(`INSERT INTO quiz_attempts(student_id,quiz_id,status,score,accuracy,time_limit_seconds,started_at,completed_at)
      VALUES($1,$2,'completed',55,55,90,now()-interval '10 seconds',now()) RETURNING id`,[f.b,f.quiz])).rows[0].id;
    await db.query(`INSERT INTO quiz_attempt_questions(quiz_attempt_id,template_id,param_a,param_b,correct_answer,distractors,order_index)
      SELECT $1,template_id,param_a,param_b,correct_answer,distractors,0 FROM quiz_attempt_questions WHERE id=$2`,[historyId,q.id]);
    ok((await rpc('quiz_timing',[f.b,7])).time_limit_seconds===945,'SQL low-accuracy history adds time');
    await db.query('UPDATE quiz_attempts SET accuracy=90 WHERE id=$1',[historyId]);
    ok((await rpc('quiz_timing',[f.b,7])).time_limit_seconds===504,'SQL high-accuracy history shortens pace');
    await db.query("UPDATE quiz_attempts SET started_at=completed_at-interval '80 seconds' WHERE id=$1",[historyId]);
    ok((await rpc('quiz_timing',[f.b,7])).seconds_per_question===86,'SQL time-usage buffer rounds');
    await db.query('UPDATE quiz_attempts SET accuracy=55 WHERE id=$1',[historyId]);
    ok((await rpc('quiz_timing',[f.b,7])).seconds_per_question===150,'SQL timer is clamped');
    console.log(JSON.stringify({status:'passed',checks,engine:'PGlite PostgreSQL + pgvector',scope:'isolated synthetic SQL/RLS; not hosted Supabase'}));
  } finally { await db.close(); }
}
if (process.argv[1]?.endsWith('test-database.mjs')) {
  try { await main(); } catch (error) { console.error({message:error.message,code:error.code,detail:error.detail,where:error.where}); process.exitCode=1; }
}
