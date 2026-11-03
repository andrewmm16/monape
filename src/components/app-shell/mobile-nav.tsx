"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/common/brand-logo";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks, type NavItem } from "./nav-links";

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú">
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-4 text-sidebar-foreground [&>[data-slot=sheet-close]]:text-sidebar-foreground">
        <SheetHeader className="px-0">
          <SheetTitle className="sr-only">Reclutamiento</SheetTitle>
          <BrandLogo tone="onDark" className="h-5" />
        </SheetHeader>
        <NavLinks items={items} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
