import { colorForUser, type PresenceUser } from "../features/realtime/useCollaborationDoc";

const MAX_VISIBLE = 5;

function initial(user: PresenceUser): string {
  return (user.name?.trim() || user.email).slice(0, 1).toUpperCase();
}

/** Avatar row of everyone currently viewing this document (M4). Ephemeral - reflects only who's connected right now. */
export function ActiveUsersList({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;

  return (
    <div
      className="flex flex-shrink-0 items-center -space-x-2"
      aria-label={`${users.length} active ${users.length === 1 ? "user" : "users"}: ${users
        .map((u) => u.name?.trim() || u.email)
        .join(", ")}`}
    >
      {visible.map((user) => (
        <span
          key={user.userId}
          title={user.name?.trim() || user.email}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium text-white"
          style={{ backgroundColor: colorForUser(user.userId) }}
        >
          {initial(user)}
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={`${overflow} more`}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-400 text-xs font-medium text-white"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
