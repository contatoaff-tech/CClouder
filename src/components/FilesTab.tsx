import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Files, Search, Trash2, Flame, Loader2, CheckSquare, Square,
  Copy, HardDrive, ShieldAlert, CheckCircle2, XCircle, Images,
  FolderX, FileX, FileArchive, FolderOpen
} from 'lucide-react'

type Mode = 'duplicates' | 'similar' | 'empty_folders' | 'empty_files' | 'big'

interface DupGroup { size: number; files: string[]; wasted: number }
interface DupResult { root: string; scanned_files: number; scanned_bytes: number; groups: DupGroup[] }
interface SimilarGroup { count: number; total_bytes: number; files: { path: string; size: number }[] }
interface SimilarResult { root: string; threshold: number; scanned: number; groups: SimilarGroup[] }
interface EmptyFoldersResult { root: string; count: number; folders: string[] }
interface EmptyFilesResult { root: string; count: number; files: string[] }
interface BigResult { root: string; count: number; total_bytes: number; files: { path: string; size: number; modified: string }[] }
interface ShredResult { shredded: number; freed_bytes: number; errors: string[] }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

const MODES: { id: Mode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'duplicates', label: 'Duplicatas', icon: <Copy className="w-4 h-4" />, hint: 'arquivos idênticos por hash' },
  { id: 'similar', label: 'Imagens similares', icon: <Images className="w-4 h-4" />, hint: 'fotos parecidas por dHash' },
  { id: 'empty_folders', label: 'Pastas vazias', icon: <FolderX className="w-4 h-4" />, hint: 'diretórios sem conteúdo' },
  { id: 'empty_files', label: 'Arquivos vazios', icon: <FileX className="w-4 h-4" />, hint: 'arquivos de 0 bytes' },
  { id: 'big', label: 'Maiores arquivos', icon: <FileArchive className="w-4 h-4" />, hint: 'top arquivos por tamanho' },
]

