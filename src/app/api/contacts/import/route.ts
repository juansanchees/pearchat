import { NextResponse } from 'next/server'
import { badRequest, payloadTooLarge, sessionWorkspaceId, unauthorized } from '@/server/contacts/api'
import { importRows } from '@/server/contacts/import'
import { parseImport } from '@/server/contacts/import-parse'
import { getWorkspaceDdi } from '@/server/workspace-locale'
import { readCsvBody } from '@/server/contacts/upload'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const body = await readCsvBody(req)
  if (!body.ok) return body.status === 413 ? payloadTooLarge(body.message) : badRequest(body.message)

  // Telefones sem DDI ganham o DDI padrão deste espaço; com + ou já com DDI, nunca ganham nada.
  const ddi = await getWorkspaceDdi(workspaceId)
  const parsed = parseImport(body.text, ddi)
  if (!parsed.ok) return parsed.status === 413 ? payloadTooLarge(parsed.message) : badRequest(parsed.message)

  const result = await importRows(workspaceId, parsed.rows, { erros: parsed.erros, ignorados: parsed.ignorados }, ddi)
  return NextResponse.json(result)
}
