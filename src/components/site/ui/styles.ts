// Classes compartilhadas da página inicial. Botão primário em #27873f (4,6:1 com texto branco, AA) e hover um passo abaixo.
export const wrap = 'mx-auto w-full max-w-[1240px] px-5 min-[768px]:px-8'

export const btn =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium leading-none transition-[background-color,border-color,box-shadow,transform] duration-200 motion-reduce:transition-none'

export const btnPrimary = `${btn} bg-light-accent-400 px-5 py-3.5 text-[15px] text-white shadow-[0_1px_0_rgba(255,255,255,.25)_inset,0_8px_20px_-8px_rgba(39,135,63,.7)] hover:bg-light-accent-300 active:translate-y-px`
export const btnSecondary = `${btn} border border-[rgba(29,33,23,.12)] bg-white px-5 py-3.5 text-[15px] text-light-text hover:border-[rgba(29,33,23,.28)]`
export const btnSmall = `${btn} bg-light-accent-400 px-3.5 py-2.5 text-[13.5px] text-white hover:bg-light-accent-300`
export const btnPro = `${btn} bg-dark-accent-500 px-5 py-3.5 text-[15px] text-[#06200f] hover:bg-dark-accent-400`
export const btnOnDark = `${btn} bg-white px-5 py-3.5 text-[15px] text-[#0b120d] hover:bg-light-accent-900`

export const eyebrow = 'text-[12px] font-medium uppercase leading-none tracking-[.14em]'
export const h2 = 'text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] min-[768px]:text-[48px] min-[1200px]:text-[56px]'
export const h3 = 'text-balance text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] min-[768px]:text-[36px]'
export const lead = 'text-[16.5px] leading-[1.6] text-light-neutral-400 [text-wrap:pretty] min-[768px]:text-[18px]'

/** Sombra das janelas do produto (mesma família do shadow-lg do app, mais profunda para o palco). */
export const windowShadow =
  'shadow-[0_0_0_1px_rgba(29,33,23,.07),0_2px_4px_rgba(29,33,23,.04),0_24px_60px_-18px_rgba(29,33,23,.28)]'
