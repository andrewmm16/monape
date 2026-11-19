# Guía de entrevista — diseño corto

- **Fecha:** 18/11/2026 · **Estado:** aprobado por Omar («si está bien lo que me dices», opción B) e implementado.

## Intención

Quitarle a RRHH el trabajo de leer cada CV para saber qué preguntar. Cada postulación trae su guion con **solo lo que falta confirmar**. Lo que RRHH confirma en la entrevista recalcula la puntuación y enseña al motor, sin tareas nuevas.

- **Objetivos:** pocas preguntas (2,8 por CV en el set de demo), concretas y ordenadas por importancia, en la ficha y en «Registrar resultado».
- **No objetivos:** preguntas de comportamiento generales, correo o PDF para jefes de área (más adelante), descartar candidatos.
- **Antiobjetivos:** preguntas sobre características protegidas, pedir datos personales, revelar la respuesta que cumple, preguntas que dependan de la IA para existir.

## Enfoques considerados

| | Enfoque | Costo | Elegido |
|---|---|---|---|
| A | Solo plantillas del motor por tipo de duda | Gratis, determinista; preguntas algo genéricas | Base y respaldo |
| **B** | **Plantillas + pregunta de Haiku en los CV que ya pasan por la IA** | Sin llamadas extra (mismo JSON, campo `interview_question`) | **Sí** |
| C | Haiku arma la guía completa a pedido | Una llamada por candidato; depende de la IA | No |

## Diseño

- `candidate_evaluation_items.signal` (la duda del motor, que antes solo vivía en memoria) e `interview_question` (pregunta de la IA). Migración `20261118200100`: `record_evaluation_core` las guarda (con otro formato se ignoran) y `anonymize_candidate` borra la pregunta.
- `ia-prompt-v5`: regla 10, una pregunta breve por requisito no acreditado.
- `interview-guide.ts` (puro): entra lo no acreditado y lo que el motor acreditó pero la IA dejó en duda; nunca lo verificado. Orden: obligatorio, parcial antes que «no aparece», peso. La pregunta es la de la IA o, si no hay, una plantilla según `signal` o la categoría. «Cumple si» siempre sale de la plantilla.
- `interview-guide-data.ts`: arma la guía con la evaluación vigente y la segunda opinión del mismo CV y criterios (cliente del usuario, con RLS).
- Interfaz: tarjeta «Guía de entrevista» en la postulación (permiso `applications:manage`) y preguntas en «Registrar resultado», con lo pendiente primero.
- `recordInterviewResult` llama a `learnFromVerifications`, igual que «Verificar».

## Ampliación del 19/11: «Preguntas para la entrevista»

Pedido de Omar: que quien usa la app vea qué preguntas se recomienda hacerle a cada persona.

- **Nombre y lugar:** la tarjeta se llama «Preguntas para la entrevista». Se muestra siempre a quien tiene `applications:manage`; sin evaluación, avisa que las preguntas sobre requisitos aparecen al evaluar el CV. La tarjeta de Entrevistas enlaza a ella («Ver las N preguntas recomendadas para esta persona»).
- **«Otros puntos para aclarar»** (`interview-topics.ts`, puro): además de los requisitos, entran las respuestas eliminatorias que no cumplen y las notas de fechas del CV (solapamientos, fechas imposibles y rotación). Las notas se reconocen por su inicio fijo, `DATE_NOTE_PREFIX` en `date-consistency.ts`. No cambian la puntuación ni descartan a nadie. La pregunta sobre la trayectoria advierte que no se pregunte por motivos personales ni de salud.
- Sigue fuera: preguntas generales por vacante, correo o PDF para los entrevistadores. Esperan la reunión de Omar con RRHH sobre quién entrevista.

## Decisiones tomadas por mí (corregibles)

- La guía va **dentro de la app**: Omar no dijo quién entrevista. El correo o PDF para jefes de área queda pendiente.
- Las preguntas de plantilla no repiten el nombre del requisito (va como título justo encima), para evitar frases como «¿experiencia en Experiencia en RRHH?».
- Las evaluaciones anteriores no tienen `signal`: su guía usa las plantillas por categoría hasta que se vuelvan a evaluar.
