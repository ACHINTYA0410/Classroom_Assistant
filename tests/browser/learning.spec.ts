// Browser contract tests use synthetic Auth/PostgREST/API responses.
// Real API -> graph -> SQL/RLS behavior is tested separately in pytest.
import {test,expect,type Page} from '@playwright/test';
const uid='00000000-0000-4000-8000-000000000001';
const sid='00000000-0000-4000-8000-000000000006';
const qid='00000000-0000-4000-8000-000000000007';
const section='00000000-0000-4000-8000-000000000008';
const user={id:uid,aud:'authenticated',role:'authenticated',email:'student@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const profile={...user,name:'Test Learner',grade_level:2,preferred_explanation_style:'text',onboarding_completed:true};
const report={id:qid,quiz_attempt_id:qid,generated_at:'2026-10-11T10:00:00Z',narrative:'Keep practicing addition with regrouping.',stats_snapshot:{current_score:100,previous_score:70,score_delta:30,trend:'improving',weak_topics:[],strong_topics:[]}};
interface Options {completed?:boolean;down?:boolean;reduced?:boolean;practice?:boolean;attention?:boolean;testMode?:boolean;six?:boolean;perfect?:boolean;reportPending?:boolean;legacyGap?:boolean;buildTen?:boolean}
async function setup(page:Page, options:Options={}){
 const {completed=false,down=false,reduced=false,practice=false,attention=false,testMode=false,six=false,perfect=true,reportPending=false}=options;
 const calls:{path:string;body:any;authorization:string|undefined}[]=[];
 const completedIds=new Set(completed?[sid]:[]);
 let recentEnd:any=null,openBreak:any=null,wrong=0,attempts=0,revealed=false,correct=false,seconds=attention?310:0,reportReads=0;
 const controls={nearExpiry:false,expiredAway:false,baseline:60,attentionDown:false};
 let lastAttentionSeconds=-1000,attentionCount=0;
 const sessions=Array.from({length:six?6:1},(_,i)=>({id:i===0?sid:`00000000-0000-4000-8000-${String(10+i).padStart(12,'0')}`,title:`Addition lesson ${i+1}`,topic_id:'addition',topic_name:'Adding ones and tens',order_index:i+1,day_number:i+1,session_type:i===5?'revision':'lesson'}));
 if(options.legacyGap){completedIds.add(sid);completedIds.add(sessions[2].id);}
 const sections=Array.from({length:attention?8:practice?3:2},(_,i)=>({
  id:i===0?section:`00000000-0000-4000-8000-${String(20+i).padStart(12,'0')}`,chunk_id:`part-${i}`,section_type:practice&&i===1?'practice':'explanation',explanation_style:'text',
  content:i===0?'Add the ones first, then the tens.':i===1&&!practice?'Regroup ten ones as one ten.':`Lesson part ${i+1}.`,order_index:i+1,
  ...(practice&&i===1?{question_prompt:'12 + 13 = ?',correct_answer:25,question_format:'numeric_input'}:{})
 }));
 await page.context().addInitScript(({user,reduced})=>{
  localStorage.setItem('sb-browser-test-auth-token',JSON.stringify({access_token:'browser-fixture-token',refresh_token:'fixture-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}));
  localStorage.setItem('reduceMotion',String(reduced));
 },{user,reduced});
 await page.context().route('https://browser-test.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').at(-1);
  let data:any=[];
  if(url.pathname.includes('/auth/v1/user'))data=user;
  else if(table==='profiles')data=profile;
  else if(table==='weeks')data={id:qid,chapter_id:qid};
  else if(table==='sessions')data=sessions;
  else if(table==='session_sections')data=sections;
  else if(table==='quizzes')data={id:qid,title:'Weekly Assessment',week_id:qid};
  else if(table==='session_progress')data=[...completedIds].map(id=>({id:qid,session_id:id,status:'completed',completed_via:'lesson_flow'}));
  await route.fulfill({json:data});
 });
 const practiceState=()=>({attempts,wrongAttempts:wrong,answerRevealed:revealed,isCorrect:correct&&!revealed,canReveal:wrong>=2});
 await page.context().route('http://127.0.0.1:8199/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
  const body=request.postDataJSON();calls.push({path,body,authorization:request.headers().authorization});
  if(down)return route.abort('connectionrefused');
  let result:any={};
  if(path.endsWith('/breaks/status')){
   if(controls.expiredAway){openBreak=null;recentEnd={id:qid,ended_reason:'expired_while_away'};result={server_now:new Date().toISOString(),break:null,expired:true,recent_end:recentEnd};controls.expiredAway=false;}
   else result={server_now:new Date().toISOString(),break:openBreak,recent_end:recentEnd};
  }
  else if(path.endsWith('/learning/session')){
   if(body.total_active_seconds!==undefined)seconds=body.total_active_seconds;
   if(body.complete)completedIds.add(body.session_id);
   result={id:qid,total_active_seconds:seconds,status:completedIds.has(body.session_id)?'completed':'in_progress'};
  }
  else if(path.endsWith('/breaks/request')){
   openBreak={id:qid,session_progress_id:qid,session_id:sid,break_start:new Date(Date.now()-(controls.nearExpiry?299000:0)).toISOString(),allowed_seconds:300,activities:[],agent_decision_id:qid};
   result={server_now:new Date().toISOString(),break:openBreak,reasoning_summary:'A calm pause.'};
  }
  else if(path.endsWith('/breaks/resume')){openBreak=null;result={server_now:new Date().toISOString(),break:null};}
  else if(path.endsWith('/breaks/activities')){if(openBreak)openBreak.activities=body.activities;result={saved:true};}
  else if(path.includes('/practice/state/'))result=practiceState();
  else if(path.endsWith('/practice/answer')){attempts++;correct=body.answer===25;if(!correct)wrong++;result={...practiceState(),explanation:correct?'Correct':'Try again'};}
  else if(path.endsWith('/practice/reveal')){revealed=true;result={...practiceState(),answer:25,explanation:'Ones: 2 + 3 = 5. Tens: 1 + 1 = 2. Result: 25.'};}
  else if(path.endsWith('/attention/check')){
   if(controls.attentionDown)return route.fulfill({status:503,json:{detail:'Attention temporarily unavailable'},headers:{'Access-Control-Allow-Origin':'*'}});
   const eligible=attention&&body.enabled&&body.interruptible&&!body.finished&&!openBreak&&body.visible_seconds>=controls.baseline*1.5&&body.idle_seconds>=25&&body.visible_seconds-lastAttentionSeconds>=120&&attentionCount<3;
   const event=eligible?{id:qid,shown_at:new Date().toISOString(),question_type:options.buildTen?'build_ten':'addition',question_payload:{title:'Quick number adventure',lesson_label:'Addition with regrouping',prompt:options.buildTen?'Tap ten ones to build a ten. How many tens did you make?':'Add these two numbers.',tiles:options.buildTen?[10]:[2,3],objects:options.buildTen?10:undefined,operator:'+',ungraded:true}}:null;
   if(eligible){lastAttentionSeconds=body.visible_seconds;attentionCount++;}
   result={action:eligible?'check_in':'continue',event,reason:'Personalized fixture policy',next_check_seconds:15};
  }
  else if(path.endsWith('/attention/answer'))result={outcome:body.skip?'skipped':'answered',is_correct:body.skip?null:body.response===(options.buildTen?1:5),response_time_seconds:2};
  else if(path.endsWith('/test-tools'))result={enabled:testMode};
  else if(path.endsWith('/test-tools/complete')){if(!testMode)return route.fulfill({status:403,json:{detail:'Test tools disabled'},headers:{'Access-Control-Allow-Origin':'*'}});completedIds.add(body.session_id);result={completed_via:'calendar_test_shortcut'};}
  else if(path.endsWith('/teaching/ask'))result={answer:'Make one ten from ten ones.',sufficient_context:true,fallback:false,context_ids:[section]};
  else if(path.endsWith('/quiz/start'))result={attempt_id:qid,started_at:new Date().toISOString(),time_limit_seconds:630,remaining_seconds:630,status:'in_progress',answered_question_ids:[],adaptive:{},explanation:'Standard pace.',questions:Array.from({length:7},(_,i)=>({id:`question-${i}`,template:'{a} + {b} = ?',a:10+i,b:10,options:[20+i,30+i,40+i,50+i]}))};
  else if(path.endsWith('/quiz/answer'))result={isCorrect:true,explanation:'Great job!',misconceptionTag:null};
  else if(path.endsWith('/quiz/finish'))result={fullMarks:perfect,correctCount:perfect?7:6,totalQuestions:7,scorePercentage:perfect?100:600/7,accuracyPercentage:perfect?100:600/7,missedQuestions:perfect?[]:[{questionText:'12+10',correctAnswer:22,selectedAnswer:32}],report:reportPending?null:report};
  else if(path.endsWith('/reports/generate'))result=report;
  else if(path.endsWith('/reports')){reportReads++;result=reportPending&&reportReads<3?[]:[report];}
  await route.fulfill({json:{result,request_id:'browser-test'},headers:{'Access-Control-Allow-Origin':'*'}});
 });
 return {calls,controls};
}
async function finish(page:Page){
 await page.getByRole('button',{name:'Start Assessment'}).click();
 for(let i=0;i<7;i++){
  await expect(page.getByText(`Question ${i+1} of 7`,{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'A quick number check-in'})).toHaveCount(0);
  await page.getByRole('button',{name:String(20+i),exact:true}).click();
  await page.getByRole('button',{name:i<6?'Next Question':'Finish Quiz'}).click();
 }
}

test('lesson asks with bearer and advances immediately without per-step animation',async({page})=>{
 const {calls}=await setup(page);
 await page.goto('/lessons');
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByPlaceholder('e.g., Why do we carry the ten?').fill('How do I regroup?');
 await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect(page.getByText('Make one ten from ten ones.')).toBeVisible();
 expect(calls.find(c=>c.path.endsWith('/teaching/ask'))?.authorization).toBe('Bearer browser-fixture-token');
 await page.getByRole('button',{name:"I'm ready for the next part"}).click();
 await expect(page.getByText('Regroup ten ones as one ten.',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('break locks lesson, has five local activities, retains state on refresh and resumes',async({page})=>{
 await setup(page);
 await page.goto('/lessons');
 await page.getByRole('button',{name:'Break Mode',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A calm break'})).toBeVisible();
 await expect(page.getByRole('timer')).toContainText('Remaining 5:00');
 await expect(page.getByPlaceholder('e.g., Why do we carry the ten?')).toBeHidden();
 await expect(page.getByRole('button',{name:"I'm ready for the next part"})).toBeHidden();
 await page.getByRole('button',{name:'Doodle pad',exact:true}).click();
 await page.getByRole('button',{name:'Add a circle'}).click();
 await expect(page.locator('svg[aria-label="Doodle canvas"] path')).toHaveCount(1);
 await page.getByRole('button',{name:'Calm bubbles',exact:true}).click();
 await page.getByRole('button',{name:'Bubble 1',exact:true}).click();
 await expect(page.getByRole('button',{name:'Bubble 1',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Stretch cards',exact:true}).click();
 await page.getByRole('button',{name:'Next stretch'}).click();
 await expect(page.getByText('Reach your hands up gently, then let them rest.')).toBeVisible();
 await page.getByRole('button',{name:'Riddles and fun facts',exact:true}).click();
 await expect(page.getByText('What has hands but cannot clap? A clock.')).toBeVisible();
 await page.screenshot({path:'test-results/break-screen.png',fullPage:true});
 await page.reload();
 await expect(page.getByRole('heading',{name:'A calm break'})).toBeVisible();
 await expect(page.getByRole('timer')).toContainText('Elapsed');
 await page.getByRole('button',{name:'Resume lesson'}).click();
 await expect(page.getByRole('heading',{name:'A calm break'})).toHaveCount(0);
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Break Mode',exact:true})).toBeEnabled();
});

test('break deadline automatically resumes and lazy expiry restores the lesson',async({page})=>{
 const {controls,calls}=await setup(page);
 controls.nearExpiry=true;
 await page.goto('/lessons');
 await page.getByRole('button',{name:'Break Mode',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A calm break'})).toBeVisible();
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible({timeout:5000});
 expect(calls.find(c=>c.path.endsWith('/breaks/resume'))?.body.timeout).toBe(true);
 controls.nearExpiry=false;
 await page.getByRole('button',{name:'Break Mode',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A calm break'})).toBeVisible();
 controls.expiredAway=true;
 await page.reload();
 await expect(page.getByText('Your break has ended. Welcome back, gently.',{exact:false})).toBeVisible();
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
});

test('Teaching Agent check-in appears while idle on the first section without Next, then restores it',async({page})=>{
 await page.clock.install();
 const {calls}=await setup(page,{attention:true});
 await page.goto('/lessons');
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.clock.runFor(105000);
 const dialog=page.getByRole('dialog',{name:'Quick number adventure'});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('spinbutton').fill('5');
 await dialog.getByRole('button',{name:'Answer',exact:true}).click();
 await expect(dialog.getByText('You got it! Thanks for checking in.')).toBeVisible();
 await dialog.getByRole('button',{name:'Back to lesson'}).click();
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:"I'm ready for the next part"}).click();
 await expect(page.getByText('Regroup ten ones as one ten.',{exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path.endsWith('/attention/show'))).toHaveLength(0);
 expect(calls.find(c=>c.path.endsWith('/attention/check'))?.authorization).toBe('Bearer browser-fixture-token');
 expect(calls.find(c=>c.path.endsWith('/attention/answer'))?.body.response).toBe(5);
 await page.screenshot({path:'test-results/attention-lesson.png',fullPage:true});
});

test('attention Escape records skip and focus returns to Next',async({page})=>{
 await page.clock.install();
 const {calls}=await setup(page,{attention:true});
 await page.goto('/lessons');
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.clock.runFor(105000);
 await expect(page.getByRole('dialog',{name:'Quick number adventure'})).toBeVisible();
 await page.keyboard.press('Shift+Tab');
 await expect(page.getByRole('button',{name:'Take a break',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(calls.find(c=>c.path.endsWith('/attention/answer'))?.body.skip).toBe(true);
 await expect(page.getByRole('button',{name:"I'm ready for the next part"})).toBeFocused();
});

test('practice reveal appears after two wrong answers, persists and allows supported continuation',async({page})=>{
 const {calls}=await setup(page,{practice:true});
 await page.goto('/lessons');
 await page.getByRole('button',{name:"I'm ready for the next part"}).click();
 await expect(page.getByRole('button',{name:'Show answer and explanation'})).toHaveCount(0);
 await page.getByPlaceholder('Type your answer').fill('24');
 await page.getByRole('button',{name:'Submit Answer'}).click();
 await expect(page.getByRole('button',{name:'Show answer and explanation'})).toHaveCount(0);
 await page.getByPlaceholder('Type your answer').fill('23');
 await page.getByRole('button',{name:'Submit Answer'}).click();
 await page.getByRole('button',{name:'Show answer and explanation'}).click();
 await expect(page.getByText('Answer: 25',{exact:true})).toBeVisible();
 await expect(page.getByText('Ones: 2 + 3 = 5. Tens: 1 + 1 = 2. Result: 25.')).toBeVisible();
 await page.reload();
 await expect(page.getByText('Answer: 25',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:"I'm ready for the next part"})).toBeEnabled();
 expect(calls.filter(c=>c.path.endsWith('/practice/answer'))).toHaveLength(2);
});

for(const perfect of [true,false]){
 test(`quiz ${perfect?'full marks celebrates':'lower score does not celebrate'} and View Report targets the completed attempt`,async({page})=>{
  const {calls}=await setup(page,{completed:true,perfect});
  await page.goto('/quiz');await finish(page);
  if(perfect){await expect(page.getByRole('dialog',{name:'Quiz celebration'})).toBeVisible();await page.getByRole('button',{name:'Skip celebration'}).click();}
  else await expect(page.getByRole('dialog',{name:'Quiz celebration'})).toHaveCount(0);
  await expect(page.getByText('Assessment Summary',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View Report'}).click();
  await expect(page).toHaveURL(new RegExp(`reports\\?attempt=${qid}`));
  await expect(page.getByText(report.narrative,{exact:true})).toBeVisible();
  expect(calls.filter(c=>c.path.endsWith('/quiz/answer'))).toHaveLength(7);
 });
}
test('pending report shows loading, polls and displays only the ready report',async({page})=>{
 const {calls}=await setup(page,{reportPending:true,completed:true});
 await page.goto(`/reports?attempt=${qid}`);
 await expect(page.getByText('Loading reports...')).toBeVisible();
 await expect(page.getByText(report.narrative,{exact:true})).toBeVisible({timeout:8000});
 expect(calls.filter(c=>c.path.endsWith('/reports')).length).toBeGreaterThanOrEqual(2);
});
test('server-flagged calendar marks all six days and unlocks quiz',async({page})=>{
 const {calls}=await setup(page,{testMode:true,six:true});
 await page.goto('/dashboard');
 await expect(page.getByText('Test mode',{exact:true})).toBeVisible();
 for(let i=0;i<6;i++){
  await expect(page.getByRole('button',{name:'Attend',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Locked',exact:true})).toHaveCount(5-i);
  const buttons=page.getByRole('button',{name:'Mark as done',exact:true});
  await expect(buttons.first()).toBeEnabled();
  for(let j=1;j<6-i;j++)await expect(buttons.nth(j)).toBeDisabled();
  await expect(page.getByRole('button',{name:'Take Quiz',exact:true})).toHaveCount(0);
  await buttons.first().click();
  await expect(page.getByRole('button',{name:'Mark as done',exact:true})).toHaveCount(5-i);
 }
 await expect(page.getByRole('button',{name:'Take Quiz',exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path.endsWith('/test-tools/complete'))).toHaveLength(6);
});

test('dashboard locks later lessons and a navigation-state bypass cannot load them',async({page})=>{
 await setup(page,{six:true});
 await page.goto('/dashboard');
 await expect(page.getByRole('button',{name:'Attend',exact:true})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Locked',exact:true})).toHaveCount(5);
 await expect(page.getByRole('button',{name:'Locked',exact:true}).first()).toBeDisabled();
 // Reproduce React Router navigation to a locked day without using its disabled button.
 await page.evaluate(()=>{
  history.pushState({usr:{sessionId:'00000000-0000-4000-8000-000000000011'},key:'bypass'},'', '/lessons');
  window.dispatchEvent(new PopStateEvent('popstate'));
 });
 await expect(page.getByRole('alert')).toContainText('Complete the earlier sessions in order');
 await expect(page.getByPlaceholder('e.g., Why do we carry the ten?')).toHaveCount(0);
});

test('old Day 3 completion cannot bypass missing Day 2 and existing progress is preserved',async({page})=>{
 await setup(page,{six:true,testMode:true,legacyGap:true});
 await page.goto('/dashboard');
 await expect(page.getByText('2/6 done',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Attend',exact:true})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Locked',exact:true})).toHaveCount(4);
 await page.getByRole('button',{name:'Mark as done',exact:true}).first().click();
 await expect(page.getByText('3/6 done',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Review',exact:true})).toHaveCount(3);
 await expect(page.getByRole('button',{name:'Attend',exact:true})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Locked',exact:true})).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Take Quiz',exact:true})).toHaveCount(0);
});
test('flag off hides calendar tools and obsolete navigation is absent',async({page})=>{
 await setup(page,{six:true});
 await page.goto('/dashboard');
 await expect(page.getByText('Weekly Curriculum & Progress',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Mark as done',exact:true})).toHaveCount(0);
 await expect(page.getByText('Test mode',{exact:true})).toHaveCount(0);
 await expect(page.locator('a[href="/streaks"]')).toHaveCount(0);
});
test('backend failure preserves static lesson and supplies quiz/report retry states',async({page})=>{
 await setup(page,{down:true,reduced:true,completed:true});
 await page.goto('/quiz');await page.getByRole('button',{name:'Start Assessment'}).click();
 await expect(page.getByRole('alert')).toContainText('unavailable');
 await page.goto('/reports');await expect(page.getByRole('alert')).toContainText('unavailable');
});
test('in-app Reduce Motion gives static celebration; OS setting keeps attention and break animation still',async({page})=>{
 await setup(page,{completed:true,reduced:true});
 await page.goto('/quiz');await finish(page);
 await expect(page.getByRole('dialog',{name:'Quiz celebration'})).toHaveCount(0);
 await expect(page.getByText('Every question correct. Well done!',{exact:true})).toBeVisible();
});
test('OS Reduce Motion makes breathing static and lesson has no forward animation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await setup(page);
 await page.goto('/lessons');
 await page.getByRole('button',{name:"I'm ready for the next part"}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Break Mode',exact:true}).click();
 const circle=page.locator('[aria-label="Break screen"] .rounded-full.border-4');
 await expect(circle).toHaveCSS('transform','none');
});

test('open break survives tab close and blocks a new quiz route',async({page,context})=>{
 await setup(page);
 await page.goto('/lessons');await page.getByRole('button',{name:'Break Mode',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A calm break'})).toBeVisible();
 await page.close();
 const returned=await context.newPage();
 await returned.goto('/quiz');
 await expect(returned.getByRole('heading',{name:'A calm break'})).toBeVisible();
 await expect(returned).toHaveURL(/lessons/);
 await expect(returned.getByRole('button',{name:'Start Assessment'})).toBeHidden();
 await returned.getByRole('button',{name:'Resume lesson'}).click();
 await expect(returned.getByRole('button',{name:'Break Mode',exact:true})).toBeEnabled();
});
test('attention numbers stay large and still under reduced motion',async({page})=>{
 await page.clock.install();
 await page.emulateMedia({reducedMotion:'reduce'});
 await setup(page,{attention:true});
 await page.goto('/lessons');
 await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.clock.runFor(105000);
 const dialog=page.getByRole('dialog',{name:'Quick number adventure'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('.text-5xl').first()).toHaveCSS('font-size','48px');
 await expect(dialog.locator('.text-5xl').first()).toHaveCSS('transform','none');
 await page.screenshot({path:'test-results/attention-popup.png',fullPage:true});
 await dialog.getByRole('button',{name:'Keep learning',exact:true}).click();
});

test('student baseline changes popup timing and typing postpones interruptions',async({page})=>{
 await page.clock.install();
 const {controls,calls}=await setup(page,{attention:true});controls.baseline=150;
 await page.goto('/lessons');await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.clock.runFor(105000);await expect(page.getByRole('dialog')).toHaveCount(0);
 controls.baseline=60;
 for(let i=0;i<4;i++){
  await page.getByPlaceholder('e.g., Why do we carry the ten?').fill(`Thinking ${i}`);
  await page.clock.runFor(8000);await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 expect(calls.some(call=>call.path.endsWith('/attention/check')&&!call.body.interruptible)).toBe(true);
 await page.clock.runFor(45000);await expect(page.getByRole('dialog',{name:'Quick number adventure'})).toBeVisible();
});

test('curriculum build-ten interaction is ungraded and offers a real break',async({page})=>{
 await page.clock.install();await setup(page,{attention:true,buildTen:true});
 await page.goto('/lessons');await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.clock.runFor(105000);
 const dialog=page.getByRole('dialog',{name:'Quick number adventure'});
 await expect(dialog.getByText('From our lesson: Addition with regrouping')).toBeVisible();
 for(let i=1;i<=10;i++)await dialog.getByRole('button',{name:`One ${i}`,exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('1 ten');
 await expect(dialog.getByRole('spinbutton')).toHaveValue('1');
 await dialog.getByRole('button',{name:'Take a break',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A calm break'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Quick number adventure'})).toHaveCount(0);
});

test('disabled check-ins, hidden tabs, and temporary attention failures do not interrupt learning',async({page})=>{
 await page.clock.install();const {controls}=await setup(page,{attention:true});
 await page.goto('/settings');await page.getByRole('checkbox',{name:'Learning check-ins',exact:true}).uncheck();
 await page.goto('/lessons');await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.clock.runFor(105000);await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto('/settings');await page.getByRole('checkbox',{name:'Learning check-ins',exact:true}).check();
 await page.goto('/lessons');await expect(page.getByText('Add the ones first, then the tens.',{exact:true})).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.runFor(105000);await expect(page.getByRole('dialog')).toHaveCount(0);
 controls.attentionDown=true;
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.runFor(15000);await expect(page.getByText('Attention support is temporarily unavailable.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:"I'm ready for the next part"}).click();
 await expect(page.getByText('Regroup ten ones as one ten.',{exact:true})).toBeVisible();
 controls.attentionDown=false;await page.clock.runFor(15000);
 await expect(page.getByText('Attention support is temporarily unavailable.',{exact:false})).toHaveCount(0);
});
