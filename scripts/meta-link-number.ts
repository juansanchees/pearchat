// Liga a um workspace um número que JÁ pertence a uma WABA do SEU Business Manager (ex.: o número de teste da Meta),
// sem passar pelo Cadastro incorporado. Usa o token de usuário do sistema (META_SYSTEM_USER_TOKEN).
//
//   docker compose exec app npx tsx scripts/meta-link-number.ts <email-do-usuario> <waba_id> <phone_number_id>
//
// Faz o mesmo que o cadastro normal: confere que o número pertence à WABA, assina o app nos webhooks, lê o número exibido
// e marca a sessão como conectada. O token fica criptografado no banco. Não imprime o token.
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main() {
  const [email, wabaId, phoneNumberId] = process.argv.slice(2)
  if (!email || !wabaId || !phoneNumberId) {
    console.error('Uso: npx tsx scripts/meta-link-number.ts <email-do-usuario> <waba_id> <phone_number_id>')
    process.exit(2)
  }
  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) {
    console.error('META_SYSTEM_USER_TOKEN não está configurado.')
    process.exit(2)
  }
  const { db } = await import('../src/lib/db')
  const { completeConnection, ConnectError } = await import('../src/server/whatsapp/meta-connect')
  try {
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { workspaceId: true } })
    if (!user) {
      console.error('Usuário não encontrado.')
      process.exit(1)
    }
    const dto = await completeConnection({
      workspaceId: user.workspaceId,
      token,
      wabaId,
      phoneNumberId,
      coexistence: false,
      registerUnlessConnected: true,
    })
    console.log(`Conectado: ${dto.numero ?? '(número sem nome exibido)'} no workspace ${user.workspaceId}`)
    // A sincronização inicial dos modelos roda em segundo plano: dá tempo de terminar antes de fechar o banco.
    await new Promise((r) => setTimeout(r, 5000))
  } catch (e) {
    if (e instanceof ConnectError) console.error(`Falhou (${e.status}): ${e.message}`)
    else console.error('Falhou:', e instanceof Error ? e.message : 'erro')
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

void main()
