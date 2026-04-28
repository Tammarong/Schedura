// src/routes/ProtectedRoute.tsx
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

type Props = { children: React.ReactNode };

export default function ProtectedRoute({ children }: Props) {
  const { user, loading, refresh } = useAuth();
  const loc = useLocation();

  // Ensure we've attempted hydration if hot-reloaded or mounted late
  useEffect(() => {
    if (!user && !loading) {
      void refresh();
    }
  }, [user, loading, refresh]);

  if (loading) {
    // tiny placeholder to prevent UI flash while hydrating
    return <div style={{ height: 1 }} />;
  }

  if (!user) {
    // not authenticated → back to landing; keep "from" so Login can redirect
    return <Navigate to="/" replace state={{ from: loc }} />;
  }

  return <>{children}</>;
}
