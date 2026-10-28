import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Reclutamiento · Interruptivo Perú", template: "%s · Reclutamiento" },
  description: "Plataforma interna de reclutamiento y selección de Interruptivo Perú.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Renderizado por solicitud: necesario para aplicar el nonce de la CSP.
  await connection();
  return (
    <html lang="es-PE" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        {/* Debajo del encabezado (h-14): los avisos no tapan la campana ni el menú. */}
        <Toaster position="top-right" richColors closeButton offset={{ top: 72 }} mobileOffset={{ top: 64 }} />
      </body>
    </html>
  );
}
