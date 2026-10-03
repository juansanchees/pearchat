// Tokens de design do PearChat (fonte única; usados pelo tailwind.config.ts).
// Os mesmos valores são expostos como CSS variables em src/app/globals.css.
const steps = [900, 800, 700, 600, 500, 400, 300, 200, 100] as const

const scale = (values: readonly string[]) =>
  Object.fromEntries(steps.map((s, i) => [s, values[i]])) as Record<(typeof steps)[number], string>

export const tokens = {
  dark: {
    bg: '#14170f',
    surface: '#1d2117',
    text: '#eef0e8',
    divider: '#2e3426',
    neutral: scale(['#262b1f', '#333a2a', '#4a5240', '#69725d', '#8a927d', '#a9b09d', '#c6ccbb', '#dde1d4', '#eef0e8']),
    accent: scale(['#12251a', '#173322', '#1e4a2e', '#25703c', '#5ccb6e', '#7ad689', '#9be0a5', '#c0edc6', '#e2f7e4']),
  },
  light: {
    bg: '#f6f7ef',
    surface: '#ffffff',
    text: '#1d2117',
    divider: '#e3e7d6',
    neutral: scale(['#eff1e6', '#e2e6d5', '#c9cfb8', '#a3aa92', '#727a63', '#565c4a', '#3e4335', '#2c3025', '#1d2117']),
    accent: {
      ...scale(['#f0faea', '#dcf3d0', '#b9e3a6', '#7acc4a', '#2e9a48', '#27873f', '#1e6b3a', '#185530', '#123f24']),
      // Preenchidos (contador, etapa concluida, switch ligado): texto/icone branco.
      // Decisao do dono: fill = base 500 (#2e9a48); hover/ativo um passo mais escuro.
      fill: '#2e9a48',
      fillHover: '#27873f',
      fillActive: '#1e6b3a',
    },
  },
  google: '#6bb39a',
  manual: '#d9a35b',
  amber: { bg: '#fbf5e8', border: '#ecd9b3', text: '#6b5427' },
} as const
