import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  HeartPulse, Loader2, CheckCircle2, AlertTriangle, Info, Trash2, RefreshCw, ShieldCheck
} from 'lucide-react'

interface HealthIssue {
  id: string
  name: string
  detail: string
  severity: 'info' | 'warn'
  fixable: boolean
}
interface HealthResult {
  score: number
  label: string
  junk_size: number
  junk_count: number
  registry_issues: number
  startup_count: number
  issues: HealthIssue[]
  scan: {
    categories: {
      id: string
      name: string
      items: { id: string; name: string; path: string; size: number; count: number; checked: boolean; is_registry: boolean }[]
    }[]
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--success)'
  if (score >= 65) return 'var(--accent)'
  if (score >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

export default function HealthCheckCard() {
  const [result, setResult] = useState<HealthResult | null>(null)
  const [running, setRunning] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setStatus(null)
    try {
      setResult(await invoke<HealthResult>('run_health_check'))
    } catch (e) {
      setStatus('Não foi possível corrigir. Tente executar como administrador.')
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => { run() }, [])

  const fixAll = async () => {
    if (!result) return
    const fixable = result.scan.categories
      .flatMap(c => c.items)
      .filter(i => i.checked)
    if (fixable.length === 0) { setStatus('Nada para corrigir'); return }
    if (!window.confirm(`Corrigir ${fixable.length} item(ns)? Isso exclui arquivos e entradas de registro marcados (backup automático incluído).`)) return
    setFixing(true)
    setStatus(null)
    try {
      const r = await invoke<{ freed_bytes: number; freed_count: number; errors: string[] }>('clean_selected', { items: fixable })
      setStatus(`Corrigido: ${r.freed_count} itens, ${fmtBytes(r.freed_bytes)} liberados${r.errors.length ? ` · ${r.errors.length} pulados` : ''}`)
      await run()
    } catch (e) {
      setStatus('Não foi possível corrigir. Tente executar como administrador.')
    } finally {
      setFixing(false)
    }
  }

  return (
    <div className="card p-5 anim-slide-up">
      <div className="flex flex-col sm:flex-row gap-5">
        {/* score */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="relative w-24 h-24">
            <svg viewBox="0 0 100 100" className="w-24 h-24 -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="9" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke={result ? scoreColor(result.score) : 'var(--border)'}
                strokeWidth="9" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 42}
                strokeDashoffset={2 * Math.PI * 42 * (1 - (result?.score ?? 0) / 100)}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {running ? <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" /> : (
                <>
                  <span className="text-2xl font-bold" style={{ color: result ? scoreColor(result.score) : undefined }}>
                    {result?.score ?? '–'}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">{result?.label ?? 'analisando'}</span>
                </>
              )}
            </div>
          </div>
          <div className="sm:hidden" />
        </div>

        {/* issues */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <HeartPulse className="w-5 h-5 text-[var(--accent)]" />
            <h3 className="font-semibold">Verificação de Saúde</h3>
            <div className="flex-1" />
            <button onClick={run} disabled={running} className="btn-ghost !p-2" title="Reavaliar">
              <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {result ? (
            <>
              <div className="space-y-1.5 mb-3">
                {result.issues.map(iss => (
                  <div key={iss.id} className="flex items-center gap-2 text-sm">
                    {iss.severity === 'warn'
                      ? <AlertTriangle className="w-4 h-4 text-[var(--warning)] shrink-0" />
                      : <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />}
                    <span className="font-medium">{iss.name}:</span>
                    <span className="text-[var(--muted)] truncate flex-1">{iss.detail}</span>
                    {iss.fixable && <span className="text-xs text-[var(--accent)]">corrigível</span>}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fixAll}
                  disabled={fixing || running || (result.junk_count === 0 && result.registry_issues === 0)}
                  className="btn-primary !py-1.5 !text-sm"
                >
                  {fixing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Trash2 className="w-4 h-4 inline mr-1" />}
                  Corrigir tudo
                </button>
                <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> backup de registro incluído
                </span>
              </div>
              {status && <p className="text-xs text-[var(--muted)] mt-2 flex items-center gap-1"><Info className="w-3 h-3" />{status}</p>}
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">{status ?? 'Analisando sistema… (limpeza, registro e inicialização)'}</p>
          )}
        </div>
      </div>
    </div>
  )
}