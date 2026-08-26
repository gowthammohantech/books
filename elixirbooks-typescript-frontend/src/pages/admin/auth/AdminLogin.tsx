import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { useSelector, useDispatch } from "react-redux";
import { loginUser } from "../../../store/auth/authSlice";
import { fetchSystemSettings } from "@store/systemSettingsSlice";
import type { RootState, AppDispatch } from "../../../store";
import { resolveCompanyLogo } from "@utils/companyLogo";
import { resolveLandingPath } from "@utils/roleLanding";
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_EMAIL = "admin@demo.elixirbooks.local";
const DEMO_PASSWORD = "Demo123$";

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState<string>(DEMO_MODE ? DEMO_EMAIL : "");
  const [password, setPassword] = useState<string>(DEMO_MODE ? DEMO_PASSWORD : "");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const { isLoading, error, isAuthenticated, user } = useSelector(
    (state: RootState) => state.auth
  );
  const dispatch: AppDispatch = useDispatch();
  const navigate = useNavigate();
  const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);

  // Guards direct/back-button visits to /admin/login while a session is
  // already active (e.g. after a refresh). Owner (user_type 1) always goes to
  // the dashboard, unaffected — everyone else lands on their permitted
  // module instead of bouncing to a dashboard they may not have access to.
  useEffect(() => {
    if (isAuthenticated) {
      const path =
        user?.user_type === 1
          ? "/admin/dashboard"
          : resolveLandingPath(systemSettings?.defaultRoute, systemSettings?.permissions);
      navigate(path);
    }
  }, [isAuthenticated, navigate, user, systemSettings]);

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    const resultAction = await dispatch(loginUser({ email, password }));
    if (loginUser.fulfilled.match(resultAction)) {
      const { token, user: loggedInUser } = resultAction.payload;

      // Fetch system-settings/permissions with the just-issued token before
      // deciding where to land — relying on the separate App-level boot
      // effect here would race the navigate() below (it keys off state.auth
      // token changing too, with no ordering guarantee against this thunk).
      let settings = systemSettings;
      const settingsAction = await dispatch(fetchSystemSettings(token));
      if (fetchSystemSettings.fulfilled.match(settingsAction)) {
        settings = settingsAction.payload;
      }

      const path =
        loggedInUser?.user_type === 1
          ? "/admin/dashboard"
          : resolveLandingPath(settings?.defaultRoute, settings?.permissions);
      navigate(path);
    }
  };

  const handleCopy = (): void => {
    const demoEmail = "admin@demo.elixirbooks.local";
    const demoPassword = "Demo123$";

    // Prefill form fields
    setEmail(demoEmail);
    setPassword(demoPassword);

    // Copy to clipboard
    const credentials = `Email: ${demoEmail}\nPassword: ${demoPassword}`;
    navigator.clipboard
      .writeText(credentials)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch((err) => console.error("Failed to copy text: ", err));
  };


  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="w-full max-w-md p-6 md:p-8 bg-white rounded-xl shadow-md space-y-6">
        {/* Logo + Brand */}
        <div className="flex items-center justify-center gap-2">
          <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="Logo" className="w-32" />
        </div>

        {/* Heading */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Welcome Back</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sign in to access the dashboard
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive-soft border border-destructive rounded-lg">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
              required
              className="w-full px-3 py-2 mt-1 text-gray-700 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <div className="relative mt-1">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPassword(e.target.value)
                }
                required
                className="w-full px-3 py-2 text-gray-700 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Remember me + Forgot */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                id="remember_me"
                name="remember_me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRememberMe(e.target.checked)
                }
                className="h-4 w-4 accent-primary rounded focus:ring-ring"
              />

              Remember me
            </label>
            <a
              href="#"
              className="text-sm hidden font-medium text-primary hover:text-primary"
            >
              Forgot Password?
            </a>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 text-white font-semibold bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:bg-chart-3 disabled:cursor-not-allowed transition-all duration-300"
          >
            {isLoading ? "Logging in..." : "Login"}
          </button>
        </form>

        {/* Demo credentials — only shown when VITE_DEMO_MODE=true */}
        {DEMO_MODE && (
          <div className="p-3 bg-accent border border-accent rounded-md">
            <div className="flex justify-between items-center text-sm text-gray-700">
              <div>
                <p>
                  <span className="font-medium">Email:</span>{" "}
                  {DEMO_EMAIL}
                </p>
                <p>
                  <span className="font-medium">Password:</span> {DEMO_PASSWORD}
                </p>
              </div>
              <button
                onClick={handleCopy}
                className="p-2 text-gray-500 hover:text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {isCopied ? (
                  <Check className="text-green-600" size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
