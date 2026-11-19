/**
 * Formas de un verbo que RRHH escribió en primera persona del pretérito como
 * palabra clave («Capacité», «Dirigí un equipo», «Alcancé la meta»): el CV suele
 * contarlo en tercera persona, en imperfecto, con el infinitivo o con el gerundio
 * («Capacitó a 14 asesores», «dirigía», «capacitando»). Es la misma acción, como
 * el plural es la misma palabra. Módulo puro (reglas-v14, banco ciego del
 * 19/11/2026).
 *
 * Solo se reconoce el pretérito con tilde final («é» en -ar; «í» en -er/-ir) en
 * la primera palabra: sin tilde («Capacite») no se distingue de otras formas. No
 * se generan sustantivos («capacitación»): «recibí capacitación en Excel» no es
 * capacitar a otros. Las formas que no existen en español (irregulares) solo
 * sobran: no coinciden con nada.
 */

const MIN_LENGTH = 5;
// -ar: pretérito, imperfecto (sing. y pl.), infinitivo, gerundio, 1.ª pl. y presente (3.ª sing. y pl.).
const AR_ENDINGS = ["ó", "aba", "aban", "ar", "ando", "amos", "a", "an"];
// -er/-ir: lo mismo, con las dos terminaciones de infinitivo porque desde «í» no se sabe cuál es.
const ER_IR_ENDINGS = ["ió", "ía", "ían", "er", "ir", "iendo", "imos", "e", "en"];

export function verbFormsOf(term: string): string[] {
  const match = /^(\p{L}+)([\s\S]*)$/u.exec(term.trim());
  if (!match) return [];
  const word = match[1]!.toLowerCase();
  const rest = match[2]!;
  if (word.length < MIN_LENGTH) return [];

  if (word.endsWith("é")) {
    let stem = word.slice(0, -1);
    // Cambios de grafía del pretérito: practiqué → practicar, llegué → llegar, alcancé → alcanzar.
    if (stem.endsWith("qu")) stem = `${stem.slice(0, -2)}c`;
    else if (stem.endsWith("gu")) stem = `${stem.slice(0, -2)}g`;
    else if (stem.endsWith("c")) stem = `${stem.slice(0, -1)}z`;
    return AR_ENDINGS.map((ending) => `${stem}${ending}${rest}`);
  }
  if (word.endsWith("í")) {
    const stem = word.slice(0, -1);
    // Raíz en vocal (distribuí, incluí, construí): distribuyó, distribuyendo.
    const vowel = /[aeou]$/.test(stem);
    return ER_IR_ENDINGS.map((ending) => {
      if (vowel && ending === "ió") return `${stem}yó${rest}`;
      if (vowel && ending === "iendo") return `${stem}yendo${rest}`;
      return `${stem}${ending}${rest}`;
    });
  }
  return [];
}
