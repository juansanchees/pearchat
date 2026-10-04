// Iniciais do avatar com emoji. Uso: npx tsx --test tests/initials.test.ts (não usa banco).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { initialsOf } from '../src/lib/initials'
import { initials as listInitials } from '../src/components/conversas/format'
const pearInitials = (n: string) => initialsOf(n, 'second') // mesma regra de pear/avatar.tsx (que só delega)

const noBrokenChar = (s: string) => assert.ok(!s.includes('�') && !/[\uD800-\uDFFF]/.test(s), `caractere partido em ${JSON.stringify(s)}`)

describe('iniciais do avatar', () => {
  it('nome normal', () => {
    assert.equal(listInitials('Maria Souza'), 'MS')
    assert.equal(listInitials('Maria da Silva Souza'), 'MS')
    assert.equal(pearInitials('Maria da Silva Souza'), 'Md')
    assert.equal(listInitials('juan'), 'J')
    assert.equal(listInitials('Álvaro Éder'), 'ÁÉ')
  })
  it('emoji no fim ou no começo não vira "�"', () => {
    const a = listInitials('Karla De la Cruz 🧝')
    noBrokenChar(a)
    assert.equal(a, 'KC')
    assert.equal(listInitials('🧝 Karla'), 'K')
    assert.equal(listInitials('Karla🧝'), 'K')
    noBrokenChar(pearInitials('🧝‍♀️ Ana Lima'))
    assert.equal(pearInitials('🧝‍♀️ Ana Lima'), 'AL')
  })
  it('nome só de emojis, símbolos ou vazio cai em "?"', () => {
    assert.equal(listInitials('🧝'), '?')
    assert.equal(listInitials('😀😀 🔥'), '?')
    assert.equal(listInitials('👨‍👩‍👧'), '?')
    assert.equal(listInitials('1️⃣'), '?')
    assert.equal(listInitials('~'), '?')
    assert.equal(listInitials('   '), '?')
    assert.equal(listInitials(''), '?')
    assert.equal(initialsOf('🧝', 'last', '5'), '5')
  })
  it('pontuação e símbolos são ignorados', () => {
    assert.equal(listInitials('~ Juan'), 'J')
    assert.equal(listInitials('~Juan Pérez'), 'JP')
    assert.equal(listInitials('* - Ana'), 'A')
    assert.equal(listInitials('"Pedro" (Loja)'), 'PL')
  })
  it('dígitos valem (nome que é o telefone)', () => {
    assert.equal(listInitials('+5511998124471'), '5')
    assert.equal(listInitials('3M Brasil'), '3B')
  })
  it('alfabetos não latinos e surrogates', () => {
    assert.equal(listInitials('Иван Петров'), 'ИП')
    assert.equal(listInitials('𝐀na 𝐁ia'), '𝐀𝐁')
  })
})
