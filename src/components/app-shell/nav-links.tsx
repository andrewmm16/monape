"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3Icon, BriefcaseIcon, CalendarDaysIcon, InboxIcon, LayoutDashboardIcon, ScrollTextIcon, SettingsIcon, TargetIcon, UsersIcon, UserCogIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  panel: LayoutDashboardIcon,
  vacantes: BriefcaseIcon,
  candidatos: UsersIcon,
  caleta: TargetIcon,
  postulaciones: InboxIcon,
  entrevistas: CalendarDaysIcon,
  usuarios: UserCogIcon,
  auditoria: ScrollTextIcon,
  reportes: BarChart3Icon,
  configuracion: SettingsIcon,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; disabled?: boolean };

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Navegación principal">
      {items.map((item) => {
        const Icon = ICONS[item.icon];

        // Ítem en pausa: se muestra sombreado y sin acceso (no es un enlace).
        if (item.disabled) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              title="En pausa"
              className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/40"
            >
              <Icon className="size-4" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <span className="rounded-sm bg-sidebar-foreground/10 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide">
                En pausa
              </span>
            </span>
          );
        }

        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
