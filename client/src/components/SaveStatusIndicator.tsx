import type { SyncStatus } from "../features/realtime/useCollaborationDoc";

export function SaveStatusIndicator({ status }: { status: SyncStatus }) {
  if (status === "connecting") {
    return <span className="text-xs text-gray-400">Connecting...</span>;
  }
  if (status === "synced") {
    return <span className="text-xs text-gray-400">Synced</span>;
  }
  if (status === "offline") {
    return <span className="text-xs text-amber-600">Offline - reconnecting...</span>;
  }
  if (status === "error") {
    return <span className="text-xs text-red-600">Couldn't connect</span>;
  }
  return null;
}
