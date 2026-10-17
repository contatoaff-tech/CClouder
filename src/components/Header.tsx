import { ReactNode } from 'react'
import { Menu, X, Maximize2, Minimize, Sun, Moon, Monitor, HardDrive, Search, MoreHorizontal, RefreshCw, Info, Github, ExternalLink } from 'lucide-react'
import { useState } from 'react'

interface HeaderProps {
  onAnalyzeDisk: (path: string) => void
  analyzingDisk: boolean
}

export default function Header({ onAnalyzeDisk, analyzingDisk }: HeaderProps) {
  const [showDiskDialog, setShowDiskDialog] = useState(false)
  const [diskPath, setDiskPath] = useState('C:\\')
  const [showMenu, setShowMenu] = useState(false)

  const handleAnalyze = () => {
    if (diskPath.trim()) {
      onAnalyzeDisk(diskPath.trim())
      setShowDiskDialog(false)
    }
  }

  return (
    <header className="h-14 bg-[var(--sidebar)] border-b border-[var(--border)] flex items-center justify-between px-4 glass sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <button
          className="btn-ghost p-2 lg:hidden"
          aria-label="Menu"
          onClick={() => setShowMenu(!showMenu)}
        >
          {showMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <div className="hidden lg:flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-1.5">
          <HardDrive className="w-4 h-4 text-[var(--muted)]" />
          <input
            type="text"
            value={diskPath}
            onChange={e => setDiskPath(e.target.value)}
            placeholder="Caminho do disco (ex: C:\\)"
            className="bg-transparent border-none outline-none text-sm text-[var(--fg)] placeholder-[var(--muted)] w-48"
            aria-label="Caminho do disco"
          />
          <button
            onClick={handleAnalyze}
            disabled={analyzingDisk}
            className="btn-primary text-sm px-3 py-1.5"
            aria-label="Analisar disco"
          >
            {analyzingDisk ? (
              <>
                <svg className="w-4 h-4 animate-spin mr-1" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Analisando...
              </>
            ) : (
                'Analisar'
              )}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1 bg-[var(--card)] border border-[var(--border)] rounded-lg p-1">
          <button className="btn-ghost p-2" aria-label="Tema" title="Tema (breve)">
            <Monitor className="w-4 h-4" />
          </button>
          <button className="btn-ghost p-2" aria-label="Atualizar" title="Verificar atualizações">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <button
            className="btn-ghost p-2"
            onClick={() => setShowMenu(!showMenu)}
            aria-label="Menu principal"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-2 w-56 glass rounded-lg shadow-lg border border-[var(--border)] py-1 anim-fade-in">
              <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--card)] text-[var(--fg)]" onClick={() => setShowMenu(false)}>
                <Github className="w-4 h-4" />
                GitHub
              </button>
              <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--card)] text-[var(--fg)]" onClick={() => setShowMenu(false)}>
                <ExternalLink className="w-4 h-4" />
                Site do Projeto
              </button>
              <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--card)] text-[var(--fg)]" onClick={() => setShowMenu(false)}>
                <Info className="w-4 h-4" />
                Sobre
              </button>
              <hr className="my-1 border-[var(--border)]" />
              <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--card)] text-[var(--danger)]" onClick={() => setShowMenu(false)}>
                <X className="w-4 h-4" />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}