# Comparativa con Pandapé e ingeniería inversa funcional

**Fecha:** 2026-11-16 · **Rama:** `fase-2`

Documento de trabajo que reúne (1) el **estado actual** de la plataforma frente a
Pandapé, y (2) el **plan para estudiar una cuenta real de Pandapé** cuando nos den
acceso, con el fin de cerrar brechas y mejorar lo que ya tenemos.

Complementa a [`roadmap-paridad-pandape.md`](roadmap-paridad-pandape.md) (orden de
ejecución y esfuerzo por tarea) y al [`guion-demo-rrhh.md`](guion-demo-rrhh.md). No
lo reemplaza: aquí va el **método de observación** y el **detalle por módulo**.

---

## 1. Qué es "ingeniería inversa funcional" aquí

**Ingeniería inversa de comportamiento:** con acceso a una cuenta de Pandapé,
observar de forma sistemática **qué hace** el producto y **cómo**, para reconstruir
en nuestra plataforma la misma utilidad con nuestra propia implementación.

El método:

- Recorrer cada flujo y anotar **campos, estados, validaciones, automatizaciones,
  correos, reportes y permisos**.
- Capturar **pantallas y mapas de flujo**.
- Mirar las **llamadas de red** del navegador al usar la cuenta (pestaña Red de las
  DevTools) para inferir el **modelo de datos** y los estados.
- Traducir todo eso a **especificaciones** nuestras (tablas, módulos, criterios de
  aceptación).

---

## 2. Estado actual frente a Pandapé

Verificado contra el código (`src/modules/*`, `src/app/(app)/*`) el 2026-11-16.

**Leyenda:** ✅ completo · 🟡 a medias · ⬜ falta · **plus** = lo tenemos y Pandapé no.

| Capacidad (Pandapé) | Estado | Qué tenemos / qué falta | Dónde (código) |
|---|:---:|---|---|
| Multiposting a portales | ✅ | Publica/automatiza Indeed, Bumeran, LinkedIn, Computrabajo | `portals`, `portal-bot`, `bot/` |
| Página de empleo (careers) | ✅ | `/empleos` público, slug SEO, `feed.xml`, sitemap/robots | `public-jobs`, `app/empleos` |
| Formulario de postulación online | ✅ | Formulario público + recepción | `online-apply` |
| Killer questions (preguntas filtro) | ✅ | Preguntas eliminatorias que **marcan**, no descartan | `vacancies` (killer-questions) |
| Scoring / matching de candidatos | ✅ | Motor **explicable** (criterios, evidencias, límites) + extracción/OCR | `evaluation`, `resumes` |
| Anti-trampas en CV | ✅ **plus** | Detector de texto oculto, señales de fechas imposibles | `resumes` |
| Pipeline / Kanban (fases) | ✅ | Tablero de 5 columnas + vista tabla | `applications`, `components/vacancies` |
| Plantillas de correo editables | ✅ | Editor + vista previa + restaurar | `email-templates` |
| Comunicación con el candidato | ✅ | Mensaje libre + aviso de estado (envío real por Resend) | `applications`, `notifications` |
| Agenda de entrevistas | ✅ | Agendar, reprogramar, correo, registrar resultado | `interviews`, `app/entrevistas` |
| Reportes / analítica | ✅ | KPIs, embudo, fuentes, tendencia, tiempos, export CSV | `reports`, `app/reportes` |
| Privacidad / consentimiento | ✅ | Aviso y consentimiento en la parte pública | `privacy`, `app/empleos/privacidad` |
| Auditoría | ✅ | Registro de cambios | `audit`, `app/auditoria` |
| Usuarios / roles / permisos | ✅ | Roles admin / rrhh con permisos | `users`, `lib/auth/permissions` |
| Integraciones / API | ✅ | Feed y postulación Talent.com | `integrations` |
| Sourcing proactivo (buscar CVs) | ✅ **plus** | Cosecha y enriquecimiento de prospectos | `caleta`, `mercado/` |
| **Evaluación colaborativa** | 🟡 | Hay "pedir opinión" a **un** evaluador asignado. Falta scorecard multi-evaluador con puntajes comparables | `applications` (`requestOpinion`) |
| **Base de talentos / CRM** | 🟡 | Búsqueda con filtros y skills. Falta etiquetas/carpetas, reactivación y campañas | `talent-pool` |
| **WhatsApp / multicanal** | 🟡 | Envío WhatsApp existe en sourcing. Falta integrarlo como canal del pipeline | `caleta`, `bot/` |
| **Portal del candidato** (seguimiento) | ⬜ | El candidato postula pero no consulta su estado | — |
| **Scorecard por competencias** en entrevista | ⬜ | Se registra resultado, sin plantilla estructurada | `interviews` |
| IA de redacción de ofertas | ⬜ | Genera descripción desde requisitos (necesita `AI_API_KEY`) | — |
| IA de evaluación (2ª opinión) | ⬜ | Cazar falsos negativos del motor literal | — |

**Resumen honesto:** el núcleo del ATS está cubierto y en scoring explicable,
anti-trampas y sourcing vamos **por encima** de Pandapé. El valor diferencial por
cerrar está en lo 🟡 (evaluación colaborativa y CRM de talentos).

---

## 3. Qué observar en la cuenta Pandapé, por módulo

