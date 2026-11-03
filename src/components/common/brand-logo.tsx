import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo de Iterruptivo. `onDark`: siempre la versión de letras blancas (para zonas
 * oscuras, como la barra lateral). `auto`: letras oscuras en modo día y blancas
 * en modo noche, alternadas por CSS (sin estado, sin desajuste de hidratación).
 */
export function BrandLogo({ tone = "auto", className }: { tone?: "onDark" | "auto"; className?: string }) {
  const size = { width: 944, height: 120, unoptimized: true } as const;
  if (tone === "onDark") {
    return <Image src="/brand/logo-on-dark.svg" alt="Iterruptivo" className={cn("h-6 w-auto", className)} {...size} />;
  }
  return (
    <>
      <Image src="/brand/logo-on-light.svg" alt="Iterruptivo" className={cn("h-6 w-auto dark:hidden", className)} {...size} />
      <Image src="/brand/logo-on-dark.svg" alt="" aria-hidden className={cn("hidden h-6 w-auto dark:block", className)} {...size} />
    </>
  );
}
