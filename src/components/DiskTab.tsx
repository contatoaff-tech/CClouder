import { ReactNode, useState } from 'react'
import { HardDrive, FolderOpen, Search, Loader2, Database, BarChart3, PieChart, ExternalLink, ChevronDown, ChevronUp, AlertTriangle, Info } from 'lucide-react'

interface FolderSize {
  name: string
  path: string
  size: number
  file_count: number
}

interface DiskAnalysis {
  path: string
  total_size: number
  folders: FolderSize[]
}

interface DiskTabProps {
  analysis: DiskAnalysis | null
  onAnalyze: (path: string) => void
  onOpenFolder: (path: string) => void
  analyzing: boolean
  formatBytes: (bytes: number) => string
  formatNumber: (num: number) => string
}

export default function DiskTab({
  analysis,
  onAnalyze,
  onOpenFolder,
  analyzing,
  formatBytes,
  formatNumber
}: DiskTabProps) {
  const [diskPath, setDiskPath] = useState('C:\\')
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [sortBy, setSortBy] = useState<'size' | 'name' | 'count'>('size')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleAnalyze = () => {
    if (diskPath.trim()) {
      onAnalyze(diskPath.trim())
    }
  }

  const sortedFolders = analysis ? [...analysis.folders].sort((a, b) => {
    let aVal: any, bVal: any
    switch (sortBy) {
      case 'name':
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        break
      case 'count':
        aVal = a.file_count
        bVal = b.file_count
        break
      case 'size':
      default:
        aVal = a.size
        bVal = b.size
        break
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
    return 0
  }) : []

  return (
    <div className="space-y-4 anim-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Analisador de Disco</h2>
          <p className="text-[var(--muted)]">Visualize o uso de espaço em disco e encontre pastas grandes</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg">
        <div className="flex items-center gap-3 flex-1 min-w-[300px]">
          <HardDrive className="w-5 h-5 text-[var(--accent)]" />
          <div className="flex-1">
            <label className="block text-xs text-[var(--muted)] mb-1">Caminho para analisar</label>
            <div className="relative">
              <input
                type="text"
                value={diskPath}
                onChange={e => setDiskPath(e.target.value)}
                placeholder="Ex: C:\\ ou D:\\"
                className="input pr-24"
              />
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs px-3 py-1"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    Analisando...
                  </>
                ) : (
                  'Analisar'
                )}
              </button>
            </div>
          </div>
        </div>
        {analysis && (
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[var(--accent)]" />
              <span>Total: <strong className="text-[var(--fg)]">{formatBytes(analysis.total_size)}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[var(--muted)]" />
              <span>Pastas: <strong className="text-[var(--fg)]">{formatNumber(analysis.folders.length)}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[var(--muted)]" />
              <span>Caminho: <strong className="text-[var(--fg)] font-mono text-xs">{analysis.path}</strong></span>
            </div>
          </div>
        )}
      </div>

      {analysis && sortedFolders.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] bg-[var(--card)] flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">Ordenar:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target as any)}
                className="input py-1.5 text-xs w-auto"
              >
                <option value="size">Tamanho</option>
                <option value="name">Nome</option>
                <option value="count">Arquivos</option>
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="btn-ghost p-1.5"
                aria-label={sortDir === 'asc' ? 'Decrescente' : 'Crescente'}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <PieChart className="w-4 h-4" />
              <span>{sortedFolders.length} pastas analisadas</span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--card)] sticky top-0">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-8">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
                    <button
                      onClick={() => { setSortBy('name'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
                      className="flex items-center gap-1 hover:text-[var(--fg)]"
                    >
                      Pasta {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-48">
                    <button
                      onClick={() => { setSortBy('size'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
                      className="flex items-center gap-1 hover:text-[var(--fg)]"
                    >
                      Tamanho {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-36">
                    <button
                      onClick={() => { setSortBy('count'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
                      className="flex items-center gap-1 hover:text-[var(--fg)]"
                    >
                      Arquivos {sortBy === 'count' && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Caminho</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sortedFolders.map((folder, index) => (
                  <FolderRow
                    key={folder.path}
                    folder={folder}
                    index={index + 1}
                    expanded={expandedFolders[folder.path]}
                    onToggleExpand={() => setExpandedFolders(prev => ({ ...prev, [folder.path]: !prev[folder.path] }))}
                    onOpenFolder={onOpenFolder}
                    formatBytes={formatBytes}
                    formatNumber={formatNumber}
                    totalSize={analysis.total_size}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!analysis && (
        <div className="text-center py-16 text-[var(--muted)]">
          <HardDrive className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium text-[var(--fg)] mb-2">Nenhuma análise realizada</h3>
          <p className="mb-4">Digite um caminho acima e clique em "Analisar" para começar</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {['C:\\', 'D:\\', 'E:\\'].map(d => (
              <button
                key={d}
                onClick={() => { setDiskPath(d); handleAnalyze() }}
                className="btn-secondary text-sm"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {analysis && sortedFolders.length === 0 && (
        <div className="text-center py-12 text-[var(--muted)]">
          <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma pasta encontrada ou sem permissão de acesso</p>
        </div>
      )}
    </div>
  )
}

function FolderRow({
  folder,
  index,
  expanded,
  onToggleExpand,
  onOpenFolder,
  formatBytes,
  formatNumber,
  totalSize
}: {
  folder: FolderSize
  index: number
  expanded: boolean
  onToggleExpand: () => void
  onOpenFolder: (path: string) => void
  formatBytes: (bytes: number) => string
  formatNumber: (num: number) => string
  totalSize: number
}) {
  const percentage = totalSize > 0 ? (folder.size / totalSize * 100).toFixed(1) : '0'

  return (
    <tr className="hover:bg-[var(--card-hover)] transition-colors">
      <td className="px-4 py-3 text-center text-[var(--muted)] text-sm">{index}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleExpand}
            className="p-1 text-[var(--muted)] hover:text-[var(--fg)]"
            aria-label={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
            <FolderOpen className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--fg)] truncate">{folder.name}</p>
            <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden mt-1" style={{ width: '100px' }}>
              <div
                className="h-full bg-[var(--accent)] rounded-full"
                style={{ width: `${Math.min(100, parseFloat(percentage))}%` }}
              />
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--fg)] font-mono">{formatBytes(folder.size)}</td>
      <td className="px-4 py-3 text-sm text-[var(--muted)] font-mono">{formatNumber(folder.file_count)}</td>
      <td className="px-4 py-3 text-xs text-[var(--muted)] truncate font-mono max-w-[300px]">{folder.path}</td>
      <td className="px-4 py-3">
        <button
          onClick={() => onOpenFolder(folder.path)}
          className="btn-ghost p-1.5"
          aria-label="Abrir pasta"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )
}