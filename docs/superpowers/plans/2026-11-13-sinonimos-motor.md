# Rescate de falsos negativos por sinónimos (reglas-v5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el motor de reglas acredite requisitos cuando el CV usa un sinónimo/paráfrasis equivalente al término configurado, con cita literal y marca de equivalencia, sin inflar.

**Architecture:** Un diccionario curado de equivalencias (`synonyms.ts`, puro y local) que `collectMatches` consulta al evaluar: para cada término configurado busca también sus expresiones equivalentes, marcando el origen. La valoración, los filtros (negación/terceros/enlace/aspiracional) y el conteo por requisito no cambian; solo se amplían las coincidencias. Sube a `reglas-v5`.

**Tech Stack:** TypeScript estricto, Vitest. Motor determinista sin red ni BD. Bancos de medición en `scripts/medir-motor/` (tsx).

**Spec:** `docs/superpowers/specs/2026-11-13-sinonimos-motor-design.md`

## Global Constraints

- Determinista, local, sin red ni servicios externos (motor puro).
- Toda acreditación conserva **cita literal** del CV; una acreditación solo-por-equivalencia se marca como tal en el `rationale`.
- Los filtros existentes se aplican a los matches por equivalencia igual que a los directos: `isNegatedMention`, `isAspirationalMention`, `isThirdPartyMention`, `isLinkMention`.
- Tratamiento de términos cortos intacto: `SHORT_TERM_MAX = 2`, `findTermOccurrences` ya exige forma estricta para ≤2 caracteres.
- Requisitos **legales/esenciales** nunca se acreditan solos (siguen `pendiente_verificacion`), también cuando el único indicio es una equivalencia.
- Alcance de equivalencias: categorías `habilidad_tecnica`, `competencia`, `experiencia`, `otro`. **No** `formacion`, `herramienta`, `certificacion`, `idioma`.
- **No** se expande `experience-dates.ts` (cálculo de años por fechas) en esta versión (spec 5.5bis).
- `npm run verificar:motor` debe quedar en verde (puerta).
- Versión del motor: `RULE_ENGINE_VERSION = "reglas-v5"`.

## Review Focus

Entradas que el spec implica y que ningún flujo feliz ejercita; cada una tiene su test en la task dueña (Task 2, salvo nota):

- **Término corto (≤2) con equivalente largo** no debe acreditar de más por la equivalencia (p. ej. un requisito con término `"C"` cuyo grupo trajera una palabra larga). Test en Task 2.
- **Equivalencia dentro de una mención de tercero** ("mi equipo llevaba la contabilidad") debe quedar filtrada, no acreditada. Test en Task 2.
- **Doble conteo**: el mismo fragmento capturado por el término directo y por un equivalente no debe contarse dos veces. Test en Task 2.
- **Requisito legal/esencial cubierto solo por equivalencia** debe quedar `pendiente_verificacion`, no `acreditado`. Test en Task 2.
- **Requisito fuera de alcance** (formación/idioma) no debe aplicar equivalencias. Test en Task 2.

---

### Task 1: Diccionario de equivalencias

**Files:**
- Create: `src/modules/evaluation/synonyms.ts`
- Test: `tests/unit/synonyms.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` de `./text`.
- Produces:
  - `EQUIVALENCE_GROUPS: ReadonlyArray<{ concepto: string; equivalentes: readonly string[] }>`
  - `equivalentsFor(term: string): string[]` — expresiones equivalentes de `term` **sin incluirlo**, de-duplicadas por `normalizeTerm`; `[]` si no pertenece a ningún grupo. La pertenencia se decide por `normalizeTerm` (ignora mayúsculas/tildes).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/synonyms.test.ts
import { describe, it, expect } from "vitest";
import { equivalentsFor } from "@/modules/evaluation/synonyms";

