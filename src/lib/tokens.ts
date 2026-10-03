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
    accent: scale(['#1f2512', '#2c3617', '#41511e', '#6a8226', '#a8c23a', '#bcd35a', '#cfe07e', '#e0eba6', '#eff5d0']),
  },
  light: {
    bg: '#f6f7ef',
    surface: '#ffffff',
    text: '#1d2117',
    divider: '#e3e7d6',
    neutral: scale(['#eff1e6', '#e2e6d5', '#c9cfb8', '#a3aa92', '#727a63', '#565c4a', '#3e4335', '#2c3025', '#1d2117']),
    accent: scale(['#f3f7e2', '#e6efc3', '#d1e092', '#b3ca52', '#a8c23a', '#86a028', '#667c1f', '#4f6118', '#3a4711']),
  },
  google: '#6bb39a',
  manual: '#d9a35b',
  amber: { bg: '#fbf5e8', border: '#ecd9b3', text: '#6b5427' },
} as const
