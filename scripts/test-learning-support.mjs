import assert from 'node:assert/strict';
import {createTestDatabase,seedTestDatabase,asUser,fixture as f} from './test-database.mjs';
const db=await createTestDatabase(); let checks=0;
const ok=(condition,message)=>{assert.ok(condition,message);checks++;};
const rpc=async(name,args=[]) => (await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
const user=(fn)=>asUser(db,f.a,fn);
const service=async(fn)=>{await db.exec('SET ROLE service_role');try{return await fn();}finally{await db.exec('RESET ROLE');}};
const reject=async(fn,regex)=>{await assert.rejects(fn,regex);checks++;};
try{
 await seedTestDatabase(db);
 const strong={wrong_attempts:0,reveals:0,practice_accuracy:100,popup_misses:0,active_seconds:0,since_break_seconds:0,breaks_today:0};
 ok(await rpc('break_allowance',[strong])===300,'fresh strong student gets 300');
 const stressed={wrong_attempts:4,reveals:2,practice_accuracy:20,popup_misses:3,active_seconds:2000,since_break_seconds:1300,breaks_today:3};
 ok(await rpc('break_allowance',[stressed])===600,'struggling student gets 600');
 for(const key of ['wrong_attempts','reveals','popup_misses','active_seconds','since_break_seconds','breaks_today']){
  let prior=300;
  for(const value of [0,1,2,3,4,10,600,1200,1800,10000]){
   const allowance=await rpc('break_allowance',[{...strong,[key]:value}]);
   ok(allowance>=prior&&allowance>=300&&allowance<=600&&allowance%30===0,`bounded monotonic ${key}`);prior=allowance;
  }
 }
 let priorAccuracy=300;
 for(const accuracy of [100,85,84,60,59,0]){const value=await rpc('break_allowance',[{...strong,practice_accuracy:accuracy}]);ok(value>=priorAccuracy,'lower accuracy never shortens allowance');priorAccuracy=value;}
 const p=await user(()=>rpc('learning_progress',[f.session]));
 await reject(()=>asUser(db,f.b,()=>rpc('begin_learning_break',[f.a,p.id])),/permission denied/);
 const state=await service(()=>rpc('begin_learning_break',[f.a,p.id]));const b=state.break;
 ok(b.allowed_seconds===300&&b.agent_decision_id,'allowance audited and linked');
 ok((await service(()=>rpc('begin_learning_break',[f.a,p.id]))).break.id===b.id,'start retry resumes same break');
 await reject(()=>db.query('INSERT INTO break_records(student_id,session_progress_id,break_start) VALUES($1,$2,now())',[f.a,p.id]),/unique/);
 await reject(()=>user(()=>rpc('learning_progress',[f.session,300,true])),/Resume your break/);
 await reject(()=>user(()=>rpc('record_practice_answer',[f.section,25,100,3])),/Resume your break/);
 await reject(()=>user(()=>rpc('reveal_practice_answer',[f.section])),/Resume your break/);
 await reject(()=>user(()=>rpc('start_quiz_attempt',[f.quiz])),/Resume your break/);
 await reject(()=>user(()=>rpc('check_learning_available')),/Resume your break/);
 await reject(()=>service(()=>rpc('calendar_test_complete',[f.a,f.session])),/Resume your break/);
 await reject(()=>user(()=>db.query('UPDATE session_progress SET status=\'completed\' WHERE id=$1',[p.id])),/permission denied/);
 await reject(()=>user(()=>db.query('UPDATE break_records SET allowed_seconds=600 WHERE id=$1',[b.id])),/permission denied/);
 await reject(()=>asUser(db,f.b,()=>rpc('end_learning_break',[b.id,[],false])),/not owned/);
 await db.query("UPDATE break_records SET break_start=clock_timestamp()-interval '100 seconds' WHERE id=$1",[b.id]);
 const resumed=await user(()=>rpc('end_learning_break',[b.id,[{id:'breathing',seconds:50},{id:'doodle',seconds:40}],false]));
 ok(resumed.break===null,'early resume clears lock');
 let row=(await db.query('SELECT * FROM break_records WHERE id=$1',[b.id])).rows[0];
 ok(row.ended_reason==='resumed_early'&&row.duration_seconds>=100,'server duration and early reason');
 ok(row.activities.length===2,'activities recorded');
 let practice=await user(()=>rpc('record_practice_answer',[f.section,24,999,2]));
 ok(practice.attempts===1&&!practice.canReveal,'client cannot forge attempts; no reveal before two wrong');
 await reject(()=>user(()=>rpc('reveal_practice_answer',[f.section])),/Two wrong attempts/);
 practice=await user(()=>rpc('record_practice_answer',[f.section,23,999,2]));
 ok(practice.attempts===2&&practice.canReveal,'reveal after exactly two wrong');
 const reveal=await user(()=>rpc('reveal_practice_answer',[f.section]));
 ok(reveal.answer===25&&reveal.explanation.includes('Ones: 2 + 3 = 5'),'worked solution uses actual operands');
 ok(reveal.answerRevealed&&!reveal.isCorrect,'reveal not independently correct');
 await db.query("UPDATE session_sections SET question_prompt='58 + 36 = ?',correct_answer=94 WHERE id=$1",[f.section]);
 const carryReveal=await user(()=>rpc('reveal_practice_answer',[f.section]));
 ok(carryReveal.answer===94&&carryReveal.explanation.includes('Ones: 8 + 6 = 14')&&carryReveal.explanation.includes('Carry 1 ten'),'regrouping explanation uses actual numbers and carry');
 await db.query("UPDATE session_sections SET question_prompt='12 + 13 = ?',correct_answer=25 WHERE id=$1",[f.section]);
 const saved=(await db.query('SELECT * FROM session_responses WHERE student_id=$1',[f.a])).rows[0];
 ok(saved.attempts_before_reveal===2&&saved.revealed_at,'reveal metadata persisted');
 const mastery=await user(()=>rpc('refresh_student_progress'));
 ok(mastery[0].mastery_status==='weak','reveal-heavy topic weak for quiz selection');
 await user(()=>rpc('learning_progress',[f.session,0,true]));
 const supportedAttempt=await user(()=>rpc('start_quiz_attempt',[f.quiz]));
 const supportedPlan=await user(()=>rpc('get_quiz_plan',[supportedAttempt]));
 ok(supportedPlan.adaptive.support_topics.includes('addition_2_digit_regrouping'),'real reveal-heavy topic included in selection input');
 await user(()=>rpc('finish_quiz_attempt',[supportedAttempt]));
 await db.query("UPDATE session_sections SET section_type='explanation' WHERE id=$1",[f.section]);
 const event=await service(()=>rpc('show_attention',[f.a,f.section,'section_boundary','addition',{prompt:'2 + 3',tiles:[2,3],answer:5}]));
 await reject(()=>asUser(db,f.b,()=>rpc('answer_attention',[event.id,5,false])),/not owned/);
 const answered=await user(()=>rpc('answer_attention',[event.id,5,false]));
 ok(answered.is_correct&&answered.outcome==='answered'&&answered.response_time_seconds>=0,'attention server grades and records response time');
 ok((await asUser(db,f.b,()=>db.query('SELECT * FROM attention_events'))).rows.length===0,'attention RLS');
 const second=(await service(()=>rpc('begin_learning_break',[f.a,p.id]))).break;
 await db.query("UPDATE break_records SET break_start=clock_timestamp()-make_interval(secs=>allowed_seconds+30) WHERE id=$1",[second.id]);
 const expired=await user(()=>rpc('learning_break_status'));
 ok(expired.expired&&expired.break===null,'lazy expiry on return');
 row=(await db.query('SELECT * FROM break_records WHERE id=$1',[second.id])).rows[0];
 ok(row.ended_reason==='expired_while_away'&&row.duration_seconds===row.allowed_seconds,'lazy expiry clamps at deadline');
 const third=(await service(()=>rpc('begin_learning_break',[f.a,p.id]))).break;
 await db.query('UPDATE break_records SET break_start=clock_timestamp()-make_interval(secs=>allowed_seconds+1) WHERE id=$1',[third.id]);
 await user(()=>rpc('end_learning_break',[third.id,[],true]));
 ok((await db.query('SELECT ended_reason FROM break_records WHERE id=$1',[third.id])).rows[0].ended_reason==='timeout','foreground timeout reason');
 ok((await db.query('SELECT total_active_seconds,break_count FROM session_progress WHERE id=$1',[p.id])).rows[0].total_active_seconds===0,'break/away time not active');
 ok((await db.query('SELECT break_count FROM session_progress WHERE id=$1',[p.id])).rows[0].break_count===3,'accurate break count');
 await reject(()=>user(()=>rpc('calendar_test_complete',[f.a,f.session])),/permission denied/);
 ok((await service(()=>rpc('calendar_test_complete',[f.a,f.session]))).completed_via==='lesson_flow','shortcut retry preserves a genuine completed lesson');
 // Isolated fixture reset: exercise the shortcut on unfinished learning with existing practice, not a completed real lesson.
 await db.query("UPDATE session_progress SET status='in_progress',completed_at=NULL WHERE id=$1",[p.id]);
 await service(()=>rpc('calendar_test_complete',[f.a,f.session]));
 ok((await db.query('SELECT completed_via FROM session_progress WHERE id=$1',[p.id])).rows[0].completed_via==='calendar_test_shortcut','shortcut provenance');
 const attempt=await user(()=>rpc('start_quiz_attempt',[f.quiz]));
 const plan=await user(()=>rpc('get_quiz_plan',[attempt]));
 for(const question of plan.questions)await user(()=>rpc('submit_quiz_answer',[attempt,question.id,question.a+question.b,1]));
 const result=await user(()=>rpc('finish_quiz_attempt',[attempt]));
 ok(result.fullMarks&&result.scorePercentage===100,'server computes full marks');
 ok(plan.adaptive.support_topics.length===0,'shortcut reveal data cannot bias quiz selection');
 const source=await user(()=>rpc('student_report_input',[attempt]));
 ok(source.practice.length===0&&source.breaks.length===0&&source.attention.length===0,'shortcut excluded from engagement');
 // Six required sessions still gate the quiz; only the test completion path changes provenance.
 await db.query('UPDATE quiz_attempts SET status=\'abandoned\' WHERE id=$1',[attempt]);
 for(let i=2;i<=6;i++)await db.query("INSERT INTO sessions(week_id,day_number,session_type,title,topic_id,order_index) VALUES($1,$2,$3,'Test day','addition_2_digit_regrouping',$2)",[f.week,i,i===6?'revision':'lesson']);
 await reject(()=>user(()=>rpc('start_quiz_attempt',[f.quiz])),/required lessons/);
 const days=(await db.query('SELECT id FROM sessions WHERE week_id=$1 ORDER BY order_index',[f.week])).rows;
 await reject(()=>user(()=>rpc('learning_progress',[days[2].id])),/earlier sessions in order/);
 await reject(()=>service(()=>rpc('calendar_test_complete',[f.a,days[2].id])),/earlier sessions in order/);
 ok((await db.query('SELECT id FROM session_progress WHERE student_id=$1 AND session_id=$2',[f.a,days[2].id])).rows.length===0,'locked requests cannot create progress');
 for(let index=0;index<days.length;index++){
  await service(()=>rpc('calendar_test_complete',[f.a,days[index].id]));
  if(index<days.length-1)await reject(()=>user(()=>rpc('start_quiz_attempt',[f.quiz])),/required lessons/);
 }
 await reject(()=>asUser(db,f.b,()=>rpc('learning_progress',[days[1].id])),/earlier sessions in order/);
 // Reproduce historical out-of-order completion in this isolated fixture only.
 await db.exec('ALTER TABLE session_progress DISABLE TRIGGER session_progress_sequential_access');
 await db.query("INSERT INTO session_progress(student_id,session_id,status) VALUES($1,$2,'completed')",[f.b,days[2].id]);
 await db.exec('ALTER TABLE session_progress ENABLE TRIGGER session_progress_sequential_access');
 await service(()=>rpc('calendar_test_complete',[f.b,days[0].id]));
 await reject(()=>asUser(db,f.b,()=>rpc('learning_progress',[days[2].id])),/earlier sessions in order/);
 await reject(()=>service(()=>rpc('calendar_test_complete',[f.b,days[3].id])),/earlier sessions in order/);
 await service(()=>rpc('calendar_test_complete',[f.b,days[1].id]));
 ok((await asUser(db,f.b,()=>rpc('learning_progress',[days[2].id]))).status==='completed','existing completion preserved when the earlier gap closes');
 const lowerAttempt=await user(()=>rpc('start_quiz_attempt',[f.quiz]));
 ok(!!lowerAttempt,'quiz unlock after all six database completions');
 const lowerPlan=await user(()=>rpc('get_quiz_plan',[lowerAttempt]));
 const first=lowerPlan.questions[0];await user(()=>rpc('submit_quiz_answer',[lowerAttempt,first.id,first.a+first.b,1]));
 ok(!(await user(()=>rpc('finish_quiz_attempt',[lowerAttempt]))).fullMarks,'non-perfect score never full marks');
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated learning support SQL/RLS'}));
}finally{await db.close();}
