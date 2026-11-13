# Diseño: rescate de falsos negativos por sinónimos en el motor de reglas (reglas-v5)

- **Fecha:** 2026-11-13
- **Estado:** propuesta, pendiente de aprobación de Omar
- **Ámbito:** `src/modules/evaluation/` (motor determinista). No toca IA externa ni scoring.

## 1. Intención y por qué

El motor de reglas solo encuentra los términos que RRHH configuró en la vacante y sus
variantes morfológicas (`termVariants`: singular/plural, género). Cuando el CV expresa el
mismo concepto con otra palabra —"llevé los libros contables" frente a un requisito de
"contabilidad", "atención al público" frente a "atención al cliente"— el motor no lo ve y el
requisito queda en *sin evidencia*. Son **falsos negativos**: el candidato sí lo cumple, pero
la evaluación no lo refleja y puede quedar enterrado.

La metodología declara hoy, a propósito, que el motor "no interpreta sinónimos no
configurados". Este cambio levanta esa limitación de forma **acotada, curada y verificable**:
introduce un diccionario de equivalencias semánticas que el motor aplica al evaluar, sin
depender de que RRHH haya anticipado cada sinónimo.

## 2. Objetivos, no-objetivos, anti-objetivos

**Objetivos**
- Rescatar falsos negativos del motor por sinónimos/paráfrasis frecuentes en CVs peruanos, en español.
- Mantener la **explicabilidad**: toda acreditación sigue mostrando una **cita literal** del CV, y se indica cuándo fue por equivalencia y a qué término del requisito equivale.
- Mantener el carácter **determinista, local y sin red** del motor.
- Que el cambio sea **auditable con los bancos existentes** (`medir:motor`, `adversario`, `legitimo`) y no los rompa.

**No-objetivos**
- No reemplaza la fase 2 (modelo local para paráfrasis que un diccionario no cubre).
- No es un diccionario editable por RRHH en esta versión (se cura en código).
- No cambia la metodología de puntuación ni `SCORING_VERSION`.

**Anti-objetivos (fracaso aunque "funcione")**
- Que una equivalencia haga **acreditar de más** a un candidato que no cumple (inflar el banco adversario). El error caro del proyecto es inflar; una sola equivalencia laxa que acredite a quien no debe es peor que diez falsos negativos no rescatados.
- Que la acreditación por equivalencia sea indistinguible de una coincidencia directa (perder trazabilidad).

## 3. Restricciones

- El diccionario debe curarse a mano y ser conservador: solo equivalencias que signifiquen lo mismo **para efectos de evidencia**, no relaciones de "misma área" (p. ej. "Excel" y "VBA" NO son equivalentes; sí lo son "contabilidad" y "contable").
- Respetar los filtros existentes que ya se aplican sobre cada coincidencia: negación (`isNegatedMention`), terceros (`isThirdPartyMention`), enlaces/correos (`isLinkMention`), aspiracional (`isAspirationalMention`). Un match por sinónimo pasa por los mismos filtros.
- Respetar el límite de palabra y la normalización actuales (`findTermOccurrences`, `normalizeForSearch`). Los términos cortos (≤ `SHORT_TERM_MAX`) mantienen su tratamiento estricto.
- `verificar:motor` debe pasar antes de dar el cambio por bueno.

## 4. Enfoques considerados

- **A — Preventivo (ampliar `term-suggestions.ts`).** Enriquecer los grupos de sugerencias para que RRHH acepte más sinónimos al crear la vacante. Cero riesgo, no toca el motor. **Descartado como principal:** solo rescata si RRHH anticipó y aceptó la sugerencia; no cubre lo que nadie configuró, que es justo el hueco. Se conserva como mejora complementaria gratuita.
- **B — Reactivo (elegido).** El motor expande cada término configurado a sus equivalencias curadas **al evaluar**, aunque RRHH no las haya escrito. Rescata falsos negativos reales. Contrapartida: toca el motor (nueva versión `reglas-v5`) y exige curar el diccionario y revalidar los bancos. **Omar eligió B** (2026-11-13) por ser el que ataca el problema real.
- **C — Embeddings/semántica vectorial.** Similitud difusa. Descartado para esta fase: no da cita literal verificable (rompe el principio del motor) y puede inflar; además pesa. Reservado, si acaso, para la fase 2 como señal de "revisar", nunca para acreditar.

## 5. Diseño (el cómo)

### 5.1 Diccionario de equivalencias

Nuevo módulo `src/modules/evaluation/synonyms.ts` (o `equivalences.ts`), **separado** de
`term-suggestions.ts` porque la semántica es distinta: aquí son equivalencias de evidencia,
no sugerencias de área.

Estructura propuesta: grupos de equivalencia, cada uno un conjunto de expresiones que cuentan
como evidencia mutua de un mismo concepto. Ejemplo ilustrativo (a curar):

```
{ concepto: "contabilidad", equivalentes: ["contabilidad", "contable", "temas contables", "libros contables", "registros contables"] }
{ concepto: "atención al cliente", equivalentes: ["atención al cliente", "atención al público", "servicio al cliente", "trato al cliente"] }
```

Reglas de curación:
- Solo sinónimos/paráfrasis que signifiquen lo mismo para evidencia. Nada de hiperónimos laxos ni nombres de herramientas (software con nombre propio —SAP, Concar— no entra salvo alias real).
- Cada grupo se valida contra el banco **adversario** (no debe acreditar a quien no cumple) y el **legítimo** (debe rescatar lo que se espera) antes de incorporarse.

