import type { SaveStatus } from "../features/documents/useAutosave";

export function SaveStatusIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "saving") {
    return <span className="text-xs text-gray-400">Saving...</span>;
  }
  if (status === "saved") {
    return <span className="text-xs text-gray-400">Saved</span>;
  }
  if (status === "error") {
    return (
      <span className="text-xs text-red-600">
        Couldn't save.{" "}
        <button onClick={onRetry} className="underline hover:text-red-800">
          Retry
        </button>
      </span>
    );
  }
  if (status === "conflict") {
    return <span className="text-xs text-amber-600">Document changed elsewhere</span>;
  }
  return null;
}
