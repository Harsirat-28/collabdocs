import { apiClient } from "../../lib/apiClient";

const API_ORIGIN = import.meta.env.VITE_API_URL.replace(/\/api\/?$/, "");

export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", file);

  const res = await apiClient.post<{ data: { url: string } }>("/uploads/image", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  // Server returns a relative path (e.g. /uploads/xyz.png); resolve it
  // against the API origin so <img> tags load it regardless of dev port.
  return `${API_ORIGIN}${res.data.data.url}`;
}
