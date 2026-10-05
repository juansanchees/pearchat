'use client'

import { useCallback, useEffect, useState } from 'react'
import { EnvelopeSimple, LinkSimple, Plus, UsersThree } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { usePermissions } from '@/components/app/use-permissions'
import { Avatar, Pill, Tag } from '@/components/pear'
import { AUDIT_LABEL } from '@/server/audit/labels'
import type { AuditAction } from '@/server/audit/labels'
import { PAPEL_LABEL } from '@/server/auth/permissions'
import type { Papel } from '@/server/auth/permissions'
import type { InviteDTO, MemberDTO, TeamResponse } from '@/server/team/types'
import { api } from './api'
import { Field, Section, Seg } from './parts'

const row = 'flex flex-wrap items-center gap-3 rounded-md border border-light-divider px-[14px] py-3'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Activity = { id: string; acao: string; alvo: string | null; quem: string | null; quando: string }
type InviteResult = { convite: InviteDTO; link: string | null; emailEnviado: boolean; emailConfigurado: boolean }

const PAPEL_OPTS: Record<string, Papel> = { Administrador: 'admin', Atendente: 'agent', Dono: 'owner' }
const labelOf = (p: Papel) => PAPEL_LABEL[p]

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function expiryText(i: InviteDTO): string {
  if (i.expirado) return 'Expirado'
  const dias = Math.max(1, Math.ceil((new Date(i.expiraEm).getTime() - Date.now()) / 86_400_000))
  return `Expira em ${dias} ${dias === 1 ? 'dia' : 'dias'}`
}

