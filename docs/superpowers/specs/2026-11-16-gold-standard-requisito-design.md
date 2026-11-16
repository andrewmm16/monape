# Diseño corto: gold standard por requisito + medidor de precisión

- **Fecha:** 2026-11-16
- **Estado:** propuesto (pendiente del visto bueno de Omar a las reglas de etiquetado)
- **Ámbito:** `scripts/medir-motor/` (solo medición). **No toca el motor, el scoring ni la BD.**

## Intención y porqué

Hoy el banco mide el **orden** de candidatos dentro de cada puesto (`medir:motor`, 8/8)
y la **separación de puntajes** entre niveles de ajuste (`calibrar:motor`). Lo que falta
es la vara más fina: la **verdad esperada por requisito**. Para cada una de las ~250
casillas (32 CVs × 6-9 requisitos) se fija cuál *debería* ser el veredicto correcto, y
con eso se mide **precisión y recall del motor requisito por requisito**.

Es el paso 1 de la hoja de ruta de calibración y la base de los pasos siguientes. En
concreto, convierte en número el hallazgo de la inspección de Chuquilín: los "créditos
generosos" que ignoran el nivel declarado ("Excel intermedio" acreditando "Excel
avanzado", "nociones de X" acreditando "conocimiento de X").

Esta vara habilita la secuencia completa que acordamos: **medir → aplicar el arreglo de
nivel/matiz al motor → volver a medir** y demostrar que subió la precisión sin empezar a
descartar méritos reales.

## Objetivos / no-objetivos / anti-objetivos

**Objetivos**
- Etiquetar las ~250 casillas con el veredicto esperado, cada una con una nota corta que
  diga de dónde sale (trazable al CV y al requisito).
- Un medidor `gold:motor` que corra el motor vigente contra la vara y reporte, por
  requisito: matriz de confusión, precisión/recall por clase y —lo que importa en RRHH—
  **sobre-acreditación** (falsos positivos) y **mérito perdido** (falsos negativos), con
  la lista de celdas culpables.

**No-objetivos**
- No cambia el motor. El arreglo de nivel/matiz es un paso posterior, ya con número.
- No etiqueta datos reales de candidatos: solo el banco ficticio de `cv-prueba/`.

**Anti-objetivos (fracaso aunque "funcione")**
- Una vara que copie lo que hoy hace el motor no mide nada. La verdad se deriva del
  **contenido del CV** (del generador `generar-cv-prueba.ts`) frente al **requisito**,
  nunca de la salida del motor.
- Etiquetas sin trazar. Cada celda lleva su nota; las dudosas se marcan `revisar` para tu
  visto bueno antes de dar la vara por buena.

## Reglas de etiquetado (la verdad esperada)

Vocabulario = el del motor (`Assessment`): `acreditado` / `no_cumplido` / `sin_evidencia`
/ `pendiente_verificacion`.

1. **Requisito esencial/legal** (`isEssential`, p.ej. colegiatura CEP/CIP, colegiatura de
   contador): si el CV lo declara → `pendiente_verificacion` (motivo `legal`). Correcto: el
   motor no puede acreditar un requisito legal solo con el CV; RRHH lo verifica con
   documento. Si el CV no lo menciona → `sin_evidencia`.
2. **Evidencia clara y suficiente** (cumple el nivel pedido y, si aplica, el mínimo de
   años) → `acreditado`.
3. **Cumplimiento PARCIAL** → `pendiente_verificacion` (motivo `parcial`). Hay evidencia
   relevante, pero no alcanza lo pedido: nivel por debajo ("Excel intermedio" cuando se
   pide "avanzado", AutoCAD intermedio, técnica cuando se pide licenciatura), años por
   debajo del mínimo, estudios en curso/en trámite, o lenguaje que matiza a la baja
   ("nociones de…", "básico"). **No es ni acreditado ni no_cumplido: es una señal para que
   RRHH lo juzgue.** Es la corrección clave de Omar: un cumplimiento parcial no puede caer
   en `no_cumplido`.
4. **Negación explícita** (el CV afirma que NO lo tiene, p.ej. "no cuento con experiencia
   en planillas") → `no_cumplido`. Este veredicto queda reservado solo para esto.
5. **Sin ninguna mención** → `sin_evidencia`.
6. **Celdas dudosas** (el matiz es discutible): se etiqueta con la verdad más defendible y
   se marca `revisar: true` para tu visto bueno antes de cerrar la vara.

**Cómo expone esto el problema de Chuquilín:** sus casillas de "Excel intermedio" y
"nociones de legislación laboral" quedan en la vara como `pendiente_verificacion`
(parcial). El motor hoy las da como `acreditado`. Esa discrepancia (motor `acreditado` vs.
vara `pendiente`) es precisamente lo que el medidor cuenta como **sobre-acreditación**, sin
necesidad de marcarlas injustamente como "no cumplido".

## Diseño

- **`scripts/medir-motor/gold-standard.ts`** — la vara: `GOLD: Record<archivo,
  Record<reqId, { assessment: Assessment; nota: string; revisar?: boolean }>>`. Datos
  puros, sin lógica. Es lo que revisas tú.
- **`scripts/medir-motor/gold.ts`** — el medidor: corre `evaluarTexto` (mismo pipeline de
  extracción y motor que el resto del banco) sobre los 32 CVs, cruza cada ítem con la
  vara y reporta matriz de confusión, precisión/recall por clase y las dos listas
  críticas (sobre-acreditación, mérito perdido). Determinista; sin BD ni servicios. Modo
  `--json`. Las celdas `revisar` se cuentan aparte y no contaminan las métricas hasta que
  las apruebes.
- **`package.json`** — `"gold:motor": "tsx scripts/medir-motor/gold.ts"` (una línea; no se
  toca nada más).
- **Versiones:** no cambia `RULE_ENGINE_VERSION` ni `SCORING_VERSION`. `medir:motor` sigue
  8/8 y `calibrar:motor` igual.

## Verificación

- `npm run gold:motor` corre sin error sobre los 32 CVs y produce el informe.
- La vara cuadra con la realidad conocida: los requisitos esenciales (colegiaturas) salen
  `pendiente_verificacion`, y el motor coincide ahí (no es un error, es el principio).
- Revisión de las celdas `revisar` por Omar antes de cerrar la vara.
- typecheck y lint de los dos archivos nuevos en verde.

## Flujo de trabajo

1. Escribo la vara (borrador de las ~250 celdas) y el medidor.
2. Corro el medidor contra el motor actual → saco el número de sobre-acreditación y mérito
   perdido.
3. Te entrego el informe + la lista de celdas `revisar` para tu visto bueno.
4. Con la vara aprobada: aplico el arreglo de nivel/matiz al motor y vuelvo a medir.
