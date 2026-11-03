# Identidad visual ITERRUPTIVO y modo día/noche — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar la identidad visual de ITERRUPTIVO (paleta, Poppins, logos, nombre "Iterruptivo") y un conmutador Día/Noche/Automático, sin tocar funcionalidad.

**Architecture:** Todo el color sale de tokens CSS en `src/app/globals.css` (hex, con pares claro/oscuro y tokens de estado), validados por una prueba unitaria de contraste WCAG. El tema lo gestiona `next-themes` (clase `dark` en `<html>`) con el `nonce` de la CSP. Los logos son SVG en `public/brand/` y se alternan por CSS según el tema.

**Tech Stack:** Next.js 16.4.2 (App Router), React 19.3, Tailwind v4, shadcn/ui, `next-themes` 0.4.6 (ya instalado), `next/font/google`, Vitest (proyecto `unit`), Playwright (`tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-03-identidad-visual-iterruptivo-design.md`

## Global Constraints

- **Solo diseño:** no cambiar rutas, acciones de servidor, consultas, permisos, flujos ni textos funcionales. Ninguna prueba existente debe modificarse para que pase.
- Escribir **"Iterruptivo"** (sin "n") en textos visibles. No tocar `project_id` de `supabase/config.toml` ni el `name` de `package.json`/`package-lock.json`.
- Marca (hex verificados en iterruptivo.com): verde `#1FF287` (brillo `#5CF7AB`), degradado `#1FF287`→`#07C199`, fondos `#0A0A0F` `#111113` `#19191C` `#242428`, texto `#F2F2F0` `#A3A3A0` `#626261`, error `#FF6B6B`, aviso `#FBBF24`. Tipografía Poppins + Geist Mono.
- Estilo híbrido: barra lateral oscura (`#0A0A0F`) en **ambos** modos; contenido claro en día, oscuro en noche.
- Contraste en **ambos** modos: texto ≥ 4,5:1; contornos de campos y foco ≥ 3:1. El `#1FF287` no se usa como texto ni foco sobre fondos claros.
- Tokens nuevos en hex (no oklch) para poder verificarlos por prueba.
- Antes de escribir código de Next.js, leer la guía pertinente en `node_modules/next/dist/docs/` (AGENTS.md: esta versión tiene cambios incompatibles).
- Textos en español con tildes correctas.
- **Sin commits ni push** hasta aprobación explícita del usuario (regla del usuario). Donde la plantilla diría "Commit", se omite; los cambios quedan sin confirmar.
- Equipo con poca memoria: `tsc`, `eslint` y `build` se ejecutan en segundo plano y se espera su aviso (tardan 3–5 min).

## Review Focus

1. **Primera visita con el sistema en modo oscuro y sin preferencia guardada:** debe pintar oscuro sin parpadeo claro y sin errores de CSP en consola (task 3, `tema.spec.ts`).
2. **Valor inválido en `localStorage` (`theme`):** debe caer en *Automático*, no romper la página (task 3).
3. **Logo duplicado o invisible:** en login y página pública solo debe verse una versión del logo en cada modo, y nunca letras blancas sobre fondo claro; incluye el menú móvil (task 4).
4. **Contenido en portales (diálogos, menús, avisos):** heredan `.dark` porque la clase está en `<html>`; los avisos (sonner) siguen el tema (task 3).
5. **Estados sin color distintivo en noche:** éxito/aviso/error/info deben seguir distinguiéndose y cumplir contraste en ambos modos (task 2 y 5).

---

### Task 1: Corregir el nombre a «Iterruptivo»

**Files:**
- Create: `tests/unit/brand-name.test.ts`
- Modify: `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/auth/auth-card.tsx`, `supabase/templates/invite.html`, `supabase/config.toml` (solo la línea `subject`), `README.md`, `.env.example`, `docs/roles-y-permisos.txt`

**Interfaces:**
- Produces: la regla «ningún texto visible dice Interruptivo», protegida por la prueba.

- [ ] **Step 1: Escribir la prueba que falla** `tests/unit/brand-name.test.ts`: recorre `src/` (`.ts`, `.tsx`), `supabase/templates/`, `README.md`, `.env.example`, `docs/roles-y-permisos.txt` y las líneas de `supabase/config.toml` que no empiecen por `project_id`; `expect(hits).toEqual([])` donde `hits` son los archivos cuyo contenido coincide con `/interruptivo/i`.
- [ ] **Step 2: Ejecutar** `npx vitest run --project unit tests/unit/brand-name.test.ts` → FALLA listando los 8 archivos.
- [ ] **Step 3: Sustituir** «Interruptivo» por «Iterruptivo» en esos archivos (incluye mayúsculas de `docs/roles-y-permisos.txt`: «ITERRUPTIVO»).
- [ ] **Step 4: Ejecutar la prueba** → PASA.

### Task 2: Tokens de color, estados y prueba de contraste

**Files:**
- Modify: `src/app/globals.css`
- Create: `tests/unit/theme-contrast.test.ts`

**Interfaces:**
- Produces: tokens CSS `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --sidebar --sidebar-foreground --sidebar-primary --sidebar-primary-foreground --sidebar-accent --sidebar-accent-foreground --sidebar-border --sidebar-ring`, más tokens de estado `--success --success-foreground --warning --warning-foreground --info --info-foreground --attention --attention-foreground`, definidos en `:root` y en `.dark`. Expuestos a Tailwind en `@theme inline` como `--color-<nombre>`. (Los usan las tasks 5 y 6 como `bg-success text-success-foreground`, etc.)
- Consumes: nada.

- [ ] **Step 1: Escribir la prueba que falla** `tests/unit/theme-contrast.test.ts`: lee `src/app/globals.css`, extrae los bloques `:root` y `.dark`, convierte `#rrggbb` a luminancia WCAG y define `contrast(a, b)`. Por cada modo comprueba ≥ 4,5 en: `foreground/background`, `card-foreground/card`, `popover-foreground/popover`, `primary-foreground/primary`, `secondary-foreground/secondary`, `accent-foreground/accent`, `muted-foreground/background` y `/card`, `destructive-foreground/destructive`, `sidebar-foreground/sidebar`, `sidebar-primary-foreground/sidebar-primary`, `sidebar-accent-foreground/sidebar-accent`, y cada par `<estado>-foreground/<estado>` (success, warning, info, attention); y ≥ 3,0 en: `input` contra `card` y `background`, `ring` contra `card` y `background`, `sidebar-ring` contra `sidebar`. Además `sidebar` es oscuro (luminancia < 0,05) en ambos modos.
- [ ] **Step 2: Ejecutar** `npx vitest run --project unit tests/unit/theme-contrast.test.ts` → FALLA (tokens aún oklch / estados inexistentes).
- [ ] **Step 3: Reescribir `:root` y `.dark` en `globals.css`** con hex, según la paleta de Global Constraints. Día: `background #F2F2F0`, `card/popover #FFFFFF`, `foreground #0A0A0F`, `primary #1FF287` con `primary-foreground #0A0A0F`, `ring/input` en un verde oscuro derivado de la marca. Noche: `background #0A0A0F`, `card #111113`, `popover #19191C`, `border #242428`, `foreground #F2F2F0`, `muted-foreground #A3A3A0`, acento `#1FF287`. Estados: fondo tinte + texto oscuro en día; fondo oscuro + texto claro en noche (success=verde marca, info=cian `#00D2EF` en la familia, warning=ámbar `#FBBF24`, attention=naranja, destructive=coral derivado de `#FF6B6B`). Añadir en `@theme inline` los `--color-success…attention` (+`-foreground`) y `--color-destructive-foreground`. Conservar `--radius` y los `--chart-*`.
- [ ] **Step 4: Ejecutar la prueba**; ajustar valores hasta que PASE. Mantener los hex de marca donde cumplan; si no cumplen, oscurecer/aclarar el derivado, no cambiar el umbral.

### Task 3: Tipografía Poppins y tema día/noche (conmutador)

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/(app)/layout.tsx`
- Create: `src/components/app-shell/theme-toggle.tsx`, `src/components/app-shell/theme-provider.tsx`, `tests/e2e/tema.spec.ts`

**Interfaces:**
- Produces: `ThemeProvider({ nonce, children })` (cliente, envuelve `next-themes`); `ThemeToggle()` (cliente, menú Día/Noche/Automático con `DropdownMenu` y `useTheme`, `aria-label="Cambiar tema"`, iconos `SunIcon`/`MoonIcon`/`MonitorIcon` de lucide-react).
- Consumes: tokens de la task 2.

- [ ] **Step 1: Escribir `tests/e2e/tema.spec.ts`** (sin backend, sobre `/ingresar`): (a) con `page.emulateMedia({ colorScheme: "dark" })` y sin preferencia, `html` tiene la clase `dark`; con `light` no la tiene; (b) con `localStorage.theme = "basura"` la página carga sin error y sigue al sistema; (c) ningún mensaje de consola contiene «Content Security Policy». Debe ejecutarse en los proyectos `escritorio` y `movil`.
- [ ] **Step 2: Ejecutarla** (`npx playwright test tests/e2e/tema.spec.ts --project=escritorio`, requiere build previo, ver task 7) → FALLA (no hay provider).
- [ ] **Step 3: Poppins** en `src/app/layout.tsx`: `Poppins` de `next/font/google` (pesos 400, 500, 600, 700, `subsets: ["latin"]`, `variable: "--font-sans"`); conservar `Geist_Mono`; quitar `Geist`. Cambiar `<html>` con `suppressHydrationWarning`.
- [ ] **Step 4: Provider con nonce:** `RootLayout` lee `(await headers()).get("x-nonce")` y lo pasa a `<ThemeProvider nonce={...}>` que usa `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`. Envuelve `TooltipProvider` y `Toaster`.
- [ ] **Step 5: Montar `ThemeToggle`** en la cabecera de `src/app/(app)/layout.tsx`, antes de `NotificationBell`. Sin cambios en el resto de la cabecera.
- [ ] **Step 6: Comprobar** que `Toaster` (`src/components/ui/sonner.tsx`) sigue el tema (ya usa `useTheme`); no modificarlo salvo que falle.
- [ ] **Step 7: Ejecutar `tema.spec.ts`** tras el build → PASA.

### Task 4: Logos y favicon

**Files:**
- Create: `public/brand/logo-on-dark.svg` (copia exacta del oficial), `public/brand/logo-on-light.svg` (derivado), `src/components/common/brand-logo.tsx`, `src/app/icon.svg`, `tests/unit/brand-assets.test.ts`
- Modify: `src/app/(app)/layout.tsx` (barra lateral), `src/components/app-shell/mobile-nav.tsx`, `src/components/auth/auth-card.tsx`, `src/app/empleos/layout.tsx`
- Delete: `src/app/favicon.ico` (el `icon.svg` lo sustituye)

**Interfaces:**
- Produces: `BrandLogo({ tone, className }: { tone?: "onDark" | "auto"; className?: string })`. `onDark` muestra siempre `logo-on-dark.svg`; `auto` (por defecto) muestra `logo-on-light.svg` en día y `logo-on-dark.svg` en noche con clases `dark:hidden` / `hidden dark:block`, con `alt="Iterruptivo"` en una sola imagen visible y la otra `aria-hidden`.
- Consumes: clase `dark` en `<html>` (task 3).

- [ ] **Step 1: Prueba que falla** `tests/unit/brand-assets.test.ts`: existen `public/brand/logo-on-dark.svg` y `logo-on-light.svg`; `logo-on-dark` conserva `fill="#ffffff"` y el degradado `#1FF287`/`#07C199`; `logo-on-light` no contiene `fill="#ffffff"` y usa `#0A0A0F`; ambos tienen el mismo `viewBox`; existe `src/app/icon.svg`; no existe `src/app/favicon.ico`.
- [ ] **Step 2: Ejecutar** → FALLA.
- [ ] **Step 3: Obtener los SVG:** copiar `logo-brand-dark.svg` desde la carpeta de trabajo de la sesión (`scratchpad/iterruptivo-web/`, revisando que sea solo SVG sin scripts) a `public/brand/logo-on-dark.svg`; generar `logo-on-light.svg` sustituyendo `#ffffff` por `#0A0A0F`.
- [ ] **Step 4: Favicon:** crear `src/app/icon.svg` cuadrado con las letras «IT» (los elementos con `fill="url(#gIT)"` del logo) sobre fondo `#0A0A0F`; renderizarlo con Playwright a PNG 64 px y mirarlo para confirmar que se lee. **Sin verificar de origen:** si no queda legible, dejar un cuadrado `#0A0A0F` con «IT» en `#1FF287` y avisar al usuario.
- [ ] **Step 5: `BrandLogo`** con `next/image` (`unoptimized`, SVG) según la interfaz.
- [ ] **Step 6: Usarlo:** barra lateral `tone="onDark"` (sustituye el texto «Iterruptivo Perú» manteniendo el subtítulo «Reclutamiento y selección»); menú móvil con el fondo/tono que corresponda a su `Sheet` (comprobar que no queda logo blanco sobre fondo claro); login (`AuthCard`) y cabecera de `/empleos` con `tone="auto"`.
- [ ] **Step 7: Ejecutar la prueba** → PASA; borrar `favicon.ico`.

### Task 5: Estados y colores sueltos → tokens

**Files:**
- Modify: `src/components/common/badges.tsx` y los archivos con colores de paleta Tailwind (`comparison-table`, `interview-item`, `batch-workspace`, `notification-bell`, `evaluation-card`, `requirements-panel`, `opinion-request`, `postulaciones/[id]/page`, `panel/page`, `applications-table`, `interview-dialogs`, `candidate-form`, `status-form`, `possible-duplicate`, `entrevistas/page`)

**Interfaces:**
- Consumes: tokens de estado de la task 2 (`bg-success text-success-foreground`, `bg-warning …`, `bg-info …`, `bg-attention …`, `text-destructive`).
- Produces: la regla «sin clases de paleta Tailwind (`sky/emerald/amber/orange/red/green/blue/slate/gray/zinc…-NNN`) en `src/`», comprobada por `tests/unit/theme-tokens.test.ts`.

- [ ] **Step 1: Prueba que falla** `tests/unit/theme-tokens.test.ts`: ningún `.tsx` de `src/` coincide con `/\b(bg|text|border|ring|from|to)-(blue|slate|gray|zinc|emerald|green|red|amber|yellow|sky|indigo|violet|orange|rose|neutral|stone)-\d{2,3}\b/` (excluir `src/components/ui/`, que es el kit shadcn).
- [ ] **Step 2: Ejecutar** → FALLA listando archivos.
- [ ] **Step 3: Migrar `badges.tsx`:** el mapa `tone` pasa a `info → "bg-info text-info-foreground"`, `success`, `warning`, `attention` análogos; `neutral` y `muted` se mantienen con tokens existentes. Los mapas de estados (`VACANCY_TONES`, etc.) **no cambian**.
- [ ] **Step 4: Migrar los demás archivos** sustituyendo cada clase de paleta por el token de estado de significado equivalente (verde→success, ámbar→warning, azul/cian→info, naranja→attention, rojo→destructive) y eliminando el `dark:` redundante. No cambiar lógica, textos ni estructura.
- [ ] **Step 5: Ejecutar la prueba** → PASA.

### Task 6: Pulido de barra lateral, login, página pública y correo

**Files:**
- Modify: `src/app/(app)/layout.tsx` (clases de barra lateral y cabecera), `src/components/app-shell/nav-links.tsx` (solo clases), `src/components/auth/auth-card.tsx` (fondo/tarjeta), `src/app/empleos/layout.tsx` (cabecera/pie), `supabase/templates/invite.html`

**Interfaces:**
- Consumes: tokens `--sidebar*` y `BrandLogo` (tasks 2 y 4).

- [ ] **Step 1: Barra lateral** con tokens `--sidebar*` (oscura en ambos modos); ítem activo con `bg-sidebar-primary text-sidebar-primary-foreground` (verde marca), ítem normal `text-sidebar-foreground` y hover `bg-sidebar-accent`. Sin cambiar `ICONS`, `NavItem` ni la lógica de `active`.
- [ ] **Step 2: Cabecera y contenido** (`bg-card`, `border`) sin cambios de estructura; el `main` usa el fondo `--background`.
- [ ] **Step 3: Login y `/empleos`:** fondo `bg-background` y detalle de marca (línea o degradado `#1FF287`→`#07C199` decorativo, `aria-hidden`); sin cambiar formularios ni textos funcionales.
- [ ] **Step 4: Correo de invitación:** botón `background: #1FF287; color: #0A0A0F`, texto `#0A0A0F`; sin imágenes (los clientes de correo no cargan `public/`). Conservar `{{ .SiteURL }}`, `{{ .TokenHash }}` y el enlace tal cual.
- [ ] **Step 5: Ejecutar** `npx vitest run --project unit` completo → todo PASA (incluye `brand-name`, `theme-contrast`, `brand-assets`, `theme-tokens`).

### Task 7: Verificación, build y reinicio del servidor

**Files:** ninguno (solo comprobaciones).

- [ ] **Step 1: Memoria:** revisar RAM libre; si es < 2 GB, avisar al usuario antes de seguir.
- [ ] **Step 2: Typecheck** `npx next typegen` y `npx tsc --noEmit` en segundo plano → salida 0.
- [ ] **Step 3: Lint** `npx eslint` en segundo plano → salida 0.
- [ ] **Step 4: Pruebas** `npx vitest run --project unit` → todo en verde, sin pruebas previas modificadas (`git diff --stat tests/` solo muestra archivos nuevos).
- [ ] **Step 5: Build** `npm run build` en segundo plano → éxito.
- [ ] **Step 6: E2E de tema** `npx playwright test tests/e2e/tema.spec.ts` (ambos proyectos) → PASA; revisar la captura del favicon.
- [ ] **Step 7: Reiniciar el servidor** (autorizado por el usuario): detener el que escuche en el puerto 3000 si existe y arrancar `npx next start -p 3000` en segundo plano; comprobar con una petición a `/ingresar` que responde 200.
- [ ] **Step 8: Entregar al usuario** con el nivel alcanzado dicho con exactitud (validado estáticamente / probado en navegador) y la lista de lo no verificado (login con sesión real, páginas internas en ambos modos, favicon). Sin commit.
