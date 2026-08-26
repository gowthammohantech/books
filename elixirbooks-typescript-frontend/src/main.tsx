import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import Cookies from 'js-cookie';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { initializeAuth, logout } from './store/auth/authSlice';
import { isTokenExpired } from './utils/auth';
import { store } from './store';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

store.dispatch(initializeAuth());

// Global 401 handler: a stale/invalid session (e.g. the token's user no longer
// exists) should cleanly log the user out and bounce to login, rather than
// surfacing confusing errors inside forms. Skip when already on the login page.
// Also skip the pre-dashboard onboarding pages (/setup, /register): in those
// router states /admin/login is not a routable path, so bouncing there just
// gets caught by the catch-all and redirected back, producing an infinite
// /setup <-> /admin/login flicker. Let those pages surface the error inline.
const LOGIN_PATH = '/admin/login';
const NO_REDIRECT_PATHS = [LOGIN_PATH, '/setup', '/register'];
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error?.response?.status === 401 &&
      !NO_REDIRECT_PATHS.some((p) => window.location.pathname.startsWith(p))
    ) {
      store.dispatch(logout());
      window.location.assign(LOGIN_PATH);
    }
    return Promise.reject(error);
  }
);

// Proactive expiry watchdog: catches idle sessions where a mounted page stays
// stale-authed because ProtectedRoute only re-checks on navigation.
// Runs (a) when the tab becomes visible and (b) every 60 s in the background.
const checkTokenExpiry = () => {
  const token = Cookies.get('authToken');
  if (token && isTokenExpired(token) && !NO_REDIRECT_PATHS.some((p) => window.location.pathname.startsWith(p))) {
    store.dispatch(logout());
    window.location.assign(LOGIN_PATH);
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkTokenExpiry();
  }
});
setInterval(checkTokenExpiry, 60_000);

const queryClient = new QueryClient();
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Dev-only design-system reference. Mounted ahead of the store, router and
// setup-status gates so it renders with no backend running — which is the
// point: it is the only way to eyeball a token migration without a database
// and a login. Never reachable in a production build.
if (import.meta.env.DEV && window.location.pathname === '/_tokens') {
  const TokenGallery = React.lazy(() => import('@pages/dev/TokenGallery'));
  root.render(
    <React.StrictMode>
      <React.Suspense fallback={<></>}>
        <TokenGallery />
      </React.Suspense>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </LocalizationProvider>
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
}