Checklist para la sesión de análisis. Por cada módulo anotar: **campos del
formulario, estados posibles, transiciones, validaciones, qué correo/notificación
dispara, qué permisos lo ven, y qué columnas/filtros ofrece**.

### 3.1 Prioritario (cierra lo 🟡 y ⬜)

- **Evaluación colaborativa / scorecards**
  - ¿Cómo invita a varios evaluadores? ¿Por vacante o por candidato?
  - Estructura del scorecard: competencias, escala (1–5, sí/no, texto), peso.
  - ¿Agrega los puntajes? ¿Muestra promedio, consenso, desacuerdos?
  - ¿Comentarios por evaluador? ¿Quién ve qué? ¿Se puede evaluar a ciegas?
  - Correos/recordatorios a los evaluadores.
- **Base de talentos / CRM**
  - Etiquetas, carpetas, listas, "viveros"/pools. ¿Cómo se agrupan candidatos?
  - Reactivación: reusar un candidato de un proceso viejo en una vacante nueva.
  - Búsqueda avanzada: filtros, skills, texto libre, boolean, ubicación.
  - Campañas/mailing a un pool. Consentimiento y caducidad del dato.
- **Portal del candidato**
  - ¿Login del candidato? ¿Qué ve de su estado? ¿Puede subir documentos, agendar?
  - Notificaciones automáticas de cambio de etapa.
- **Scorecard de entrevista por competencias**
  - Plantillas por tipo de puesto, guía de preguntas, rúbrica.

### 3.2 Para igualar/pulir lo que ya tenemos

- **Pipeline/fases:** nombres y orden de fases por defecto, acciones masivas,
  automatizaciones al mover de fase (correo, tarea, etiqueta).
- **Reportes:** qué KPIs e informes trae de fábrica, filtros, time-to-hire,
  fuente de contratación, embudo por vacante/reclutador.
- **Multiposting:** lista exacta de portales, campos que pide cada uno, estados de
  publicación, caducidad/renovación del aviso.
- **Plantillas y automatizaciones:** variables disponibles, disparadores, secuencias.
- **Permisos:** roles de fábrica y qué puede hacer cada uno.
- **Killer questions:** tipos de pregunta, si auto-descarta (nosotros **no**), cómo
  pondera.

### 3.3 Cómo registrar la sesión (entregables del análisis)

1. **Mapa de flujos** (uno por módulo): pantallas y transiciones, en nuestras notas.
2. **Diccionario de datos observable:** por entidad (vacante, candidato, postulación,
   evaluación, entrevista, pool), los campos y estados que se ven en la UI y en la
   pestaña Red.
3. **Catálogo de automatizaciones:** disparador → acción → correo/plantilla.
4. **Lista de brechas priorizada:** qué de lo observado adoptamos, adaptamos o
   descartamos (y por qué).

---

## 4. De la observación a la implementación

Cada hallazgo se traduce a una tarea con objetivo, cambios técnicos y criterios de
aceptación. Prioridad alineada con [`roadmap-paridad-pandape.md`](roadmap-paridad-pandape.md).

### Fase A — Cerrar lo que está a medias (mayor retorno)

**A1. Evaluación colaborativa con scorecards** (hoy: `requestOpinion` a un evaluador)
- **Objetivo:** varios evaluadores puntúan al candidato con una rúbrica y RRHH ve el
  consolidado.
- **Cambios técnicos (estimado):** tabla `evaluation_scorecards` (postulación,
  evaluador, competencia, puntaje, comentario) + rúbrica por vacante o plantilla;
  RLS por evaluador; vista de consolidado (promedio + desacuerdos) en la ficha de la
  postulación; correos de invitación/recordatorio (reusar `notifications`).
- **Aceptación:** N evaluadores puntúan; se ve el consolidado; auditado.

**A2. CRM de talentos** (hoy: `talent-pool` con búsqueda)
- **Objetivo:** etiquetar, agrupar y reactivar candidatos del histórico en vacantes
  nuevas.
- **Cambios técnicos:** `talent_tags` + `talent_tag_assignments`; acción "añadir a
  vacante" desde el pool; filtros por etiqueta/skill; consentimiento y caducidad del
  dato (atar a `privacy`).
- **Aceptación:** buscar por etiqueta/skill, mover un candidato del pool a una
  vacante, respetar consentimiento/retención, auditado.

### Fase B — Faltantes de experiencia

**B1. Portal del candidato (seguimiento de estado)** — Grupo C #12 del roadmap.
**B2. Scorecard de entrevista por competencias** — extiende `interviews`.

### Fase C — Mejoras detectadas en el análisis

Lo que surja de §3 y no esté previsto: automatizaciones por fase, informes extra,
campos de vacante, etc. Se prioriza con el mismo criterio (barato + alto retorno).

> **No perseguir a Pandapé feature por feature.** Adoptamos lo que aporta a RRHH;
> descartamos lo caro de bajo retorno (p. ej. +100 pruebas psicométricas, multiempresa
> SaaS) salvo que cambie el objetivo del producto.

---

## 5. Próximos pasos

1. Conseguir el **acceso a la cuenta** Pandapé (bloquea el análisis).
2. Sesión de análisis siguiendo §3; producir los 4 entregables de §3.3.
3. Convertir brechas en tareas (§4) y meterlas al roadmap.
4. Ejecutar **Fase A** (evaluación colaborativa + CRM de talentos) por ser lo de
   mayor retorno y ya "a medias".
