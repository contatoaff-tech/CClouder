import { ReactNode, useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronDown, ChevronUp, CheckSquare, Square, MinusSquare, Trash2, Database, FolderOpen, AlertCircle, CheckCircle, History, Loader2, RotateCcw } from 'lucide-react'

interface CleanItem {
  id: string
  name: string
  path: string
  size: number
  count: number
  checked: boolean
  is_registry: boolean
}

interface CleanCategory {
  id: string
  name: string
  description: string
  items: CleanItem[]
  checked: boolean
}

interface RegistryTabProps {
  categories: CleanCategory[]
  onToggleItem: (catId: string, itemId: string) => void
  onSelectAll: (checked: boolean) => void
  scanning: boolean
  cleaning: boolean
  onClean: () => void
  totalSelected: number
  totalSize: number
  formatBytes: (bytes: number) => string
  formatNumber: (num: number) => string
}

export default function RegistryTab({
  categories,
  onToggleItem,
  onSelectAll,
  scanning,
  cleaning,
  onClean,
  totalSelected,
  totalSize,
  formatBytes,
  formatNumber
}: RegistryTabProps) {
  const registryCats = categories.filter(c => c.id === 'registry')
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(registryCats.map(c => [c.id, true]))
  )

  const allChecked = registryCats.every(c => c.items.every(i => i.checked))
  const someChecked = registryCats.some(c => c.items.some(i => i.checked))

  return (
    <div className="space-y-4 anim-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Limpeza do Registro</h2>
          <p className="text-[var(--muted)]">⚠ Cuidado: alterações no registro podem afetar a estabilidade do sistema. Faça backup antes.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectAll(!allChecked)}
            className="btn-secondary text-sm flex items-center gap-2"
            aria-label={allChecked ? 'Desmarcar todos' : 'Marcar todos'}
          >
            {allChecked ? <CheckSquare className="w-4 h-4" /> : someChecked ? <MinusSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            <span>{allChecked ? 'Desmarcar todos' : 'Marcar todos'}</span>
          </button>
          <button
            onClick={onClean}
            disabled={totalSelected === 0 || cleaning || scanning}
            className="btn-danger flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>Corrigir Selecionados</span>
          </button>
        </div>
      </div>

      <div className="p-4 bg-[var(--card)] border border-[var(--warning)]/50 rounded-lg border-l-4 border-[var(--warning)]">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--fg)]">
            <p className="font-medium text-[var(--warning)] mb-1">Atenção: Limpeza de Registro</p>
            <p>O CClouder detecta entradas órfãs e inválidas, mas <strong>não remove automaticamente</strong> por segurança. Use esta aba para:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Identificar chaves problemáticas</li>
              <li>Exportar lista para revisão manual</li>
              <li>Usar ferramentas nativas (regedit) com cautela</li>
            </ul>
            <p className="mt-2">Recomendamos criar um ponto de restauração antes de qualquer alteração no registro.</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {registryCats.map(cat => (
          <CategorySection
            key={cat.id}
            category={cat}
            icon={<Database className="w-5 h-5" />}
            expanded={expanded[cat.id]}
            onToggleExpand={() => setExpanded(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
            onToggleItem={onToggleItem}
            formatBytes={formatBytes}
            formatNumber={formatNumber}
          />
        ))}
      </div>

      {registryCats.length === 0 && (
        <div className="text-center py-12 text-[var(--muted)]">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Execute uma análise para ver itens do registro</p>
        </div>
      )}
    </div>
  )
}

