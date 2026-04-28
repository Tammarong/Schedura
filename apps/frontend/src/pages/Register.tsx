// src/pages/Register.tsx
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { UserPlus, Eye, EyeOff } from "lucide-react";
import { api, API_BASE, setToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type RegisterUser = {
  id: number;
  username: string;
  email?: string;
  display_name?: string;
  displayName?: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
};

type RegisterResponse = {
  message?: string;
  token?: string; // optional: if backend returns it, we auto-login
  user?: RegisterUser;
};

function mapDisplayName(u: NonNullable<RegisterResponse["user"]>): string {
  return u.displayName ?? u.display_name ?? u.username;
}

type LocationState = { from?: { pathname?: string } };

const Register = () => {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // eye toggles
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  // remember me (persist token to localStorage vs sessionStorage)
  const [remember, setRemember] = useState<boolean>(true);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  // simple client validation for button disabled state
  const formValid =
    username.trim().length > 0 &&
    displayName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const body = {
        username: username.trim(),
        email: email.trim(),
        display_name: displayName.trim(), // backend expects snake_case
        password,
      };

      const data = await api<RegisterResponse>("/auth/register", {
        method: "POST",
        body,
      });

      // If backend returns a token, persist it based on "Remember me"
      if (data?.token) {
        setToken(data.token, remember ? "local" : "session");
      }

      // Optimistically set user for snappy UX; refresh will verify with server
      if (data?.user?.id) {
        setUserOptimistic({
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          displayName: mapDisplayName(data.user),
          avatarUrl: data.user.avatarUrl ?? data.user.avatar_url ?? null,
        });
      }

      // Ensure server-side session (cookies) or token is recognized
      await refresh();

      // Decide where to go
      if (data?.token || data?.user?.id) {
        navigate(next, { replace: true });
      } else {
        alert("🎉 Account created! Please sign in.");
        navigate("/login", { replace: true });
      }
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
        <Card className="bg-gradient-card border-card-border shadow-elegant">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
              <UserPlus className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold text-card-foreground">
              Join Schedura
            </CardTitle>
            <p className="text-foreground-muted">
              Create your account to get started
            </p>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Choose a unique username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  type="text"
                  placeholder="Your display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? "text" : "password"}
                    placeholder="Create a strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={8}
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
                <p className="text-xs text-muted-foreground">Must be at least 8 characters.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPwd ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPwd ? "Hide confirm password" : "Show confirm password"}
                    aria-pressed={showConfirmPwd}
                    aria-controls="confirmPassword"
                    title={showConfirmPwd ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirmPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="text-xs text-red-500">Passwords don’t match.</p>
                )}
              </div>

              {/* Keep me signed in */}
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

                {/* (Optional) Terms link placeholder */}
                <Link
                  to="#"
                  className="text-sm text-primary hover:text-primary-hover"
                  onClick={(e) => e.preventDefault()}
                >
                  Terms
                </Link>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading || !formValid}>
                {loading ? "Registering..." : "Create Account"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-foreground-muted">
                Already have an account{" "}
                <Link
                  to="/login"
                  className="text-primary hover:text-primary-hover transition-colors"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Register;
