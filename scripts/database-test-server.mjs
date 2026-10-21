// TEST ONLY: a deliberately small PostgREST-compatible adapter over ephemeral PGlite.
// This verifies the production HTTP client + graph + SQL, not hosted Supabase infrastructure.
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createTestDatabase, seedTestDatabase, fixture } from './test-database.mjs';

const db = await createTestDatabase();
await seedTestDatabase(db);
const secret = 'isolated-unit-test-signing-secret-32-characters';
const service = 'isolated-service-key';
const allowedTables = new Set(['profiles','session_sections','student_progress','reports','agent_decisions']);
const identifier = name => { if (!/^[a-z_]+$/.test(name)) throw Error('Invalid identifier'); return '"'+name+'"'; };
let queue = Promise.resolve();
async function dispatch(req,res) {
  const url = new URL(req.url,'http://localhost');
  let body = '';
  for await (const part of req) body += part;
  body = body ? JSON.parse(body) : {};
  const bearer = req.headers.authorization?.slice(7);
  let role = 'authenticated', user;
  if (bearer === service) role = 'service_role';
  else {
    const parts = bearer?.split('.') || [];
    if (parts.length !== 3) throw Object.assign(Error('Unauthorized'),{status:401});
    const expected = createHmac('sha256',secret).update(parts[0]+'.'+parts[1]).digest();
    const signature = Buffer.from(parts[2],'base64url');
    if (expected.length !== signature.length || !timingSafeEqual(expected,signature)) throw Object.assign(Error('Unauthorized'),{status:401});
    user = JSON.parse(Buffer.from(parts[1],'base64url')).sub;
  }
  await db.exec('SET ROLE '+role);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user || '']);
  let result;
  try {
    if (url.pathname === '/__test__/complete-lesson' && role === 'service_role') {
      await db.query("INSERT INTO session_progress(student_id,session_id,status) VALUES($1,$2,'completed') ON CONFLICT(student_id,session_id) DO UPDATE SET status='completed'",[fixture.a,fixture.session]);
      result = {ok:true};
    } else if (url.pathname === '/__test__/embedding' && role === 'service_role') {
      await db.query(`INSERT INTO curriculum_embeddings(session_section_id,grade_level,chapter_id,topic_id,embedding,source_text,embedding_model,embedding_dimension)
        VALUES($1,2,$2,'addition_2_digit_regrouping',$3,'Add the ones first, regroup ten ones as a ten, then add the tens.',$4,768)`,[fixture.section,fixture.chapter,JSON.stringify(body.vector),body.model]);
      result = {ok:true};
    } else if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').at(-1);
      const keys = Object.keys(body);
      const args = keys.map((key,i)=>identifier(key)+' => $'+(i+1)).join(',');
      const values = Object.values(body).map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value);
      if (name === 'match_curriculum') result = (await db.query(`SELECT * FROM public.${identifier(name)}(${args})`,values)).rows;
      else result = (await db.query(`SELECT public.${identifier(name)}(${args}) AS result`,values)).rows[0].result;
    } else {
      const table = url.pathname.split('/').at(-1);
      if (!allowedTables.has(table)) throw Error('Unexpected test table');
      if (req.method === 'GET') {
        const values=[],conditions=[];
        for (const [key,value] of url.searchParams) {
          if (['select','limit','order'].includes(key)) continue;
          if (!value.startsWith('eq.')) throw Error('Unsupported test filter');
          values.push(value.slice(3)); conditions.push('t.'+identifier(key)+'=$'+values.length);
        }
        const selection = table === 'session_sections' ? `t.*,jsonb_build_object('topic_id',s.topic_id,'weeks',jsonb_build_object('chapter_id',w.chapter_id,'chapters',jsonb_build_object('grade_level',c.grade_level))) AS sessions` : 't.*';
        const joins = table === 'session_sections' ? 'JOIN sessions s ON s.id=t.session_id JOIN weeks w ON w.id=s.week_id JOIN chapters c ON c.id=w.chapter_id' : '';
        result = (await db.query(`SELECT ${selection} FROM public.${identifier(table)} t ${joins} ${conditions.length?'WHERE '+conditions.join(' AND '):''}`,values)).rows;
      } else {
        result=[];
        for (const row of Array.isArray(body)?body:[body]) {
          const keys=Object.keys(row);
          const conflict=url.searchParams.get('on_conflict');
          const clause=conflict?' ON CONFLICT('+conflict.split(',').map(identifier).join(',')+') DO UPDATE SET '+keys.map(k=>identifier(k)+'=EXCLUDED.'+identifier(k)).join(','):'';
          const values=Object.values(row).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
          result.push(...(await db.query(`INSERT INTO public.${identifier(table)}(${keys.map(identifier).join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})${clause} RETURNING *`,values)).rows);
        }
      }
    }
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result));
  } finally { await db.exec('RESET ROLE'); }
}
const server=http.createServer((req,res)=>{
  // One connection owns one role at a time in this embedded engine.
  queue=queue.then(()=>dispatch(req,res)).catch(error=>{
    res.writeHead(error.status || (error.code==='42501'?403:400),{'Content-Type':'application/json'});
    res.end(JSON.stringify({code:error.code || 'test_adapter',message:error.message}));
  });
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,fixture})));
