'use client'

import { createContext, useContext } from 'react'

// Estado da gaveta do menu lateral (abaixo de 900 px o menu vira gaveta).
export type ShellState = { menuOpen: boolean; setMenuOpen: (open: boolean) => void }

export const ShellCtx = createContext<ShellState>({ menuOpen: false, setMenuOpen: () => {} })

export const useShell = () => useContext(ShellCtx)
