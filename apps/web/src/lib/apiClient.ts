/**
 * The app's HTTP client.
 *
 * There was none. `axios.create()` appeared nowhere: 601 call sites across 209
 * files each built their own request, 303 of them re-deriving
 * `Authorization: Bearer ${token}` by hand, and the only shared behaviour was a
 * 401 handler registered on the GLOBAL axios default in main.tsx — which meant
 * every other axios consumer in the process inherited it too.
 *
 * Deliberately NOT a workspace package, unlike @elixirbooks/money and friends.
 * It reads `window.location` and is consumed by exactly one app, so there is
 * nothing to share; a package would buy a dual build and Docker wiring for no
 * second consumer.
 *
 * Scope is deliberately narrow: a base URL, auth, and the 401 handler. Call
 * sites keep their shape — `api.get(Constants.X)` instead of
 * `axios.get(Constants.X, { headers })` — and `constants/api.ts` stays. Response
 * unwrapping is NOT done here: 366 call sites read `.data.data` and 44 read
 * `.data.success`, and changing that is a different, much larger refactor.
 */
import axios, { type AxiosInstance } from 'axios';
import Cookies from 'js-cookie';

/**
 * Where the API lives.
 *
 * `constants/api.ts` builds every URL by concatenating this, so when
 * VITE_API_BASE_URL is unset every request used to go to a literal
 * "undefined/api/...". An empty base means same-origin, which is what the nginx
 * `/api` proxy in front of the built bundle actually serves.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || '';

/**
 * The session token.
 *
 * Read from the cookie rather than the Redux store on purpose: `persistSession`
 * in authSlice writes the cookie as the durable record and mirrors it into state,
 * so the cookie is the source of truth and reading it keeps this module from
 * importing the store — which would be a circular dependency, since the store's
 * thunks call this client.
 */
export const getAuthToken = (): string | undefined => Cookies.get('authToken');

/**
 * Paths where a 401 must NOT bounce the user to login.
 *
 * /setup and /register are where a user completes signup and workspace setup; a
 * transient 401 there should surface inline beside the form rather than discard
 * what they have typed. /admin/login is on the list for the obvious reason.
 */
export const LOGIN_PATH = '/admin/login';
export const NO_REDIRECT_PATHS = [LOGIN_PATH, '/setup', '/register'];

export const isNoRedirectPath = (pathname: string): boolean =>
  NO_REDIRECT_PATHS.some((p) => pathname.startsWith(p));

export const api: AxiosInstance = axios.create({ baseURL: API_BASE_URL });

/**
 * Attach the session token to every request.
 *
 * Replaces 303 hand-written headers. A call site that passes its own
 * Authorization header still wins — a few flows (SSO exchange, public links)
 * legitimately send a different credential or none.
 */
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token && !config.headers?.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Wire the 401 -> logout -> redirect handler.
 *
 * Called once from main.tsx with the store's dispatch, so this module does not
 * import the store. Previously this lived on the global axios default; putting
 * it on the instance means it applies to the app's own calls and stops leaking
 * into anything else that happens to use axios.
 */
export function installUnauthorizedHandler(onUnauthorized: () => void): void {
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401 && !isNoRedirectPath(window.location.pathname)) {
        onUnauthorized();
        window.location.assign(LOGIN_PATH);
      }
      return Promise.reject(error);
    },
  );
}

export default api;
