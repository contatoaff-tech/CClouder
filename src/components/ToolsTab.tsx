import { ReactNode, useState, useEffect, useCallback } from 'react'
import { Wrench, Terminal, Shield, Download, RefreshCw, ExternalLink, Info, CheckCircle, AlertTriangle, Cpu, MemoryStick, Monitor, HardDrive, Network, Settings, Zap, Sparkles, Database, Rocket, Trash2, MousePointerClick, Loader2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

interface Tool {
  id: string
  name: string
  description: string
  icon: ReactNode
  category: 'system' | 'maintenance' | 'advanced'
  action: () => Promise<void>
  danger?: boolean
}

export default function ToolsTab() {
  const [tools, setTools] = useState<Tool[]>([
    {
      id: 'disk_cleanup',
      name: 'Limpeza de Disco (Windows)',
      description: 'Abre a ferramenta nativa cleanmgr do Windows',
      icon: <Sparkles className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        await invoke('open_folder', { path: 'cleanmgr' })
        // Fallback: executar cleanmgr via shell
      },
      danger: false
    },
    {
      id: 'defrag',
      name: 'Desfragmentar e Otimizar Unidades',
      description: 'Abre o otimizador de unidades do Windows',
      icon: <HardDrive className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // dfrgui
      },
      danger: false
    },
    {
      id: 'system_file_checker',
      name: 'Verificador de Arquivos do Sistema (SFC)',
      description: 'Executa sfc /scannow para reparar arquivos de sistema corrompidos',
      icon: <Shield className="w-5 h-5" />,
      category: 'maintenance',
      action: async () => {
        // sfc /scannow
      },
      danger: false
    },
    {
      id: 'dism',
      name: 'DISM - Restaurar Imagem do Windows',
      description: 'Repara o armazenamento de componentes do Windows',
      icon: <RefreshCw className="w-5 h-5" />,
      category: 'maintenance',
      action: async () => {
        // DISM /Online /Cleanup-Image /RestoreHealth
      },
      danger: false
    },
    {
      id: 'disk_check',
      name: 'Verificar Disco (CHKDSK)',
      description: 'Verifica e corrige erros no sistema de arquivos',
      icon: <CheckCircle className="w-5 h-5" />,
      category: 'maintenance',
      action: async () => {
        // chkdsk /f /r
      },
      danger: true
    },
    {
      id: 'task_manager',
      name: 'Gerenciador de Tarefas',
      description: 'Abre o Gerenciador de Tarefas do Windows',
      icon: <Cpu className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // taskmgr
      },
      danger: false
    },
    {
      id: 'resource_monitor',
      name: 'Monitor de Recursos',
      description: 'Monitora CPU, memória, disco e rede em tempo real',
      icon: <MemoryStick className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // resmon
      },
      danger: false
    },
    {
      id: 'event_viewer',
      name: 'Visualizador de Eventos',
      description: 'Visualiza logs de sistema, aplicação e segurança',
      icon: <Info className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // eventvwr
      },
      danger: false
    },
    {
      id: 'services',
      name: 'Serviços',
      description: 'Gerencia serviços do Windows',
      icon: <Settings className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // services.msc
      },
      danger: false
    },
    {
      id: 'registry_editor',
      name: 'Editor do Registro',
      description: 'Edita o registro do Windows (use com extrema cautela)',
      icon: <Database className="w-5 h-5" />,
      category: 'advanced',
      action: async () => {
        // regedit
      },
      danger: true
    },
    {
      id: 'group_policy',
      name: 'Editor de Políticas de Grupo',
      description: 'Configura políticas do Windows (Pro/Enterprise)',
      icon: <Shield className="w-5 h-5" />,
      category: 'advanced',
      action: async () => {
        // gpedit.msc
      },
      danger: true
    },
    {
      id: 'system_config',
      name: 'Configuração do Sistema (msconfig)',
      description: 'Configura inicialização, serviços e ferramentas',
      icon: <Zap className="w-5 h-5" />,
      category: 'advanced',
      action: async () => {
        // msconfig
      },
      danger: true
    },
  ])

  const [expandedCategory, setExpandedCategory] = useState<string>('system')

  const categories = [
    { id: 'system', label: 'Sistema', icon: <Monitor className="w-5 h-5" /> },
    { id: 'maintenance', label: 'Manutenção', icon: <Shield className="w-5 h-5" /> },
    { id: 'advanced', label: 'Avançado', icon: <AlertTriangle className="w-5 h-5" /> },
  ]

  const handleRunTool = async (tool: Tool) => {
    try {
      await tool.action()
    } catch (e) {
      console.error('Erro ao executar ferramenta:', e)
    }
  }

  return (
    <div className="space-y-6 anim-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-[var(--fg)]">Ferramentas do Sistema</h2>
        <p className="text-[var(--muted)]">Acesso rápido às utilidades nativas do Windows</p>
      </div>

      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto pb-2">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setExpandedCategory(cat.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              expandedCategory === cat.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card)]'
            }`}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools
          .filter(t => t.category === expandedCategory)
          .map(tool => (
            <ToolCard key={tool.id} tool={tool} onRun={handleRunTool} />
          ))}
      </div>

      {tools.filter(t => t.category === expandedCategory).length === 0 && (
        <div className="text-center py-12 text-[var(--muted)]">
          <Wrench className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma ferramenta nesta categoria</p>
        </div>
      )}

      <ContextMenuManager />

      <DevCleanerCard />
    </div>
  )
}

function ToolCard({ tool, onRun }: { tool: Tool; onRun: (tool: Tool) => void }) {
  return (
    <button
      onClick={() => onRun(tool)}
      className="card p-5 flex flex-col gap-3 hover:border-[var(--accent)] transition-all duration-200 group"
      disabled={tool.danger}
    >
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
          tool.danger ? 'bg-[var(--danger)]/20 text-[var(--danger)]' : 'bg-[var(--accent)]/20 text-[var(--accent)]'
        }`}>
          {tool.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--fg)] truncate">{tool.name}</h3>
          {tool.danger && (
            <span className="px-2 py-0.5 text-xs bg-[var(--danger)]/20 text-[var(--danger)] rounded-full">
              Perigoso
            </span>
          )}
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] flex-1">{tool.description}</p>
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <span className="text-xs text-[var(--muted)]">
          {tool.danger ? 'Requer confirmação' : 'Clique para executar'}
        </span>
        <span className="text-[var(--accent)] text-sm font-medium group-hover:translate-x-1 transition-transform">
          Executar →
        </span>
      </div>
    </button>
  )
}
// ==================== Gerenciador de Menu de Contexto (v1.2) ====================

