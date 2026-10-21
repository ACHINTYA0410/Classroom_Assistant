import {useEffect} from 'react';
import {motion} from 'framer-motion';
export function QuizCelebration({onDone}:{onDone:()=>void}){
 useEffect(()=>{const timer=setTimeout(onDone,2500);return()=>clearTimeout(timer);},[onDone]);
 return <div role="dialog" aria-modal="true" aria-label="Quiz celebration" className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-lg bg-background/95" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onDone();}if(e.key==='Tab'){e.preventDefault();e.currentTarget.querySelector<HTMLButtonElement>('button')?.focus();}}}>
  <h2 className="text-3xl text-primary font-bold">Every question correct. Well done!</h2>
  <div aria-hidden className="relative w-64 h-40 overflow-hidden">
   {Array.from({length:12},(_,i)=><motion.span key={i} className="absolute w-3 h-5 rounded bg-secondary" style={{left:`${i*8}%`}}
    initial={{y:-20,rotate:0,opacity:0}} animate={{y:140,rotate:i%2?90:-90,opacity:[0,1,1,0]}} transition={{duration:2.2,delay:i%3*0.1,ease:'easeOut'}}/>)}
  </div>
  <button autoFocus className="bg-primary text-on-primary rounded-full px-6 py-3" onClick={onDone}>Skip celebration</button>
 </div>;
}
