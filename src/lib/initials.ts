// Iniciais para o avatar. Trabalha por GRAFEMA (um emoji é um caractere só, nunca cortado ao meio) e ignora emojis,
// símbolos e pontuação: "Karla De la Cruz 🧝" -> "K", "~ Juan" -> "J", "🧝🏽" -> "?".

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Caracteres visíveis do texto, sem partir pares substitutos, sequências de emoji nem acentos combinados. */
export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
}

// Construídas por texto: o tsconfig usa um alvo ES antigo (a flag /u literal não compila), mas o navegador e o Node entendem.
const PICTO = new RegExp('\\p{Extended_Pictographic}|\\u20E3|\\p{Regional_Indicator}', 'u')
const ALNUM = new RegExp('[\\p{L}\\p{N}]', 'u')

/** Primeira letra ou dígito da palavra (pula pontuação/emoji do começo), ou ''. */
function firstLetter(word: string): string {
  return graphemes(word).find((g) => ALNUM.test(g) && !PICTO.test(g)) ?? ''
}

/**
 * Siglas do nome: 1ª letra da 1ª palavra + 1ª letra da 2ª ('second') ou da última ('last').
 * Palavras sem letra/dígito (emoji, "~", "-") não contam. Sem nada aproveitável: `fallback` ("?").
 */
export function initialsOf(name: string, second: 'second' | 'last' = 'second', fallback = '?'): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map(firstLetter)
    .filter(Boolean)
  if (letters.length === 0) return fallback
  const other = letters.length > 1 ? (second === 'last' ? letters[letters.length - 1] : letters[1]) : ''
  return letters[0] + other
}
