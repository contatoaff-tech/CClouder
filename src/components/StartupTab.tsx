import { ReactNode, useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sparkles, Play, Pause, Trash2, ExternalLink, FolderOpen, ChevronDown, ChevronUp, Search, Filter, Loader2, CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw } from 'lucide-react'

interface StartupItem {
  name: string
  path: string
  enabled: boolean
  location: string
}

interface StartupTabProps {
  items: StartupItem[]
  onToggle: (path: string, enable: boolean) => void
  onRefresh: () => void
  loading: boolean
}

export default function StartupTab({ items, onToggle, onRefresh, loading }: StartupTabProps) {
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const filteredItems = items.filter(item => {
    if (filter === 'enabled' && !item.enabled) return false
    if (filter === 'disabled' && item.enabled) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !item.path.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const enabledCount = items.filter(i => i.enabled).length
  const disabledCount = items.filter(i => !i.enabled).length

  return (
    <div className="space-y-4 anim-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Gerenciador de Inicialização</h2>
          <p className="text-[var(--muted)]">Controle quais programas iniciam com o Windows</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading} className="btn-secondary flex items-center gap-2">
            <Sparkles className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg">
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--muted)]">Total:</span>
          <span className="px-3 py-1 bg-[var(--bg)] rounded-lg text-sm font-medium text-[var(--fg)]">{items.length}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--muted)]">Habilitados:</span>
          <span className="px-3 py-1 bg-[var(--success)]/20 text-[var(--success)] rounded-lg text-sm font-medium">{enabledCount}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--muted)]">Desabilitados:</span>
          <span className="px-3 py-1 bg-[var(--muted)]/20 text-[var(--muted)] rounded-lg text-sm font-medium">{disabledCount}</span>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou caminho..."
              className="input pl-10"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--muted)]" />
          <select value={filter} onChange={e => setFilter(e.target as any)} className="input py-1.5 w-auto">
            <option value="all">Todos</option>
            <option value="enabled">Habilitados</option>
            <option value="disabled">Desabilitados</option>
          </select>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{search || filter !== 'all' ? 'Nenhum item encontrado' : 'Nenhum item de inicialização detectado'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-10"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Editora / Caminho</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-32">Localização</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-28">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-40">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredItems.map((item, index) => (
                  <StartupRow
                    key={`${item.location}-${item.name}-${index}`}
                    item={item}
                    index={index}
                    expanded={expanded[item.name]}
                    onToggleExpand={() => setExpanded(prev => ({ ...prev, [item.name]: !prev[item.name] }))}
                    onToggle={onToggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ScheduledTasksSection />
    </div>
  )
}

function StartupRow({
  item,
  index,
  expanded,
  onToggleExpand,
  onToggle
}: {
  item: StartupItem
  index: number
  expanded: boolean
  onToggleExpand: () => void
  onToggle: (path: string, enable: boolean) => void
}) {
  return (
    <tr className="hover:bg-[var(--card-hover)] transition-colors">
      <td className="px-4 py-3 text-center text-[var(--muted)]">
        {index + 1}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleExpand}
            className="p-1 text-[var(--muted)] hover:text-[var(--fg)]"
            aria-label={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--fg)] truncate">{item.name}</p>
            {expanded && (
              <p className="text-xs text-[var(--muted)] truncate font-mono">{item.path}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--muted)] font-mono truncate max-w-[300px]">
        {item.path}
      </td>
      <td className="px-4 py-3">
        <span className="px-2 py-1 text-xs bg-[var(--card)] border border-[var(--border)] rounded font-mono">
          {item.location}
        </span>
      </td>
      <td className="px-4 py-3">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={e => onToggle(item.path, e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-[var(--border)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--accent)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
        </label>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost p-1.5"
            aria-label="Abrir localização do arquivo"
            title="Abrir localização"
            onClick={() => invoke('open_folder', { path: item.path }).catch(() => { })}
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            className="btn-ghost p-1.5"
            aria-label="Pesquisar online"
            title="Pesquisar online"
            onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(item.name)}`, '_blank')}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
// ==================== Tarefas Agendadas de Logon/Boot (v1.2) ====================

interface ScheduledTask {
  name: string
  tpath: string
  state: string
  action: string
}

function ScheduledTasksSection() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTasks(await invoke<ScheduledTask[]>('get_scheduled_tasks'))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (t: ScheduledTask) => {
    const enable = t.state !== 'Disabled'
    if (!enable && !window.confirm(`Desabilitar a tarefa agendada "${t.name}"?

Tarefas de sistema (\Microsoft\) podem afetar atualizações e serviços do Windows. Você pode reabilitar depois.`)) return
    setBusy(t.tpath + t.name)
    try {
      await invoke('toggle_scheduled_task', { tpath: t.tpath, name: t.name, enable: !enable })
      await load()
    } catch (e) {
      window.alert('Não foi possível alterar a tarefa. Tente executar como administrador.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-5 space-y-3 anim-fade-in">
      <div className="flex items-center gap-3">
        <Clock className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Tarefas Agendadas (logon / boot)</h3>
        <span className="text-sm text-[var(--muted)]">{tasks.length}</span>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="btn-ghost !p-2" title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={() => setExpanded(e => !e)} className="btn-ghost !text-xs">
          {expanded ? 'Recolher' : 'Expandir'}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">consultando agendador do Windows…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">nenhuma tarefa de logon/boot encontrada</p>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto scrollbar-thin">
          {(expanded ? tasks : tasks.slice(0, 8)).map(t => {
            const disabled = t.state === 'Disabled'
            return (
              <div key={t.tpath + t.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                <button
                  onClick={() => toggle(t)}
                  disabled={busy === t.tpath + t.name}
                  className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${disabled ? 'bg-[var(--border)]' : 'bg-[var(--success)]'}`}
                  title={disabled ? 'Habilitar' : 'Desabilitar'}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${disabled ? 'left-0.5' : 'left-4'}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{t.name}</div>
                  <div className="text-xs text-[var(--muted)] font-mono truncate" title={t.action}>{t.action || t.tpath}</div>
                </div>
                <span className="text-xs text-[var(--accent)] shrink-0 hidden sm:block">{t.tpath}</span>
              </div>
            )
          })}
          {!expanded && tasks.length > 8 && (
            <p className="text-xs text-[var(--muted)] text-center py-1">… mais {tasks.length - 8} tarefas</p>
          )}
        </div>
      )}
      <p className="text-xs text-[var(--muted)]">tarefas do sistema (\Microsoft\) podem exigir administrador para alterar</p>
    </div>
  )
}
