import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Cpu, Globe, ShieldCheck, Archive, RefreshCw, Search, Loader2,
  CheckCircle2, XCircle, Info, AlertTriangle, Gamepad2, Wrench,
  Download, Volume2, Wifi, Zap
} from 'lucide-react'

interface Driver {
  name: string
  version: string
  manufacturer: string
  device_class: string
  inf_name: string
  driver_date: string
  is_signed: boolean
}

interface HardwareIssue {
  id: string
  name: string
  code: number
  status: string
  description: string
}

interface GameRuntime {
  id: string
  name: string
  category: string
  installed: boolean
  version: string
  winget_id: string
  description: string
}

interface Capabilities {
  is_elevated: boolean
  pnputil_available: boolean
  powershell_available: boolean
  restore_point: boolean
  restore_note: string
  backup_drivers: boolean
}

type SubTab = 'drivers' | 'runtimes' | 'fixes'
type Op = 'none' | 'scan' | 'backup' | 'restore' | 'caps' | 'installing_runtime' | 'fixing_audio' | 'fixing_net'

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
  const [subTab, setSubTab] = useState<SubTab>('drivers')
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [hardwareIssues, setHardwareIssues] = useState<HardwareIssue[]>([])
  const [runtimes, setRuntimes] = useState<GameRuntime[]>([])
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [op, setOp] = useState<Op>('none')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setOp('scan')
    setStatus(null)
    try {
      const [driverList, issues, runtimeList] = await Promise.all([
        invoke<Driver[]>('get_drivers'),
        invoke<HardwareIssue[]>('get_hardware_issues').catch(() => []),
        invoke<GameRuntime[]>('get_game_runtimes').catch(() => [])
      ])
      setDrivers(driverList)
      setHardwareIssues(issues)
      setRuntimes(runtimeList)
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
      setStatus({ type: 'err', msg: 'Erro de verificação: ' + e })
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

  const searchWeb = async (d: Driver | { name: string; manufacturer?: string; version?: string }) => {
    try {
      await invoke('search_driver_web', {
        name: d.name,
        manufacturer: 'manufacturer' in d ? d.manufacturer : '',
        version: 'version' in d ? d.version : ''
      })
    } catch (e) {
      setStatus({ type: 'err', msg: 'Erro ao abrir busca: ' + e })
    }
  }

  const installRuntime = async (r: GameRuntime) => {
    setInstallingId(r.id)
    setStatus({ type: 'ok', msg: `Instalando ${r.name} via winget... Isso pode levar alguns minutos.` })
    try {
      const res = await invoke<{ ok: boolean; output: string }>('install_runtime', { id: r.winget_id })
      if (res.ok) {
        setStatus({ type: 'ok', msg: `${r.name} instalado com sucesso!` })
        const updated = await invoke<GameRuntime[]>('get_game_runtimes').catch(() => [])
        setRuntimes(updated)
      } else {
        setStatus({ type: 'err', msg: `Falha na instalação de ${r.name}: ${res.output}` })
      }
    } catch (e) {
      setStatus({ type: 'err', msg: `Erro ao instalar ${r.name}: ${e}` })
    } finally {
      setInstallingId(null)
    }
  }

  const fixAudio = async () => {
    setOp('fixing_audio')
    setStatus(null)
    try {
      const res = await invoke<{ ok: boolean; message: string }>('fix_hardware_audio')
      setStatus({ type: res.ok ? 'ok' : 'err', msg: res.message })
    } catch (e) {
      setStatus({ type: 'err', msg: 'Erro: ' + e })
    } finally {
      setOp('none')
    }
  }

  const fixNetwork = async () => {
    setOp('fixing_net')
    setStatus(null)
    try {
      const res = await invoke<{ ok: boolean; message: string }>('fix_hardware_network')
      setStatus({ type: res.ok ? 'ok' : 'err', msg: res.message })
    } catch (e) {
      setStatus({ type: 'err', msg: 'Erro: ' + e })
    } finally {
      setOp('none')
    }
  }

  const filtered = drivers.filter(d =>
    !search ||
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.manufacturer.toLowerCase().includes(search.toLowerCase()) ||
    d.version.includes(search))

  const busy = op !== 'none' || installingId !== null

  return (
    <div className="space-y-4 anim-fade-in">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Gerenciador de Drivers & Runtimes</h2>
          <p className="text-[var(--muted)]">Escaneie, diagnostique falhas, instale componentes de jogos e faça backup</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={scan} disabled={busy} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${op === 'scan' ? 'animate-spin' : ''}`} /> Atualizar
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

      {/* Navegação por Sub-abas */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-2 overflow-x-auto">
        <button
          onClick={() => setSubTab('drivers')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subTab === 'drivers'
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card)]'
          }`}
        >
          <Cpu className="w-4 h-4" />
          Dispositivos ({drivers.length})
          {hardwareIssues.length > 0 && (
            <span className="px-1.5 py-0.2 text-xs bg-[var(--danger)] text-white font-bold rounded-full">
              {hardwareIssues.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setSubTab('runtimes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subTab === 'runtimes'
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card)]'
          }`}
        >
          <Gamepad2 className="w-4 h-4" />
          Componentes de Jogos & Runtimes ({runtimes.filter(r => r.installed).length}/{runtimes.length})
        </button>

        <button
          onClick={() => setSubTab('fixes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subTab === 'fixes'
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card)]'
          }`}
        >
          <Wrench className="w-4 h-4" />
          Reparo Rápido de Hardware
        </button>
      </div>

      {/* Verificação de Capacidades */}
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

      {/* Feedback de Status */}
      {status && (
        <div className={`card p-4 border-l-4 ${status.type === 'ok' ? 'border-l-[var(--success)]' : 'border-l-[var(--danger)]'}`}>
          <div className="flex items-center gap-2">
            {status.type === 'ok' ? <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" /> : <XCircle className="w-4 h-4 text-[var(--danger)] shrink-0" />}
            <span className="text-sm">{status.msg}</span>
          </div>
        </div>
      )}

      {/* SUB-ABA: DISPOSITIVOS */}
      {subTab === 'drivers' && (
        <div className="space-y-4">
          {/* Hardware Doctor: Alerta de dispositivos com erro */}
          {hardwareIssues.length > 0 && (
            <div className="card p-4 border border-[var(--danger)]/50 bg-[var(--danger)]/5 space-y-3">
              <div className="flex items-center gap-2 text-[var(--danger)] font-semibold">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Hardware Doctor: {hardwareIssues.length} dispositivo(s) com problema detectado</span>
              </div>
              <div className="space-y-2">
                {hardwareIssues.map((issue) => (
                  <div key={issue.id} className="p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--fg)] truncate">{issue.name}</div>
                      <div className="text-xs text-[var(--danger)] font-medium">
                        Código {issue.code}: {issue.description}
                      </div>
                    </div>
                    <button
                      onClick={() => searchWeb({ name: issue.name })}
                      className="btn-secondary !text-xs flex items-center gap-1.5 shrink-0"
                    >
                      <Globe className="w-3.5 h-3.5" /> Buscar Driver
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Barra de pesquisa */}
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

          {/* Lista de drivers */}
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
      )}

      {/* SUB-ABA: RUNTIMES DE JOGOS & SOFTWARES (Estilo Driver Booster) */}
      {subTab === 'runtimes' && (
        <div className="space-y-4">
          <div className="card p-4 bg-gradient-to-r from-[var(--card)] to-[var(--card-hover)] border border-[var(--border)]">
            <div className="flex items-start gap-3">
              <Gamepad2 className="w-8 h-8 text-[var(--accent)] shrink-0" />
              <div>
                <h3 className="text-lg font-bold text-[var(--fg)]">Componentes Essenciais de Jogos e Softwares</h3>
                <p className="text-sm text-[var(--muted)]">
                  Pacotes de tempo de execução (runtimes) indispensáveis para evitar erros de DLL faltando (ex: VCRUNTIME140.dll, MSVCP140.dll, d3dx9_43.dll) em jogos e aplicações Windows.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {runtimes.map(r => (
              <div key={r.id} className="card p-4 flex flex-col justify-between gap-3 border border-[var(--border)]">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)]">
                      {r.category}
                    </span>
                    {r.installed ? (
                      <span className="flex items-center gap-1 text-xs text-[var(--success)] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Instalado {r.version && `(${r.version})`}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-[var(--warning)] font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" /> Ausente
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--fg)]">{r.name}</h4>
                  <p className="text-xs text-[var(--muted)] mt-1">{r.description}</p>
                </div>

                <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
                  <span className="text-[11px] font-mono text-[var(--muted)]">{r.winget_id}</span>
                  <button
                    onClick={() => installRuntime(r)}
                    disabled={installingId !== null}
                    className="btn-secondary !text-xs flex items-center gap-1.5"
                  >
                    {installingId === r.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Instalando...
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" /> {r.installed ? 'Reinstalar' : 'Instalar'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-ABA: REPARO RÁPIDO DE HARDWARE */}
      {subTab === 'fixes' && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Reparo de Áudio */}
            <div className="card p-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center">
                  <Volume2 className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-[var(--fg)]">Corrigir Áudio Sem Som</h3>
                <p className="text-sm text-[var(--muted)]">
                  Reinicia em cascata o Construtor de Pontos de Extremidade de Áudio e o Serviço de Áudio do Windows (AudioSrv). Resolve travamentos e dispositivos mudos.
                </p>
              </div>
              <button
                onClick={fixAudio}
                disabled={busy}
                className="btn-secondary flex items-center justify-center gap-2 w-full"
              >
                {op === 'fixing_audio' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                Reiniciar Serviços de Áudio
              </button>
            </div>

            {/* Reparo de Rede */}
            <div className="card p-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center">
                  <Wifi className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-[var(--fg)]">Corrigir Conexão de Rede & DNS</h3>
                <p className="text-sm text-[var(--muted)]">
                  Esvazia o cache DNS local, renova a concessão DHCP e redefine a pilha Winsock do Windows para resolver perdas de conexão.
                </p>
              </div>
              <button
                onClick={fixNetwork}
                disabled={busy}
                className="btn-secondary flex items-center justify-center gap-2 w-full"
              >
                {op === 'fixing_net' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                Redefinir Rede & Limpar DNS
              </button>
            </div>
          </div>

          {/* Dica de Reinicialização de Driver de Vídeo */}
          <div className="card p-4 border border-[var(--border)] flex items-center gap-3">
            <Zap className="w-5 h-5 text-[var(--warning)] shrink-0" />
            <div className="text-sm text-[var(--muted)]">
              <strong className="text-[var(--fg)]">Dica para tela piscando ou driver de vídeo travado:</strong> Use o atalho universal nativo do Windows{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--card-hover)] border border-[var(--border)] font-mono text-xs text-[var(--fg)]">
                Win + Ctrl + Shift + B
              </kbd>{' '}
              para reiniciar o driver de vídeo instantaneamente sem fechar suas janelas.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
