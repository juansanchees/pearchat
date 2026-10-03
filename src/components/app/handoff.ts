import type { HandoffRequestedPayload } from '@/server/realtime/events'

export type { HandoffRequestedPayload }

/** Evento de janela repassado às telas (a de Conversas atualiza a pílula de modo). */
export const HANDOFF_WINDOW_EVENT = 'pearchat:handoff'
