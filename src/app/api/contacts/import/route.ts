import { NextResponse } from 'next/server'
import { badRequest, payloadTooLarge, sessionWorkspaceId, unauthorized } from '@/server/contacts/api'
import { importRows } from '@/server/contacts/import'
import { parseImport } from '@/server/contacts/import-parse'
import { readCsvBody } from '@/server/contacts/upload'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const body = await readCsvBody(req)
  if (!body.ok) return body.status === 413 ? payloadTooLarge(body.message) : badRequest(body.message)

  const parsed = parseImport(body.text)
  if (!parsed.ok) return parsed.status === 413 ? payloadTooLarge(parsed.message) : badRequest(parsed.message)

  const result = await importRows(workspaceId, parsed.rows, { erros: parsed.erros, ignorados: parsed.ignorados })
  return NextResponse.json(result)
}
