"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseIcon, InboxIcon, LayoutDashboardIcon, SettingsIcon, UsersIcon, UserCogIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  panel: LayoutDashboardIcon,
  vacantes: BriefcaseIcon,
  candidatos: UsersIcon,
  postulaciones: InboxIcon,
  usuarios: UserCogIcon,
  configuracion: SettingsIcon,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Navegación principal">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
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
