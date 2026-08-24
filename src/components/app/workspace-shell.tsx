"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Bell,
  BookOpen,
  Building2,
  ChevronDown,
  FileClock,
  FileInput,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Scale,
  Settings,
  SlidersHorizontal,
  RotateCcw,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/auth/actions";

const nav = [
  { segment: "", label: "Overview", icon: LayoutDashboard },
  { segment: "imports", label: "Imports", icon: FileInput },
  { segment: "payments", label: "Payments", icon: ReceiptText },
  { segment: "invoices", label: "Invoices", icon: FileText },
  { segment: "exceptions", label: "Exceptions", icon: Scale },
  { segment: "audit", label: "Audit log", icon: FileClock },
  { segment: "exports", label: "Exports", icon: ArrowDownToLine },
  { segment: "rules", label: "Matching rules", icon: SlidersHorizontal },
  { segment: "settings", label: "Settings", icon: Settings },
];

type WorkspaceNotification = {
  id: string;
  event_type: "import_preview_ready" | "import_failed" | "reconciliation_ready" | "reconciliation_failed";
  title: string;
  body: string;
  action_path: string;
  read_at: string | null;
  created_at: string;
};

function clearFinancialBrowserData() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith("ir_reconciliation_") || key?.startsWith("ir_decisions_")) storage.removeItem(key);
    }
  }
}

export function WorkspaceShell({ workspaceId, userName, isDemo, exceptionCount, workspaces, children }: { workspaceId: string; userName: string; isDemo: boolean; exceptionCount: number | null; workspaces: Array<{ id: string; name: string }>; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const base = `/app/${workspaceId}`;
  const unreadNotifications = notifications.filter((notification) => notification.read_at === null);

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    async function refreshNotifications() {
      try {
        const response = await fetch(`/api/notifications?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { notifications?: WorkspaceNotification[] };
        if (Array.isArray(result.notifications)) setNotifications(result.notifications);
      } catch {
        // A later bounded poll or page navigation can recover a temporary read failure.
      }
    }
    void refreshNotifications();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [isDemo, workspaceId]);

  function toggleNotifications() {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (!opening || !unreadNotifications.length) return;
    const readAt = new Date().toISOString();
    const notificationIds = unreadNotifications.map((notification) => notification.id);
    setNotifications((current) => current.map((notification) => notificationIds.includes(notification.id) ? { ...notification, read_at: readAt } : notification));
    void fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, notificationIds }),
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-surface">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-5">
          <button type="button" className="inline-flex size-9 items-center justify-center border lg:hidden" aria-label={mobileOpen ? "Close workspace navigation" : "Open workspace navigation"} aria-expanded={mobileOpen} onClick={() => setMobileOpen((value) => !value)}>{mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}</button>
          <BrandLogo className="hidden sm:inline-flex" />
          <div className="hidden h-5 border-l lg:block" />
          <label className="relative flex min-w-0 items-center">
            <span className="sr-only">Workspace</span>
            <Building2 className="pointer-events-none absolute left-2.5 size-4 text-muted" />
            <select
              className="h-9 max-w-[230px] appearance-none border bg-background pl-9 pr-8 text-sm font-semibold outline-none focus:border-brand"
              value={workspaceId}
              onChange={(event) => router.push(`/app/${event.target.value}`)}
            >
              {workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 size-4 text-muted" />
          </label>
          {isDemo ? <span className="hidden border border-info/25 bg-info-soft px-2 py-1 text-xs font-semibold text-info sm:inline-flex">Fictional demo</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href={`${base}/imports`} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "hidden sm:inline-flex")}><FileInput className="size-4" /> Import files</Link>
            {!isDemo ? <div className="relative"><button type="button" className="relative inline-flex size-9 items-center justify-center border bg-surface hover:bg-surface-muted" aria-label={unreadNotifications.length ? `Notifications, ${unreadNotifications.length} unread` : "Notifications"} aria-expanded={notificationsOpen} onClick={toggleNotifications}><Bell className="size-4" />{unreadNotifications.length ? <span className="absolute -right-1 -top-1 min-w-4 bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">{Math.min(99, unreadNotifications.length)}</span> : null}</button>{notificationsOpen ? <div className="absolute right-0 top-11 z-50 w-[min(24rem,calc(100vw-2rem))] border bg-surface shadow-xl"><div className="border-b p-3"><p className="text-sm font-semibold">Notifications</p><p className="mt-0.5 text-xs text-muted">Recent import and reconciliation updates</p></div>{notifications.length ? <ul className="max-h-96 divide-y overflow-y-auto">{notifications.map((notification) => <li key={notification.id}><Link href={notification.action_path} onClick={() => setNotificationsOpen(false)} className="block p-4 hover:bg-surface-muted"><div className="flex items-start justify-between gap-4"><p className="text-sm font-semibold">{notification.title}</p>{notification.read_at === null ? <span className="mt-1 size-2 shrink-0 bg-brand" aria-label="Unread" /> : null}</div><p className="mt-1 text-xs leading-5 text-muted-strong">{notification.body}</p><p className="mt-2 text-[11px] text-muted">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(notification.created_at))}</p></Link></li>)}</ul> : <p className="p-5 text-sm text-muted">No import notifications yet.</p>}</div> : null}</div> : null}
            <div className="inline-flex size-9 items-center justify-center bg-[#173d2e] text-xs font-bold text-white" title={userName}>{userName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
          </div>
        </div>
      </header>
      <div className="flex">
        <aside className={cn("fixed inset-y-14 left-0 z-30 w-64 border-r bg-surface transition-transform lg:sticky lg:top-14 lg:block lg:h-[calc(100vh-3.5rem)] lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
          <nav aria-label="Workspace navigation" className="flex h-full flex-col p-3">
            <Link href="/app/workspaces" className="mb-3 flex items-center gap-2 border-b px-3 pb-4 pt-2 text-sm font-semibold text-muted-strong hover:text-foreground"><BookOpen className="size-4" /> All client workspaces</Link>
            <ul className="space-y-1">
              {nav.filter((item) => isDemo || item.segment !== "rules").map((item) => {
                const href = item.segment ? `${base}/${item.segment}` : base;
                const active = pathname === href;
                const count = item.segment === "exceptions" ? exceptionCount : 0;
                return <li key={item.label}><Link href={href} onClick={() => setMobileOpen(false)} className={cn("flex min-h-10 items-center gap-3 px-3 text-sm font-medium transition", active ? "bg-brand-soft text-brand" : "text-muted-strong hover:bg-surface-muted hover:text-foreground")}><item.icon className="size-4" /><span>{item.label}</span>{count === null ? <span className="ml-auto bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning">Unavailable</span> : count ? <span className="ml-auto bg-warning-soft px-1.5 py-0.5 text-xs font-bold text-warning">{count}</span> : null}</Link></li>;
              })}
            </ul>
            <div className="mt-auto border-t pt-3">
              {isDemo ? <Link href="/app/demo" className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-strong hover:text-foreground"><RotateCcw className="size-4" /> Reset sample workspace</Link> : null}
              <Link href="/" className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-strong hover:text-foreground">Back to website</Link>
              <form action={signOutAction} onSubmit={clearFinancialBrowserData}>
                <button type="submit" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm font-medium text-muted-strong hover:text-foreground"><LogOut className="size-4" /> Sign out</button>
              </form>
            </div>
          </nav>
        </aside>
        {mobileOpen ? <button type="button" className="fixed inset-0 top-14 z-20 bg-black/25 lg:hidden" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} /> : null}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
