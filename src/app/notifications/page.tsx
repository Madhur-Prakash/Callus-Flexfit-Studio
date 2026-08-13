"use client";

import { LoadingMessage, PageHeaderRow } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

export default function NotificationsPage() {
  const utils = trpc.useUtils();

  const {
    data: notifications,
    isLoading,
    error,
  } = trpc.notifications.list.useQuery(undefined, { retry: false });

  const markAllAsRead = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  if (isLoading) return <LoadingMessage />;
  if (error) return <p className="muted">{error.message}</p>;

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeaderRow title="Notifications">
        {unreadCount > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
          >
            Mark all as read
          </button>
        )}
      </PageHeaderRow>

      {!notifications || notifications.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="panel p-4"
              style={{ opacity: notification.read ? 0.6 : 1 }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium">{notification.title}</div>
                  <div className="mt-1 text-sm muted">{notification.message}</div>
                  <div className="mt-2 text-xs muted">
                    {formatDateTime(notification.createdAt)}
                  </div>
                </div>
                {!notification.read && (
                  <div
                    className="mt-1 h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--accent)" }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
