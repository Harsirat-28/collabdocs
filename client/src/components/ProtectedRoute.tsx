import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export function ProtectedRoute({ children }: { children: ReactElement }): ReactElement {
  const status = useAuthStore((state) => state.status);

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">Loading...</div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return children;
}
