import {useEffect,useRef,useState} from 'react';
import {motion} from 'framer-motion';
import {backendRequest} from '../services/backendClient';
import {useSettings} from '../context/SettingsContext';
export interface AttentionPrompt {id:string;shown_at:string;question_type?:string;question_payload:{prompt:string;tiles:number[];objects?:number;title?:string;lesson_label?:string;support_kind?:string;hint?:string;operator?:string;ungraded?:boolean}}
export function AttentionPopup({event,onClose,onBreak}:{event:AttentionPrompt;onClose:(result:{outcome:string;is_correct:boolean|null;response_time_seconds:number|null})=>void;onBreak?:()=>Promise<void>}){
 const {reduceMotion}=useSettings();
 const [answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [result,setResult]=useState<{outcome:string;is_correct:boolean|null;response_time_seconds:number|null}|null>(null);
 const dialog=useRef<HTMLDivElement>(null);
 const [picked,setPicked]=useState<number[]>([]);
 const isReset=event.question_type==='reset';
 const buildTen=event.question_type==='build_ten';
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  dialog.current?.querySelector<HTMLElement>('button,input')?.focus();
  return()=>{requestAnimationFrame(()=>{if(document.getElementById('attention-title'))return;const target=previous?.isConnected&&previous!==document.body?previous:document.getElementById('btn-next-section');target?.focus();});};
 },[]);
 const submit=async(skip=false,takeReset=false)=>{
  if(busy)return;setBusy(true);setError(null);
  try{
   const saved=await backendRequest<{outcome:string;is_correct:boolean|null;response_time_seconds:number|null}>('/attention/answer',
    {event_id:event.id,response:skip?null:Number(answer),skip});
   if(skip){onClose(saved);if(takeReset&&onBreak)await onBreak();}else setResult(saved);
  }catch(e){setError(e instanceof Error?e.message:'Could not record this check-in.');}
  finally{setBusy(false);}
 };
 return <div className="fixed inset-0 z-[70] bg-black/25 flex items-center justify-center p-lg">
  <motion.div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="attention-title" className="bg-surface rounded-2xl p-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto text-center shadow-xl"
   initial={reduceMotion?false:{opacity:0,scale:0.85,y:24}} animate={{opacity:1,scale:1,y:0}} transition={{duration:reduceMotion?0:0.45}}
   onKeyDown={e=>{
    if(e.key==='Escape'&&!busy){e.preventDefault();if(result)onClose(result);else void submit(true);}
    if(e.key==='Tab'){
     const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')||[]);
     const first=nodes[0],last=nodes.at(-1);
     if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
     else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
   }}>
   <h2 id="attention-title" className="text-2xl font-bold text-primary">{event.question_payload.title || 'Quick number adventure'}</h2>
   {event.question_payload.lesson_label && <p className="text-sm text-on-surface-variant mt-2">From our lesson: {event.question_payload.lesson_label}</p>}
   <p className="text-sm mt-2">Just for fun—this does not affect your score.</p>
   <p className="text-xl my-md">{event.question_payload.prompt}</p>
   {event.question_payload.support_kind==='hint' && event.question_payload.hint && <p className="p-md bg-primary/10 rounded-xl">{event.question_payload.hint}</p>}
   {event.question_payload.objects&&<div aria-label={`${event.question_payload.objects} circles`} className="flex flex-wrap justify-center gap-3 my-lg">{Array.from({length:event.question_payload.objects},(_,i)=>buildTen?<button key={i} aria-label={`One ${i+1}`} aria-pressed={picked.includes(i)} disabled={busy||!!result} className={`w-11 h-11 rounded-full border-2 border-primary ${picked.includes(i)?'bg-primary text-on-primary':'bg-primary/10'}`} onClick={()=>{const next=picked.includes(i)?picked:picked.concat(i);setPicked(next);if(next.length===10)setAnswer('1');}}>●</button>:<span key={i} aria-hidden className="w-8 h-8 rounded-full bg-secondary"/>)}</div>}
   {buildTen&&picked.length===10?<motion.div role="status" className="p-md rounded-xl bg-primary/10 text-primary font-bold" initial={reduceMotion?false:{scale:0.9}} animate={{scale:1}}>10 ones → 1 ten!</motion.div>:<div className="flex justify-center gap-md my-lg">{event.question_payload.tiles.map((n,i)=><span key={i} className="flex items-center gap-md">{i>0&&event.question_payload.operator&&<span className="text-3xl">{event.question_payload.operator}</span>}<motion.span className="text-5xl font-bold rounded-xl bg-primary/10 p-md text-primary" initial={reduceMotion?false:{y:12}} animate={{y:0}} transition={{duration:reduceMotion?0:0.4,delay:reduceMotion?0:i*0.08}}>{n}</motion.span></span>)}</div>}
   {result?<><p role="status">{result.is_correct?'You got it! Thanks for checking in.':'Nice try. Let’s continue calmly.'}</p><button className="px-6 py-3 bg-primary text-on-primary rounded-full mt-md" autoFocus onClick={()=>onClose(result)}>Back to lesson</button></>:
   <form onSubmit={e=>{e.preventDefault();void submit();}}>{!isReset&&<><label className="block">Your answer<input type="number" value={answer} onChange={e=>setAnswer(e.target.value)} className="block border rounded-xl p-3 my-md mx-auto w-36" disabled={busy}/></label><button disabled={busy||!answer.trim()} className="rounded-full bg-primary text-on-primary px-6 py-3">Answer</button></>}<button type="button" disabled={busy} onClick={()=>void submit(true)} className="rounded-full border px-6 py-3 ml-3">Keep learning</button>{onBreak&&<button type="button" disabled={busy} onClick={()=>void submit(true,true)} className="rounded-full border px-6 py-3 mt-3">Take a break</button>}</form>}
   {error&&<p role="alert" className="text-error mt-md">{error}</p>}
  </motion.div>
 </div>;
}
