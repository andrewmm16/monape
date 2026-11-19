import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/common/brand-logo";
import { getPublicJobsConfig, requirePublicJobsConfig } from "@/modules/public-jobs/config";

export async function generateMetadata(): Promise<Metadata> {
  const config = getPublicJobsConfig();
  if (!config.enabled) return {};
  return {
    metadataBase: new URL(config.siteUrl),
    title: { default: `Empleos · ${config.companyName}`, template: `%s · ${config.companyName}` },
    description: `Vacantes abiertas en ${config.companyName}.`,
    // El layout raíz bloquea la indexación (aplicación interna); aquí se permite.
    robots: { index: true, follow: true },
  };
}

/** Diseño público mínimo: nombre de la empresa, sin navegación interna. */
export default function PublicJobsLayout({ children }: LayoutProps<"/empleos">) {
  const { companyName } = requirePublicJobsConfig();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4">
          <Link href="/empleos" className="flex items-center gap-3 text-sm font-semibold" aria-label={`${companyName}: todas las vacantes`}>
            <BrandLogo />
            {/* El logo ya dice «Iterruptivo»: el nombre se repite solo si la empresa es otra. */}
            {companyName.trim().toLowerCase() === "iterruptivo" ? null : <span>{companyName}</span>}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t bg-background">
        <p className="mx-auto max-w-4xl px-4 py-4 text-xs text-muted-foreground">{companyName}</p>
      </footer>
    </div>
  );
}
