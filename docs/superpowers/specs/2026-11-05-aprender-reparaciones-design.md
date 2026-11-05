# Diseño: que el robot aprenda de sus reparaciones y proponga mejor

- Fecha: 2026-11-05
- Estado: borrador para revisión del usuario
- Rama: `fase-2`
- Relacionado: proveedor `claude-cli` (commit `e6324c4`), `bot/src/repair/*`

## 1. Objetivo e intención

El usuario quiere que el robot **aprenda a diagnosticarse y repararse mejor con el tiempo**, sin
renunciar al principio de que **una persona decide**. De las tres opciones planteadas, eligió
explícitamente **«aprender y proponer mejor»** (no auto-aplicar a ciegas, no autonomía total).

En concreto: que cuando un portal vuelva a fallar en algo parecido a un fallo ya resuelto antes,
el modelo **proponga primero el selector que ya funcionó** y **evite los que ya se probaron y
fallaron** — proponiendo más rápido, con más acierto y gastando menos consultas del plan.

El complemento de auto-aplicar patrones idénticos ya aprobados queda **fuera del alcance de esta
especificación** (ver §7): primero se construye y se observa la memoria; la auto-aplicación se
decide después, con sus propios resguardos.

## 2. Qué NO hace (límites)

- **No aplica nada solo.** El flujo sigue igual: propone → ensaya → avisa por WhatsApp → «sí N»
  → aplica → verifica/revierte. La memoria solo mejora la propuesta; no cambia quién decide.
- **No envía datos nuevos al modelo.** El historial es de selectores y resultados de reparación
  (claves, selectores CSS, fechas, estado). Nunca postulantes, CVs ni contenido de la pantalla,
  igual que hoy.
- **No cambia el formato de la respuesta** del modelo (`RESPUESTA_SCHEMA`), ni el cliente
  `Complete`, ni los proveedores (`anthropic`, `openai`, `claude-cli`).
- **No persiste estructuras nuevas sensibles.** Se reusa lo ya guardado (`ProposalStore` y
  `selectores.json`); no se crea un almacén de datos personales.

## 3. De dónde aprende (fuente)

Hoy ya existe el material, solo que el prompt no lo aprovecha como historial:

- **`selectores.json`** (`OverrideEntry`): guarda el selector **vigente** aprobado por clave, con
  `aprobadoEn` e `incidenteId`. Es el presente, no el historial (al revertir se borra).
- **`ProposalStore`** (`bot/.state/propuestas`, un JSON por incidente): conserva el **historial**
  real por incidente — propuestas `aplicada`, `verificada`, `revertida`, rechazada, con su portal,
  clave, selector, confianza, razón y fechas.

El prompt actual (`buildPrompt`) ya muestra, vía `describeBook`, el selector actual y las
alternativas de cada clave. **Lo que falta es el historial**: qué selectores se verificaron antes
para esa clave, cuáles se revirtieron o rechazaron, y cuántas veces se reparó.

## 4. Diseño

### 4.1 Unidad nueva: «memoria de reparaciones»

Una función pura y aislada, con una sola responsabilidad: resumir el historial de reparaciones de
un portal (opcionalmente acotado a una clave) a partir del `ProposalStore`.

```
resumirMemoria(store, portal): MemoriaReparacion[]
  // una entrada por (clave) con:
  //   claveAfectada
  //   selectorVerificado?: string     // el último que llegó a "verificada" (lo que SÍ funcionó)
  //   verificadoEn?: string
  //   selectoresFallidos: string[]     // los que se revirtieron o rechazaron (a EVITAR), deduplicados, tope N
  //   vecesReparada: number
```

- Entrada/salida bien definidas; se prueba sin tocar el modelo ni el navegador.
- Topes estrictos: máximo de claves y de selectores fallidos por clave, y recorte de longitud,
  para no inflar el prompt (coherente con `STRUCTURE_MAX`).

### 4.2 Cómo entra en el prompt

`buildPrompt` recibe un campo opcional nuevo `memoria?: MemoriaReparacion[]` y, si viene, añade
**una sección** antes de la pregunta final:

