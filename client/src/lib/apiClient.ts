import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { getAccessToken, useAuthStore } from "../store/authStore";

const baseURL = import.meta.env.VITE_API_URL;

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

// Endpoints where a 401 means "credentials were rejected", not "access token
// expired" - retrying them after a refresh would be meaningless/looping.
const NO_RETRY_PATHS = ["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout"];

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshPromise ??= axios
    .post<{ data: { user: { id: string; email: string; name: string | null }; accessToken: string } }>(
      `${baseURL}/auth/refresh`,
      {},
      { withCredentials: true },
    )
    .then((res) => {
      const { user, accessToken } = res.data.data;
      useAuthStore.getState().setSession(user, accessToken);
      return accessToken;
    })
    .catch(() => {
      useAuthStore.getState().clearSession();
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

apiClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    const path = config?.url ?? "";

    const shouldAttemptRefresh =
      status === 401 && config && !config._retried && !NO_RETRY_PATHS.some((p) => path.includes(p));

    if (shouldAttemptRefresh) {
      config._retried = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        config.headers.set("Authorization", `Bearer ${newToken}`);
        return apiClient(config);
      }
    }

    return Promise.reject(error);
  },
);

export function extractErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error
      ?.message;
    if (message) return message;
  }
  return fallback;
}

export { refreshAccessToken };
