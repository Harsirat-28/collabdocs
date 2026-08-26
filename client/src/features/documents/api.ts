import type { JSONContent } from "@tiptap/react";
import { apiClient } from "../../lib/apiClient";

export type DocumentRole = "OWNER" | "EDITOR" | "VIEWER";

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  role: DocumentRole;
}

export interface DocumentDetail {
  id: string;
  title: string;
  content: JSONContent;
  version: number;
  ownerId: string;
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
  role: DocumentRole;
}

export interface ConflictInfo {
  currentVersion: number;
  currentContent: JSONContent;
  currentTitle: string;
}

export interface AccessGrant {
  userId: string;
  email: string;
  role: "VIEWER" | "EDITOR";
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const res = await apiClient.get<{ data: { documents: DocumentSummary[] } }>("/documents");
  return res.data.data.documents;
}

export async function createDocument(title?: string): Promise<DocumentDetail> {
  const res = await apiClient.post<{ data: { document: DocumentDetail } }>("/documents", {
    title,
  });
  return res.data.data.document;
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  const res = await apiClient.get<{ data: { document: DocumentDetail } }>(`/documents/${id}`);
  return res.data.data.document;
}

export async function renameDocument(id: string, title: string): Promise<DocumentDetail> {
  const res = await apiClient.patch<{ data: { document: DocumentDetail } }>(
    `/documents/${id}`,
    { title },
  );
  return res.data.data.document;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/documents/${id}`);
}

export async function updateDocumentContent(
  id: string,
  content: JSONContent,
  version: number,
): Promise<DocumentDetail> {
  const res = await apiClient.put<{ data: { document: DocumentDetail } }>(
    `/documents/${id}/content`,
    { content, version },
  );
  return res.data.data.document;
}

export async function shareDocument(
  id: string,
  email: string,
  role: "VIEWER" | "EDITOR",
): Promise<AccessGrant> {
  const res = await apiClient.post<{ data: { access: AccessGrant } }>(`/documents/${id}/access`, {
    email,
    role,
  });
  return res.data.data.access;
}

export async function revokeAccess(id: string, email: string): Promise<void> {
  await apiClient.delete(`/documents/${id}/access/${encodeURIComponent(email)}`);
}
