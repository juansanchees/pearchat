'use client'

import dynamic from 'next/dynamic'

// Ilhas abaixo da dobra em pedaços de JavaScript separados. O HTML continua vindo pronto do servidor (ssr padrão);
// só o código delas sai do pacote inicial da página, que fica com o herói. Precisa ser um módulo cliente para o
// next/dynamic dividir o código.
const live = () => import('./live/feature-live')

export const Impact = dynamic(() => import('./sections/impact').then((m) => m.Impact))
export const HowItWorks = dynamic(() => import('./sections/how-it-works').then((m) => m.HowItWorks))
export const Niches = dynamic(() => import('./sections/niches').then((m) => m.Niches))
export const SpacesSwitcher = dynamic(() => import('./mini/spaces').then((m) => m.SpacesSwitcher))
export const AiChatLive = dynamic(() => live().then((m) => m.AiChatLive))
export const AgendaLive = dynamic(() => live().then((m) => m.AgendaLive))
export const FollowupLive = dynamic(() => live().then((m) => m.FollowupLive))
export const InboxLive = dynamic(() => live().then((m) => m.InboxLive))
export const BroadcastLive = dynamic(() => live().then((m) => m.BroadcastLive))
export const ContactsLive = dynamic(() => live().then((m) => m.ContactsLive))
export const RevealObserver = dynamic(() => import('./anim/reveal').then((m) => m.RevealObserver), { ssr: false })
