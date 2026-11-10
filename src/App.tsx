import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { HardDrive, Database, Wrench, Rocket, Trash2, Settings, Sparkles, Cpu, Files, Activity } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import CleanerTab from './components/CleanerTab'
import RegistryTab from './components/RegistryTab'
import DriverTab from './components/DriverTab'
import FilesTab from './components/FilesTab'
import ProcessesTab from './components/ProcessesTab'
import ToolsTab from './components/ToolsTab'
import StartupTab from './components/StartupTab'
import UninstallTab from './components/UninstallTab'
import DiskTab from './components/DiskTab'
import SettingsTab from './components/SettingsTab'
import ScanProgressModal from './components/ScanProgressModal'
import ResultModal from './components/ResultModal'
import toast from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'

interface CleanCategory {
  id: string
  name: string
  description: string
  items: CleanItem[]
  checked: boolean
}

interface CleanItem {
  id: string
  name: string
  path: string
  size: number
  count: number
  checked: boolean
  is_registry: boolean
}

interface ScanResult {
  categories: CleanCategory[]
  total_size: number
  total_count: number
}

interface CleanResult {
  freed_bytes: number
  freed_count: number
  errors: string[]
}

interface StartupItem {
  name: string
  path: string
  enabled: boolean
  location: string
}

interface InstalledProgram {
  name: string
  version: string
  publisher: string
  install_date: string
  size: string
  uninstall_string: string
}

interface DiskAnalysis {
  path: string
  total_size: number
  folders: FolderSize[]
}

interface FolderSize {
  name: string
  path: string
  size: number
  file_count: number
}

