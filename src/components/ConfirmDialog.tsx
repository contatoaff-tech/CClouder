import { useEffect, useRef } from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  details?: string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal de confirmação estilizado (substitui confirm()/alert() nativos).
 * Trava o foco, fecha no ESC e anuncia o conteúdo para leitores de tela.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  details,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
    >
      <div className="glass rounded-xl max-w-md w-full p-6 anim-slide-up space-y-4">
        <div className="flex items-start gap-3">
          {danger ? (
            <ShieldAlert className="w-6 h-6 text-[var(--danger)] flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-[var(--warning)] flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 id="confirm-title" className="font-semibold text-[var(--fg)]">{title}</h3>
            <p id="confirm-desc" className="text-sm text-[var(--muted)] mt-1">{description}</p>
            {details && details.length > 0 && (
              <ul className="text-xs text-[var(--muted)] mt-2 space-y-1 list-disc list-inside">
                {details.map(d => <li key={d}>{d}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">{cancelLabel}</button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={danger ? 'btn-danger' : 'btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
