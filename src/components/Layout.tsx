import React from 'react';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

export const Layout = () => {
  const { reduceMotion } = useSettings();
  const { profile } = useAuth();

  return (
    <div className="bg-background text-on-background min-h-screen flex">
      <Sidebar />
      <div className="flex-1 ml-0 md:ml-[260px] flex flex-col min-h-screen overflow-x-hidden">
        <TopNav
          studentName={profile?.name ?? 'Student'}
          streakDays={profile?.streak_days ?? 0}
        />
        <main className="flex-1 pt-24 pb-xl px-lg lg:px-xxl w-full max-w-[1200px] mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={window.location.pathname}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};