type Tab = 'cleaner' | 'registry' | 'drivers' | 'files' | 'processes' | 'tools' | 'startup' | 'uninstall' | 'disk' | 'settings'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'cleaner', label: 'Limpeza', icon: <Sparkles className="w-5 h-5" /> },
  { id: 'registry', label: 'Registro', icon: <Database className="w-5 h-5" /> },
  { id: 'drivers', label: 'Drivers', icon: <Cpu className="w-5 h-5" /> },
  { id: 'files', label: 'Arquivos', icon: <Files className="w-5 h-5" /> },
  { id: 'processes', label: 'Processos', icon: <Activity className="w-5 h-5" /> },
  { id: 'tools', label: 'Ferramentas', icon: <Wrench className="w-5 h-5" /> },
  { id: 'startup', label: 'Inicialização', icon: <Rocket className="w-5 h-5" /> },
  { id: 'uninstall', label: 'Desinstalar', icon: <Trash2 className="w-5 h-5" /> },
  { id: 'disk', label: 'Disco', icon: <HardDrive className="w-5 h-5" /> },
  { id: 'settings', label: 'Configurações', icon: <Settings className="w-5 h-5" /> },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('pt-BR').format(num)
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('cleaner')
  const [categories, setCategories] = useState<CleanCategory[]>([])
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{current_category: string, progress: number, found_size: number, found_count: number} | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null)
  const [showScanModal, setShowScanModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [startupItems, setStartupItems] = useState<StartupItem[]>([])
  const [installedPrograms, setInstalledPrograms] = useState<InstalledProgram[]>([])
  const [diskAnalysis, setDiskAnalysis] = useState<DiskAnalysis | null>(null)
  const [analyzingDisk, setAnalyzingDisk] = useState(false)
  const [toasts, setToasts] = useState<Array<{id: number, message: string, type: 'success' | 'error' | 'info'}>>([])
  const [confirmDelete, setConfirmDelete] = useState(true)
  const [pendingClean, setPendingClean] = useState<{ items: CleanItem[] } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  const loadCategories = useCallback(async () => {
    try {
      const cats = await invoke<CleanCategory[]>('get_categories')
      setCategories(cats)
    } catch (e) {
      showToast('Erro ao carregar categorias: ' + e, 'error')
    }
  }, [])

  const loadStartupItems = useCallback(async () => {
    try {
      const items = await invoke<StartupItem[]>('get_startup_items')
      setStartupItems(items)
    } catch (e) {
      showToast('Erro ao carregar itens de inicialização: ' + e, 'error')
    }
  }, [])

  const loadInstalledPrograms = useCallback(async () => {
    try {
      const programs = await invoke<InstalledProgram[]>('get_installed_programs')
      setInstalledPrograms(programs)
    } catch (e) {
      showToast('Erro ao carregar programas: ' + e, 'error')
    }
  }, [])

  useEffect(() => {
    loadCategories()
    const unlistenScan = listen('scan-progress', (e) => {
      setScanProgress(e.payload as any)
    })
    const unlistenComplete = listen('scan-complete', (e) => {
      setScanResult(e.payload as ScanResult)
      setScanning(false)
      setShowScanModal(false)
      const cats = e.payload as ScanResult
      setCategories(prev => prev.map(c => {
        const found = cats.categories.find(fc => fc.id === c.id)
        return found ? { ...c, items: found.items } : c
      }))
      showToast(`Escaneamento concluído: ${formatNumber(cats.total_count)} itens, ${formatBytes(cats.total_size)}`, 'success')
    })
    return () => {
      unlistenScan.then(f => f())
      unlistenComplete.then(f => f())
    }
  }, [loadCategories])

  useEffect(() => {
    const openSettings = () => setActiveTab('settings')
    window.addEventListener('cclouder:open-settings', openSettings)
    return () => window.removeEventListener('cclouder:open-settings', openSettings)
  }, [])

  useEffect(() => {
    invoke<Record<string, unknown>>('get_settings').then(s => {
      const t = typeof s.theme === 'string' ? s.theme : 'dark'
      if (t === 'system') delete document.documentElement.dataset.theme
      else document.documentElement.dataset.theme = t
      if (typeof s.confirm_delete === 'boolean') setConfirmDelete(s.confirm_delete)
    }).catch(() => { })
  }, [])

  const handleScan = async () => {
    const selected = activeTab === 'registry'
      ? categories.filter(c => c.id === 'registry' && c.items.some(i => i.checked)).map(c => c.id)
      : categories.filter(c => c.id !== 'registry' && c.items.some(i => i.checked)).map(c => c.id)
    if (selected.length === 0) {
      showToast('Selecione pelo menos uma categoria', 'error')
      return
    }
    setScanning(true)
    setScanResult(null)
    setShowScanModal(true)
    try {
      await invoke('start_scan', { app: null, state: null, selected_categories: selected })
    } catch (e) {
      setScanning(false)
      setShowScanModal(false)
      showToast('Erro ao iniciar escaneamento: ' + e, 'error')
    }
  }

  const handleCancelScan = async () => {
    try {
      await invoke('cancel_scan')
      setScanning(false)
      setShowScanModal(false)
      showToast('Escaneamento cancelado', 'info')
    } catch (e) {
      showToast('Erro ao cancelar: ' + e, 'error')
    }
  }

  const runClean = async (items: CleanItem[]) => {
    setPendingClean(null)
    setCleaning(true)
    try {
      const result = await invoke<CleanResult>('clean_selected', { items })
      setCleanResult(result)
      setShowResultModal(true)
      if (result.errors.length > 0) {
        showToast(`Limpeza parcial: ${result.errors.length} item(ns) não puderam ser processados`, 'error')
      } else {
        showToast(`Limpeza concluída: ${formatNumber(result.freed_count)} arquivos, ${formatBytes(result.freed_bytes)} liberados`, 'success')
      }
      // Re-escaneia após fechar o modal de resultado (antes cobria o resultado).
    } catch (e) {
      showToast('Não foi possível concluir a limpeza. Tente novamente ou execute como administrador.', 'error')
    } finally {
      setCleaning(false)
    }
  }

  const handleClean = async () => {
    if (!scanResult) {
      showToast('Execute uma análise antes de limpar', 'info')
      return
    }
    const items = scanResult.categories.flatMap(c => c.items.filter(i => i.checked))
    if (items.length === 0) {
      showToast('Nenhum item selecionado para limpeza', 'error')
      return
    }
    if (confirmDelete) {
      setPendingClean({ items })
      return
    }
    await runClean(items)
  }

  const handleToggleCategory = (id: string) => {
    const updateCategory = (c: CleanCategory): CleanCategory => {
      if (c.id !== id) return c
      const checked = c.items.some(i => !i.checked)
      return { ...c, checked, items: c.items.map(i => ({ ...i, checked })) }
    }
    setCategories(prev => prev.map(updateCategory))
    if (scanResult) setScanResult(prev => prev ? { ...prev, categories: prev.categories.map(updateCategory) } : null)
  }

  const handleToggleItem = (catId: string, itemId: string) => {
    const updateCategory = (c: CleanCategory): CleanCategory => {
      if (c.id !== catId) return c
      const items = c.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i)
      return { ...c, checked: items.some(i => i.checked), items }
    }
    setCategories(prev => prev.map(updateCategory))
    if (scanResult) {
      setScanResult(prev => prev ? { ...prev, categories: prev.categories.map(updateCategory) } : null)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    const updateCategory = (c: CleanCategory): CleanCategory => {
      if (c.id === 'registry' && activeTab !== 'registry') return c
      return { ...c, checked, items: c.items.map(i => ({ ...i, checked })) }
    }
    setCategories(prev => prev.map(updateCategory))
    if (scanResult) {
      setScanResult(prev => prev ? { ...prev, categories: prev.categories.map(updateCategory) } : null)
    }
  }

  const handleAnalyzeDisk = async (path: string) => {
    setAnalyzingDisk(true)
    try {
      const result = await invoke<DiskAnalysis>('analyze_disk', { path })
      setDiskAnalysis(result)
      showToast('Análise de disco concluída', 'success')
    } catch (e) {
      showToast('Erro na análise: ' + e, 'error')
    } finally {
      setAnalyzingDisk(false)
    }
  }

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke('open_folder', { path })
    } catch (e) {
      showToast('Erro ao abrir pasta: ' + e, 'error')
    }
  }

  const handleToggleStartup = async (path: string, enable: boolean) => {
    try {
      await invoke('toggle_startup_item', { path, enable })
      loadStartupItems()
      showToast(enable ? 'Habilitado na inicialização' : 'Desabilitado na inicialização', 'success')
    } catch (e) {
      showToast('Erro: ' + e, 'error')
    }
  }

  const handleUninstall = async (name: string) => {
    if (!confirm(`Desinstalar "${name}"?`)) return
    try {
      await invoke('uninstall_program', { name })
      showToast('Desinstalação iniciada', 'success')
      loadInstalledPrograms()
    } catch (e) {
      showToast('Erro: ' + e, 'error')
    }
  }

  const getActiveCategories = () => (scanResult?.categories || categories).filter(c =>
    activeTab === 'registry' ? c.id === 'registry' : c.id !== 'registry'
  )

  const getTotalSelected = () =>
    getActiveCategories().flatMap(c => c.items.filter(i => i.checked)).length

  const getTotalItems = () =>
    (scanResult?.categories || categories)
      .filter(c => c.id !== 'registry')
      .reduce((a, c) => a + c.items.length, 0)
  const getTotalSize = () =>
    getActiveCategories().flatMap(c => c.items.filter(i => i.checked)).reduce((a, i) => a + i.size, 0)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as Tab)}
        categories={categories}
        onToggleCategory={handleToggleCategory}
        scanning={scanning}
        onScan={handleScan}
        selectedCount={getTotalSelected()}
        totalSize={getTotalSize()}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onAnalyzeDisk={handleAnalyzeDisk} analyzingDisk={analyzingDisk} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {activeTab === 'cleaner' && (
            <CleanerTab
              categories={(scanResult?.categories || categories).filter(c => c.id !== 'registry')}
              onToggleItem={handleToggleItem}
              onSelectAll={handleSelectAll}
              scanning={scanning}
              cleaning={cleaning}
              onClean={handleClean}
              totalSelected={getTotalSelected()}
              totalSize={getTotalSize()}
              totalItems={getTotalItems()}
              formatBytes={formatBytes}
              formatNumber={formatNumber}
            />
          )}
          {activeTab === 'drivers' && <DriverTab />}
          {activeTab === 'files' && <FilesTab />}
          {activeTab === 'processes' && <ProcessesTab />}
          {activeTab === 'registry' && (
            <RegistryTab
              categories={(scanResult?.categories || categories).filter(c => c.id === 'registry')}
              onOpenFolder={handleOpenFolder}
              onToggleItem={handleToggleItem}
              onSelectAll={handleSelectAll}
              scanning={scanning}
              cleaning={cleaning}
              onClean={handleClean}
              totalSelected={getTotalSelected()}
              totalSize={getTotalSize()}
              formatBytes={formatBytes}
              formatNumber={formatNumber}
            />
          )}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'startup' && (
            <StartupTab
              items={startupItems}
              onToggle={handleToggleStartup}
              onRefresh={loadStartupItems}
              loading={false}
            />
          )}
          {activeTab === 'uninstall' && (
            <UninstallTab
              programs={installedPrograms}
              onUninstall={handleUninstall}
              onRefresh={loadInstalledPrograms}
              loading={false}
            />
          )}
          {activeTab === 'disk' && (
            <DiskTab
              analysis={diskAnalysis}
              onAnalyze={handleAnalyzeDisk}
              onOpenFolder={handleOpenFolder}
              analyzing={analyzingDisk}
              formatBytes={formatBytes}
              formatNumber={formatNumber}
            />
          )}
          {activeTab === 'settings' && <SettingsTab />}
        </main>
      </div>
      {showScanModal && (
        <ScanProgressModal
          progress={scanProgress}
          onCancel={handleCancelScan}
          scanning={scanning}
        />
      )}
      {showResultModal && cleanResult && (
        <ResultModal
          result={cleanResult}
          onClose={() => {
            setShowResultModal(false)
            setCleanResult(null)
            handleScan()
          }}
          formatBytes={formatBytes}
          formatNumber={formatNumber}
        />
      )}
      <ConfirmDialog
        open={pendingClean !== null}
        title="Confirmar limpeza"
        description={`Isso excluirá ${pendingClean ? pendingClean.items.length : 0} item(ns) marcados. Arquivos em uso serão mantidos.`}
        confirmLabel="Limpar agora"
        danger
        details={pendingClean ? Array.from(new Set(pendingClean.items.map(i => i.name))).slice(0, 8) : undefined}
        onConfirm={() => pendingClean && runClean(pendingClean.items)}
        onCancel={() => setPendingClean(null)}
      />
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg glass animate-slide-up ${t.type === 'success' ? 'border-l-4 border-[var(--success)]' : t.type === 'error' ? 'border-l-4 border-[var(--danger)]' : 'border-l-4 border-[var(--accent)]'}`}>
            <span className="text-sm">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}