function CategorySection({
  category,
  icon,
  expanded,
  onToggleExpand,
  onToggleItem,
  formatBytes,
  formatNumber
}: {
  category: CleanCategory
  icon: ReactNode
  expanded: boolean
  onToggleExpand: () => void
  onToggleItem: (catId: string, itemId: string) => void
  formatBytes: (bytes: number) => string
  formatNumber: (num: number) => string
}) {
  const checkedCount = category.items.filter(i => i.checked).length
  const totalCount = category.items.length

  return (
    <div className="card anim-slide-up">
      <button
        onClick={onToggleExpand}
        className="category-header w-full text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="text-[var(--accent)]">{icon}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-[var(--fg)]">{category.name}</h3>
            <p className="text-xs text-[var(--muted)]">{category.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={category.checked}
                onChange={() => category.items.forEach(i => onToggleItem(category.id, i.id))}
                className="w-4 h-4 accent-[var(--accent)] rounded border-[var(--border)] bg-[var(--card)]"
              />
            </label>
            <div className="text-xs text-[var(--muted)] w-24 text-right">
              {formatNumber(checkedCount)}/{formatNumber(totalCount)}
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-[var(--border)]">
          {category.items.map(item => (
            <RegistryItemRow
              key={item.id}
              item={item}
              categoryId={category.id}
              onToggle={onToggleItem}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RegistryItemRow({
  item,
  categoryId,
  onToggle
}: {
  item: CleanItem
  categoryId: string
  onToggle: (catId: string, itemId: string) => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="item-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(categoryId, item.id)}
          className="w-4 h-4 accent-[var(--accent)] rounded border-[var(--border)] bg-[var(--card)] flex-shrink-0"
          aria-label={item.checked ? `Desmarcar ${item.name}` : `Marcar ${item.name}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--fg)] truncate">{item.name}</p>
          <p className="text-xs text-[var(--muted)] truncate font-mono">{item.path}</p>
        </div>
      </label>
      <div className="flex items-center gap-2">
        {item.is_registry && (
          <span className="px-2 py-0.5 text-xs bg-[var(--warning)]/20 text-[var(--warning)] rounded-full">
            Registro
          </span>
        )}
      </div>
      {hovered && (
        <button className="btn-ghost p-1.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Detalhes">
          <FolderOpen className="w-4 h-4" />
        </button>
      )}
      <RegistryBackupsCard />
    </div>
  )
}
// ==================== Backups de Registro restauráveis (v1.3) ====================

interface RegBackup {
  file: string
  name: string
  date: string
  size: number
  entries: number
  restorable: boolean
}

function RegistryBackupsCard() {
  const [backups, setBackups] = useState<RegBackup[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBackups(await invoke<RegBackup[]>('list_registry_backups'))
    } catch (e) {
      setStatus(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const restore = async (b: RegBackup) => {
    if (!confirm(`Restaurar o backup ${b.name}? As entradas removidas voltarao ao registro.`)) return
    setBusy(b.file)
    setStatus(null)
    try {
      const r = await invoke<{ restored_values: number; restored_keys: number; skipped: number }>('restore_registry_backup', { file: b.file })
      setStatus(`Restaurado: ${r.restored_values} valores, ${r.restored_keys} chaves${r.skipped ? ` - ${r.skipped} ignorados (backups antigos sem conteudo)` : ''}`)
    } catch (e) {
      setStatus(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <History className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Backups do Registro</h3>
        <span className="text-sm text-[var(--muted)]">{backups.length}</span>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="btn-ghost !p-2" title="Atualizar">
          <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {status && <p className="text-xs text-[var(--muted)]">{status}</p>}
      {loading ? (
        <p className="text-sm text-[var(--muted)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> carregando...</p>
      ) : backups.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nenhum backup ainda - eles sao criados automaticamente antes de cada limpeza de registro.</p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin">
          {backups.map(b => (
            <div key={b.file} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono truncate">{b.name}</div>
                <div className="text-xs text-[var(--muted)]">{b.date} - {b.entries} entradas</div>
              </div>
              <button
                onClick={() => restore(b)}
                disabled={busy !== null}
                className="btn-secondary !py-1 !text-xs flex items-center gap-1"
                title={b.restorable ? 'Restaurar' : 'Backup antigo (conteudo de subchaves nao capturado)'}
              >
                {busy === b.file ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Restaurar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
