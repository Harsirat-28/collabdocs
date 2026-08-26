import { useEffect } from "react";
import { refreshAccessToken } from "../../lib/apiClient";
import { useAuthStore } from "../../store/authStore";

/**
 * Restores a session on page load. The access token lives only in memory
 * (never localStorage), so a reload has none - this exchanges the httpOnly
 * refresh cookie for a fresh access token before rendering protected routes.
 */
export function useAuthInit(): void {
  useEffect(() => {
    void refreshAccessToken();
  }, []);
}

export function useAuthStatus() {
  return useAuthStore((state) => state.status);
}