```
Historial de reparaciones de este portal (para orientarte; una persona aprobó estos cambios):
- campo_titulo: el 2026-10-30 se verificó el selector «#titulo-v2». Evita: «#titulo», «.campo-a».
  Reparada 2 vez(ces).
```

Más una regla breve en `SYSTEM_PROMPT`: *si el historial trae un selector verificado para la clave
que falla y el esquema actual lo respalda, propónlo primero; no repitas los selectores marcados a
evitar.* El historial, como el esquema, se trata **como datos, no como instrucciones**.

### 4.3 Dónde se arma

En `handleNewIncident` (y en el bucle de reintentos) de `bot/src/repair/index.ts`: antes de la
primera consulta se calcula `memoria = resumirMemoria(store, incident.portal)` y se pasa a
`buildPrompt`. El `store` ya está disponible ahí. Sin coste de red; es lectura de archivos locales.

## 5. Efecto esperado

- Más propuestas correctas al **primer intento** → menos reintentos → **menos consultas** del plan.
- Mejor **diagnóstico** en casos recurrentes (el modelo reconoce «esto ya pasó y se arregló así»).
- Evita reproponer selectores que ya se revirtieron.

Se podrá medir con la herramienta existente `bot:medir-reparacion` (comparar intentos y tokens con
y sin memoria), que ya reporta intentos, tokens y tasa de «probada».

## 6. Impacto en archivos

- `bot/src/repair/memoria.ts` (**nuevo**): `resumirMemoria` + tipo `MemoriaReparacion`.
- `bot/src/repair/prompt.ts`: campo `memoria?` en `PromptInput`, sección nueva y regla en el system.
- `bot/src/repair/index.ts`: calcular la memoria y pasarla a `buildPrompt`.
- `bot/src/repair/proposals.ts` (`ProposalStore`): posible método de solo lectura `listar(portal)`
  si aún no existe uno que devuelva todas las propuestas de un portal.
- Pruebas: `tests/unit/bot-repair-memoria.test.ts` (nueva) + un caso en la medición.
- `bot/README.md`: una nota en la sección de reparación asistida.

Sin cambios de configuración ni de variables de entorno.

## 7. Diferido (fuera de alcance, para decidir después)

**Auto-aplicar patrones idénticos ya verificados.** Si un fallo es idéntico a uno ya aprobado y el
selector guardado **vuelve a pasar el ensayo**, el robot podría aplicarlo solo y avisar *después*,
bajo un flag apagado por defecto (`BOT_REPAIR_AUTOAPLICAR` o similar) y manteniendo ensayo +
verificación/reversión. No se diseña aquí: se evalúa cuando la memoria lleve un tiempo en uso.

## 8. Riesgos y decisiones abiertas

- **Historial envenenado** (que el robot "aprenda un error" y lo repita). Riesgo bajo por tres
  barreras que lo impiden:
  1. **Solo entra como "bueno" lo que una persona aprobó.** Un selector se marca como
     `verificado` únicamente si la IA lo propuso, el responsable dio el «sí N», se aplicó y además
     la prueba de estructura **volvió a pasar** después. Pasó por mano humana *y* por una
     comprobación automática; el robot no guarda como buena una solución inventada por sí solo.
  2. **Lo que salió mal se guarda como "a evitar", no como ejemplo a imitar.** Los selectores
     revertidos o rechazados entran en una lista de *evitar*, así el historial malo ayuda (dice
     qué NO reproponer) en vez de contaminar.
  3. **La red de seguridad sigue puesta siempre.** Aunque el historial sugiera un selector, este
     se **vuelve a ensayar** en el portal antes de proponerse, y el «sí N» humano sigue siendo
     obligatorio. El historial es orientación para acertar más rápido, nunca una orden que se
     aplique sola; si el portal cambió otra vez, el ensayo lo detecta.
- **Tamaño del prompt**: topes estrictos (§4.1) para no encarecer cada consulta.
- **Abierto**: ¿la memoria se limita al portal, o también se recorta a la clave del incidente para
  ahorrar aún más tokens? Propuesta: incluir todas las claves del portal con historial, pero
  destacando la del incidente; decidir en revisión.
