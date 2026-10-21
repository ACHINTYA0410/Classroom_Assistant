import {useEffect} from 'react';
import {Sidebar} from './Sidebar';
import {TopNav} from './TopNav';
import {Outlet,useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {useSession} from '../context/SessionContext';
import {BreakScreen} from './BreakScreen';

export function Layout(){
 const {profile}=useAuth();
 const {isOnBreak,currentBreak,breakLoading,breakError,breakMessage,clearBreakMessage}=useSession();
 const location=useLocation(),navigate=useNavigate();
 const breakId=currentBreak?.id,breakSession=currentBreak?.session_id;
 useEffect(()=>{
  if(breakId&&breakSession&&location.pathname!=='/lessons')navigate('/lessons',{replace:true,state:{sessionId:breakSession}});
 },[breakId,breakSession,location.pathname,navigate]);
 return <div className="bg-background text-on-background min-h-screen flex">
  <Sidebar/>
  <div className="flex-1 ml-0 md:ml-[260px] flex flex-col min-h-screen overflow-x-hidden">
   <TopNav studentName={profile?.name??'Student'}/>
   <main className="flex-1 pt-24 pb-xl px-lg lg:px-xxl w-full max-w-[1200px] mx-auto">
    {breakLoading&&<p>Checking your learning session...</p>}
    {isOnBreak&&<BreakScreen/>}
    <div hidden={breakLoading||isOnBreak} inert={breakLoading||isOnBreak}>
     {!isOnBreak&&breakError&&<p aria-live="polite" className="text-error mb-md">{breakError}</p>}
     {breakMessage&&<div role="status" className="p-md bg-primary/10 rounded-xl mb-md">{breakMessage} <button className="underline ml-2" onClick={clearBreakMessage}>Dismiss</button></div>}
     <Outlet/>
    </div>
   </main>
  </div>
 </div>;
}
