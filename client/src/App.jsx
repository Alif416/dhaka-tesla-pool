import { BrowserRouter } from 'react-router-dom';

import { AuthProvider } from './auth/AuthProvider.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import { AppRoutes } from './routes.jsx';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
