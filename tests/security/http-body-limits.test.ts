// Onda 1 (revisão), ponto 3: limite de corpo por rota. O 256 KB do middleware NÃO pode barrar o que o app já aceitava (mídia, foto,
// logo, CSV) nem os webhooks. HTTP contra o servidor de TESTE (TEST_BASE_URL, porta 3048); sem a variável os testes são pulados.
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { cleanup, makeAccount } from './helpers'
import { APP_ORIGIN, BASE, filler, login } from './http-helpers'
import { db } from '../../src/lib/db'

const suite = BASE ? describe : describe.skip
const MB = 1024 * 1024

after(cleanup)

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const PDF = Buffer.from('%PDF-1.4\n')
const form = (_campo: string, bytes: Buffer, type: string, file = 'arquivo') => {
  const f = new FormData()
  f.append('file', new Blob([new Uint8Array(bytes)], { type }), file)
  return f
}

suite('Limite de corpo por rota (o do middleware não barra o que o app já aceitava)', () => {
  let cookie = ''
  let workspaceId = ''
  let conversationId = ''
  const send = (method: string, path: string, body: BodyInit | undefined, headers: Record<string, string> = {}) =>
    fetch(`${BASE}${path}`, { method, headers: { cookie, origin: APP_ORIGIN, ...headers }, body }) // como o navegador: com Origin do app

  it('prepara a conta e uma conversa', async () => {
    const u = await makeAccount({ verified: true })
    cookie = await login(u)
    workspaceId = u.workspaceId
    const contact = await db.contact.create({ data: { workspaceId, nome: 'Cliente', telefone: `5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`, tags: [] } })
    conversationId = (await db.conversation.create({ data: { workspaceId, contactId: contact.id } })).id
  })

  it('JSON comum: até 256 KB passa (o app valida o conteúdo), acima é 413', async () => {
    const j = { 'content-type': 'application/json' }
    const dentro = await send('PUT', '/api/settings', JSON.stringify({ nome: 'x', email: 'a@b.co', empresa: 'x'.repeat(200 * 1024), horarioAtendimento: '', notifs: [] }), j)
    assert.equal(dentro.status, 400, 'passou do limite de corpo e foi recusado pela validação do campo (não 413)')
    const fora = await send('PUT', '/api/settings', JSON.stringify({ empresa: 'x'.repeat(300 * 1024) }), j)
    assert.equal(fora.status, 413)
  })

  it('foto de perfil: imagem de ~1,9 MB passa; acima de 2 MB o app recusa (413); acima de 3 MB o middleware recusa (413)', async () => {
    const ok = await send('POST', '/api/me/avatar', form('file', Buffer.concat([PNG, filler(1_900_000)]), 'image/png', 'a.png'))
    assert.equal(ok.status, 200, await ok.clone().text())
    const app = await send('POST', '/api/me/avatar', form('file', Buffer.concat([PNG, filler(2 * MB + 10_000)]), 'image/png', 'a.png'))
    assert.equal(app.status, 413)
    const mw = await send('POST', '/api/me/avatar', form('file', Buffer.concat([PNG, filler(3 * MB + 10_000)]), 'image/png', 'a.png'))
    assert.equal(mw.status, 413)
  })

  it('logo do negócio: imagem pequena e de ~1,9 MB passam; acima de 3 MB é 413', async () => {
    const path = `/api/spaces/${workspaceId}/logo`
    const pequena = await send('PUT', path, form('file', Buffer.concat([PNG, filler(5_000)]), 'image/png', 'l.png'))
    assert.equal(pequena.status, 200, await pequena.clone().text())
    const grande = await send('PUT', path, form('file', Buffer.concat([PNG, filler(1_900_000)]), 'image/png', 'l.png'))
    assert.equal(grande.status, 200)
    const mw = await send('PUT', path, form('file', Buffer.concat([PNG, filler(3 * MB + 10_000)]), 'image/png', 'l.png'))
    assert.equal(mw.status, 413)
  })

  it('mídia na conversa: ~15 MB passa pelo limite (o app responde pelo estado do WhatsApp, não 413); 16 MB e meio é recusado pelo app; 18 MB pelo middleware', async () => {
    const path = `/api/conversations/${conversationId}/media`
    const quinze = await send('POST', path, form('file', Buffer.concat([PDF, filler(15 * MB)]), 'application/pdf', 'doc.pdf'))
    assert.ok(![401, 403, 413].includes(quinze.status), `15 MB: HTTP ${quinze.status}`)
    const dezesseisEMeio = await send('POST', path, form('file', Buffer.concat([PDF, filler(16 * MB + 400_000)]), 'application/pdf', 'doc.pdf'))
    assert.equal(dezesseisEMeio.status, 413)
    assert.equal(((await dezesseisEMeio.json()) as { code?: string }).code, 'ARQUIVO_GRANDE')
    const dezoito = await send('POST', path, form('file', Buffer.concat([PDF, filler(18 * MB)]), 'application/pdf', 'doc.pdf'))
    assert.equal(dezoito.status, 413)
  })

  it('importação de contatos (CSV): ~7,5 MB passa (multipart e text/csv); 8,2 MB o app recusa; 9,5 MB o middleware recusa', async () => {
    // Linhas inválidas (sem telefone): nada é gravado no banco. Até 20 mil linhas (limite do app), por isso linhas longas.
    const csv = (bytes: number, largura: number) => {
      const linha = `"${'N'.repeat(largura)}",sem-telefone
`
      return Buffer.from(`nome,telefone
${linha.repeat(Math.ceil(bytes / linha.length))}`)
    }
    const multipart = await send('POST', '/api/contacts/import', form('file', csv(7.5 * MB, 400), 'text/csv', 'c.csv'))
    assert.ok(![401, 403, 413].includes(multipart.status), `multipart 7,5 MB: HTTP ${multipart.status}`)
    const texto = await send('POST', '/api/contacts/import', csv(7.5 * MB, 400), { 'content-type': 'text/csv' })
    assert.ok(![401, 403, 413].includes(texto.status), `text/csv 7,5 MB: HTTP ${texto.status}`)
    const app = await send('POST', '/api/contacts/import', csv(8.2 * MB, 700), { 'content-type': 'text/csv' })
    assert.equal(app.status, 413)
    const mw = await send('POST', '/api/contacts/import', csv(9.5 * MB, 700), { 'content-type': 'text/csv' })
    assert.equal(mw.status, 413)
  })

  it('webhooks (Evolution, Meta, Asaas) NÃO passam pelo middleware: corpo grande chega à rota (que se autentica / tem o próprio teto)', async () => {
    const evo = await fetch(`${BASE}/api/wa/evolution`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'errada' }, body: filler(12 * MB, 'a') })
    assert.equal(evo.status, 401, 'Evolution: 12 MB chegam à rota (que recusa pela chave), não 413 do middleware')
    const asaas = await fetch(`${BASE}/api/billing/asaas`, { method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': 'errado' }, body: filler(300 * 1024, 'a') })
    assert.equal(asaas.status, 401, 'Asaas: chega à rota')
    const meta = await fetch(`${BASE}/api/wa/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: filler(9 * MB, 'a') })
    assert.equal(meta.status, 413, 'Meta: teto de 8 MB da própria rota')
    const metaOk = await fetch(`${BASE}/api/wa/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: filler(7 * MB, 'a') })
    assert.equal(metaOk.status, 401, 'Meta: 7 MB passam do teto e caem na conferência da assinatura')
  })
})
