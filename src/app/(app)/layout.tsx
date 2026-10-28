import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { InactivityGuard } from "@/components/app-shell/inactivity-guard";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NavLinks, type NavItem } from "@/components/app-shell/nav-links";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { UserMenu } from "@/components/app-shell/user-menu";
import { readActivityTime } from "@/lib/auth/activity-cookie";
import { ACTIVITY_COOKIE, serverIdleMs } from "@/lib/auth/inactivity";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getNotificationFeed } from "@/modules/notifications/queries";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  // Si fallan las notificaciones, la aplicación sigue funcionando sin ellas.
  const notifications = await getNotificationFeed(await createSupabaseServerClient()).catch((error: unknown) => {
    logServerError("notifications.layout", error);
    return { items: [], unread: 0 };
  });
  const idleMs = serverIdleMs(readActivityTime((await cookies()).get(ACTIVITY_COOKIE)?.value, user.id)) ?? 0;
  const items: NavItem[] = [
    { href: "/panel", label: "Panel", icon: "panel" },
    { href: "/postulaciones", label: "Postulaciones", icon: "postulaciones" },
    { href: "/vacantes", label: "Vacantes", icon: "vacantes" },
    { href: "/candidatos", label: "Candidatos", icon: "candidatos" },
    ...(can(user.role, "users:manage") ? [{ href: "/usuarios", label: "Usuarios", icon: "usuarios" } as const] : []),
    ...(can(user.role, "privacy:manage")
      ? [{ href: "/configuracion/privacidad", label: "Configuración", icon: "configuracion" } as const]
      : []),
  ];

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-4 md:block">
        <Link href="/panel" className="mb-6 block px-3">
          <span className="block text-sm font-semibold">Interruptivo Perú</span>
          <span className="block text-xs text-muted-foreground">Reclutamiento y selección</span>
        </Link>
        <NavLinks items={items} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b bg-card px-4">
          <div className="flex items-center gap-2">
            <MobileNav items={items} />
            <span className="text-sm font-medium md:hidden">Reclutamiento</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell initial={notifications} />
            <UserMenu name={user.fullName} email={user.email} roleLabel={ROLE_LABELS[user.role]} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 md:px-8">{children}</main>
      </div>
      <InactivityGuard serverIdleMs={idleMs} />
    </div>
  );
}
