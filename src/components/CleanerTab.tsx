import { ReactNode } from 'react'
import { ChevronDown, ChevronUp, CheckSquare, Square, MinusSquare, Trash2, Sparkles, FolderOpen, Eye, EyeOff, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import HealthCheckCard from './HealthCheckCard'

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

interface CleanerTabProps {
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

const categoryIcons: Record<string, ReactNode> = {
  system: <Sparkles className="w-5 h-5" />,
  browser: <FolderOpen className="w-5 h-5" />,
  apps: <Eye className="w-5 h-5" />,
  registry: <AlertCircle className="w-5 h-5" />,
  advanced: <CheckCircle className="w-5 h-5" />,
}

export default function CleanerTab({
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
}: CleanerTabProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(categories.map(c => [c.id, true]))
  )

  const allChecked = categories.length > 0 && categories.every(c => c.items.every(i => i.checked))
  const someChecked = categories.some(c => c.items.some(i => i.checked))

  return (
    <div className="space-y-4 anim-fade-in">
      <HealthCheckCard />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Limpeza do Sistema</h2>
          <p className="text-[var(--muted)]">Selecione as categorias e itens para escanear e limpar</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectAll(!allChecked)}
            className="btn-secondary text-sm flex items-center gap-2"
            aria-label={allChecked ? 'Desmarcar todos' : 'Marcar todos'}
          >
            {allChecked ? (
              <CheckSquare className="w-4 h-4" />
            ) : someChecked ? (
              <MinusSquare className="w-4 h-4" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            <span>{allChecked ? 'Desmarcar todos' : 'Marcar todos'}</span>
          </button>
          <button
            onClick={onClean}
            disabled={totalSelected === 0 || cleaning || scanning}
            className="btn-danger flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>Limpar {totalSelected > 0 ? `(${formatNumber(totalSelected)})` : ''}</span>
          </button>
        </div>
      </div>

      {totalSelected > 0 && (
        <div className="flex items-center gap-4 p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[var(--muted)]">Itens selecionados</span>
              <span className="text-[var(--fg)] font-medium">{formatNumber(totalSelected)}</span>
            </div>
            <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (totalSize / 1024 / 1024 / 1024) * 100)}%` }}
              />
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-[var(--muted)]">Espaço a liberar</div>
            <div className="text-lg font-bold text-[var(--accent)]">{formatBytes(totalSize)}</div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {categories.map(cat => (
          <CategorySection
            key={cat.id}
            category={cat}
            icon={categoryIcons[cat.id] || <Sparkles className="w-5 h-5" />}
            expanded={expanded[cat.id]}
            onToggleExpand={() => setExpanded(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
            onToggleItem={onToggleItem}
            formatBytes={formatBytes}
            formatNumber={formatNumber}
          />
        ))}
      </div>

      {categories.length === 0 && (
        <div className="text-center py-12 text-[var(--muted)]">
          <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma categoria disponível</p>
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
  const totalSize = category.items.reduce((a, i) => a + i.size, 0)

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
                onChange={() => {
                const checked = category.items.some(i => !i.checked)
                category.items.forEach(i => {
                  if (i.checked !== checked) onToggleItem(category.id, i.id)
                })
              }}
                className="w-4 h-4 accent-[var(--accent)] rounded border-[var(--border)] bg-[var(--card)]"
                aria-label={category.checked ? `Desmarcar ${category.name}` : `Marcar ${category.name}`}
              />
            </label>
            <div className="text-xs text-[var(--muted)] w-24 text-right">
              {formatNumber(checkedCount)}/{formatNumber(totalCount)}
            </div>
            <div className="text-xs text-[var(--muted)] w-28 text-right">
              {formatBytes(totalSize)}
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-[var(--border)]">
          {category.items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              categoryId={category.id}
              onToggle={onToggleItem}
              formatBytes={formatBytes}
              formatNumber={formatNumber}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({
  item,
  categoryId,
  onToggle,
  formatBytes,
  formatNumber
}: {
  item: CleanItem
  categoryId: string
  onToggle: (catId: string, itemId: string) => void
  formatBytes: (bytes: number) => string
  formatNumber: (num: number) => string
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
      <div className="flex items-center gap-4 text-xs text-[var(--muted)] font-mono w-40">
        <span>{formatNumber(item.count)}</span>
        <span>{formatBytes(item.size)}</span>
      </div>
      {hovered && item.size > 0 && (
        <button
          className="btn-ghost p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Abrir pasta"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

import { useState } from 'react'