import type { Metadata } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ThemeProvider } from "@/components/app-shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const poppins = Poppins({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Reclutamiento · Iterruptivo Perú", template: "%s · Reclutamiento" },
  description: "Plataforma interna de reclutamiento y selección de Iterruptivo Perú.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Renderizado por solicitud: necesario para aplicar el nonce de la CSP.
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="es-PE" className={`${poppins.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider nonce={nonce}>
          <TooltipProvider>{children}</TooltipProvider>
          {/* Debajo del encabezado (h-14): los avisos no tapan la campana ni el menú. */}
          <Toaster position="top-right" richColors closeButton offset={{ top: 72 }} mobileOffset={{ top: 64 }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
