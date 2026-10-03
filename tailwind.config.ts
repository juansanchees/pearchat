import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import { tokens } from './src/lib/tokens'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Tokens PearChat: dark (menu lateral) e light (área principal)
        dark: tokens.dark,
        light: tokens.light,
        google: tokens.google,
        manual: tokens.manual,
        amber: tokens.amber,
        // shadcn/ui (mapeado para o tema claro via CSS variables)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: 'hsl(var(--destructive))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        pill: '999px',
      },
      boxShadow: {
        md: '0 4px 14px rgba(29,33,23,.08)',
        lg: '0 12px 36px rgba(29,33,23,.12)',
        drawer: '-24px 0 60px rgba(29,33,23,.16)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        zfIn: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        zfDrawer: { from: { transform: 'translateX(40px)' }, to: { transform: 'translateX(0)' } },
        zfToast: { from: { transform: 'translateY(14px)' }, to: { transform: 'translateY(0)' } },
        zfPulse: { '0%, 100%': { opacity: '.45' }, '50%': { opacity: '1' } },
        zfSpin: { to: { transform: 'rotate(360deg)' } },
        // Telas de acesso
        pcIn: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        pcFade: { from: { opacity: '0' }, to: { opacity: '1' } },
        pcSpin: { to: { transform: 'rotate(360deg)' } },
        pcToast: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        zfIn: 'zfIn .3s ease both',
        zfDrawer: 'zfDrawer .28s ease both',
        zfToast: 'zfToast .28s ease both',
        zfPulse: 'zfPulse 1.8s ease-in-out infinite',
        zfSpin: 'zfSpin .8s linear infinite',
        pcIn: 'pcIn .3s ease',
        pcInSlow: 'pcIn .5s ease',
        pcInPronto: 'pcIn .35s ease',
        pcFade: 'pcFade .25s ease',
        pcFadeFast: 'pcFade .2s ease',
        pcSpin: 'pcSpin .8s linear infinite',
        pcToast: 'pcToast .28s ease',
      },
    },
  },
  plugins: [animate],
}
export default config
