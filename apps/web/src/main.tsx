import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
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
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
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
