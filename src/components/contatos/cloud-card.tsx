import { CloudCheck, DownloadSimple } from '@phosphor-icons/react'

export function CloudCard({
  company,
  exporting,
  onExport,
}: {
  company: string
  exporting: boolean
  onExport: () => void
}) {
  return (
    <div className="flex flex-none items-center gap-3 rounded-lg border border-solid border-light-divider bg-light-surface px-4 py-3.5 shadow-md">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-solid border-light-accent-700 bg-light-accent-900"
      >
        <CloudCheck size={18} className="text-light-accent-300" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-tight">Nuvem do {company}</div>
        <div className="mt-0.5 text-[11px] text-light-neutral-500">
          Backup diário · seus contatos ficam salvos mesmo se trocar de celular
        </div>
      </div>
      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        title="Exportar CSV"
        aria-label="Exportar CSV"
        className="pc-btn pc-btn-ghost !h-[30px] !w-[30px] flex-none !p-0"
      >
        <DownloadSimple size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
