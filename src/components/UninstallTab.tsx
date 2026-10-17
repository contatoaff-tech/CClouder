import { ReactNode, useState } from 'react'
import { Trash2, Search, Filter, Loader2, Package, RefreshCw, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react'

interface InstalledProgram {
  name: string
  version: string
  publisher: string
  install_date: string
  size: string
  uninstall_string: string
}

interface UninstallTabProps {
  programs: InstalledProgram[]
  onUninstall: (name: string) => void
  onRefresh: () => void
  loading: boolean
}

export default function UninstallTab({ programs, onUninstall, onRefresh, loading }: UninstallTabProps) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const sortedPrograms = [...programs].sort((a, b) => {
    let aVal: any, bVal: any
    switch (sortBy) {
      case 'name':
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        break
      case 'size':
        aVal = parseSize(a.size)
        bVal = parseSize(b.size)
        break
      case 'date':
        aVal = new Date(a.install_date).getTime()
        bVal = new Date(b.install_date).getTime()
        break
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const filteredPrograms = sortedPrograms.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.publisher.toLowerCase().includes(search.toLowerCase())
  )

  function parseSize(size: string): number {
    const match = size.match(/([\d.]+)\s*(KB|MB|GB)?/i)
    if (!match) return 0
    const num = parseFloat(match[1])
    const unit = match[2]?.toUpperCase() || 'KB'
    const multipliers: Record<string, number> = { KB: 1, MB: 1024, GB: 1024 * 1024 }
    return num * (multipliers[unit] || 1)
  }

  function formatDate(dateStr: string): string {
    if (!dateStr || dateStr.length !== 8) return 'Desconhecido'
    try {
      const year = dateStr.slice(0, 4)
      const month = dateStr.slice(4, 6)
      const day = dateStr.slice(6, 8)
      return `${day}/${month}/${year}`
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-4 anim-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--fg)]">Desinstalar Programas</h2>
          <p className="text-[var(--muted)]">Gerencie programas instalados no sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg">
        <div className="flex-1 min-w-[250px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar programa..."
              className="input pl-10"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--muted)]" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target as any)}
            className="input py-1.5 w-auto"
          >
            <option value="name">Nome</option>
            <option value="size">Tamanho</option>
            <option value="date">Data de instalação</option>
          </select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="btn-ghost p-1.5"
            aria-label={sortDir === 'asc' ? 'Ordem decrescente' : 'Ordem crescente'}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Package className="w-4 h-4" />
          <span>{filteredPrograms.length} de {programs.length} programas</span>
        </div>
      </div>

      {filteredPrograms.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{search ? 'Nenhum programa encontrado' : 'Nenhum programa instalado detectado'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
                    <button
                      onClick={() => { setSortBy('name'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
                      className="flex items-center gap-1 hover:text-[var(--fg)]"
                    >
                      Nome {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-32">
                    <button
                      onClick={() => { setSortBy('size'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
                      className="flex items-center gap-1 hover:text-[var(--fg)]"
                    >
                      Tamanho {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-40">
                    <button
                      onClick={() => { setSortBy('date'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
                      className="flex items-center gap-1 hover:text-[var(--fg)]"
                    >
                      Instalado em {sortBy === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Editora</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-36">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredPrograms.map((program, index) => (
                  <ProgramRow
                    key={program.uninstall_string || program.name + index}
                    program={program}
                    onUninstall={onUninstall}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ProgramRow({
  program,
  onUninstall
}: {
  program: InstalledProgram
  onUninstall: (name: string) => void
}) {
  function formatDate(dateStr: string): string {
    if (!dateStr || dateStr.length !== 8) return 'Desconhecido'
    try {
      const year = dateStr.slice(0, 4)
      const month = dateStr.slice(4, 6)
      const day = dateStr.slice(6, 8)
      return `${day}/${month}/${year}`
    } catch {
      return dateStr
    }
  }

  return (
    <tr className="hover:bg-[var(--card-hover)] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <p className="font-medium text-[var(--fg)] truncate max-w-[300px]">{program.name}</p>
            {program.version && <p className="text-xs text-[var(--muted)]">v{program.version}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--fg)] font-mono">{program.size || 'Desconhecido'}</td>
      <td className="px-4 py-3 text-sm text-[var(--muted)]">{formatDate(program.install_date)}</td>
      <td className="px-4 py-3 text-sm text-[var(--muted)] truncate max-w-[200px]">{program.publisher || 'Desconhecido'}</td>
      <td className="px-4 py-3">
        <button
          onClick={() => onUninstall(program.name)}
          className="btn-danger text-sm flex items-center gap-1"
          disabled={!program.uninstall_string}
        >
          <Trash2 className="w-4 h-4" />
          Desinstalar
        </button>
      </td>
    </tr>
  )
}