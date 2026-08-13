"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/roles";
import { isAdmin, isStaff, isTrainer } from "@/lib/roles";
import { trpc } from "@/lib/trpc/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

const UNREAD_POLL_MS = 30_000;

type NavLink = { href: string; label: string };

/** Links every signed-in member gets. */
const MEMBER_LINKS: NavLink[] = [
  { href: "/dashboard", label: "My bookings" },
  { href: "/waitlist", label: "Waitlist" },
];

/** Extra links per role, in the order they appear in the bar. */
function linksForRole(role: Role): NavLink[] {
  const links: NavLink[] = [];

  if (isTrainer(role)) {
    links.push({ href: "/trainer/schedule", label: "My schedule" });
  }
  if (isAdmin(role)) {
    links.push(
      { href: "/admin", label: "Admin" },
      { href: "/admin/attendance", label: "Attendance" },
    );
  }
  if (isStaff(role)) {
    links.push({ href: "/kiosk", label: "Kiosk" });
  }

  return links;
}

function NavLinkItem({ href, label }: NavLink) {
  return (
    <Link href={href} className="text-sm muted hover:text-white">
      {label}
    </Link>
  );
}

export function NavBar() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { user } = useCurrentUser();

  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: UNREAD_POLL_MS,
  });

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      router.push("/login");
    },
  });

  return (
    <header className="border-b" style={{ borderColor: "var(--border)" }}>
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          FlexFit<span style={{ color: "var(--accent)" }}>.</span>
        </Link>

        <NavLinkItem href="/schedule" label="Schedule" />

        {user && MEMBER_LINKS.map((link) => <NavLinkItem key={link.href} {...link} />)}
        {user && linksForRole(user.role).map((link) => <NavLinkItem key={link.href} {...link} />)}

        <div className="ml-auto flex items-center gap-3">
          {user && <NotificationBell unreadCount={unreadCount} />}

          {user ? (
            <>
              <span className="text-sm muted">{user.name}</span>
              <button
                className="btn"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="btn">
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

function NotificationBell({ unreadCount }: { unreadCount: number | undefined }) {
  return (
    <Link href="/notifications" className="relative">
      <span className="text-sm">🔔</span>
      {/*
        Ternary, not `&&`. With `&&` a count of 0 makes the expression evaluate
        to the number 0, which React renders — putting a stray "0" next to the
        bell for every user with nothing unread.
      */}
      {unreadCount ? (
        <span
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
          style={{ backgroundColor: "var(--accent)" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