describe("equivalentsFor", () => {
  it("devuelve equivalentes de un término del diccionario, sin incluirlo", () => {
    const eq = equivalentsFor("contabilidad").map((s) => s.toLowerCase());
    expect(eq).toContain("libros contables");
    expect(eq).not.toContain("contabilidad");
  });
  it("es simétrico dentro del grupo", () => {
    expect(equivalentsFor("contable").map((s) => s.toLowerCase())).toContain("contabilidad");
  });
  it("ignora mayúsculas y tildes al emparejar", () => {
    expect(equivalentsFor("CONTABILIDAD").length).toBeGreaterThan(0);
  });
  it("devuelve [] para un término fuera del diccionario", () => {
    expect(equivalentsFor("xyzzy")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- synonyms`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement `synonyms.ts`**

Define `EQUIVALENCE_GROUPS` con un conjunto **inicial pequeño y curado** (ampliable en Task 3 contra los bancos): al menos `contabilidad`/`contable`/`libros contables`/`registros contables`; `atención al cliente`/`atención al público`/`servicio al cliente`; `ventas`/`comercial`. Implementar `equivalentsFor`: normaliza el término, reúne los miembros de todo grupo que lo contenga (por `normalizeTerm`), excluye el propio término y de-duplica por `normalizeTerm` conservando la forma escrita del diccionario. Curación: solo equivalencias de evidencia (no hiperónimos de área, no software con nombre propio).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- synonyms`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/evaluation/synonyms.ts tests/unit/synonyms.test.ts
git commit -m "feat(motor): diccionario de equivalencias de evidencia (synonyms.ts)"
```

---

### Task 2: Integrar equivalencias en el motor (reglas-v5)

**Files:**
- Modify: `src/modules/evaluation/rule-engine.ts` (`TermMatch` ~90, `collectMatches` ~106, `evaluateRequirement` ~421, `RULE_ENGINE_VERSION` l.65)
- Test: `tests/unit/rule-engine.test.ts`

**Interfaces:**
- Consumes: `equivalentsFor` (Task 1).
- Produces (internos al módulo):
  - `type TermMatch = Match & { term: string; via?: string }` — `via` = expresión equivalente que coincidió; `undefined` si fue coincidencia directa.
  - `collectMatches(haystack: NormalizedText, terms: string[], expand?: (term: string) => string[]): TermMatch[]` — `expand` por defecto `() => []`. Para cada término: busca el término y sus `termVariants` (origen directo), y para cada `e` de `expand(term)` busca `e` y sus `termVariants` con `via = e`. Los directos se insertan antes que los equivalentes, de modo que un span ya capturado directo gana (la clave de de-dup sigue siendo `term|start|end`).
  - `isEquivalenceScope(requirement: RequirementInput): boolean` — `true` si `requirement.category` ∈ {`habilidad_tecnica`, `competencia`, `experiencia`, `otro`}.

- [ ] **Step 1: Write the failing tests**

```ts
// añadir a tests/unit/rule-engine.test.ts
it("acredita por equivalencia y lo marca en el rationale", () => {
  const r = evaluateRequirement(
    "Responsable de los libros contables de la empresa durante 2020-2023.",
    normalizeForSearch("Responsable de los libros contables de la empresa durante 2020-2023."),
    { id: "1", category: "habilidad_tecnica", priority: "obligatorio", description: "Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: false },
    new Date("2026-11-13"),
  );
  expect(r.assessment).toBe("acreditado");
  expect(r.rationale.toLowerCase()).toContain("equivalencia");
});

it("no aplica equivalencias a formación", () => {
  const texto = "Experiencia en libros contables.";
  const r = evaluateRequirement(texto, normalizeForSearch(texto),
    { id: "1", category: "formacion", priority: "obligatorio", description: "Título en Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: false },
    new Date("2026-11-13"));
  expect(r.assessment).not.toBe("acreditado");
});

it("la equivalencia dentro de una mención de tercero no acredita", () => {
  const texto = "Mi equipo llevaba la contabilidad; yo solo apoyaba.";
  const r = evaluateRequirement(texto, normalizeForSearch(texto),
    { id: "1", category: "habilidad_tecnica", priority: "obligatorio", description: "Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: false },
    new Date("2026-11-13"));
  expect(r.assessment).not.toBe("acreditado");
});

it("un esencial cubierto solo por equivalencia queda pendiente", () => {
  const texto = "Encargada de los libros contables.";
  const r = evaluateRequirement(texto, normalizeForSearch(texto),
    { id: "1", category: "habilidad_tecnica", priority: "obligatorio", description: "Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: true },
    new Date("2026-11-13"));
  expect(r.assessment).toBe("pendiente_verificacion");
});

it("RULE_ENGINE_VERSION es reglas-v5", () => {
  expect(RULE_ENGINE_VERSION).toBe("reglas-v5");
});
```

Nota para el implementador: añadir también un test de **término corto** (un grupo de equivalencia que incluya un término ≤2 y una palabra larga, verificando que el corto no acredita con una palabra que lo contenga) y uno de **doble conteo** (término directo y equivalente sobre el mismo fragmento ⇒ una sola evidencia), según Review Focus.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- rule-engine`
Expected: FAIL (equivalencias no integradas; versión aún `reglas-v4`).

- [ ] **Step 3: Implement**

1. `RULE_ENGINE_VERSION = "reglas-v5"`.
2. `TermMatch` gana `via?: string`; en `collectMatches` propaga `via` al construir cada match (directo ⇒ `via` ausente; equivalente ⇒ `via = e`). Firma con `expand` opcional como arriba.
3. En `evaluateRequirement`, tras `const terms = uniqueTerms(...)`, calcular `const expand = isEquivalenceScope(requirement) ? equivalentsFor : () => [];` y llamar `collectMatches(haystack, terms, expand)`. El resto del flujo (filtros, `pickEvidence`, ramas de valoración) no cambia.
4. Enriquecer `foundText`: para cada término de `foundTerms` cuyos matches en `matches` tengan **todos** `via` definido (es decir, se encontró solo por equivalencia), anotar `«<via>»`. Redacción: `El CV menciona: contabilidad (por equivalencia: «libros contables»).` Mantener el formato actual para los términos directos.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- rule-engine synonyms`
Expected: PASS. Luego `npm run typecheck` en verde.

- [ ] **Step 5: Commit**

```bash
git add src/modules/evaluation/rule-engine.ts tests/unit/rule-engine.test.ts
git commit -m "feat(motor): acreditar por equivalencia en collectMatches (reglas-v5)"
```

---

### Task 3: Bancos de medición y puerta

**Files:**
- Modify: `scripts/medir-motor/legitimo.ts` (casos que deben rescatarse)
- Modify: `scripts/medir-motor/adversario.ts` (equivalencias cercanas que NO deben acreditar)
- Modify (solo si un rescate legítimo lo justifica): `scripts/medir-motor/datos.ts` (re-baseline de `esperado` con nota)

**Interfaces:**
- Consumes: tipo `Caso` de `scripts/medir-motor/banco` — `{ grupo, nombre, texto, requisito: { category, description, keywords }, espera: Assessment[], porque }`.

- [ ] **Step 1: Añadir casos al banco legítimo**

Grupo nuevo "Equivalencias" en `legitimo.ts`: textos que demuestran el requisito por sinónimo y `espera: ["acreditado"]` (p. ej. "Responsable de los libros contables…" para `Contabilidad`; "Atención al público en ventanilla…" para `Atención al cliente`). `porque` explica la equivalencia.

- [ ] **Step 2: Añadir casos al banco adversario**

En `adversario.ts`, equivalencias que NO deben acreditar: menciones negadas/de tercero con el sinónimo, y equivalencias que serían demasiado laxas (que justifican dejar un grupo fuera del diccionario). `espera: ["pendiente_verificacion", "sin_evidencia"]`.

- [ ] **Step 3: Correr la puerta**

Run: `npm run verificar:motor`
Expected: PASS. Si falla:
- por **inflar** (adversario o un CV de `medir:motor` acredita a quien no cumple) ⇒ corregir o quitar la equivalencia en `synonyms.ts`.
- por **cambio de puntaje esperado de un verdadero positivo** en `medir:motor` ⇒ verificar que el CV realmente cumple y **re-baselinar** `esperado` en `datos.ts` con un comentario que cite la equivalencia y la fecha (2026-11-13). No mutilar el diccionario para preservar un número.

- [ ] **Step 4: Commit**

```bash
git add scripts/medir-motor/legitimo.ts scripts/medir-motor/adversario.ts scripts/medir-motor/datos.ts src/modules/evaluation/synonyms.ts
git commit -m "test(motor): bancos de equivalencias (legítimo/adversario) y re-baseline justificado"
```

---

### Task 4: Documentación de la metodología

**Files:**
- Modify: `docs/metodologia-evaluacion.md`

- [ ] **Step 1: Actualizar la metodología**

- Añadir subsección "Equivalencias de evidencia (reglas-v5)": qué hace, el alcance por categoría, que acredita con marca de equivalencia y cita, y que legales/esenciales siguen pendientes.
- Corregir la frase "No interpreta sinónimos no configurados" para reflejar las equivalencias curadas (lo demás sigue: nivel de dominio, contexto).
- Registrar `reglas-v5` junto a las versiones anteriores y el límite conocido de experiencia por fechas (spec 5.5bis).

- [ ] **Step 2: Commit**

```bash
git add docs/metodologia-evaluacion.md
git commit -m "docs(motor): metodología de equivalencias (reglas-v5)"
```

---

## Notas de verificación final

- `npm run verificar:motor` en verde (puerta dura: adversario y legítimo).
- `npm run typecheck` y `npm run test:unit` en verde.
- El orden de candidatos por puesto en `medir:motor` no empeora (ningún candidato que no cumple supera a uno que cumple).