### 5.2 Punto de integración

En `collectMatches` (`rule-engine.ts:106`): hoy, para cada término configurado, itera
`termVariants(term)` y busca. Se añade un paso que, para cada término configurado, obtiene sus
expresiones equivalentes del diccionario y las busca **también**, buscando a su vez las
variantes morfológicas de cada equivalente. El `TermMatch` conserva `term` = el término
**configurado** (para que el conteo por requisito no cambie), y se añade metadato del
**origen** del match: directo (término/variante) vs por equivalencia (con la expresión del CV
que coincidió). Ese metadato alimenta la explicación.

### 5.3 Explicabilidad

La evidencia (`Evidence`) y el motivo indican cuándo la acreditación provino de una
equivalencia y cuál: p. ej. *"acreditado por equivalencia: se encontró 'libros contables',
equivalente a 'contabilidad'"*. Se mantiene la cita literal de la oración del CV.

### 5.4 Valoración de un match SOLO por sinónimo — DECIDIDO: acredita por equivalencia

**Decisión de Omar (2026-11-13): Opción 1.** Cuando un requisito se cubre **únicamente** por
equivalencia (sin coincidencia directa), el motor lo marca como **acreditado por equivalencia**,
con la marca de origen y la cita literal. Sube el puntaje y el nivel como cualquier acreditación.

Salvaguarda: el banco **adversario** es la red de seguridad. Ninguna equivalencia entra al
diccionario sin pasar el adversario (no debe acreditar a quien no cumple); una equivalencia que
infle se detecta ahí y se corrige o se quita. Los requisitos **legales/esenciales** siguen sin
acreditarse automáticamente (quedan *pendiente de verificación*), igual que hoy.

Alternativa descartada: dejarlo en *pendiente de verificación* (no subía el puntaje; menor rescate).

### 5.5 Alcance por tipo de requisito (propuesta, confirmable)

Aplicar equivalencias a: habilidad técnica, competencia, experiencia y "otro". **No** a
formación (tiene su escalera de grados) ni, por defecto, a herramientas con nombre propio
(software). Decisión menor; se fija así salvo que Omar prefiera otro alcance.

### 5.5bis Experiencia con años mínimos y cálculo por fechas — CALL del builder (conservador)

`evaluateRequirement` acredita años por dos vías: (a) **mención explícita** de años cerca de
las coincidencias —que SÍ usa `matches`, luego SÍ se beneficia de los sinónimos—, y (b)
**fechas del CV** (`experience-dates.ts`), que hoy decide qué bloques de empleo suman años con
los **términos configurados crudos** (sin variantes ni equivalencias) y que **no** aplica los
filtros de negación/terceros/aspiracional.

**Decisión (mi call, revisable por Omar): en v1 NO se expande `experience-dates.ts` con
equivalencias.** Motivos: es el punto de mayor riesgo de inflar (sin los filtros de seguridad),
justo contra el anti-objetivo; y la degradación es conservadora —si el bloque se describe solo
con un sinónimo y no hay mención explícita de años, el requisito queda *pendiente* en lugar de
acreditarse de más—, coherente con "los errores conocidos van en el sentido conservador".
Consecuencia (límite conocido a documentar): un requisito de experiencia **con años mínimos**
cuyo único indicio es un sinónimo dentro del bloque de fechas se rescata por la vía (a) si hay
años explícitos, pero no por la vía (b). Ampliable en una fase posterior con su propio banco.

### 5.6 Versión y documentación

- Nueva versión de motor **`reglas-v5`**, guardada en cada evaluación (como `reglas-v4`).
- Actualizar `docs/metodologia-evaluacion.md`: nueva sección de equivalencias, el cambio de la
  frase "no interpreta sinónimos no configurados", y el origen de cada match en la evidencia.

### 5.7 Verificación

- Añadir casos al banco **legítimo** (paráfrasis que deben rescatarse) y al **adversario**
  (equivalencias cercanas que NO deben acreditar).
- `npm run verificar:motor` en verde como puerta.
- **Semántica del banco `medir:motor` ante un rescate legítimo — CALL del builder.** Los 5
  puestos originales fijan **puntaje exacto esperado** por candidato; con Opción 1, una
  equivalencia que rescate un **verdadero positivo** en esos 32 CV cambiará ese puntaje aunque
  el cambio sea correcto. El banco se trata como **referencia viva, no barrera inmutable**: ante
  cada cambio de puntaje esperado se decide caso por caso —
  - si el CV **sí cumple** el requisito (la equivalencia rescató un verdadero positivo), se
    **re-baselina** la expectativa (`esperado.score`/nivel/orden) con una **nota justificatoria**
    en el banco, igual que el proyecto ya registra decisiones con fecha;
  - si el CV **no cumple** (la equivalencia infló), la equivalencia se **corrige o se quita** del
    diccionario.
  - La distinción verdadero/falso positivo la dan los bancos **adversario** y **legítimo**, que
    siguen siendo puerta dura. No se mutila el diccionario solo para preservar un número.
- Reconfirmar que el **orden** de candidatos por puesto no empeora (ningún candidato que no
  cumple supera a uno que cumple).

## 6. Qué queda al builder

- Forma exacta del metadato de origen en `TermMatch`/`Evidence` y su redacción en motivos y borradores (`drafts.ts`), respetando las plantillas deterministas existentes.
- Contenido inicial del diccionario (curado e iterado contra los bancos).
- Si conviene exponer el origen "por equivalencia" en la UI de la evaluación o solo en el texto de la evidencia.
