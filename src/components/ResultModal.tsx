import { ReactNode, useEffect } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Trash2, HardDrive, Loader2 } from 'lucide-react'

interface CleanResult {
  freed_bytes: number
  freed_count: number
  errors: string[]
}

interface ResultModalProps {
  result: CleanResult
  onClose: () => void
  formatBytes: (bytes: number) => string
  formatNumber: (num: number) => string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('pt-BR').format(num)
}

export default function ResultModal({ result, onClose, formatBytes, formatNumber }: ResultModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasErrors = result.errors.length > 0
  const success = result.freed_count > 0 || result.freed_bytes > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm anim-fade-in">
      <div className="w-full max-w-md card p-6 anim-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              hasErrors ? 'bg-[var(--warning)]/20 text-[var(--warning)]' : 'bg-[var(--success)]/20 text-[var(--success)]'
            }`}>
              {hasErrors ? (
                <AlertTriangle className="w-6 h-6" />
              ) : (
                <CheckCircle className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--fg)]">
                {hasErrors ? 'Limpeza Concluída com Avisos' : 'Limpeza Concluída'}
              </h3>
              <p className="text-sm text-[var(--muted)]">
                {success
                  ? `${formatNumber(result.freed_count)} itens removidos, ${formatBytes(result.freed_bytes)} liberados`
                  : 'Nenhum arquivo foi removido'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost p-2"
            aria-label="Fechar"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg">
          <div className="text-center">
            <div className="text-3xl font-bold text-[var(--accent)]">{formatBytes(result.freed_bytes)}</div>
            <div className="text-xs text-[var(--muted)]">Espaço Liberado</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-[var(--accent)]">{formatNumber(result.freed_count)}</div>
            <div className="text-xs text-[var(--muted)]">Arquivos Removidos</div>
          </div>
        </div>

        {hasErrors && (
          <div className="mb-6 p-4 bg-[var(--warning)]/10 border border-[var(--warning)]/50 rounded-lg">
            <div className="flex items-center gap-2 text-[var(--warning)] mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-medium">Avisos ({result.errors.length})</span>
            </div>
            <ul className="space-y-1 text-sm text-[var(--fg)]">
              {result.errors.slice(0, 5).map((error, i) => (
                <li key={i} className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span className="truncate" title={error}>{error}</span>
                </li>
              ))}
              {result.errors.length > 5 && (
                <li className="text-xs text-[var(--muted)]">
                  ... e mais {result.errors.length - 5} avisos
                </li>
              )}
            </ul>
          </div>
        )}

        {!hasErrors && !success && (
          <div className="mb-6 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg text-center">
            <p className="text-[var(--muted)]">Nenhum item foi selecionado ou todos os itens selecionados já estavam limpos.</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 btn-primary"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}