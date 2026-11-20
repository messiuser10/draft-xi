import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { RouteError } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { CreatePage } from './pages/Create';
import { DraftPage } from './pages/Draft';
import { LeaguePage } from './pages/League';
import { RevealPage } from './pages/Reveal';
import { SeasonPage } from './pages/Season';
import { HomePage } from './pages/Home';
import { HowToPlayPage } from './pages/HowToPlay';
import { LobbyPage } from './pages/Lobby';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { SoloPage } from './pages/Solo';
import { HallOfFamePage, LeaderboardPage } from './pages/HallOfFame';
import { ProfilePage } from './pages/Profile';
import { ResultsPage } from './pages/Results';
import { TeamPage } from './pages/Team';
import { AdminAnnouncementsPage } from './pages/admin/Announcements';
import { AdminAuditPage } from './pages/admin/Audit';
import { AdminClubsPage } from './pages/admin/Clubs';
import { AdminGamesPage } from './pages/admin/Games';
import { AdminLabPage } from './pages/admin/Lab';
import { AdminOverviewPage } from './pages/admin/Overview';
import { AdminPlayersPage } from './pages/admin/Players';
import { AdminSettingsPage } from './pages/admin/Settings';
import { AdminLayout } from './pages/admin/shared';
import { AdminUsersPage } from './pages/admin/Users';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/how-to-play', element: <HowToPlayPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/create', element: <CreatePage /> },
      { path: '/solo', element: <SoloPage /> },
      { path: '/lobby/:code', element: <LobbyPage /> },
      { path: '/draft/:code', element: <DraftPage /> },
      { path: '/reveal/:code', element: <RevealPage /> },
      { path: '/season/:code', element: <SeasonPage /> },
      { path: '/league/:code', element: <LeaguePage /> },
      { path: '/results/:code', element: <ResultsPage /> },
      { path: '/team/:code/:teamId', element: <TeamPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/profile/:userId', element: <ProfilePage /> },
      { path: '/hall-of-fame', element: <HallOfFamePage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: 'players', element: <AdminPlayersPage /> },
          { path: 'clubs', element: <AdminClubsPage /> },
          { path: 'games', element: <AdminGamesPage /> },
          { path: 'settings', element: <AdminSettingsPage /> },
          { path: 'lab', element: <AdminLabPage /> },
          { path: 'users', element: <AdminUsersPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
          { path: 'announcements', element: <AdminAnnouncementsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
