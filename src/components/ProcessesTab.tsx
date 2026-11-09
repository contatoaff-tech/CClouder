import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Cpu, Activity, RefreshCw, Loader2, Zap, Search, MemoryStick, Rocket, CheckCircle2, ShieldAlert } from 'lucide-react'

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

interface TurboStatus {
  active: boolean
  services: string[]
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
  const [turboActive, setTurboActive] = useState(false)
  const [turboLoading, setTurboLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [procRes, turboRes] = await Promise.all([
        invoke<ProcResult>('get_processes'),
        invoke<TurboStatus>('get_turbo_boost_status').catch(() => ({ active: false, services: [] }))
      ])
      setData(procRes)
      setTurboActive(turboRes.active)
    } catch (e) {
      setStatus('Erro: ' + e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleTurbo = async () => {
    setTurboLoading(true)
    setStatus(null)
    const targetState = !turboActive
    try {
      const res = await invoke<{ ok: boolean; active: boolean; count: number }>('toggle_turbo_boost', { enable: targetState })
      setTurboActive(res.active)
      if (res.active) {
        setStatus(`Turbo Boost ATIVADO! ${res.count} serviço(s) secundário(s) pausados e memória RAM otimizada para jogos/tarefas pesadas.`)
      } else {
        setStatus(`Turbo Boost desativado. ${res.count} serviço(s) restaurados ao funcionamento normal.`)
      }
      await load()
    } catch (e) {
      setStatus('Erro ao alternar Turbo Boost: ' + e)
    } finally {
      setTurboLoading(false)
    }
  }

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
          <p className="text-[var(--muted)]">Monitore recursos, reduza latência e acelere seu sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
          <button onClick={optimize} disabled={optimizing} className="btn-secondary flex items-center gap-2">
            {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Liberar RAM
          </button>
        </div>
      </div>

      {/* Turbo Boost Banner (Inspirado no Advanced SystemCare) */}
      <div className={`card p-5 border transition-all duration-300 ${
        turboActive
          ? 'border-[var(--success)] bg-gradient-to-r from-[var(--success)]/10 to-[var(--card)] shadow-lg shadow-[var(--success)]/5'
          : 'border-[var(--border)] bg-gradient-to-r from-[var(--card)] to-[var(--card-hover)]'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              turboActive ? 'bg-[var(--success)] text-white shadow-md' : 'bg-[var(--accent)]/10 text-[var(--accent)]'
            }`}>
              <Rocket className={`w-6 h-6 ${turboActive ? 'animate-bounce' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-[var(--fg)]">Turbo Boost (Modo Gamer & Alta Performance)</h3>
                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  turboActive ? 'bg-[var(--success)] text-white' : 'bg-[var(--border)] text-[var(--muted)]'
                }`}>
                  {turboActive ? 'ATIVADO' : 'INATIVO'}
                </span>
              </div>
              <p className="text-sm text-[var(--muted)] mt-1">
                Pausa temporariamente serviços secundários (SysMain/SuperFetch, Telemetria, Windows Search) e esvazia cache de memória RAM para máxima fluidez em jogos e aplicativos pesados.
              </p>
            </div>
          </div>
          <button
            onClick={toggleTurbo}
            disabled={turboLoading}
            className={`px-5 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shrink-0 ${
              turboActive
                ? 'bg-[var(--card)] text-[var(--danger)] border border-[var(--danger)]/50 hover:bg-[var(--danger)]/10'
                : 'bg-[var(--success)] text-white hover:opacity-90 shadow-md shadow-[var(--success)]/20'
            }`}
          >
            {turboLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : turboActive ? (
              <ShieldAlert className="w-4 h-4" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            {turboActive ? 'Desativar Turbo Boost' : 'Ativar Turbo Boost'}
          </button>
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm">
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <MemoryStick className="w-4 h-4 text-[var(--accent)]" /> Working set total:
            <strong className="text-[var(--fg)]">{fmtBytes(Number(data.total_working_set))}</strong>
          </span>
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <Cpu className="w-4 h-4 text-[var(--accent)]" /> {data.cores} núcleos lógicos
          </span>
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <Activity className="w-4 h-4 text-[var(--accent)]" /> {data.processes.length} processos monitorados
          </span>
        </div>
      )}

      {status && (
        <div className="card p-3 border-l-4 border-l-[var(--accent)] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
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
        <span className="text-sm text-[var(--muted)]">{filtered.length} processos listados</span>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-[var(--muted)] border-b border-[var(--border)] bg-[var(--card-hover)] font-medium">
          <span className="col-span-5">Processo</span>
          <span className="col-span-2 text-right">RAM</span>
          <span className="col-span-2 text-right">CPU</span>
          <span className="col-span-2 text-right">PID</span>
          <span className="col-span-1 text-center">Ação</span>
        </div>
        <div className="divide-y divide-[var(--border)] max-h-[480px] overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="p-8 text-center text-sm text-[var(--muted)]">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)] mx-auto mb-2" />
              Carregando processos…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--muted)]">Nenhum processo correspondente</div>
          ) : (
            filtered.map(p => (
              <div key={p.pid} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm items-center hover:bg-[var(--card-hover)] transition-colors">
                <span className="col-span-5 font-mono text-xs truncate text-[var(--fg)]" title={p.name}>
                  {p.name}
                </span>
                <span className="col-span-2 text-right font-mono text-xs text-[var(--fg)]">
                  {fmtBytes(p.working_set)}
                </span>
                <span className="col-span-2 text-right font-mono text-xs text-[var(--muted)]">
                  {p.cpu > 0 ? `${p.cpu.toFixed(1)}%` : '0%'}
                </span>
                <span className="col-span-2 text-right font-mono text-xs text-[var(--muted)]">
                  {p.pid}
                </span>
                <span className="col-span-1 text-center">
                  <button
                    onClick={() => kill(p)}
                    title="Encerrar processo"
                    className="text-xs text-[var(--danger)] hover:underline hover:opacity-80"
                  >
                    Finalizar
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
