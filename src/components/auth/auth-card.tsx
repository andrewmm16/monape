import type { ReactNode } from "react";
import { BrandLogo } from "@/components/common/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex justify-center">
            <BrandLogo className="h-7" />
          </div>
          <div aria-hidden className="mx-auto mt-3 h-0.5 w-12 rounded-full bg-linear-to-r from-[#1ff287] to-[#07c199]" />
          <p className="mt-3 text-xs text-muted-foreground">Plataforma interna de reclutamiento</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{title}</h1>
            </CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
