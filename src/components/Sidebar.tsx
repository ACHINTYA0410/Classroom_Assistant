import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, HelpCircle, TrendingUp, Award, Users, Settings, FileText } from 'lucide-react';

export const Sidebar = () => {
  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Lessons', path: '/lessons', icon: BookOpen },
    { name: 'Quizzes', path: '/quiz', icon: HelpCircle },
    { name: 'Progress', path: '/progress', icon: TrendingUp },
    { name: 'Reports', path: '/reports', icon: FileText },
    { name: 'Badges & Streaks', path: '/streaks', icon: Award },
    { name: 'Educator View', path: '/educator', icon: Users },
  ];

  return (
    <nav className="h-full w-sidebar-width fixed left-0 top-0 bg-surface shadow-[16px_0_24px_rgba(67,97,130,0.08)] z-50 flex flex-col py-md px-sm hidden md:flex">
      <div className="flex items-center gap-4 mb-xl px-4 py-2">
        <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary">
          <BookOpen size={24} />
        </div>
        <div>
          <h1 className="font-headline-md text-headline-md font-bold text-primary">Inclusive Assistant</h1>
          <p className="font-label-sm text-label-sm text-on-surface-variant">Safe Learning</p>
        </div>
      </div>
      <ul className="flex flex-col gap-2 flex-1">
        {navItems.map((item) => (
          <li key={item.name}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl font-label-lg text-label-lg transition-colors duration-200 ${
                  isActive
                    ? 'bg-surface-container text-primary font-bold border-r-4 border-primary scale-98'
                    : 'text-on-surface-variant hover:bg-surface-container active:scale-95'
                }`
              }
            >
              <item.icon size={20} />
              <span>{item.name}</span>
            </NavLink>
          </li>
        ))}
        <li className="mt-auto">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl font-label-lg text-label-lg transition-colors duration-200 ${
                isActive
                  ? 'bg-surface-container text-primary font-bold border-r-4 border-primary scale-98'
                  : 'text-on-surface-variant hover:bg-surface-container active:scale-95'
              }`
            }
          >
            <Settings size={20} />
            <span>Settings</span>
          </NavLink>
        </li>
      </ul>
    </nav>
  );
};
