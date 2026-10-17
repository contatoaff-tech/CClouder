import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Files, Search, Trash2, Flame, Loader2, CheckSquare, Square,
  Copy, HardDrive, ShieldAlert, CheckCircle2, XCircle, RefreshCw
} from 'lucide-react'

interface DupGroup {
  size: number
  files: string[]
  wasted: number
}
interface DupResult {
  root: string
  scanned_files: number
  scanned_bytes: number
  groups: DupGroup[]
}
interface ShredResult {
  shredded: number
  freed_bytes: number
  errors: string[]
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export default function FilesTab() {
  // ---------- duplicatas ----------
  const [dupPath, setDupPath] = useState('C:\\Users\\felip')
  const [dupMin, setDupMin] = useState(1048576)
  const [dupResult, setDupResult] = useState<DupResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [dupStatus, setDupStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const scanDupes = useCallback(async () => {
    setScanning(true)
    setDupResult(null)
    setChecked(new Set())
    setDupStatus(null)
    try {
      const r = await invoke<DupResult>('find_duplicates', { path: dupPath, min_size: dupMin })
      setDupResult(r)
      // pré-seleciona todos menos o primeiro de cada grupo
      const sel = new Set<string>()
      r.groups.forEach(g => g.files.slice(1).forEach(f => sel.add(f)))
      setChecked(sel)
    } catch (e) {
      setDupStatus({ ok: false, msg: String(e) })
    } finally {
      setScanning(false)
    }
  }, [dupPath, dupMin])

  const toggleFile = (path: string) =>
    setChecked(prev => {
      const n = new Set(prev)
      if (n.has(path)) n.delete(path); else n.add(path)
      return n
    })

  const deleteDupes = async () => {
    setDeleting(true)
    setDupStatus(null)
    try {
      const r = await invoke<{ deleted: number; freed_bytes: number; errors: string[] }>('delete_files', { paths: [...checked] })
      const bytes = fmtBytes(r.freed_bytes)
      setDupStatus({
        ok: true,
        msg: r.errors.length > 0
          ? `${r.deleted} arquivos excluídos (${bytes}) · ${r.errors.length} falharam`
          : `${r.deleted} arquivos excluídos · ${bytes} liberados`,
      })
      await scanDupes()
    } catch (e) {
      setDupStatus({ ok: false, msg: String(e) })
    } finally {
      setDeleting(false)
    }
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
      const bytes = fmtBytes(r.freed_bytes)
      setShredStatus({
        ok: r.errors.length === 0,
        msg: r.errors.length > 0
          ? `${r.shredded} itens triturados (${bytes}) · ${r.errors.length} falharam: ${r.errors[0]}`
          : `${r.shredded} itens triturados · ${bytes} liberados`,
      })
      setShredList([])
    } catch (e) {
      setShredStatus({ ok: false, msg: String(e) })
    } finally {
      setShredding(false)
    }
  }

  const wastedTotal = dupResult?.groups.reduce((a, g) => a + Number(g.wasted), 0) ?? 0

  return (
    <div className="space-y-6 anim-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-[var(--fg)]">Arquivos</h2>
        <p className="text-[var(--muted)]">Duplicatas e trituração segura de arquivos</p>
      </div>

      {/* ---------- Duplicate Finder ---------- */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Copy className="w-5 h-5 text-[var(--accent)]" />
          <h3 className="font-semibold">Buscador de Duplicatas</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={dupPath}
            onChange={e => setDupPath(e.target.value)}
            placeholder="Pasta para analisar…"
            className="input flex-1 min-w-64 font-mono text-sm"
          />
          <select
            value={dupMin}
            onChange={e => setDupMin(Number(e.target.value))}
            className="input w-36 text-sm"
          >
            <option value={0}>Todos os tamanhos</option>
            <option value={1048576}>≥ 1 MB</option>
            <option value={10485760}>≥ 10 MB</option>
            <option value={104857600}>≥ 100 MB</option>
          </select>
          <button onClick={scanDupes} disabled={scanning} className="btn-primary">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Search className="w-4 h-4 inline mr-1" />}
            Analisar
          </button>
        </div>

        {dupResult && (
          <>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted)]">
              <span><HardDrive className="w-3.5 h-3.5 inline mr-1" />{dupResult.scanned_files} arquivos verificados ({fmtBytes(Number(dupResult.scanned_bytes))})</span>
              <span className="text-[var(--accent)] font-medium">{dupResult.groups.length} grupos duplicados · {fmtBytes(wastedTotal)} desperdiçados</span>
              {checked.size > 0 && (
                <button onClick={deleteDupes} disabled={deleting} className="btn-danger !py-1.5 !text-xs ml-auto">
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : <Trash2 className="w-3.5 h-3.5 inline mr-1" />}
                  Excluir selecionados ({checked.size})
                </button>
              )}
            </div>
            {dupStatus && (
              <div className={`text-sm flex items-center gap-2 ${dupStatus.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {dupStatus.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {dupStatus.msg}
              </div>
            )}
            <div className="space-y-3 max-h-96 overflow-y-auto scrollbar-thin">
              {dupResult.groups.length === 0 ? (
                <p className="text-sm text-[var(--muted)] text-center py-6">Nenhuma duplicata encontrada ✓</p>
              ) : dupResult.groups.map((g, gi) => (
                <div key={gi} className="border border-[var(--border)] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--card-hover)] flex items-center justify-between text-sm">
                    <span className="font-medium">{g.files.length} cópias idênticas</span>
                    <span className="text-[var(--muted)]">{fmtBytes(g.size)} cada · desperdiça {fmtBytes(g.wasted)}</span>
                  </div>
                  {g.files.map((f, fi) => (
                    <label key={f} className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border)] hover:bg-[var(--card-hover)] cursor-pointer">
                      <button onClick={() => toggleFile(f)} className="text-[var(--accent)]">
                        {checked.has(f) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-[var(--muted)]" />}
                      </button>
                      <span className="text-xs font-mono truncate flex-1" title={f}>{f}</span>
                      {fi === 0 && <span className="text-xs text-[var(--success)]">manter</span>}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---------- Shredder ---------- */}
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