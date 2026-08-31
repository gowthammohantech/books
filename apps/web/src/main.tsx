import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import Cookies from 'js-cookie';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { initializeAuth, logout } from './store/auth/authSlice';
import { isTokenExpired } from './utils/auth';
import { migrateLegacyKeys } from './utils/tenantStorage';
import { store } from './store';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Drop the un-namespaced cache keys written by every build before workspaces
// existed. One sweep, before anything reads storage: a returning user would
// otherwise carry a bare `systemSettings` - one company's branding, currency
// and permission set - on disk indefinitely.
migrateLegacyKeys();

store.dispatch(initializeAuth());

// Global 401 handler: a stale/invalid session (e.g. the token's user no longer
// exists, their membership was revoked, or their workspace was suspended)
// should cleanly log the user out and bounce to login, rather than surfacing
// confusing errors inside forms. Skip when already on the login page.
//
// /setup and /register stay on the skip list, though the reason has changed:
// they were skipped because /admin/login was not a routable path in those
// router states, which produced a /setup <-> /admin/login flicker. There is one
// route tree now and /admin/login is always routable, so the flicker is gone -
// but bouncing off these two pages is still wrong. They are where a user
// completes signup and workspace setup, and a transient 401 there should show
// inline beside the form rather than discard what they have typed.
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
import { ThemeProvider } from '@mui/material/styles';
import { muiTheme } from '@lib/muiTheme';
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
          <ThemeProvider theme={muiTheme}>
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <QueryClientProvider client={queryClient}>
                <App />
              </QueryClientProvider>
            </LocalizationProvider>
          </ThemeProvider>
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
}
