// Validação do corpo de POST /api/onboarding, sem banco. Uso: tsx --test tests/onboarding.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { onboardingSchema } from '../src/app/api/onboarding/schema'

const base = { empresa: 'Doces da Ana', segmento: 'confeitaria', objetivos: ['ia'], agenteNome: 'Pera', tom: 'Amigável', tamanhoEquipe: '2 a 5' }

describe('onboardingSchema.tamanhoEquipe', () => {
  it('aceita os três valores da tela', () => {
    for (const v of ['Só eu', '2 a 5', '6 ou mais']) assert.equal(onboardingSchema.safeParse({ ...base, tamanhoEquipe: v }).success, true, v)
  })
  it('rejeita valor fora da lista ou ausente', () => {
    assert.equal(onboardingSchema.safeParse({ ...base, tamanhoEquipe: '10 a 20' }).success, false)
    assert.equal(onboardingSchema.safeParse({ ...base, tamanhoEquipe: undefined }).success, false)
    assert.equal(onboardingSchema.safeParse({ ...base, tamanhoEquipe: 3 }).success, false)
  })
})
