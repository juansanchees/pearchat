// Eventos de janela para as telas avisarem o menu lateral que os dados mudaram.
export const AGENDA_CHANGED = 'pearchat:agenda-changed'
export const CONTACTS_CHANGED = 'pearchat:contacts-changed'

function emit(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(name))
}

export const emitAgendaChanged = () => emit(AGENDA_CHANGED)
export const emitContactsChanged = () => emit(CONTACTS_CHANGED)
