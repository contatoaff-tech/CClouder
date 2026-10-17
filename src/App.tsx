import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { HardDrive, Database, Wrench, Rocket, Trash2, Settings, Sparkles } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import CleanerTab from './components/CleanerTab'
import RegistryTab from './components/RegistryTab'
import ToolsTab from './components/ToolsTab'
import StartupTab from './components/StartupTab'
import UninstallTab from './components/UninstallTab'
import DiskTab from './components/DiskTab'
import SettingsTab from './components/SettingsTab'
import ScanProgressModal from './components/ScanProgressModal'
import ResultModal from './components/ResultModal'
import toast from './components/Toast'

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

type Tab = 'cleaner' | 'registry' | 'tools' | 'startup' | 'uninstall' | 'disk' | 'settings'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'cleaner', label: 'Limpeza', icon: <Sparkles className="w-5 h-5" /> },
  { id: 'registry', label: 'Registro', icon: <Database className="w-5 h-5" /> },
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

  const handleScan = async () => {
    const selected = categories.filter(c => c.checked).map(c => c.id)
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

  const handleClean = async () => {
    if (!scanResult) return
    const items = scanResult.categories.flatMap(c => c.items.filter(i => i.checked))
    if (items.length === 0) {
      showToast('Nenhum item selecionado para limpeza', 'error')
      return
    }
    setCleaning(true)
    try {
      const result = await invoke<CleanResult>('clean_selected', { items })
      setCleanResult(result)
      setShowResultModal(true)
      showToast(`Limpeza concluída: ${formatNumber(result.freed_count)} arquivos, ${formatBytes(result.freed_bytes)} liberados`, 'success')
      await handleScan()
    } catch (e) {
      showToast('Erro na limpeza: ' + e, 'error')
    } finally {
      setCleaning(false)
    }
  }

  const handleToggleCategory = (id: string) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c))
  }

  const handleToggleItem = (catId: string, itemId: string) => {
    setCategories(prev => prev.map(c => c.id === catId ? {
      ...c, items: c.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i)
    } : c))
    if (scanResult) {
      setScanResult(prev => prev ? {
        ...prev, categories: prev.categories.map(c => c.id === catId ? {
          ...c, items: c.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i)
        } : c)
      } : null)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    setCategories(prev => prev.map(c => ({
      ...c, checked, items: c.items.map(i => ({ ...i, checked }))
    })))
    if (scanResult) {
      setScanResult(prev => prev ? {
        ...prev, categories: prev.categories.map(c => ({
          ...c, checked, items: c.items.map(i => ({ ...i, checked }))
        }))
      } : null)
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

  const getTotalSelected = () => {
    const base = scanResult || { categories }
    return base.categories.flatMap(c => c.items.filter(i => i.checked)).length
  }

  const getTotalSize = () => {
    const base = scanResult || { categories }
    return base.categories.flatMap(c => c.items.filter(i => i.checked)).reduce((a, i) => a + i.size, 0)
  }

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
              categories={scanResult?.categories || categories}
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
          {activeTab === 'registry' && (
            <RegistryTab
              categories={scanResult?.categories || categories}
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
          onClose={() => { setShowResultModal(false); setCleanResult(null) }}
          formatBytes={formatBytes}
          formatNumber={formatNumber}
        />
      )}
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