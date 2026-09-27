import { Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth.jsx';
import { TopBar } from './components/TopBar.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { NowPage } from './pages/NowPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';

function AuthenticatedLayout({ children }) {
  return (
    <RequireAuth>
      <TopBar />
      {children}
    </RequireAuth>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <AuthenticatedLayout>
            <NowPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/history"
        element={
          <AuthenticatedLayout>
            <HistoryPage />
          </AuthenticatedLayout>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