interface CtxHandler {
  name: string
  location: string
  key: string
  clsid: string
  dll: string
  enabled: boolean
  reg_path: string
}

function ContextMenuManager() {
  const [handlers, setHandlers] = useState<CtxHandler[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHandlers(await invoke<CtxHandler[]>('get_context_menu'))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (h: CtxHandler) => {
    setBusyKey(h.reg_path)
    try {
      await invoke('toggle_context_menu', { location: h.location, key: h.key, enable: !h.enabled })
      await load()
    } catch (e) {
      alert(String(e))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <MousePointerClick className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Menu de Contexto</h3>
        <span className="text-xs text-[var(--muted)]">extensões do botão direito (blocos de terceiros que deixam o menu lento)</span>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="btn-ghost !p-2" title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">carregando handlers…</p>
      ) : handlers.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">nenhum handler encontrado</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto scrollbar-thin">
          {handlers.map(h => (
            <div key={h.reg_path} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <button
                onClick={() => toggle(h)}
                disabled={busyKey === h.reg_path}
                className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${h.enabled ? 'bg-[var(--success)]' : 'bg-[var(--border)]'}`}
                title={h.enabled ? 'Clique para desabilitar' : 'Clique para habilitar'}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${h.enabled ? 'left-4' : 'left-0.5'}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{h.name}</div>
                <div className="text-xs text-[var(--muted)] font-mono truncate" title={h.dll || h.clsid}>{h.dll || h.clsid}</div>
              </div>
              <span className="text-xs text-[var(--accent)] shrink-0">{h.location}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-[var(--muted)]">desabilitar é reversível (prefixo “-” no CLSID, com backup automático)</p>
    </div>
  )
}

// ==================== Dev Cleaner (v1.5) ====================

interface DevCache {
  id: string
  name: string
  path: string
  size: number
  count: number
  kind: string
  detail?: string
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

function DevCleanerCard() {
  const [items, setItems] = useState<DevCache[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await invoke<{ items: DevCache[]; total: number }>('scan_dev_caches')
      setItems(r.items)
      setTotal(Number(r.total))
    } catch (e) {
      setStatus(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const clean = async (c: DevCache) => {
    if (!confirm(`Limpar ${c.name} (${fmtSize(Number(c.size))})? Os caches serão recriados pelas ferramentas.`)) return
    setBusy(c.id)
    setStatus(null)
    try {
      const r = await invoke<{ ok: boolean; freed_bytes: number; count: number; output?: string }>('clean_dev_cache', { id: c.id })
      setStatus(`${c.name}: ${fmtSize(Number(r.freed_bytes))} liberados${r.output ? ` · ${r.output.slice(0, 90)}` : ''}`)
      await load()
    } catch (e) {
      setStatus(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <HardDrive className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Dev Cleaner</h3>
        <span className="text-xs text-[var(--muted)]">caches de npm, pip, NuGet, Cargo, Gradle, Yarn, pnpm, Go, VS Code e Docker</span>
        <div className="flex-1" />
        {total > 0 && <span className="text-sm text-[var(--accent)] font-medium">{fmtSize(total)}</span>}
        <button onClick={load} disabled={loading} className="btn-ghost !p-2" title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {status && <p className="text-xs text-[var(--muted)]">{status}</p>}
      {loading ? (
        <p className="text-sm text-[var(--muted)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> medindo caches…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nenhum cache de desenvolvimento encontrado.</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto scrollbar-thin">
          {items.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{c.name}</div>
                <div className="text-xs text-[var(--muted)] font-mono truncate" title={c.path}>{c.path}</div>
                {c.detail && <div className="text-xs text-[var(--muted)] font-mono whitespace-pre-line">{c.detail}</div>}
              </div>
              <span className="text-xs text-[var(--muted)] font-mono shrink-0">
                {c.kind === 'docker' ? 'via CLI' : fmtSize(Number(c.size))}
              </span>
              <button
                onClick={() => clean(c)}
                disabled={busy !== null}
                className="btn-secondary !py-1 !text-xs flex items-center gap-1"
              >
                {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Limpar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
