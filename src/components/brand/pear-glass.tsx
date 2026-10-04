// Pera de vidro da marca: objeto de design (não mascote), desenhado em SVG puro a partir da silhueta do símbolo
// (pera-balão com folha e os três pontos de conversa). Vidro verde translúcido com brilho especular, borda clara,
// núcleo mais espesso e uma cáustica de luz na sombra. Sem dependências e sem animação: a etapa 2 pode girar/flutuar
// o elemento por CSS. `id` precisa ser único na página (os degradês do SVG usam ids globais).

const BODY =
  'M34 226 C40 210 38 186 38 160 C38 124 66 114 70 92 C74.8 65.6 82 42 100 42 C118 42 125.2 65.6 130 92 C134 114 162 124 162 160 C162 194.2 134.2 222 100 222 C76 222 52 220 34 226 Z'
const LEAF = 'M0 0 C1 -14 25 -22 49 0 C25 18 1 14 0 0 Z'

export function PearGlass({
  id,
  className,
  tone = 'light',
  title,
}: {
  id: string
  className?: string
  /** Fundo onde a pera aparece: no escuro o vidro fica mais luminoso; no claro, mais saturado. */
  tone?: 'light' | 'dark'
  /** Sem título a pera é decorativa (aria-hidden). */
  title?: string
}) {
  const g = (n: string) => `${id}-${n}`
  const dark = tone === 'dark'
  return (
    <svg
      viewBox="20 -22 160 270"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id={g('body')} x1="0.15" y1="0.05" x2="0.85" y2="1">
          <stop offset="0" stopColor={dark ? '#d8ffc4' : '#b2ea8c'} stopOpacity={dark ? 0.75 : 0.95} />
          <stop offset="0.42" stopColor={dark ? '#62cf74' : '#46b05a'} stopOpacity={dark ? 0.42 : 0.72} />
          <stop offset="1" stopColor={dark ? '#1b8a43' : '#156b35'} stopOpacity={dark ? 0.78 : 0.95} />
        </linearGradient>
        <radialGradient id={g('rim')} cx="0.46" cy="0.56" r="0.62">
          <stop offset="0.62" stopColor="#0d4a24" stopOpacity="0" />
          <stop offset="1" stopColor="#0b4020" stopOpacity={dark ? 0.6 : 0.5} />
        </radialGradient>
        <radialGradient id={g('core')} cx="0.62" cy="0.7" r="0.45">
          <stop offset="0" stopColor="#eaffdd" stopOpacity={dark ? 0.32 : 0.4} />
          <stop offset="1" stopColor="#eaffdd" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('edge')} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#0f5a2a" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={g('leaf')} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#c9f7a8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#2e9a48" stopOpacity="0.85" />
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
      <ellipse cx="100" cy="236" rx="64" ry="7" fill={dark ? '#000' : '#14301d'} opacity={dark ? 0.55 : 0.22} filter={`url(#${g('shadow')})`} />
      <ellipse cx="114" cy="234" rx="30" ry="4" fill="#7acc4a" opacity={dark ? 0.55 : 0.45} filter={`url(#${g('soft')})`} />

      {/* Corpo */}
      <path d={BODY} fill={`url(#${g('body')})`} />
      <path d={BODY} fill={`url(#${g('rim')})`} />
      <path d={BODY} fill={`url(#${g('core')})`} />

      {/* Refração: uma silhueta interna deslocada sugere a espessura do vidro */}
      <g clipPath={`url(#${g('clip')})`}>
        <path
          d={BODY}
          transform="translate(108 150) scale(0.86) translate(-100 -140)"
          fill="none"
          stroke="#f2ffe9"
          strokeOpacity={dark ? 0.22 : 0.35}
          strokeWidth="2"
        />
        <path d="M150 120 C170 150 168 196 128 214" fill="none" stroke="#0a3d1d" strokeOpacity="0.28" strokeWidth="14" filter={`url(#${g('soft')})`} />
      </g>

      {/* Borda iluminada */}
      <path d={BODY} fill="none" stroke={`url(#${g('edge')})`} strokeWidth="2.2" strokeLinejoin="round" />

      {/* Brilho especular */}
      <path
        d="M52 168 C50 140 64 126 74 108 C80 96 82 74 94 58"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.75"
        strokeWidth="6"
        strokeLinecap="round"
        filter={`url(#${g('soft')})`}
      />
      <path d="M52 186 C51 182 51 178 51.5 174" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3.5" strokeLinecap="round" />
      <ellipse cx="88" cy="70" rx="3.2" ry="7" transform="rotate(28 88 70)" fill="#ffffff" opacity="0.9" />

      {/* Luz de borda do lado direito (reflexo do ambiente) */}
      <path d="M150 128 C160 140 163 152 162 166" fill="none" stroke="#ffffff" strokeOpacity={dark ? 0.55 : 0.6} strokeWidth="2.5" strokeLinecap="round" filter={`url(#${g('soft')})`} />

      {/* Pontos da conversa, foscos e gravados no vidro (sem brilho, para não virar rosto) */}
      {[78, 100, 122].map((cx) => (
        <circle key={cx} cx={cx} cy="168" r="5.5" fill="#ffffff" opacity={dark ? 0.32 : 0.5} />
      ))}

      {/* Folha */}
      <g transform="translate(101 40) rotate(-48)">
        <path d={LEAF} fill={`url(#${g('leaf')})`} />
        <path d={LEAF} fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.2" />
        <path d="M6 -2 C16 -8 28 -8 40 -1" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  )
}
