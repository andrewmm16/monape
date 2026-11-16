# Roadmap de paridad con Pandapé

**Fecha:** 2026-11-12 · **Rama:** `fase-2`

Mapa de lo que falta implementar para que la plataforma quede a la par de Pandapé
(para **uso interno de RRHH**, no como SaaS comercial).

> **Decisiones de Omar (2026-11-12):**
> - El **deploy a la nube se ejecuta al final** (Grupo D). No frena nada: todo lo
>   demás se desarrolla y prueba en **local (Docker)**. En **prioridad** sigue siendo
>   P0; solo se pospone su ejecución.
> - La **IA de evaluación NO es prioridad ni paridad**: el motor de reglas de afinidad
>   ya cumple el rol del "IA-Match" de Pandapé (y mejor, por explicable). La IA se usará
>   como **segunda opinión** para descartar **falsos negativos** del motor literal
>   (evidencia semántica que el motor no conecta). Pasa al Grupo C.

> **Principio:** no perseguir a Pandapé feature por feature. Terminar lo barato que
> ya está casi hecho y apoyarse en el **robot** para la mitad "externa" (portales,
> WhatsApp).

## Leyenda

- **Estado:** ⬜ Pendiente · 🟡 En curso · ✅ Hecho · ⏸️ En pausa
- **Robot:** ✅ lo cubre el robot · 🟡 parcial (robot + app) · ❌ no es del robot
- **Esfuerzo:** Muy bajo · Bajo · Medio · Alto · Muy alto

## Orden de avance (ejecución)

### Grupo A — Ahora, en local (barato, ataca lo de Pandapé)
1. **Killer questions** (screening eliminatorio que *marca*, no descarta)
2. Correo transaccional (Resend)
3. IA de redacción de ofertas
4. Reporting/KPIs + exportación CSV + embudo

### Grupo B — Robot y canales externos (corre desde local/tu máquina)
5. Piloto del robot contra 1 portal real (publicar/retirar)
6. Traer postulantes desde ese portal real
7. WhatsApp con candidatos integrado al ATS
8. Invitaciones y recordatorios de entrevista
9. Ampliar multiposting a más portales

### Grupo C — Mejoras de evaluación y pool
10. **IA de evaluación como segunda opinión** (cazar falsos negativos del motor)
11. Base de talento reutilizable + búsqueda avanzada
12. Portal del candidato (seguimiento de su estado)

### Grupo D — Puesta en producción (al final, por decisión; prioridad real P0)
13. Deploy a la nube (Supabase cloud + Vercel) + MFA admins + pruebas contra nube

### Grupo E — Opcional / caro (decidir según objetivo)
14. Entrevista por IA tipo "Aina"
15. Módulo de pruebas/evaluaciones propio
16. Multiempresa (SaaS)

## Tabla de mapeo

| # | Tarea | Grupo | Prioridad | Esfuerzo | Robot | Depende de | Estado |
|---|---|---|---|---|---|---|---|
| 1 | **Killer questions** en el formulario público (preguntas eliminatorias que *marcan* al candidato, sin descartarlo) | A | P1 | Bajo-Medio | ❌ | — | ✅ |
| 2 | **Correo transaccional (Resend)**: plantillas + envío (acuses, invitaciones, avisos de estado) | A | P0 | Bajo | ❌ | — | 🟡 |
| 3 | **IA de redacción de ofertas** (genera la descripción desde los requisitos; **necesita `AI_API_KEY`**) | A | P1 | Bajo | ❌ | — | ⬜ |
| 4 | **Reporting/KPIs + export CSV + embudo** (conversión por etapa, fuentes, indicadores) | A | P2 | Medio | ❌ | — | 🟡 |
| 5 | **Piloto robot contra 1 portal real** (login, publicar, retirar, pasar anti-bot) | B | P2 | Alto | ✅ | — | ⬜ |
| 6 | **Traer postulantes desde portal real** (mapear formato real; respaldo por feed/correo ya hechos) | B | P2 | Medio | ✅ | 5 | ⬜ |
| 7 | **WhatsApp con candidatos** integrado al ATS (avisos, respuestas, recordatorios; Baileys ya corre) | B | P2 | Medio | ✅ | — | ⬜ |
| 8 | **Invitaciones y recordatorios de entrevista** (correo + WhatsApp, confirmación) | B | P2 | Bajo-Medio | 🟡 | 2 | 🟡 |
| 9 | **Ampliar multiposting a más portales** (según resultado del piloto; mixto robot + feed/correo) | B | P2/P3 | Alto | ✅ | 5 | ⬜ |
| 10 | **IA de evaluación como segunda opinión** (correr cuando el motor marca "sin evidencia"; verifica citas; **necesita `AI_API_KEY`**) | C | P3 | Bajo | ❌ | — | ⬜ |
| 11 | **Base de talento reutilizable + búsqueda avanzada** (reusar candidatos del histórico en nuevas vacantes) | C | P3 | Medio | ❌ | — | 🟡 |
| 12 | **Portal del candidato** (vista donde consulta en qué etapa va) | C | P3 | Medio | ❌ | — | ⬜ |
| 13 | **Deploy a la nube** (Supabase cloud + Vercel, RLS/Storage contra nube, MFA admins) | D | P0* | Medio | ❌ | — | ⬜ |
| 14 | **Entrevista por IA tipo "Aina"** (canal WhatsApp vía robot + transcripción + estructurar evidencias) | E | P3 | Alto | 🟡 | 7 | ⬜ |
| 15 | **Módulo de pruebas/evaluaciones propio** (mínimo: killer questions + 1-2 tests; NO los +100 de Genoma) | E | P3 | Alto | ❌ | — | ⬜ |
| 16 | **Multiempresa (SaaS)** (tenancy, aislamiento por empresa, planes) — solo si se vuelve producto comercial | E | Opcional | Muy alto | ❌ | — | ⬜ |

> *El deploy (#13) sigue siendo **P0 de prioridad real**; solo se **ejecuta al final**
> por decisión de orden. Conviene hacerlo antes de que RRHH use la herramienta en serio.

## Qué carga el robot vs qué es trabajo de app

- **Lo absorbe el robot** (selectores tolerantes + health-check + reparación IA + Baileys ya construidos): #5, #6, #7, #9, y el canal de #14.
- **Trabajo de app** (lo más barato y de mayor retorno): #1, #2, #3, #4.
- **Caro / opcional**: #14, #15, #16.

## Fuera de alcance por ahora (y por qué)

- **Módulo tipo Genoma (+100 pruebas gamificadas/psicométricas):** meses para algo mediocre.
- **Multiempresa / SaaS:** solo si el objetivo cambia a producto comercial.
- **Comprometerse a "18 portales":** Pandapé los cubre con acuerdos comerciales, no con
  código. Mejor pocos portales reales bien sostenidos + feed/correo.

## Riesgos abiertos a vigilar

- **Validación que SOLO se confirma en producción (al hacer #13):** RLS contra Supabase
  real, extracción/OCR en Vercel, correo saliente real, y el robot contra el anti-bot real.
- **Desfase docs↔código:** la pantalla de auditoría ya existe en código aunque figura como
  pendiente en `pendientes.md` / `roles-y-permisos.txt`.
