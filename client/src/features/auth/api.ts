import { apiClient } from "../../lib/apiClient";
import type { AuthUser } from "../../store/authStore";

interface AuthResponse {
  data: { user: AuthUser; accessToken: string };
}

export async function signup(email: string, password: string, name?: string) {
  const res = await apiClient.post<AuthResponse>("/auth/signup", { email, password, name });
  return res.data.data;
}

export async function login(email: string, password: string) {
  const res = await apiClient.post<AuthResponse>("/auth/login", { email, password });
  return res.data.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}
