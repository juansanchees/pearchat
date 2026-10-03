import Image from 'next/image'

// Logo oficial do PearChat. Usa os SVGs de /public/brand via <img> (sem ids de degradê duplicados na página).
// Os SVGs horizontais têm 24 unidades de respiro em volta (589,26 x 201), então a altura do arquivo
// é ~30% maior que a altura visível da marca.
const H_RATIO = 589.26 / 201
const S_RATIO = 168 / 266

type LogoProps =
  | { variant?: 'horizontal'; theme?: 'light' | 'dark'; height?: number; className?: string; priority?: boolean }
  | { variant: 'symbol'; size?: number; className?: string; priority?: boolean }

export function Logo(props: LogoProps) {
  if (props.variant === 'symbol') {
    const h = props.size ?? 28
    return (
      <Image
        src="/brand/pearchat-symbol.svg"
        alt="PearChat"
        width={Math.round(h * S_RATIO)}
        height={h}
        unoptimized
        priority={props.priority}
        className={props.className}
        style={{ width: 'auto', height: h }}
      />
    )
  }
  const h = props.height ?? 36
  const dark = props.theme === 'dark'
  return (
    <Image
      src={dark ? '/brand/pearchat-horizontal-dark.svg' : '/brand/pearchat-horizontal.svg'}
      alt="PearChat"
      width={Math.round(h * H_RATIO)}
      height={h}
      unoptimized
      priority={props.priority}
      className={props.className}
      style={{ width: 'auto', height: h }}
    />
  )
}
