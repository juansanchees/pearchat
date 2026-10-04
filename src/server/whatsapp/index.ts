import type { ProviderKind } from '@/lib/types'
import { CloudApiProvider } from './cloud-api'
import { EvolutionProvider } from './evolution'
import { MockProvider } from './mock'
import type { WhatsAppProvider } from './provider'

export const isMock = () => process.env.WA_MOCK === 'true'

// Fábrica de provedores. WA_MOCK=true devolve o MockProvider para os dois tipos.
export function getProvider(kind: ProviderKind): WhatsAppProvider {
  if (isMock()) return new MockProvider()
  switch (kind) {
    case 'oficial':
      return new CloudApiProvider()
    case 'rapida':
      return new EvolutionProvider()
  }
}

export type { WhatsAppProvider, ContactRef, OutboundMedia, FetchedMedia } from './provider'
export { WhatsAppProviderError, ProviderUnsupportedError, WindowClosedError } from './provider'
