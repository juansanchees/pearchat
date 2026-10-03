import type { ConnectionStatus, Provider } from '@prisma/client'
import type { ConnectionStatusKind, ProviderKind } from '@/lib/types'

// Conversões entre enums do Prisma (MAIÚSCULAS) e os tipos de DTO (minúsculas).
export const providerToKind = (p: Provider): ProviderKind => p.toLowerCase() as ProviderKind
export const kindToProvider = (k: ProviderKind): Provider => k.toUpperCase() as Provider
export const statusToKind = (s: ConnectionStatus): ConnectionStatusKind => s.toLowerCase() as ConnectionStatusKind
export const kindToStatus = (k: ConnectionStatusKind): ConnectionStatus => k.toUpperCase() as ConnectionStatus
