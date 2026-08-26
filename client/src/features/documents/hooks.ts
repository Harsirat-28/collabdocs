import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as documentsApi from "./api";

const documentsKey = ["documents"] as const;
const documentKey = (id: string) => ["documents", id] as const;

export function useDocuments() {
  return useQuery({ queryKey: documentsKey, queryFn: documentsApi.listDocuments });
}

export function useDocument(id: string) {
  return useQuery({ queryKey: documentKey(id), queryFn: () => documentsApi.getDocument(id) });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => documentsApi.createDocument(title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsKey });
    },
  });
}

export function useRenameDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => documentsApi.renameDocument(id, title),
    onSuccess: (document) => {
      queryClient.setQueryData(documentKey(id), document);
      void queryClient.invalidateQueries({ queryKey: documentsKey });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.deleteDocument(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsKey });
    },
  });
}

export function useShareDocument(id: string) {
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: "VIEWER" | "EDITOR" }) =>
      documentsApi.shareDocument(id, email, role),
  });
}

export function useRevokeAccess(id: string) {
  return useMutation({
    mutationFn: (email: string) => documentsApi.revokeAccess(id, email),
  });
}
