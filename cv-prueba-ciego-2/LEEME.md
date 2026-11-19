# Banco ciego 2: puestos operativos

30 CV **ficticios** para 10 vacantes operativas (3 por vacante: fuerte, medio y débil). Se armaron el 19/11/2026 para comprobar si el 97 % del primer banco ciego se mantenía con otro tipo de puesto. No se mantenía: el motor bajó al 72 %, y de ahí salieron reglas-v15 y reglas-v16.

Es más exigente que el primero en dos cosas:

- **Las vacantes las redactó un agente que hacía de analista de RRHH** y no conocía el motor: almacén con montacargas, reparto, tienda, caja, electricista, SST, mesa de ayuda, recepción bilingüe, compras y vigilancia SUCAMEC. Sus términos de búsqueda son imperfectos, como en la vida real.
- **Los CV los escribió otro agente viendo solo el aviso público**, sin los términos de búsqueda. Son cortos, como los de estos puestos:
  - 12 Word a una columna, 6 de Computrabajo, 6 de Canva a dos columnas, 2 de LinkedIn, 2 en tablas, 1 Europass y 1 funcional;
  - 1 en inglés y 1 mixto;
  - faltas de ortografía, frases negativas («aún no cuento con…», «en trámite») y 3 que copian el aviso.

Todos los datos son inventados: correos `@example.com`, teléfonos `999 000 xxx` y empresas genéricas.

| Carpeta o archivo | Qué es |
|---|---|
| `fuente/` | El CV en HTML, tal como se escribió. |
| `pdf/` | El mismo CV en PDF (Chromium, A4). Es lo que lee el motor, con el mismo lector de la app. En 12 de ellos la fecha flota a la derecha del cargo y el PDF la guarda fuera de orden: es el caso que resolvió `pdf-reading-order.ts`. |
| `vacantes.json` | Descripción, funciones y requisitos de cada vacante, tal como los redactó el agente de RRHH. |
| `vara.json` | La respuesta correcta por requisito. La puso Opus a ciegas sobre el texto de `fuente/`, sin ver al motor ni a la IA. Las casillas que marcó como dudosas quedan fuera de las métricas. 7 casillas de requisitos legales (licencia, carné SUCAMEC, récord, antecedentes, certificados) se ajustaron al criterio de Omar: se verifican con documentos aunque el CV diga que los tiene (campo `ajusteOmar`; el veredicto original de Opus queda en `opus`). |

## Cómo se usa

```bash
npm run medir:motor:ciego2                  # resumen; falla si el motor empeora
npm run medir:motor:ciego2 -- --detalle     # cada desacuerdo con la vara
npm run medir:motor:ciego2 -- --generar-pdf # rehace pdf/ desde fuente/
```

Mide solo el motor: sin IA, sin base de datos y sin reglas aprendidas. La línea base está en `scripts/medir-motor/ciego.ts` (`BANCOS["2"]`). Si un cambio la mejora, se baja en el mismo commit. La revisión automática de GitHub lo corre en cada push.

**Ojo:** el motor se afinó con estos CV (reglas-v15 y reglas-v16), así que ya es un examen conocido. Sirve para frenar regresiones, no para saber cuánto acierta con CV reales.
