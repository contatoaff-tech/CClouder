import { ReactNode, useState } from 'react'
import { Wrench, Terminal, Shield, Download, RefreshCw, ExternalLink, Info, CheckCircle, AlertTriangle, Cpu, MemoryStick, Monitor, HardDrive, Network, Settings, Zap, Sparkles, Database, Rocket, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

interface Tool {
  id: string
  name: string
  description: string
  icon: ReactNode
  category: 'system' | 'maintenance' | 'advanced'
  action: () => Promise<void>
  danger?: boolean
}

export default function ToolsTab() {
  const [tools, setTools] = useState<Tool[]>([
    {
      id: 'disk_cleanup',
      name: 'Limpeza de Disco (Windows)',
      description: 'Abre a ferramenta nativa cleanmgr do Windows',
      icon: <Sparkles className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        await invoke('open_folder', { path: 'cleanmgr' })
        // Fallback: executar cleanmgr via shell
      },
      danger: false
    },
    {
      id: 'defrag',
      name: 'Desfragmentar e Otimizar Unidades',
      description: 'Abre o otimizador de unidades do Windows',
      icon: <HardDrive className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // dfrgui
      },
      danger: false
    },
    {
      id: 'system_file_checker',
      name: 'Verificador de Arquivos do Sistema (SFC)',
      description: 'Executa sfc /scannow para reparar arquivos de sistema corrompidos',
      icon: <Shield className="w-5 h-5" />,
      category: 'maintenance',
      action: async () => {
        // sfc /scannow
      },
      danger: false
    },
    {
      id: 'dism',
      name: 'DISM - Restaurar Imagem do Windows',
      description: 'Repara o armazenamento de componentes do Windows',
      icon: <RefreshCw className="w-5 h-5" />,
      category: 'maintenance',
      action: async () => {
        // DISM /Online /Cleanup-Image /RestoreHealth
      },
      danger: false
    },
    {
      id: 'disk_check',
      name: 'Verificar Disco (CHKDSK)',
      description: 'Verifica e corrige erros no sistema de arquivos',
      icon: <CheckCircle className="w-5 h-5" />,
      category: 'maintenance',
      action: async () => {
        // chkdsk /f /r
      },
      danger: true
    },
    {
      id: 'task_manager',
      name: 'Gerenciador de Tarefas',
      description: 'Abre o Gerenciador de Tarefas do Windows',
      icon: <Cpu className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // taskmgr
      },
      danger: false
    },
    {
      id: 'resource_monitor',
      name: 'Monitor de Recursos',
      description: 'Monitora CPU, memória, disco e rede em tempo real',
      icon: <MemoryStick className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // resmon
      },
      danger: false
    },
    {
      id: 'event_viewer',
      name: 'Visualizador de Eventos',
      description: 'Visualiza logs de sistema, aplicação e segurança',
      icon: <Info className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // eventvwr
      },
      danger: false
    },
    {
      id: 'services',
      name: 'Serviços',
      description: 'Gerencia serviços do Windows',
      icon: <Settings className="w-5 h-5" />,
      category: 'system',
      action: async () => {
        // services.msc
      },
      danger: false
    },
    {
      id: 'registry_editor',
      name: 'Editor do Registro',
      description: 'Edita o registro do Windows (use com extrema cautela)',
      icon: <Database className="w-5 h-5" />,
      category: 'advanced',
      action: async () => {
        // regedit
      },
      danger: true
    },
    {
      id: 'group_policy',
      name: 'Editor de Políticas de Grupo',
      description: 'Configura políticas do Windows (Pro/Enterprise)',
      icon: <Shield className="w-5 h-5" />,
      category: 'advanced',
      action: async () => {
        // gpedit.msc
      },
      danger: true
    },
    {
      id: 'system_config',
      name: 'Configuração do Sistema (msconfig)',
      description: 'Configura inicialização, serviços e ferramentas',
      icon: <Zap className="w-5 h-5" />,
      category: 'advanced',
      action: async () => {
        // msconfig
      },
      danger: true
    },
  ])

  const [expandedCategory, setExpandedCategory] = useState<string>('system')

  const categories = [
    { id: 'system', label: 'Sistema', icon: <Monitor className="w-5 h-5" /> },
    { id: 'maintenance', label: 'Manutenção', icon: <Shield className="w-5 h-5" /> },
    { id: 'advanced', label: 'Avançado', icon: <AlertTriangle className="w-5 h-5" /> },
  ]

  const handleRunTool = async (tool: Tool) => {
    try {
      await tool.action()
    } catch (e) {
      console.error('Erro ao executar ferramenta:', e)
    }
  }

  return (
    <div className="space-y-6 anim-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-[var(--fg)]">Ferramentas do Sistema</h2>
        <p className="text-[var(--muted)]">Acesso rápido às utilidades nativas do Windows</p>
      </div>

      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto pb-2">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setExpandedCategory(cat.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              expandedCategory === cat.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card)]'
            }`}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools
          .filter(t => t.category === expandedCategory)
          .map(tool => (
            <ToolCard key={tool.id} tool={tool} onRun={handleRunTool} />
          ))}
      </div>

      {tools.filter(t => t.category === expandedCategory).length === 0 && (
        <div className="text-center py-12 text-[var(--muted)]">
          <Wrench className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma ferramenta nesta categoria</p>
        </div>
      )}
    </div>
  )
}

function ToolCard({ tool, onRun }: { tool: Tool; onRun: (tool: Tool) => void }) {
  return (
    <button
      onClick={() => onRun(tool)}
      className="card p-5 flex flex-col gap-3 hover:border-[var(--accent)] transition-all duration-200 group"
      disabled={tool.danger}
    >
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
          tool.danger ? 'bg-[var(--danger)]/20 text-[var(--danger)]' : 'bg-[var(--accent)]/20 text-[var(--accent)]'
        }`}>
          {tool.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--fg)] truncate">{tool.name}</h3>
          {tool.danger && (
            <span className="px-2 py-0.5 text-xs bg-[var(--danger)]/20 text-[var(--danger)] rounded-full">
              Perigoso
            </span>
          )}
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] flex-1">{tool.description}</p>
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <span className="text-xs text-[var(--muted)]">
          {tool.danger ? 'Requer confirmação' : 'Clique para executar'}
        </span>
        <span className="text-[var(--accent)] text-sm font-medium group-hover:translate-x-1 transition-transform">
          Executar →
        </span>
      </div>
    </button>
  )
}