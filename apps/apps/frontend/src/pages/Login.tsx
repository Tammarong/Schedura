// src/pages/Login.tsx
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogIn, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { api, API_BASE, setToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type LoginUser = {
  id: number;
  email?: string;
  username: string;
  display_name?: string;
  displayName?: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
};

type LoginResponse = {
  message?: string;
  token?: string;
  user?: LoginUser;
};

function mapDisplayName(u: NonNullable<LoginResponse["user"]>): string {
  return u.displayName ?? u.display_name ?? u.username;
}

type LocationState = { from?: { pathname?: string } };

const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState<boolean>(true); // default: keep signed in
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const state = (location.state as LocationState | null) ?? undefined;
  const fromState = state?.from?.pathname;
  const nextFromQuery = searchParams.get("next");
  const next = fromState || nextFromQuery || "/dashboard";

  const { login: setUserOptimistic, refresh } = useAuth();

  const isProdMismatchHint = useMemo(() => {
    if (typeof window === "undefined") return "";
    const onLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    return API_BASE.includes("localhost") && !onLocalhost
      ? " (possible API base mismatch — check VITE_API_BASE or Vercel rewrites)"
      : "";
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      });

      // Persist the access token based on "Remember me"
      if (data?.token) {
        setToken(data.token, remember ? "local" : "session");
      }

      // Optimistically set user (faster UI), refresh will verify and hydrate fully
      if (data?.user?.id) {
        setUserOptimistic({
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          displayName: mapDisplayName(data.user),
          avatarUrl: data.user.avatarUrl ?? data.user.avatar_url ?? null,
        });
      }

      await refresh();
      navigate(next, { replace: true });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(msg + isProdMismatchHint);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="mb-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </div>

        <Card className="bg-gradient-card border-card-border shadow-elegant">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
              <LogIn className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold text-card-foreground">
              Welcome Back
            </CardTitle>
            <p className="text-foreground-muted">Sign in to your Schedura account</p>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">Email or Username</Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="Enter your email or username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                    aria-pressed={showPwd}
                    aria-controls="password"
                    title={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember me */}
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Keep me signed in
                </label>

                {/* (Optional) Forgot link placeholder */}
                <Link
                  to="#"
                  className="text-sm text-primary hover:text-primary-hover"
                  onClick={(e) => e.preventDefault()}
                >
                  Forgot password?
                </Link>
              </div>

              {error && (
                <p className="text-red-500 text-sm text-center" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-foreground-muted">
                Don&apos;t have an account?{" "}
                <Link
                  to="/register"
                  className="text-primary hover:text-primary-hover transition-colors"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Login;
