import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider }        from './context/SocketContext';

import AuthPage        from './pages/AuthPage/AuthPage';
import LeaderboardPage from './pages/LeaderboardPage/LeaderboardPage';
import JudgePage       from './pages/JudgePage/JudgePage';
import ChronometerPage from './pages/ChronometerPage/ChronometerPage';
import PilotsPage      from './pages/PilotsPage/PilotsPage';
import BracketPage      from './pages/BracketPage/BracketPage';
import ParticipantsPage from './pages/ParticipantsPage/ParticipantsPage';
import AdminPage        from './pages/AdminPage/AdminPage';
import DocsPage         from './pages/DocsPage/DocsPage';
import PenaltiesPage    from './pages/PenaltiesPage/PenaltiesPage';
import Navigation       from './components/Navigation/Navigation';

function PrivateRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  const isKiosk = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('kiosk') === '1';

  return (
    <div className="app-shell">
      {user && !isKiosk && <Navigation />}
      <main className="app-main">
        <Routes>
          <Route path="/login" element={<AuthPage />} />

          <Route
            path="/"
            element={
              <PrivateRoute>
                <LeaderboardPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/bracket"
            element={
              <PrivateRoute>
                <BracketPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/judge"
            element={
              <PrivateRoute roles={['judge', 'chief_judge', 'admin']}>
                <JudgePage />
              </PrivateRoute>
            }
          />

          <Route
            path="/chronometer"
            element={
              <PrivateRoute roles={['judge', 'chief_judge', 'admin']}>
                <ChronometerPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/pilots"
            element={
              <PrivateRoute roles={['admin', 'chief_judge']}>
                <PilotsPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/participants"
            element={
              <PrivateRoute roles={['admin']}>
                <ParticipantsPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <PrivateRoute roles={['admin']}>
                <AdminPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/docs"
            element={
              <PrivateRoute roles={['admin', 'chief_judge']}>
                <DocsPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/penalties"
            element={
              <PrivateRoute>
                <PenaltiesPage />
              </PrivateRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <AppRoutes />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
