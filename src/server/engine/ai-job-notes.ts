// Marca de um AiJob criado por PEDIDO ("Responder com a IA", lote de conversas paradas, "Devolver para a IA").
// O AiJob não tem coluna para isso (e esta entrega não cria migration): a marca vai no começo de `error`, que só serve
// de nota enquanto o job está pendente/executando. `finish` regrava a nota final, então um job concluído não a carrega.

export const MANUAL_MARK = 'pedido|'

/** Job criado por pedido de uma pessoa (pode responder histórico importado e não depende do horário do agente). */
export const isManualNote = (error: string | null | undefined): boolean => !!error && error.startsWith(MANUAL_MARK)

/** Nota sem a marca (para ler contadores como "aguardando-midia:2"). */
export const plainNote = (error: string | null | undefined): string => (isManualNote(error) ? error!.slice(MANUAL_MARK.length) : (error ?? ''))

/** Reaplica a marca a uma nova nota de job que continua pendente (espera por mídia, nova tentativa). */
export const keepManual = (error: string | null | undefined, note: string): string => (isManualNote(error) ? `${MANUAL_MARK}${note}` : note)