/** Seção "Equipe" do drawer de Configurações (dono e administrador): pessoas, convites, papéis, WhatsApps e atividade. */
export function TeamSection() {
  const { toast } = useAppState()
  const { isOwner } = usePermissions()
  const [data, setData] = useState<TeamResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [activity, setActivity] = useState<Activity[]>([])
  const [busy, setBusy] = useState(false)

  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<'admin' | 'agent'>('agent')
  const [spaceIds, setSpaceIds] = useState<string[]>([])
  const [result, setResult] = useState<InviteResult | null>(null)

  const [editing, setEditing] = useState<string | null>(null)
  const [editPapel, setEditPapel] = useState<Papel>('agent')
  const [editSpaces, setEditSpaces] = useState<string[]>([])
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<TeamResponse>('/api/team'))
      setFailed(false)
    } catch {
      setFailed(true)
    }
    if (isOwner) {
      try {
        setActivity(await api<Activity[]>('/api/team/activity'))
      } catch {
        // atividade é só informativa
      }
    }
  }, [isOwner])

  useEffect(() => {
    void load()
  }, [load])

  const fail = (e: unknown, title: string) => toast({ title, text: e instanceof Error ? e.message : 'Tente novamente em instantes.' })

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast({ icon: <LinkSimple size={18} weight="fill" />, title: 'Link copiado', text: 'Envie para a pessoa convidada.' })
    } catch {
      toast({ title: 'Não foi possível copiar', text: 'Selecione o link e copie manualmente.' })
    }
  }

  async function sendInvite() {
    if (busy) return
    setBusy(true)
    try {
      const r = await api<InviteResult>('/api/team/invites', { method: 'POST', body: { email: email.trim(), papel, workspaceIds: papel === 'agent' ? spaceIds : [] } })
      setResult(r)
      setInviting(false)
      setEmail('')
      setSpaceIds([])
      await load()
      if (r.emailEnviado) toast({ icon: <EnvelopeSimple size={18} weight="fill" />, title: 'Convite enviado', text: r.convite.email })
    } catch (e) {
      fail(e, 'Não foi possível convidar')
    } finally {
      setBusy(false)
    }
  }

  async function resend(i: InviteDTO, enviarEmail: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const r = await api<InviteResult>(`/api/team/invites/${i.id}/resend`, { method: 'POST', body: { enviarEmail } })
      if (enviarEmail && r.emailEnviado) toast({ icon: <EnvelopeSimple size={18} weight="fill" />, title: 'Convite reenviado', text: i.email })
      else if (enviarEmail) setResult(r)
      if (!enviarEmail && r.link) await copy(r.link)
      await load()
    } catch (e) {
      fail(e, 'Não foi possível reenviar')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(i: InviteDTO) {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/team/invites/${i.id}`, { method: 'DELETE' })
      toast({ title: 'Convite revogado', text: i.email })
      await load()
    } catch (e) {
      fail(e, 'Não foi possível revogar')
    } finally {
      setBusy(false)
    }
  }

  async function saveMember(m: MemberDTO) {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/team/members/${m.id}`, { method: 'PATCH', body: { papel: editPapel, workspaceIds: editPapel === 'agent' ? editSpaces : [] } })
      toast({ title: 'Pessoa atualizada', text: m.nome })
      setEditing(null)
      await load()
    } catch (e) {
      fail(e, 'Não foi possível salvar')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(m: MemberDTO) {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/team/members/${m.id}`, { method: 'DELETE' })
      toast({ title: 'Pessoa removida da equipe', text: m.nome })
      setRemoving(null)
      await load()
    } catch (e) {
      fail(e, 'Não foi possível remover')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const spaceName = (id: string) => data?.espacos.find((s) => s.id === id)?.nome ?? 'WhatsApp'
  const full = !!data && data.usados >= data.limite
  const canSubmit = EMAIL_RE.test(email.trim()) && (papel === 'admin' || spaceIds.length > 0)

  const SpacePills = ({ value, onToggle }: { value: string[]; onToggle: (id: string) => void }) => (
    <div className="flex flex-wrap gap-2">
      {data?.espacos.map((s) => (
        <Pill key={s.id} variant="chip" active={value.includes(s.id)} onClick={() => onToggle(s.id)}>
          {s.nome}
        </Pill>
      ))}
    </div>
  )

  return (
    <Section
      label="Equipe"
      aside={data ? <span className="text-[11.5px] text-light-neutral-500">{data.usados} de {data.limite} {data.limite === 1 ? 'pessoa' : 'pessoas'}</span> : null}
    >
      {failed && !data && (
        <div className={row}>
          <span className="flex-1 text-[12.5px] text-light-neutral-500">Não foi possível carregar a equipe.</span>
          <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => void load()}>
            Tentar de novo
          </button>
        </div>
      )}

      {data?.membros.map((m) => {
        const canAct = !m.voce && (isOwner || m.papel !== 'owner')
        return (
          <div key={m.id} className="flex flex-col gap-3 rounded-md border border-light-divider px-[14px] py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={m.nome} size={32} src={m.fotoUrl} />
              <div className="min-w-0 flex-[1_1_160px]">
                <div className="truncate text-[13px] font-medium leading-[1.25]">
                  {m.nome}
                  {m.voce && <span className="font-normal text-light-neutral-500"> (você)</span>}
                </div>
                <div className="truncate text-[11.5px] text-light-neutral-500">{m.email}</div>
                <div className="truncate text-[11.5px] text-light-neutral-500">
                  {m.workspaceIds === null ? 'Todos os WhatsApps' : m.workspaceIds.map(spaceName).join(', ') || 'Nenhum WhatsApp'}
                </div>
              </div>
              <Tag tone={m.papel === 'agent' ? 'neutral' : 'accent'} className="!px-2 !text-[10.5px]">{labelOf(m.papel)}</Tag>
              {canAct && editing !== m.id && removing !== m.id && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="pc-btn pc-btn-ghost !text-[12px]"
                    onClick={() => {
                      setRemoving(null)
                      setEditing(m.id)
                      setEditPapel(m.papel)
                      setEditSpaces(m.workspaceIds ?? [])
                    }}
                  >
                    Editar
                  </button>
                  <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => { setEditing(null); setRemoving(m.id) }}>
                    Remover
                  </button>
                </div>
              )}
            </div>

            {editing === m.id && (
              <div className="flex flex-col gap-3 border-t border-light-divider pt-3">
                <Field label="Papel">
                  <Seg
                    label="Papel"
                    options={isOwner ? ['Administrador', 'Atendente', 'Dono'] : ['Administrador', 'Atendente']}
                    value={labelOf(editPapel)}
                    onChange={(v) => setEditPapel(PAPEL_OPTS[v])}
                  />
                </Field>
                {editPapel === 'agent' ? (
                  <Field label="WhatsApps liberados">
                    <SpacePills value={editSpaces} onToggle={(id) => toggle(editSpaces, setEditSpaces, id)} />
                  </Field>
                ) : (
                  <div className="text-[11.5px] text-light-neutral-500">{editPapel === 'owner' ? 'O dono' : 'O administrador'} acessa todos os WhatsApps da conta.</div>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                  <button type="button" disabled={busy || (editPapel === 'agent' && editSpaces.length === 0)} className="pc-btn pc-btn-primary !text-[12px]" onClick={() => void saveMember(m)}>
                    {busy ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}

            {removing === m.id && (
              <div className="flex flex-col gap-2 border-t border-light-divider pt-3">
                <div className="text-[12.5px] font-medium">Remover {m.nome} da equipe?</div>
                <div className="text-[11.5px] leading-[1.4] text-light-neutral-500">
                  A pessoa perde o acesso na hora e as conversas dela ficam sem responsável. Nada é apagado.
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setRemoving(null)}>
                    Cancelar
                  </button>
                  <button type="button" disabled={busy} className="pc-btn pc-btn-primary !text-[12px]" onClick={() => void removeMember(m)}>
                    {busy ? 'Removendo…' : 'Remover'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {data && data.convites.length > 0 && (
        <>
          <div className="pc-section-label mt-1">Convites pendentes</div>
          {data.convites.map((i) => (
            <div key={i.id} className={row}>
              <EnvelopeSimple size={18} className="flex-none text-light-accent-300" aria-hidden="true" />
              <div className="min-w-0 flex-[1_1_160px]">
                <div className="truncate text-[13px] font-medium leading-[1.25]">{i.email}</div>
                <div className="truncate text-[11.5px] text-light-neutral-500">
                  {labelOf(i.papel)} · {expiryText(i)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button type="button" disabled={busy} className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => void resend(i, false)} title="Gera um link novo e copia">
                  <LinkSimple size={13} /> Copiar link
                </button>
                {data.emailConfigurado && (
                  <button type="button" disabled={busy} className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => void resend(i, true)}>
                    Reenviar
                  </button>
                )}
                <button type="button" disabled={busy} className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => void revoke(i)}>
                  Revogar
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {result && (
        <div className="flex flex-col gap-2 rounded-md border border-light-accent-700 bg-light-accent-900 p-[14px]">
          <div className="text-[12.5px] font-medium text-light-accent-200">
            {result.emailEnviado ? `Convite enviado para ${result.convite.email}` : `Convite criado para ${result.convite.email}`}
          </div>
          <div className="text-[11.5px] leading-[1.4] text-light-neutral-500">
            {result.emailEnviado
              ? 'O link foi enviado só para o e-mail da pessoa (vale por 7 dias). Se ela não receber, use "Reenviar" na lista de convites.'
              : result.emailConfigurado
                ? 'Não foi possível enviar o e-mail agora. Copie o link e mande para a pessoa.'
                : 'O envio de e-mail ainda não está configurado. Copie o link e mande para a pessoa (vale por 7 dias).'}
          </div>
          <div className="flex gap-2">
            {result.link && (
              <>
                <input readOnly aria-label="Link do convite" className="pc-input min-w-0 flex-1" value={result.link} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={() => void copy(result.link ?? '')}>
                  <LinkSimple size={14} /> Copiar link
                </button>
              </>
            )}
            <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setResult(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {inviting ? (
        <div className="flex flex-col gap-3 rounded-md border border-light-divider p-[14px]">
          <Field label="E-mail da pessoa">
            <input className="pc-input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com.br" />
          </Field>
          <Field label="Papel">
            <Seg label="Papel" options={['Administrador', 'Atendente']} value={labelOf(papel)} onChange={(v) => setPapel(PAPEL_OPTS[v] as 'admin' | 'agent')} />
          </Field>
          {papel === 'agent' ? (
            <Field label="WhatsApps liberados">
              <SpacePills value={spaceIds} onToggle={(id) => toggle(spaceIds, setSpaceIds, id)} />
            </Field>
          ) : (
            <div className="text-[11.5px] text-light-neutral-500">O administrador acessa todos os WhatsApps, mas não vê plano e pagamento.</div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setInviting(false)}>
              Cancelar
            </button>
            <button type="button" disabled={busy || !canSubmit} className="pc-btn pc-btn-primary !text-[12px]" onClick={() => void sendInvite()}>
              {busy ? 'Enviando…' : data?.emailConfigurado ? 'Enviar convite' : 'Criar convite'}
            </button>
          </div>
        </div>
      ) : (
        data && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={full}
              className="pc-btn pc-btn-secondary self-start !text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                setResult(null)
                setInviting(true)
              }}
            >
              <Plus size={14} />
              Convidar pessoa
            </button>
            {full && (
              <div className="flex items-center gap-2 text-[11.5px] text-light-neutral-500">
                <UsersThree size={14} aria-hidden="true" />
                Seu plano permite {data.limite} {data.limite === 1 ? 'pessoa' : 'pessoas'} na equipe. Faça upgrade para convidar mais.
              </div>
            )}
          </div>
        )
      )}

      {isOwner && activity.length > 0 && (
        <>
          <div className="pc-section-label mt-1">Atividade recente</div>
          <div className="overflow-hidden rounded-md border border-light-divider">
            {activity.map((a, idx) => (
              <div key={a.id} className={`flex items-baseline gap-3 px-[14px] py-[8px] text-[12px] ${idx > 0 ? 'border-t border-light-divider' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.quem ?? 'Sistema'}</span> {AUDIT_LABEL[a.acao as AuditAction] ?? a.acao}
                  {a.alvo ? <span className="text-light-neutral-500"> {a.alvo}</span> : null}
                </span>
                <span className="flex-none text-[11px] text-light-neutral-500">{fmtWhen(a.quando)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}
