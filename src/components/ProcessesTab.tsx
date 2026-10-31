import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Cpu, Activity, RefreshCw, Loader2, Zap, XCircle, Search, MemoryStick } from 'lucide-react'

interface Proc {
  name: string
  pid: number
  working_set: number
  cpu: number
}
interface ProcResult {
  processes: Proc[]
  total_working_set: number
  cores: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export default function ProcessesTab() {
  const [data, setData] = useState<ProcResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await invoke<ProcResult>('get_processes'))
    } catch (e) {
      setStatus('Erro: ' + e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const optimize = async () => {
    setOptimizing(true)
    setStatus(null)
    try {
      const r = await invoke<{ processes: number; freed_bytes: number }>('optimize_memory')
      setStatus(`Memória otimizada: ${fmtBytes(r.freed_bytes)} liberados em ${r.processes} processos`)
      await load()
    } catch (e) {
      setStatus('Erro: ' + e)
    } finally {
      setOptimizing(false)
    }
  }

  const kill = async (p: Proc) => {
    if (!confirm(`Encerrar "${p.name}" (PID ${p.pid})?`)) return
    try {
      await invoke('kill_process', { pid: p.pid })
      await load()
    } catch (e) {
      setStatus('Erro: ' + e)
    }
  }

  const filtered = (data?.processes ?? []).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || String(p.pid).includes(search))

  return (
    <div className="space-y-4 anim-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Processos e Memória</h2>
          <p className="text-[var(--muted)]">Monitore o consumo e libere memória de trabalho</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
          <button onClick={optimize} disabled={optimizing} className="btn-primary flex items-center gap-2">
            {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Otimizar memória
          </button>
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm">
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <MemoryStick className="w-4 h-4" /> Working set total:
            <strong className="text-[var(--fg)]">{fmtBytes(Number(data.total_working_set))}</strong>
          </span>
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <Cpu className="w-4 h-4" /> {data.cores} núcleos lógicos
          </span>
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <Activity className="w-4 h-4" /> {data.processes.length} processos monitorados
          </span>
        </div>
      )}

      {status && (
        <div className="card p-3 border-l-4 border-l-[var(--accent)]">
          <span className="text-sm">{status}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-1.5 flex-1 max-w-md">
          <Search className="w-4 h-4 text-[var(--muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filtrar por nome ou PID…"
            className="bg-transparent outline-none text-sm text-[var(--fg)] placeholder-[var(--muted)] w-full"
          />
        </div>
        <span className="text-sm text-[var(--muted)]">{filtered.length}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-[var(--muted)] border-b border-[var(--border)] bg-[var(--card-hover)]">
          <span className="col-span-5">Processo</span>
          <span className="col-span-2 text-right">RAM</span>
          <span className="col-span-2 text-right">CPU</span>
          <span className="col-span-2 text-right">PID</span>
          <span className="col-span-1" />
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)] mx-auto mb-2" />
            <p className="text-sm text-[var(--muted)]">amostrando processos…</p>
          </div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto scrollbar-thin divide-y divide-[var(--border)]">
            {filtered.map(p => (
              <div key={p.pid} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm items-center hover:bg-[var(--card-hover)]">
                <span className="col-span-5 truncate font-medium">{p.name}</span>
                <span className="col-span-2 text-right text-[var(--muted)] font-mono">{fmtBytes(Number(p.working_set))}</span>
                <span className={`col-span-2 text-right font-mono ${p.cpu > 10 ? 'text-[var(--warning)]' : 'text-[var(--muted)]'}`}>{p.cpu.toFixed(1)}%</span>
                <span className="col-span-2 text-right text-[var(--muted)] font-mono">{p.pid}</span>
                <span className="col-span-1 text-right">
                  <button onClick={() => kill(p)} className="text-[var(--muted)] hover:text-[var(--danger)]" title="Encerrar">
                    <XCircle className="w-4 h-4" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}