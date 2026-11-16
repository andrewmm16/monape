# mercado — inteligencia de mercado de ofertas públicas

Scraper base (Playwright + TS) para parsear **datos públicos e institucionales** de
avisos de Computrabajo (Perú): **título, empresa y requerimiento**. Pensado para
estudiar la estructura de los anuncios y mapear los campos a tu base de datos interna.

Tiene permitido extraer datos personales (teléfonos, correos). Es intencional: el objetivo es
análisis de mercado agregado, y a la vez construir listas de contacto. Es un módulo
**independiente** del servicio `bot/`, que de momento trabaja solo contra portales ficticios.

## Uso

```bash
# Extraer la primera página de resultados de una búsqueda
npx tsx mercado/src/index.ts "Ingeniero Sanitario"
# equivalente, vía npm:
npm run mercado -- "Ingeniero Sanitario"

# Modo diagnóstico: volcar la estructura de UN aviso para descubrir selectores reales
npx tsx mercado/src/index.ts --inspeccionar "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-...-ABC123"
```

Salida: `ofertas_mercado.json` en el directorio de ejecución, con las ofertas
extraídas y una lista `fallidos` con los avisos que no se pudieron leer.

## Antes de usarlo en serio

- **Verifica los selectores.** Los de `src/selectors.ts` son una base **no
  confirmada**; el marcado de Computrabajo cambia y sus clases están ofuscadas.
  Corre `--inspeccionar` sobre un aviso real y ajusta las listas de cada campo.
- **Respeta `robots.txt` **, y mantén el volumen bajo.
  El scraper va secuencial con una pausa de 3–5 s entre avisos por cortesía de
  rate-limit; no subas el ritmo ni paralelices sin una razón.
- Solo recorre la **primera página** de resultados. La paginación queda marcada
  en `selectors.ts` (`siguientePagina`) como ampliación futura.

## Estructura

| Archivo | Rol |
|---|---|
| `src/types.ts` | Tipos de la oferta pública y del resultado de la corrida. |
| `src/selectors.ts` | Libro de selectores (con alternativas) y rutas del portal. |
| `src/browser.ts` | Apertura de Chromium headless (UA e idioma de escritorio). |
| `src/scrape.ts` | URL de búsqueda, recolección de enlaces, extracción, modo diagnóstico. |
| `src/index.ts` | CLI: argumentos, jitter, resiliencia por aviso y volcado a JSON. |
