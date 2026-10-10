import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home.tsx';

const Camera = lazy(() => import('./pages/Camera.tsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.tsx'));
const Monitor = lazy(() => import('./pages/Monitor.tsx'));
const Join = lazy(() => import('./pages/Join.tsx'));
const Practice = lazy(() => import('./pages/Practice.tsx'));
const Report = lazy(() => import('./pages/Report.tsx'));
const Replay = lazy(() => import('./pages/Replay.tsx'));

export function App() {
  return (
    <Suspense fallback={<div className="shell empty">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/camera" element={<Camera />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/join" element={<Join />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/report/:id" element={<Report />} />
        <Route path="/replay/:id" element={<Replay />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
