import { ReactNode, useEffect } from 'react'
import { Loader2, X, CheckCircle, AlertCircle, HardDrive, Database, Sparkles, FolderOpen, Eye, Zap } from 'lucide-react'

interface ScanProgressModalProps {
  progress: { current_category: string; category_id?: string; progress: number; found_size: number; found_count: number } | null
  onCancel: () => void
  scanning: boolean
}

const categoryIcons: Record<string, ReactNode> = {
  system: <Sparkles className="w-5 h-5" />,
  browser: <FolderOpen className="w-5 h-5" />,
  apps: <Eye className="w-5 h-5" />,
  registry: <Database className="w-5 h-5" />,
  advanced: <Zap className="w-5 h-5" />,
}

const categoryNames: Record<string, string> = {
  system: 'Sistema',
  browser: 'Navegadores',
  apps: 'Aplicativos',
  registry: 'Registro',
  advanced: 'Avançado',
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

export default function ScanProgressModal({ progress, onCancel, scanning }: ScanProgressModalProps) {
  useEffect(() => {
    if (!scanning) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scanning, onCancel])

  if (!progress && !scanning) return null

  const currentCat = progress?.current_category || 'Iniciando...'
  const catKey = progress?.category_id || Object.keys(categoryNames).find(k => categoryNames[k] === currentCat) || 'system'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm anim-fade-in">
      <div className="w-full max-w-md card p-6 anim-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)]">
              {scanning ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <CheckCircle className="w-6 h-6 text-[var(--success)]" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--fg)]">
                {scanning ? 'Escaneando...' : 'Escaneamento Concluído'}
              </h3>
              <p className="text-sm text-[var(--muted)]">Analisando arquivos das categorias selecionadas</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={!scanning}
            className="btn-ghost p-2"
            aria-label="Cancelar escaneamento"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[var(--muted)]">Categoria atual</span>
              <span className="text-[var(--fg)] font-medium flex items-center gap-2">
                {categoryIcons[catKey] || <HardDrive className="w-4 h-4" />}
                {currentCat}
              </span>
            </div>
            <div className="h-3 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--accent)] to-blue-400 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progress?.progress || 0) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--muted)] mt-1">
              <span>{Math.round((progress?.progress || 0) * 100)}%</span>
              <span>{scanning ? 'Em andamento' : 'Concluído'}</span>
            </div>
          </div>

          {progress && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--accent)]">{formatBytes(progress.found_size)}</div>
                <div className="text-xs text-[var(--muted)]">Encontrado</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--accent)]">{formatNumber(progress.found_count)}</div>
                <div className="text-xs text-[var(--muted)]">Arquivos</div>
              </div>
            </div>
          )}

          {progress && (
            <div className="text-center text-sm text-[var(--muted)]">
              <p>Isso pode levar alguns minutos dependendo do tamanho do disco</p>
              <p className="mt-1">Não feche o aplicativo durante o escaneamento</p>
            </div>
          )}

          {!scanning && progress && (
            <div className="pt-4 border-t border-[var(--border)]">
              <p className="text-sm text-[var(--success)] font-medium flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Escaneamento concluído com sucesso!
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}