export default function FilesTab() {
  const [mode, setMode] = useState<Mode>('duplicates')
  const [root, setRoot] = useState('C:\\Users\\felip')
  const [dupMin, setDupMin] = useState(1048576)
  const [threshold, setThreshold] = useState(5)
  const [bigMin, setBigMin] = useState(10485760)
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  const [dup, setDup] = useState<DupResult | null>(null)
  const [similar, setSimilar] = useState<SimilarResult | null>(null)
  const [emptyFolders, setEmptyFolders] = useState<EmptyFoldersResult | null>(null)
  const [emptyFiles, setEmptyFiles] = useState<EmptyFilesResult | null>(null)
  const [big, setBig] = useState<BigResult | null>(null)

  const clearResults = () => {
    setDup(null); setSimilar(null); setEmptyFolders(null); setEmptyFiles(null); setBig(null)
    setChecked(new Set()); setStatus(null)
  }

  const switchMode = (m: Mode) => { setMode(m); clearResults() }

  const toggle = (p: string) => setChecked(prev => {
    const n = new Set(prev)
    if (n.has(p)) n.delete(p); else n.add(p)
    return n
  })

  const analyze = async () => {
    setScanning(true)
    clearResults()
    try {
      if (mode === 'duplicates') {
        const r = await invoke<DupResult>('find_duplicates', { path: root, min_size: dupMin })
        setDup(r)
        const sel = new Set<string>()
        r.groups.forEach(g => g.files.slice(1).forEach(f => sel.add(f)))
        setChecked(sel)
      } else if (mode === 'similar') {
        const r = await invoke<SimilarResult>('scan_similar_images', { path: root, threshold })
        setSimilar(r)
        const sel = new Set<string>()
        r.groups.forEach(g => g.files.slice(1).forEach(f => sel.add(f.path)))
        setChecked(sel)
      } else if (mode === 'empty_folders') {
        setEmptyFolders(await invoke<EmptyFoldersResult>('scan_empty_folders', { path: root }))
      } else if (mode === 'empty_files') {
        setEmptyFiles(await invoke<EmptyFilesResult>('scan_empty_files', { path: root }))
      } else {
        setBig(await invoke<BigResult>('scan_big_files', { path: root, min_size: bigMin, limit: 100 }))
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) })
    } finally {
      setScanning(false)
    }
  }

  const deleteChecked = async () => {
    if (checked.size === 0) return
    if (!confirm(`Excluir ${checked.size} item(ns) permanentemente?`)) return
    setDeleting(true)
    try {
      const r = await invoke<{ deleted: number; freed_bytes: number; errors: string[] }>('delete_files', { paths: [...checked] })
      setStatus({
        ok: true,
        msg: `${r.deleted} itens excluídos · ${fmtBytes(r.freed_bytes)} liberados${r.errors.length ? ` · ${r.errors.length} falharam` : ''}`,
      })
      setChecked(new Set())
      await analyze()
    } catch (e) {
      setStatus({ ok: false, msg: String(e) })
    } finally {
      setDeleting(false)
    }
  }

  const checkAll = (paths: string[]) => setChecked(new Set(paths))

  const openFolder = (p: string) => {
    const dir = p.includes('\\') ? p.slice(0, p.lastIndexOf('\\')) : p
    invoke('open_folder', { path: dir }).catch(() => { })
  }

  // ---------- shredder ----------
  const [shredInput, setShredInput] = useState('')
  const [shredList, setShredList] = useState<string[]>([])
  const [shredding, setShredding] = useState(false)
  const [shredStatus, setShredStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const addShred = () => {
    const p = shredInput.trim().replace(/^"|"$/g, '')
    if (p && !shredList.includes(p)) setShredList(l => [...l, p])
    setShredInput('')
  }

  const shred = async () => {
    if (!confirm(`Sobrescrever e apagar PERMANENTEMENTE ${shredList.length} item(ns)? Não há como desfazer.`)) return
    setShredding(true)
    setShredStatus(null)
    try {
      const r = await invoke<ShredResult>('shred_paths', { paths: shredList })
      setShredStatus({
        ok: r.errors.length === 0,
        msg: r.errors.length > 0
          ? `${r.shredded} itens triturados (${fmtBytes(r.freed_bytes)}) · ${r.errors.length} falharam: ${r.errors[0]}`
          : `${r.shredded} itens triturados · ${fmtBytes(r.freed_bytes)} liberados`,
      })
      setShredList([])
    } catch (e) {
      setShredStatus({ ok: false, msg: String(e) })
    } finally {
      setShredding(false)
    }
  }

  const wastedTotal = dup?.groups.reduce((a, g) => a + Number(g.wasted), 0) ?? 0
  const hasResult = (mode === 'duplicates' && dup) || (mode === 'similar' && similar) ||
    (mode === 'empty_folders' && emptyFolders) || (mode === 'empty_files' && emptyFiles) || (mode === 'big' && big)

  return (
    <div className="space-y-5 anim-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-[var(--fg)]">Arquivos</h2>
        <p className="text-[var(--muted)]">Duplicatas, imagens similares, vazios e maiores arquivos</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => switchMode(m.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${mode === m.id
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--fg)]'
              }`}
            title={m.hint}
          >
            {m.icon}{m.label}
          </button>
        ))}
      </div>

      <div className="card p-4 flex flex-wrap gap-2 items-center">
        <input
          value={root}
          onChange={e => setRoot(e.target.value)}
          placeholder="Pasta para analisar…"
          className="input flex-1 min-w-64 font-mono text-sm"
        />
        {mode === 'duplicates' && (
          <select value={dupMin} onChange={e => setDupMin(Number(e.target.value))} className="input w-40 text-sm">
            <option value={0}>Todos os tamanhos</option>
            <option value={1048576}>≥ 1 MB</option>
            <option value={10485760}>≥ 10 MB</option>
            <option value={104857600}>≥ 100 MB</option>
          </select>
        )}
        {mode === 'similar' && (
          <select value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="input w-44 text-sm">
            <option value={0}>Idênticas (0)</option>
            <option value={5}>Similares (5)</option>
            <option value={10}>Parecidas (10)</option>
          </select>
        )}
        {mode === 'big' && (
          <select value={bigMin} onChange={e => setBigMin(Number(e.target.value))} className="input w-40 text-sm">
            <option value={10485760}>≥ 10 MB</option>
            <option value={104857600}>≥ 100 MB</option>
            <option value={1073741824}>≥ 1 GB</option>
          </select>
        )}
        <button onClick={analyze} disabled={scanning} className="btn-primary">
          {scanning ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Search className="w-4 h-4 inline mr-1" />}
          Analisar
        </button>
      </div>

      {status && (
        <div className={`text-sm flex items-center gap-2 ${status.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
          {status.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {status.msg}
        </div>
      )}

      {hasResult && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted)]">
          {mode === 'duplicates' && dup && (
            <>
              <span><HardDrive className="w-3.5 h-3.5 inline mr-1" />{dup.scanned_files} arquivos ({fmtBytes(Number(dup.scanned_bytes))})</span>
              <span className="text-[var(--accent)] font-medium">{dup.groups.length} grupos · {fmtBytes(wastedTotal)} desperdiçados</span>
            </>
          )}
          {mode === 'similar' && similar && (
            <>
              <span><Images className="w-3.5 h-3.5 inline mr-1" />{similar.scanned} imagens analisadas</span>
              <span className="text-[var(--accent)] font-medium">{similar.groups.length} grupos similares</span>
            </>
          )}
          {mode === 'empty_folders' && emptyFolders && (
            <span className="text-[var(--accent)] font-medium">{emptyFolders.count} pastas vazias</span>
          )}
          {mode === 'empty_files' && emptyFiles && (
            <span className="text-[var(--accent)] font-medium">{emptyFiles.count} arquivos vazios</span>
          )}
          {mode === 'big' && big && (
            <span className="text-[var(--accent)] font-medium">{big.count} arquivos ≥ limite · {fmtBytes(Number(big.total_bytes))} no total</span>
          )}
          {checked.size > 0 && (
            <button onClick={deleteChecked} disabled={deleting} className="btn-danger !py-1.5 !text-xs ml-auto">
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : <Trash2 className="w-3.5 h-3.5 inline mr-1" />}
              Excluir selecionados ({checked.size})
            </button>
          )}
        </div>
      )}

      {mode === 'duplicates' && dup && (
        <div className="space-y-3 max-h-[420px] overflow-y-auto scrollbar-thin">
          {dup.groups.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-6">Nenhuma duplicata encontrada ✓</p>
          ) : dup.groups.map((g, gi) => (
            <div key={gi} className="border border-[var(--border)] rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-[var(--card-hover)] flex items-center justify-between text-sm">
                <span className="font-medium">{g.files.length} cópias idênticas</span>
                <span className="text-[var(--muted)]">{fmtBytes(Number(g.size))} cada · desperdiça {fmtBytes(Number(g.wasted))}</span>
              </div>
              {g.files.map((f, fi) => (
                <div key={f} className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border)] hover:bg-[var(--card-hover)]">
                  <button onClick={() => toggle(f)} className="text-[var(--accent)]">
                    {checked.has(f) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-[var(--muted)]" />}
                  </button>
                  <span className="text-xs font-mono truncate flex-1" title={f}>{f}</span>
                  {fi === 0 && <span className="text-xs text-[var(--success)]">manter</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {mode === 'similar' && similar && (
        <div className="space-y-3 max-h-[420px] overflow-y-auto scrollbar-thin">
          {similar.groups.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-6">Nenhuma imagem similar encontrada ✓</p>
          ) : similar.groups.map((g, gi) => (
            <div key={gi} className="border border-[var(--border)] rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-[var(--card-hover)] flex items-center justify-between text-sm">
                <span className="font-medium">{g.count} imagens parecidas</span>
                <span className="text-[var(--muted)]">{fmtBytes(Number(g.total_bytes))} no grupo</span>
              </div>
              {g.files.map((f, fi) => (
                <div key={f.path} className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border)] hover:bg-[var(--card-hover)]">
                  <button onClick={() => toggle(f.path)} className="text-[var(--accent)]">
                    {checked.has(f.path) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-[var(--muted)]" />}
                  </button>
                  <span className="text-xs font-mono truncate flex-1" title={f.path}>{f.path}</span>
                  <span className="text-xs text-[var(--muted)]">{fmtBytes(Number(f.size))}</span>
                  {fi === 0 && <span className="text-xs text-[var(--success)]">manter</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {mode === 'empty_folders' && emptyFolders && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 bg-[var(--card-hover)] flex items-center justify-between text-sm">
            <span>{emptyFolders.count} pastas vazias encontradas</span>
            <button onClick={() => checkAll(emptyFolders.folders)} className="text-[var(--accent)] text-xs">selecionar tudo</button>
          </div>
          <div className="max-h-[380px] overflow-y-auto scrollbar-thin divide-y divide-[var(--border)]">
            {emptyFolders.folders.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-6">Nenhuma pasta vazia ✓</p>
            ) : emptyFolders.folders.map(f => (
              <div key={f} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--card-hover)]">
                <button onClick={() => toggle(f)} className="text-[var(--accent)]">
                  {checked.has(f) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-[var(--muted)]" />}
                </button>
                <span className="text-xs font-mono truncate flex-1" title={f}>{f}</span>
                <button onClick={() => openFolder(f)} className="text-[var(--muted)] hover:text-[var(--accent)]" title="Abrir pasta pai">
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'empty_files' && emptyFiles && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 bg-[var(--card-hover)] flex items-center justify-between text-sm">
            <span>{emptyFiles.count} arquivos de 0 bytes</span>
            <button onClick={() => checkAll(emptyFiles.files)} className="text-[var(--accent)] text-xs">selecionar tudo</button>
          </div>
          <div className="max-h-[380px] overflow-y-auto scrollbar-thin divide-y divide-[var(--border)]">
            {emptyFiles.files.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-6">Nenhum arquivo vazio ✓</p>
            ) : emptyFiles.files.map(f => (
              <div key={f} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--card-hover)]">
                <button onClick={() => toggle(f)} className="text-[var(--accent)]">
                  {checked.has(f) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-[var(--muted)]" />}
                </button>
                <span className="text-xs font-mono truncate flex-1" title={f}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'big' && big && (
        <div className="card overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto scrollbar-thin divide-y divide-[var(--border)]">
            {big.files.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-6">Nenhum arquivo acima do limite ✓</p>
            ) : big.files.map(f => (
              <div key={f.path} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--card-hover)]">
                <FileArchive className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                <span className="text-xs font-mono truncate flex-1" title={f.path}>{f.path}</span>
                <span className="text-xs text-[var(--muted)]">{f.modified}</span>
                <span className="text-xs text-[var(--accent)] font-mono w-20 text-right">{fmtBytes(Number(f.size))}</span>
                <button onClick={() => openFolder(f.path)} className="text-[var(--muted)] hover:text-[var(--accent)]" title="Abrir pasta">
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* shredder */}
      <div className="card p-5 space-y-4 border-[var(--danger)]/30">
        <div className="flex items-center gap-3">
          <Flame className="w-5 h-5 text-[var(--danger)]" />
          <h3 className="font-semibold">Triturador de Arquivos</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--danger)]/20 text-[var(--danger)]">Irreversível</span>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Sobrescreve os bytes com dados aleatórios, renomeia e apaga — impossível recuperar com software de restauração.
        </p>
        <div className="flex gap-2">
          <input
            value={shredInput}
            onChange={e => setShredInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addShred()}
            placeholder="Cole um caminho de arquivo ou pasta…"
            className="input flex-1 font-mono text-sm"
          />
          <button onClick={addShred} className="btn-secondary">Adicionar</button>
        </div>
        {shredList.length > 0 && (
          <div className="space-y-1.5">
            {shredList.map(p => (
              <div key={p} className="flex items-center gap-2 px-3 py-2 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <Files className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                <span className="text-xs font-mono truncate flex-1" title={p}>{p}</span>
                <button
                  onClick={() => setShredList(l => l.filter(x => x !== p))}
                  className="text-[var(--muted)] hover:text-[var(--danger)] text-xs"
                >remover</button>
              </div>
            ))}
            <button onClick={shred} disabled={shredding} className="btn-danger w-full">
              {shredding ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Flame className="w-4 h-4 inline mr-1" />}
              Triturar {shredList.length} item(ns) permanentemente
            </button>
          </div>
        )}
        {shredStatus && (
          <div className={`text-sm flex items-center gap-2 ${shredStatus.ok ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
            {shredStatus.ok ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            {shredStatus.msg}
          </div>
        )}
      </div>
    </div>
  )
}