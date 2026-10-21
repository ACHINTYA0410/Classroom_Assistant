import {useEffect,useRef,useState} from 'react';
import {motion} from 'framer-motion';
import {useSession} from '../context/SessionContext';
import {useSettings} from '../context/SettingsContext';
import type {BreakActivity} from '../services/sessionService';
import {stopSpeaking} from '../services/voice';

const names={breathing:'Gentle breathing',doodle:'Doodle pad',bubbles:'Calm bubbles',stretch:'Stretch cards',riddles:'Riddles and fun facts'};
const stretches=['Relax your shoulders and gently roll them back.','Reach your hands up gently, then let them rest.','Look away from the screen and notice something far away.','Open and close your hands slowly.'];
const facts=['What has hands but cannot clap? A clock.','Butterflies taste with their feet.','What gets wetter as it dries? A towel.','An octopus has three hearts.'];
const format=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
export function BreakScreen(){
 const {currentBreak,breakElapsed,resumeFromBreak,updateActivities,breakError}=useSession();
 const {reduceMotion}=useSettings();
 const [selected,setSelected]=useState<BreakActivity['id']>('breathing');
 const [points,setPoints]=useState<string[]>([]),[popped,setPopped]=useState<number[]>([]),[card,setCard]=useState(0);
 const drawing=useRef(false),previous=useRef(breakElapsed),selectedRef=useRef(selected);
 const counts=useRef<BreakActivity[]>(currentBreak?.activities.length?currentBreak.activities.map(a=>({...a})):[{id:'breathing',seconds:0}]);
 const svg=useRef<SVGSVGElement|null>(null);
 useEffect(()=>{selectedRef.current=selected;},[selected]);
 useEffect(()=>{stopSpeaking();void updateActivities(counts.current.map(a=>({...a}))).catch(()=>{});},[updateActivities]);
 useEffect(()=>{
  const delta=Math.max(0,breakElapsed-previous.current);previous.current=breakElapsed;
  if(delta&&document.visibilityState==='visible'){
   let item=counts.current.find(a=>a.id===selectedRef.current);
   if(!item){item={id:selectedRef.current,seconds:0};counts.current.push(item);}
   item.seconds+=delta;
   void updateActivities(counts.current.map(a=>({...a}))).catch(()=>{});
  }
 },[breakElapsed,updateActivities]);
 if(!currentBreak)return null;
 const remaining=Math.max(0,currentBreak.allowed_seconds-breakElapsed);
 const draw=(event:React.PointerEvent<SVGSVGElement>)=>{
  if(!drawing.current||!svg.current)return;
  const rect=svg.current.getBoundingClientRect();
  const x=Math.max(0,Math.min(400,(event.clientX-rect.left)*400/rect.width));
  const y=Math.max(0,Math.min(220,(event.clientY-rect.top)*220/rect.height));
  setPoints(paths=>paths.length?paths.map((p,i)=>i===paths.length-1?p+` L ${x} ${y}`:p):paths);
 };
 return <section aria-label="Break screen" className="max-w-3xl mx-auto bg-surface rounded-2xl p-lg text-center border border-primary/20">
  <h1 className="text-3xl font-bold text-primary">A calm break</h1>
  <p className="my-md">Your lesson is paused. Take a gentle rest.</p>
  <div role="timer" aria-label="Break time" className="text-3xl font-bold my-lg">
   <span>Elapsed {format(breakElapsed)}</span><span className="block text-xl">Remaining {format(remaining)}</span>
  </div>
  <div className="flex flex-wrap justify-center gap-2 mb-lg" aria-label="Break activities">
   {(Object.entries(names) as [BreakActivity['id'],string][]).map(([id,name])=><button key={id} aria-pressed={id===selected} onClick={()=>{setSelected(id);selectedRef.current=id;setCard(0);if(!counts.current.some(a=>a.id===id))counts.current.push({id,seconds:0});void updateActivities(counts.current.map(a=>({...a}))).catch(()=>{});}} className="rounded-full border px-4 py-2">{name}</button>)}
  </div>
  <div className="min-h-64 bg-surface-container-low rounded-xl p-lg">
   {selected==='breathing'&&<div className="flex flex-col items-center gap-lg"><p>Breathe gently in and out. No need to hold your breath.</p><motion.div aria-hidden className="w-28 h-28 rounded-full bg-primary/25 border-4 border-primary/40" animate={reduceMotion?{scale:1}:{scale:[1,1.2,1]}} transition={reduceMotion?{duration:0}:{duration:8,repeat:Infinity,ease:'easeInOut'}}/><p>{reduceMotion?'Breathe at your own comfortable pace.':breakElapsed%8<4?'Breathe gently in…':'Breathe gently out…'}</p></div>}
   {selected==='doodle'&&<><p>Draw anything calm. Keyboard users can add a circle or clear the pad.</p><svg ref={svg} viewBox="0 0 400 220" aria-label="Doodle canvas" className="bg-surface w-full touch-none border rounded-xl" onPointerDown={e=>{drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);const r=e.currentTarget.getBoundingClientRect();setPoints(p=>[...p,`M ${(e.clientX-r.left)*400/r.width} ${(e.clientY-r.top)*220/r.height}`]);}} onPointerMove={draw} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}>{points.map((p,i)=><path key={i} d={p} stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>)}</svg><button className="p-2 underline" onClick={()=>setPoints(p=>[...p,'M 170 110 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0'])}>Add a circle</button><button className="p-2 underline" onClick={()=>setPoints([])}>Clear doodle</button></>}
   {selected==='bubbles'&&<><p>Tap a bubble gently. There is no score or hurry.</p><div className="grid grid-cols-4 gap-lg my-lg">{Array.from({length:12},(_,i)=><button key={i} aria-label={`Bubble ${i+1}`} disabled={popped.includes(i)} onClick={()=>setPopped(p=>[...p,i])} className={`w-12 h-12 rounded-full border-2 border-primary/40 bg-primary/10 ${popped.includes(i)?'opacity-0':''}`}/>)}</div><button onClick={()=>setPopped([])} className="underline">New bubbles</button></>}
   {selected==='stretch'&&<><p className="text-xl my-lg">{stretches[card%stretches.length]}</p><p>Only move in ways that feel comfortable.</p><button className="underline p-3" onClick={()=>setCard(c=>c+1)}>Next stretch</button></>}
   {selected==='riddles'&&<><p className="text-xl my-lg">{facts[card%facts.length]}</p><button className="underline p-3" onClick={()=>setCard(c=>c+1)}>Another riddle or fact</button></>}
  </div>
  {breakError&&<p role="alert" className="text-error my-md">{breakError}</p>}
  <button onClick={()=>void resumeFromBreak()} className="rounded-full bg-primary text-on-primary px-8 py-3 mt-lg">Resume lesson</button>
 </section>;
}
