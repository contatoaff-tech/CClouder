import { ReactNode } from 'react'
import { ChevronRight, ChevronDown, CheckSquare, Square, MinusSquare, HardDrive, Zap, Sparkles, Database, Wrench, Rocket, Trash2, Settings, Cpu, Files, Activity } from 'lucide-react'

interface Tab {
  id: string
  label: string
  icon: ReactNode
}

interface CleanCategory {
  id: string
  name: string
  description: string
  items: any[]
  checked: boolean
}

interface SidebarProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (tab: string) => void
  categories: CleanCategory[]
  onToggleCategory: (id: string) => void
  scanning: boolean
  onScan: () => void
  selectedCount: number
  totalSize: number
}

const tabIcons: Record<string, ReactNode> = {
  cleaner: <Sparkles className="w-5 h-5" />,
  registry: <Database className="w-5 h-5" />,
  drivers: <Cpu className="w-5 h-5" />,
  files: <Files className="w-5 h-5" />,
  processes: <Activity className="w-5 h-5" />,
  tools: <Wrench className="w-5 h-5" />,
  startup: <Rocket className="w-5 h-5" />,
  uninstall: <Trash2 className="w-5 h-5" />,
  disk: <HardDrive className="w-5 h-5" />,
  settings: <Settings className="w-5 h-5" />,
}

export default function Sidebar({
  tabs,
  activeTab,
  onTabChange,
  categories,
  onToggleCategory,
  scanning,
  onScan,
  selectedCount,
  totalSize
}: SidebarProps) {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatNumber = (num: number) => new Intl.NumberFormat('pt-BR').format(num)

  const selectableCategories = categories.filter(c => activeTab === 'registry' ? c.id === 'registry' : c.id !== 'registry')
  const allChecked = selectableCategories.length > 0 && selectableCategories.every(c => c.items.every(i => i.checked))
  const someChecked = selectableCategories.some(c => c.items.some(i => i.checked))

  return (
    <aside className="w-72 bg-[var(--sidebar)] border-r border-[var(--border)] flex flex-col glass">
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--accent)] to-blue-600 flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--fg)]">CClouder</h1>
            <p className="text-xs text-[var(--muted)]">Open Source Cleaner</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1" role="navigation" aria-label="Navegação principal">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id as any)}
            className={`w-full sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tabIcons[tab.id] || tab.icon}
            <span className="font-medium">{tab.label}</span>
          </button>
        ))}
      </nav>

      {activeTab === 'cleaner' || activeTab === 'registry' ? (
        <div className="p-3 border-t border-[var(--border)] space-y-3 anim-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg)]">Categorias</h3>
            <button
              onClick={() => selectableCategories.forEach(c => {
                const shouldCheck = !allChecked
                if (c.items.some(i => i.checked !== shouldCheck)) onToggleCategory(c.id)
              })}
              className="text-xs text-[var(--accent)] hover:underline"
              aria-label={allChecked ? 'Desmarcar todas' : 'Marcar todas'}
            >
              {allChecked ? 'Desmarcar todas' : someChecked ? 'Marcar todas' : 'Selecionar todas'}
            </button>
          </div>

          <div className="space-y-1 max-h-[300px] overflow-y-auto scrollbar-thin">
            {selectableCategories.map(cat => (
              <div key={cat.id} className="group">
                <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--card)] cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={cat.checked}
                    onChange={() => onToggleCategory(cat.id)}
                    className="w-4 h-4 accent-[var(--accent)] rounded border-[var(--border)] bg-[var(--card)] focus:ring-[var(--accent)]"
                    aria-label={cat.name}
                  />
                  <span className="text-sm font-medium text-[var(--fg)] flex-1 truncate">{cat.name}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {cat.items.filter(i => i.checked).length}/{cat.items.length}
                  </span>
                </label>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-[var(--border)]">
            <button
              onClick={onScan}
              disabled={scanning}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {scanning ? (
                <>
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Escaneando...</span>
                </>
              ) : (
                <>
                  <HardDrive className="w-5 h-5" />
                  <span>Analisar</span>
                </>
              )}
            </button>

            {selectedCount > 0 && (
              <div className="mt-3 p-3 bg-[var(--card)] rounded-lg border border-[var(--border)]">
                <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                  <span>Itens selecionados</span>
                  <span className="text-[var(--fg)] font-medium">{formatNumber(selectedCount)}</span>
                </div>
                <div className="flex justify-between text-xs text-[var(--muted)]">
                  <span>Tamanho estimado</span>
                  <span className="text-[var(--accent)] font-medium">{formatBytes(totalSize)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="p-3 border-t border-[var(--border)]">
        <div className="text-xs text-[var(--muted)] text-center">
          CClouder v1.6.0 — MIT License
        </div>
      </div>
    </aside>
  )
}