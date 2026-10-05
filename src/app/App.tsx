import { useQuery } from '@tanstack/react-query';
import { Activity, Dumbbell, Scale, Settings as SettingsIcon, TrendingUp, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { db } from '../db/client';
import { BodyScreen } from '../features/body/BodyScreen';
import { ExerciseDetailScreen } from '../features/exercises/ExerciseDetail';
import { ExerciseFormScreen } from '../features/exercises/ExerciseForm';
import { Onboarding } from '../features/onboarding/Onboarding';
import { ProgressScreen } from '../features/progress/ProgressScreen';
import { RoutineEditor } from '../features/routines/RoutineEditor';
import { RoutinesScreen } from '../features/routines/RoutinesScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { WorkoutScreen } from '../features/workout/WorkoutScreen';
import { SummaryScreen } from '../features/workout/SummaryScreen';
import { useElapsed } from '../features/workout/useElapsed';
import { fmtDuration } from '../shared/time';
import { Toaster } from '../ui/toast';
import { useActiveWorkoutId, useSettings } from './queries';

const TABS = [
  { to: '/', label: 'Today', icon: Activity, end: true },
  { to: '/routines', label: 'Routines', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/body', label: 'Body', icon: Scale },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <Icon size={24} strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function ResumePill() {
  const id = useActiveWorkoutId();
  const nav = useNavigate();
  const { data: w } = useQuery({ queryKey: ['workout', id], queryFn: () => db.getWorkout(id!), enabled: !!id });
  const elapsed = useElapsed(w?.started_at ?? null);
  if (!id || !w) return null;
  const current = w.exercises.find((e) => e.sets.some((s) => !s.completed_at));
  return (
    <button type="button" className="resume-pill" onClick={() => nav('/workout')} aria-label="Resume workout">
      <span className="num">{fmtDuration(elapsed)}</span>
      <span className="grow ellipsis" style={{ textAlign: 'left', fontWeight: 600 }}>
        {current ? current.exercise.name : w.name}
      </span>
      <span style={{ fontWeight: 600 }}>Resume</span>
    </button>
  );
}

function TabLayout() {
  return (
    <div className="app">
      <Outlet />
      <ResumePill />
      <TabBar />
    </div>
  );
}

function StorageWarning() {
  const { data } = useQuery({ queryKey: ['boot'], queryFn: () => db.boot() });
  const [hidden, setHidden] = useState(false);
  if (data?.vfs !== 'memory' || hidden) return null;
  return (
    <div className="banner storage-banner" role="alert">
      <TriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
      <span className="grow">Not saving: storage is unavailable (private browsing, or Redline is open in another tab). Close other tabs and reload.</span>
      <button type="button" className="icon-btn" style={{ width: 28, height: 28, margin: -4, color: 'inherit' }} aria-label="Dismiss" onClick={() => setHidden(true)}><X size={16} /></button>
    </div>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Gate() {
  const { data: settings, isLoading } = useSettings();
  const { pathname } = useLocation();
  useEffect(() => {
    // Ask once for persistent storage (home-screen apps usually get it).
    if (navigator.storage?.persist) void navigator.storage.persisted().then((p) => p || navigator.storage.persist());
  }, []);
  if (isLoading || !settings) return <div className="screen" aria-busy="true" />;
  if (!settings.onboarded && pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <HashRouter>
      <ScrollTop />
      <Toaster />
      <StorageWarning />
      <Routes>
        <Route element={<Gate />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/workout" element={<div className="app"><WorkoutScreen /></div>} />
          <Route path="/workout/:id/summary" element={<div className="app"><SummaryScreen /></div>} />
          <Route element={<TabLayout />}>
            <Route index element={<TodayScreen />} />
            <Route path="/routines" element={<RoutinesScreen />} />
            <Route path="/routines/:id" element={<RoutineEditor />} />
            <Route path="/exercises/:id" element={<ExerciseDetailScreen />} />
            <Route path="/exercises/:id/edit" element={<ExerciseFormScreen />} />
            <Route path="/progress" element={<ProgressScreen />} />
            <Route path="/history/:id" element={<SummaryScreen history />} />
            <Route path="/body" element={<BodyScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}
