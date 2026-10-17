import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Cpu, Globe, ShieldCheck, Archive, RefreshCw, Search, Loader2, CheckCircle2, XCircle, Info } from 'lucide-react'

interface Driver {
  name: string
  version: string
  manufacturer: string
  device_class: string
  inf_name: string
  driver_date: string
  is_signed: boolean
}

interface Capabilities {
  is_elevated: boolean
  pnputil_available: boolean
  powershell_available: boolean
  restore_point: boolean
  restore_note: string
  backup_drivers: boolean
}

type Op = 'none' | 'scan' | 'backup' | 'restore' | 'caps'

function fmtCap(ok: boolean, label: string, note?: string) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)]">
      {ok ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" /> : <XCircle className="w-4 h-4 text-[var(--danger)]" />}
      <span className="text-sm">{label}</span>
      {note && <span className="text-xs text-[var(--muted)]">— {note}</span>}
    </div>
  )
}

export default function DriverTab() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [op, setOp] = useState<Op>('none')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const scan = useCallback(async () => {
    setOp('scan')
    setStatus(null)
    try {
      setDrivers(await invoke<Driver[]>('get_drivers'))
    } catch (e) {
      setStatus({ type: 'err', msg: 'Erro ao escanear drivers: ' + e })
    } finally {
      setOp('none')
    }
  }, [])

  const checkCaps = useCallback(async () => {
    setOp('caps')
    try {
      setCaps(await invoke<Capabilities>('verify_capabilities'))
    } catch (e) {
      setStatus({ type: 'err', msg: 'Erro: ' + e })
    } finally {
      setOp('none')
    }
  }, [])

  useEffect(() => {
    scan()
    checkCaps()
  }, [scan, checkCaps])

  const backup = async () => {
    setOp('backup')
    setStatus(null)
    try {
      const r = await invoke<{ ok: boolean; path: string; count: number }>('backup_drivers')
      setStatus({ type: 'ok', msg: `Backup concluído: ${r.count} drivers exportados para ${r.path}` })
    } catch (e) {
      setStatus({ type: 'err', msg: String(e) })
    } finally {
      setOp('none')
    }
  }

  const restorePoint = async () => {
    setOp('restore')
    setStatus(null)
    try {
      const r = await invoke<{ ok: boolean; message: string }>('create_restore_point')
      setStatus({ type: 'ok', msg: r.message })
    } catch (e) {
      setStatus({ type: 'err', msg: String(e) })
    } finally {
      setOp('none')
    }
  }

  const searchWeb = async (d: Driver) => {
    try {
      await invoke('search_driver_web', { name: d.name, manufacturer: d.manufacturer, version: d.version })
    } catch (e) {
      setStatus({ type: 'err', msg: 'Erro ao abrir busca: ' + e })
    }
  }

  const filtered = drivers.filter(d =>
    !search ||
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.manufacturer.toLowerCase().includes(search.toLowerCase()) ||
    d.version.includes(search))

  const busy = op !== 'none'

  return (
    <div className="space-y-4 anim-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Gerenciador de Drivers</h2>
          <p className="text-[var(--muted)]">Escaneie, busque atualizações na web e proteja antes de alterar</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={scan} disabled={busy} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${op === 'scan' ? 'animate-spin' : ''}`} /> Atualizar lista
          </button>
          <button onClick={restorePoint} disabled={busy} className="btn-secondary flex items-center gap-2">
            {op === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Ponto de restauração
          </button>
          <button onClick={backup} disabled={busy} className="btn-primary flex items-center gap-2">
            {op === 'backup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
            Backup de drivers
          </button>
        </div>
      </div>

      {/* verificação de capacidades */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-medium">Verificação de recursos</span>
          {op === 'caps' && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted)]" />}
        </div>
        {caps ? (
          <div className="flex flex-wrap gap-2">
            {fmtCap(caps.is_elevated, 'Administrador', caps.is_elevated ? 'recursos completos' : 'rode como admin p/ backup e restauração')}
            {fmtCap(caps.restore_point, 'Ponto de restauração', caps.restore_note)}
            {fmtCap(caps.backup_drivers, 'Backup de drivers', caps.pnputil_available ? 'pnputil disponível' : 'pnputil não encontrado')}
            {fmtCap(caps.powershell_available, 'PowerShell', '')}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">verificando…</p>
        )}
      </div>

      {status && (
        <div className={`card p-4 border-l-4 ${status.type === 'ok' ? 'border-l-[var(--success)]' : 'border-l-[var(--danger)]'}`}>
          <div className="flex items-center gap-2">
            {status.type === 'ok' ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" /> : <XCircle className="w-4 h-4 text-[var(--danger)]" />}
            <span className="text-sm">{status.msg}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-1.5 flex-1 max-w-md">
          <Search className="w-4 h-4 text-[var(--muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar dispositivo, fabricante ou versão…"
            className="bg-transparent outline-none text-sm text-[var(--fg)] placeholder-[var(--muted)] w-full"
          />
        </div>
        <span className="text-sm text-[var(--muted)]">{filtered.length} de {drivers.length}</span>
      </div>

      <div className="space-y-2">
        {op === 'scan' ? (
          <div className="card p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)] mx-auto mb-2" />
            <p className="text-sm text-[var(--muted)]">Escaneando drivers instalados via WMI…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <Cpu className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm text-[var(--muted)]">Nenhum driver encontrado</p>
          </div>
        ) : (
          filtered.slice(0, 200).map((d, i) => (
            <div key={d.inf_name + d.name + i} className="card p-4 flex items-center gap-4">
              <Cpu className="w-5 h-5 text-[var(--muted)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-xs text-[var(--muted)]">
                  {d.manufacturer && <>{d.manufacturer} · </>}
                  v{d.version} {d.driver_date && `· ${d.driver_date}`}
                </div>
                <div className="text-xs text-[var(--muted)] font-mono truncate">{d.inf_name}{d.device_class && ` · ${d.device_class}`}</div>
              </div>
              {d.is_signed
                ? <span title="Assinado"><CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" /></span>
                : <span title="Não assinado"><XCircle className="w-4 h-4 text-[var(--warning)] shrink-0" /></span>}
              <button onClick={() => searchWeb(d)} className="btn-secondary !text-xs flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> Buscar na web
              </button>
            </div>
          ))
        )}
      </div>
      {filtered.length > 200 && (
        <p className="text-xs text-[var(--muted)] text-center">mostrando os primeiros 200 de {filtered.length} — refine a busca</p>
      )}
    </div>
  )
}