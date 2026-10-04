// Pera de vidro da marca: objeto de design (não mascote), desenhado em SVG puro a partir da silhueta do símbolo
// (pera-balão com folha e os três pontos de conversa). Vidro verde translúcido com brilho especular, borda clara,
// núcleo mais espesso e uma cáustica de luz na sombra. A ponta do balão é arredondada e a folha sai de um talo curto.
// `id` precisa ser único na página (os degradês do SVG usam ids globais).

const BODY =
  'M41 213 C43 199 38 182 38 160 C38 124 66 114 70 92 C74.8 65.6 82 44 100 44 C118 44 125.2 65.6 130 92 C134 114 162 124 162 160 C162 194.2 134.2 222 100 222 C82 222 66 222.5 54 224.5 C45 226 39 222 41 213 Z'
const LEAF = 'M0 0 C2 -13 24 -21 46 -2 C24 15 3 12 0 0 Z'
const STEM = 'M100 46 C100.5 39 102 33 105 28'

export function PearGlass({
  id,
  className,
  tone = 'light',
  title,
}: {
  id: string
  className?: string
  /** Fundo onde a pera aparece: no escuro o vidro fica mais luminoso; no claro, mais saturado e com borda mais firme. */
  tone?: 'light' | 'dark'
  /** Sem título a pera é decorativa (aria-hidden). */
  title?: string
}) {
  const g = (n: string) => `${id}-${n}`
  const dark = tone === 'dark'
  return (
    <svg viewBox="22 -4 156 252" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <defs>
        <linearGradient id={g('body')} x1="0.15" y1="0.05" x2="0.85" y2="1">
          <stop offset="0" stopColor={dark ? '#d8ffc4' : '#a6e57c'} stopOpacity={dark ? 0.75 : 0.95} />
          <stop offset="0.45" stopColor={dark ? '#62cf74' : '#3fa955'} stopOpacity={dark ? 0.42 : 0.82} />
          <stop offset="1" stopColor={dark ? '#1b8a43' : '#11602f'} stopOpacity={dark ? 0.78 : 0.97} />
        </linearGradient>
        <radialGradient id={g('rim')} cx="0.46" cy="0.56" r="0.62">
          <stop offset="0.6" stopColor="#0d4a24" stopOpacity="0" />
          <stop offset="1" stopColor="#0b4020" stopOpacity={dark ? 0.6 : 0.6} />
        </radialGradient>
        <radialGradient id={g('core')} cx="0.62" cy="0.7" r="0.45">
          <stop offset="0" stopColor="#eaffdd" stopOpacity={dark ? 0.32 : 0.45} />
          <stop offset="1" stopColor="#eaffdd" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('edge')} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity={dark ? 0.25 : 0.4} />
          <stop offset="1" stopColor="#0b4a22" stopOpacity={dark ? 0.7 : 0.9} />
        </linearGradient>
        <linearGradient id={g('leaf')} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#c9f7a8" stopOpacity="0.95" />
          <stop offset="1" stopColor={dark ? '#2e9a48' : '#23823d'} stopOpacity="0.92" />
        </linearGradient>
        <filter id={g('soft')} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <filter id={g('shadow')} x="-40%" y="-200%" width="180%" height="500%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <clipPath id={g('clip')}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* Sombra e cáustica (luz verde concentrada atravessando o vidro) */}
      <ellipse cx="102" cy="236" rx="62" ry="7" fill={dark ? '#000' : '#14301d'} opacity={dark ? 0.55 : 0.3} filter={`url(#${g('shadow')})`} />
      <ellipse cx="114" cy="234" rx="30" ry="4" fill="#7acc4a" opacity={dark ? 0.55 : 0.6} filter={`url(#${g('soft')})`} />

      {/* Talo e folha */}
      <path d={STEM} fill="none" stroke={dark ? '#7fbf6a' : '#3d7a2c'} strokeWidth="4.5" strokeLinecap="round" />
      <path d={STEM} fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" transform="translate(-1 0)" />
      <g transform="translate(104 30) rotate(-34)">
        <path d={LEAF} fill={`url(#${g('leaf')})`} />
        <path d={LEAF} fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.2" />
        <path d="M5 -1.5 C15 -7 27 -8 38 -2.5" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.8" strokeLinecap="round" />
      </g>

      {/* Corpo */}
      <path d={BODY} fill={`url(#${g('body')})`} />
      <path d={BODY} fill={`url(#${g('rim')})`} />
      <path d={BODY} fill={`url(#${g('core')})`} />

      {/* Refração: uma silhueta interna deslocada sugere a espessura do vidro */}
      <g clipPath={`url(#${g('clip')})`}>
        <path d={BODY} transform="translate(108 150) scale(0.86) translate(-100 -140)" fill="none" stroke="#f2ffe9" strokeOpacity={dark ? 0.22 : 0.35} strokeWidth="2" />
        <path d="M150 120 C170 150 168 196 128 214" fill="none" stroke="#0a3d1d" strokeOpacity="0.3" strokeWidth="14" filter={`url(#${g('soft')})`} />
      </g>

      {/* Borda iluminada */}
      <path d={BODY} fill="none" stroke={`url(#${g('edge')})`} strokeWidth={dark ? 2.2 : 2.6} strokeLinejoin="round" />

      {/* Brilho especular */}
      <path d="M52 168 C50 140 64 126 74 108 C80 96 82 76 94 60" fill="none" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="6" strokeLinecap="round" filter={`url(#${g('soft')})`} />
      <path d="M53 190 C52 186 52 182 52.5 178" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3.5" strokeLinecap="round" />
      <ellipse cx="88" cy="72" rx="3.2" ry="7" transform="rotate(28 88 72)" fill="#ffffff" opacity="0.9" />

      {/* Luz de borda do lado direito (reflexo do ambiente) */}
      <path d="M150 128 C160 140 163 152 162 166" fill="none" stroke="#ffffff" strokeOpacity={dark ? 0.55 : 0.65} strokeWidth="2.5" strokeLinecap="round" filter={`url(#${g('soft')})`} />

      {/* Pontos da conversa, foscos e gravados no vidro (sem brilho, para não virar rosto) */}
      {[78, 100, 122].map((cx) => (
        <circle key={cx} cx={cx} cy="168" r="5.5" fill="#ffffff" opacity={dark ? 0.32 : 0.55} />
      ))}
    </svg>
  )
}
