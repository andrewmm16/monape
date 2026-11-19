# Banco ciego del motor

30 CV **ficticios** (3 por cada una de 10 vacantes: fuerte, medio y débil) que el motor no había visto. Los escribió el 19/11/2026 un agente que no conocía el motor, imitando los CV reales que llegan a una empresa:

- 10 a dos columnas (tipo Canva), 6 exportaciones de LinkedIn y 4 como los genera Computrabajo o Bumeran;
- Word clásico, tablas, Europass y un CV funcional;
- 2 en inglés y 1 mixto;
- fechas escritas de muchas formas, faltas de ortografía, frases negativas honestas y 3 que copian el aviso.

Todos los datos son inventados: correos `@example.com`, teléfonos `999 000 xxx` y enlaces `perfil-ficticio-NN`.

| Carpeta o archivo | Qué es |
|---|---|
| `fuente/` | El CV en HTML, tal como se escribió. |
| `pdf/` | El mismo CV en PDF (Chromium, A4). Es lo que lee el motor, con el mismo lector de la app. |
| `vacantes.json` | Descripción, funciones y requisitos de cada vacante (de la base local del 19/11/2026). |
| `vara.json` | La respuesta correcta por requisito. La puso Opus a ciegas sobre el texto de `fuente/`, sin ver al motor ni a la IA. Las casillas que marcó como dudosas quedan fuera de las métricas. 5 casillas se ajustaron a los criterios de Omar (campo `ajusteOmar`; el veredicto original de Opus queda en `opus`). |

## Cómo se usa

```bash
npm run medir:motor:ciego                  # resumen; falla si el motor empeora
npm run medir:motor:ciego -- --detalle     # cada desacuerdo con la vara
npm run medir:motor:ciego -- --generar-pdf # rehace pdf/ desde fuente/
```

Mide solo el motor: sin IA, sin base de datos y sin reglas aprendidas. La línea base está en `scripts/medir-motor/ciego.ts` (`BASE`). Si un cambio la mejora, se baja en el mismo commit. La revisión automática de GitHub lo corre en cada push.

**Ojo:** el motor se afinó con estos CV (reglas-v14), así que ya es un examen conocido. Sirve para frenar regresiones, no para saber cuánto acierta con CV reales.
