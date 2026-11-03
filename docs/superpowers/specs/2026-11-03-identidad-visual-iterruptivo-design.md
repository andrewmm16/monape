# Identidad visual ITERRUPTIVO y modo día/noche — diseño

Fecha: 2026-11-03 · Rama: `fase-2` · Estado: pendiente de revisión del usuario

## Objetivo
Que la plataforma se vea mejor y sea reconocible como producto de ITERRUPTIVO (paleta, tipografía y logos de la marca), con un conmutador de modo día/noche. Escribir siempre **"Iterruptivo"** (sin "n").

## Restricción principal
**Solo diseño.** No se cambia ninguna funcionalidad: rutas, acciones de servidor, consultas, permisos, flujos ni textos funcionales. Los cambios se limitan a estilos, tipografía, logos, el nombre de marca en textos visibles y el conmutador de tema.

## Fuente de la marca (verificada en iterruptivo.com el 2026-11-03)
Extraída del HTML y CSS publicados; no hay manual de marca público.

| Elemento | Valor |
|---|---|
| Verde principal | `#1FF287` (brillo `#5CF7AB`) |
| Degradado del logo | `#1FF287` → `#07C199` |
| Fondos oscuros | `#0A0A0F`, `#111113`, `#19191C`, `#242428` |
| Texto | `#F2F2F0` (principal), `#A3A3A0` (secundario), `#626261` (apagado) |
| Estados | error `#FF6B6B`, aviso `#FBBF24` |
| Tipografías | Poppins (texto y títulos), Geist Mono |
| Logo | `https://iterruptivo.com/images/logo-brand-dark.svg` (letras blancas, "IT" en degradado verde) |

Copias de trabajo descargadas en la carpeta temporal de la sesión (datos no confiables hasta revisarlos).

## Decisiones (aprobadas por el usuario)
1. **Estilo híbrido.** Barra lateral oscura (`#0A0A0F`) en ambos modos; contenido claro en modo día y oscuro en modo noche.
2. **Conmutador sol/luna** en la cabecera, junto a la campana: *Día*, *Noche*, *Automático* (sigue al sistema). La elección se recuerda en el navegador de cada persona.
3. **Alcance enfoque B:** tokens + logo + pulido de piezas clave (barra lateral, login, estados, página pública `/empleos`, favicon, correo de invitación). Sin rediseño de pantallas.
4. **Páginas públicas** (`/empleos`, login) también siguen el tema (supuesto: el usuario no pidió excluirlas).

## Diseño técnico
### Tokens (`src/app/globals.css`)
- `:root` (día): fondo `#F2F2F0`, tarjetas blancas, texto `#0A0A0F`, primario verde con texto oscuro, acento/foco con un verde más oscuro derivado de la marca (el `#1FF287` sobre blanco no cumple contraste como texto ni como foco).
- `.dark` (noche): fondo `#0A0A0F`, tarjetas `#111113`/`#19191C`, bordes `#242428`, texto `#F2F2F0`/`#A3A3A0`, acento `#1FF287`.
- Sidebar: tokens `--sidebar*` propios, oscuros en ambos modos.
- Los valores exactos se fijan en la implementación y se verifican con cálculo de contraste: texto ≥ 4,5:1; contornos de campos y foco ≥ 3:1, **en ambos modos**.

### Tipografía (`src/app/layout.tsx`)
`Poppins` vía `next/font/google` para `--font-sans` y `--font-heading`; se conserva `Geist_Mono`.

### Tema (conmutador)
- `next-themes` (0.4.6, ya instalado) con `ThemeProvider` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`) en el layout raíz.
- La CSP exige `nonce` en scripts: se pasa el valor de `x-nonce` (generado en `src/proxy.ts`) al provider para que su script de arranque no sea bloqueado y no haya parpadeo. Se verifica en navegador.
- Nuevo componente cliente `ThemeToggle` (menú con Día/Noche/Automático) en `src/components/app-shell/`, montado en la cabecera de `src/app/(app)/layout.tsx`.
- `Toaster` (sonner) ya usa `useTheme`; se comprueba que siga el tema.
- Las variantes `dark:` existentes (≈20 archivos) se revisan con la paleta nueva.

### Logos y favicon
- Logo oficial en `public/brand/` (letras blancas) para barra lateral y modo noche.
- Variante con letras oscuras (`#fff` → `#0A0A0F`), derivada del SVG oficial; es una **adaptación propia**, no un archivo oficial. Se alterna con clases `dark:`/`hidden`.
- Favicon: el `icon.svg` del sitio pesa igual que el logo (16.490 bytes), posiblemente es el mismo archivo. Se intenta un ícono cuadrado con las letras "IT" verdes; **no verificado**, se revisa el resultado.

### Nombre
"Interruptivo" → "Iterruptivo" en textos visibles: `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/auth/auth-card.tsx`, `supabase/templates/invite.html`, `supabase/config.toml`, `README.md`, `.env.example`, `docs/roles-y-permisos.txt`. Se deja el nombre interno del paquete (`package.json`/`package-lock.json`).
Nota: la plantilla de correo en Supabase en la nube es independiente de la local; si ya se usa, hay que actualizarla allí.

### Estados y alertas
`src/components/common/badges.tsx` y los ~16 archivos con colores sueltos pasan a pares claro/oscuro con la paleta, manteniendo la distinción éxito/aviso/error. El rojo de la web (`#FF6B6B`) es demasiado claro para texto sobre blanco: se usa uno más oscuro en modo día.

## Fuera de alcance
Cambios de funcionalidad, rediseño de layouts, nuevas pantallas, modo por usuario guardado en base de datos.

## Verificación
1. Cálculo de contraste de las dos paletas.
2. `tsc`, `eslint`, pruebas unitarias existentes, `npm run build`.
3. Pruebas existentes sin cambios de comportamiento (ninguna prueba funcional debe modificarse).
4. Reinicio del servidor (`next start -p 3000`, autorizado por el usuario) y revisión visual por el usuario en ambos modos.
5. Sin commit ni push hasta aprobación explícita del usuario.

## Riesgos
- Memoria limitada del equipo: el build y el servidor pueden ser interrumpidos; se ejecutan en segundo plano.
- Logo y favicon derivados: revisión visual del usuario.
- CSP + script de tema: verificar que no aparezcan errores de CSP en consola.
