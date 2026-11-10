import { ReactNode, useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings, User, Shield, Palette, Bell, Database, HardDrive, Sparkles, Zap, Info, Github, ExternalLink, Moon, Sun, Monitor, Download, Upload, RefreshCw, CheckCircle, AlertTriangle, Key, Lock, Unlock, Plus, X, Loader2 } from 'lucide-react'

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState<'general' | 'appearance' | 'cleaning' | 'advanced' | 'about'>('general')
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('dark')
  const [autoScan, setAutoScan] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(true)
  const [skipSystemFiles, setSkipSystemFiles] = useState(true)
  const [createRestorePoint, setCreateRestorePoint] = useState(false)
  const [language, setLanguage] = useState('pt-BR')
  const [checkUpdates, setCheckUpdates] = useState(true)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  const [startWithWindows, setStartWithWindows] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleFreq, setScheduleFreq] = useState('daily')
  const [scheduleTime, setScheduleTime] = useState('10:00')
  const [scheduleInfo, setScheduleInfo] = useState<{ exists: boolean; next_run: string } | null>(null)
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null)

  const saveSetting = useCallback((key: string, value: unknown) => {
    invoke('save_setting', { key, value }).catch(() => { })
  }, [])

  const applyTheme = (t: string) => {
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
  }

  useEffect(() => {
    invoke<Record<string, unknown>>('get_settings').then(s => {
      if (typeof s.theme === 'string') { setTheme(s.theme as any); applyTheme(s.theme) }
      if (typeof s.auto_scan === 'boolean') setAutoScan(s.auto_scan)
      if (typeof s.confirm_delete === 'boolean') setConfirmDelete(s.confirm_delete)
      if (typeof s.skip_system_files === 'boolean') setSkipSystemFiles(s.skip_system_files)
      if (typeof s.restore_point_before_clean === 'boolean') setCreateRestorePoint(s.restore_point_before_clean)
      if (typeof s.minimize_to_tray === 'boolean') setMinimizeToTray(s.minimize_to_tray)
      if (typeof s.start_minimized === 'boolean') setStartMinimized(s.start_minimized)
      if (typeof s.start_with_windows === 'boolean') setStartWithWindows(s.start_with_windows)
      if (typeof s.schedule_enabled === 'boolean') setScheduleEnabled(s.schedule_enabled)
      if (typeof s.schedule_frequency === 'string') setScheduleFreq(s.schedule_frequency)
      if (typeof s.schedule_time === 'string') setScheduleTime(s.schedule_time)
    }).catch(() => { })
    invoke<{ exists: boolean; next_run: string }>('get_schedule').then(setScheduleInfo).catch(() => { })
  }, [])

  const sections = [
    { id: 'general', label: 'Geral', icon: <Settings className="w-5 h-5" /> },
    { id: 'appearance', label: 'Aparência', icon: <Palette className="w-5 h-5" /> },
    { id: 'cleaning', label: 'Limpeza', icon: <Sparkles className="w-5 h-5" /> },
    { id: 'advanced', label: 'Avançado', icon: <Zap className="w-5 h-5" /> },
    { id: 'about', label: 'Sobre', icon: <Info className="w-5 h-5" /> },
  ]

  return (
    <div className="space-y-6 anim-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-[var(--fg)]">Configurações</h2>
        <p className="text-[var(--muted)]">Personalize o comportamento do CClouder</p>
      </div>

      <div className="flex gap-6">
        <aside className="w-56 flex-shrink-0">
          <nav className="space-y-1" role="navigation" aria-label="Seções de configurações">
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id as any)}
                className={`w-full sidebar-item ${activeSection === section.id ? 'active' : ''}`}
              >
                {section.icon}
                <span className="font-medium">{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 space-y-6">
          {activeSection === 'general' && (
            <SettingsSection title="Geral" icon={<Settings className="w-5 h-5" />}>
              <SettingGroup title="Inicialização">
                <SettingItem
                  label="Iniciar com o Windows"
                  description="Adiciona o CClouder à inicialização automática do Windows"
                >
                  <Toggle
                    checked={startWithWindows}
                    onChange={async (v) => {
                      try {
                        await invoke('set_start_with_windows', { enable: v })
                        setStartWithWindows(v)
                        saveSetting('start_with_windows', v)
                      } catch (e) {
                        alert(String(e))
                      }
                    }}
                  />
                </SettingItem>
                <SettingItem
                  label="Iniciar minimizado na bandeja"
                  description="Inicia o CClouder minimizado na área de notificação"
                >
                  <Toggle checked={startMinimized} onChange={(v) => { setStartMinimized(v); saveSetting('start_minimized', v) }} />
                </SettingItem>
                <SettingItem
                  label="Minimizar para a bandeja"
                  description="Ao fechar a janela, minimiza para a bandeja em vez de sair"
                >
                  <Toggle checked={minimizeToTray} onChange={(v) => { setMinimizeToTray(v); saveSetting('minimize_to_tray', v) }} />
                </SettingItem>
              </SettingGroup>

              <SettingGroup title="Atualizações">
                <SettingItem
                  label="Verificar atualizações automaticamente"
                  description="Verifica por novas versões na inicialização"
                >
                  <Toggle checked={checkUpdates} onChange={(v) => { setCheckUpdates(v); saveSetting('check_updates', v) }} />
                </SettingItem>
                <SettingItem
                  label="Idioma"
                  description="Idioma da interface"
                >
                  <select value={language} onChange={e => { setLanguage(e.target.value); saveSetting('language', e.target.value) }} className="input w-auto">
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es-ES">Español</option>
                  </select>
                </SettingItem>
              </SettingGroup>
            </SettingsSection>
          )}

          {activeSection === 'appearance' && (
            <SettingsSection title="Aparência" icon={<Palette className="w-5 h-5" />}>
              <SettingGroup title="Tema">
                <SettingItem
                  label="Tema da interface"
                  description="Escolha o tema visual do aplicativo"
                >
                  <div className="flex gap-2">
                    {(['system', 'light', 'dark'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => { setTheme(t); applyTheme(t); saveSetting('theme', t) }}
                        className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                          theme === t
                            ? 'bg-[var(--accent)] text-white'
                            : 'bg-[var(--card)] text-[var(--fg)] border border-[var(--border)] hover:border-[var(--accent)]'
                        }`}
                      >
                        {t === 'system' && <Monitor className="w-4 h-4 mr-1" />}
                        {t === 'light' && <Sun className="w-4 h-4 mr-1" />}
                        {t === 'dark' && <Moon className="w-4 h-4 mr-1" />}
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </SettingItem>
              </SettingGroup>
            </SettingsSection>
          )}

          {activeSection === 'cleaning' && (
            <SettingsSection title="Limpeza" icon={<Sparkles className="w-5 h-5" />}>
              <SettingGroup title="Comportamento">
                <SettingItem
                  label="Pular arquivos de sistema"
                  description="Não tenta remover arquivos protegidos do Windows"
                >
                  <Toggle checked={skipSystemFiles} onChange={(v) => { setSkipSystemFiles(v); saveSetting('skip_system_files', v) }} />
                </SettingItem>
                <SettingItem
                  label="Confirmar antes de excluir"
                  description="Pede confirmação antes de cada operação de limpeza"
                >
                  <Toggle checked={confirmDelete} onChange={(v) => { setConfirmDelete(v); saveSetting('confirm_delete', v) }} />
                </SettingItem>
                <SettingItem
                  label="Criar ponto de restauração"
                  description="Cria um ponto de restauração do Windows antes da limpeza (recomendado)"
                >
                  <Toggle checked={createRestorePoint} onChange={(v) => { setCreateRestorePoint(v); saveSetting('restore_point_before_clean', v) }} />
                </SettingItem>
              </SettingGroup>

              <SettingGroup title="Escaneamento Automático">
                <SettingItem
                  label="Escaneamento automático na inicialização"
                  description="Executa uma análise rápida ao iniciar o aplicativo"
                >
                  <Toggle checked={autoScan} onChange={(v) => { setAutoScan(v); saveSetting('auto_scan', v) }} />
                </SettingItem>
              </SettingGroup>

              <SettingGroup title="Limpeza agendada">
                <SettingItem
                  label="Ativar agendamento"
                  description="Cria uma tarefa no Agendador do Windows (roda o exe com --clean --quiet)"
                >
                  <Toggle
                    checked={scheduleEnabled}
                    onChange={async (v) => {
                      setScheduleEnabled(v)
                      try {
                        const r = await invoke<{ ok: boolean }>('set_schedule', { enabled: v, frequency: scheduleFreq, time: scheduleTime })
                        setScheduleStatus(v ? 'tarefa criada' : 'agendamento removido')
                        saveSetting('schedule_enabled', v)
                        const info = await invoke<{ exists: boolean; next_run: string }>('get_schedule')
                        setScheduleInfo(info)
                        void r
                      } catch (e) {
                        setScheduleStatus(String(e))
                        setScheduleEnabled(!v)
                      }
                    }}
                  />
                </SettingItem>
                <SettingItem label="Frequência" description="Com que frequência a limpeza roda">
                  <select
                    value={scheduleFreq}
                    onChange={e => { setScheduleFreq(e.target.value); saveSetting('schedule_frequency', e.target.value) }}
                    className="input w-auto"
                  >
                    <option value="daily">Diário</option>
                    <option value="weekly">Semanal</option>
                  </select>
                </SettingItem>
                <SettingItem label="Horário" description="Formato HH:mm (24h)">
                  <input
                    value={scheduleTime}
                    onChange={e => { setScheduleTime(e.target.value); saveSetting('schedule_time', e.target.value) }}
                    className="input w-24 font-mono text-sm"
                  />
                </SettingItem>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={async () => {
                      try {
                        await invoke('set_schedule', { enabled: true, frequency: scheduleFreq, time: scheduleTime })
                        setScheduleStatus('agendamento aplicado')
                        setScheduleEnabled(true)
                        setScheduleInfo(await invoke<{ exists: boolean; next_run: string }>('get_schedule'))
                      } catch (e) {
                        setScheduleStatus(String(e))
                      }
                    }}
                    className="btn-primary !py-1.5 !text-sm"
                  >
                    Aplicar agendamento
                  </button>
                  <span className="text-xs text-[var(--muted)]">
                    {scheduleInfo?.exists ? `próxima execução: ${scheduleInfo.next_run || '—'}` : 'sem tarefa criada'}
                    {scheduleStatus ? ` · ${scheduleStatus}` : ''}
                  </span>
                </div>
              </SettingGroup>

              <SettingGroup title="Exclusões">
                <ExclusionsManager />
              </SettingGroup>
            </SettingsSection>
          )}

          {activeSection === 'advanced' && (
            <SettingsSection title="Avançado" icon={<Zap className="w-5 h-5" />}>
              <SettingGroup title="Registro" icon={<Database className="w-5 h-5" />}>
                <div className="p-4 bg-[var(--card)] border border-[var(--warning)]/50 rounded-lg border-l-4 border-[var(--warning)]">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-[var(--fg)]">
                      <p className="font-medium text-[var(--warning)] mb-2">Área de Risco</p>
                      <p>As opções abaixo podem afetar a estabilidade do sistema. Use apenas se souber o que está fazendo.</p>
                    </div>
                  </div>
                </div>
                <SettingItem
                  label="Limpeza profunda do registro"
                  description="Inclui verificações mais agressivas (pode remover chaves válidas)"
                >
                  <Toggle checked={false} onChange={() => {}} disabled />
                </SettingItem>
                <SettingItem
                  label="Remover chaves órfãs de desinstalação"
                  description="Remove entradas de programas já desinstalados"
                >
                  <Toggle checked={true} onChange={() => {}} disabled />
                </SettingItem>
              </SettingGroup>

              <SettingGroup title="Dados" icon={<Database className="w-5 h-5" />}>
                <SettingItem
                  label="Exportar configurações"
                  description="Salva todas as configurações em um arquivo JSON"
                >
                  <button className="btn-secondary text-sm">Exportar</button>
                </SettingItem>
                <SettingItem
                  label="Importar configurações"
                  description="Carrega configurações de um arquivo JSON"
                >
                  <button className="btn-secondary text-sm">Importar</button>
                </SettingItem>
                <SettingItem
                  label="Redefinir para padrões"
                  description="Restaura todas as configurações aos valores de fábrica"
                >
                  <button className="btn-danger text-sm">Redefinir</button>
                </SettingItem>
              </SettingGroup>
            </SettingsSection>
          )}

          {activeSection === 'about' && (
            <SettingsSection title="Sobre" icon={<Info className="w-5 h-5" />}>
              <div className="card p-6 text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--accent)] to-blue-600 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-xl font-bold text-[var(--fg)] mb-1">CClouder</h3>
                <p className="text-[var(--muted)] mb-4">Versão 1.7.0</p>
                <p className="text-sm text-[var(--muted)] max-w-md mx-auto mb-6">
                  Limpador de sistema open source, leve e moderno. Construído do zero com
                  C#/.NET 10 + WebView2 (shell nativo) e React + Tailwind (interface).
                </p>
                <div className="flex justify-center gap-3">
                  <a href="https://github.com/contatoaff-tech/CClouder" target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-2">
                    <Github className="w-4 h-4" />
                    GitHub
                  </a>
                  <a href="https://github.com/contatoaff-tech/CClouder/releases/latest" target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    Releases
                  </a>
                </div>
              </div>

              <AppUpdateCard />

              <SettingGroup title="Licença">
                <div className="card p-4">
                  <p className="text-sm text-[var(--muted)]">
                    CClouder é licenciado sob a licença MIT. Código fonte disponível no GitHub.
                  </p>
                </div>
              </SettingGroup>

              <SettingGroup title="Sistema">
                <SettingItem label="Runtime" description="Shell nativo" ><span className="text-[var(--muted)] font-mono">.NET 10 + WPF</span></SettingItem>
                <SettingItem label="WebView" description="Motor da interface" ><span className="text-[var(--muted)] font-mono">Edge WebView2</span></SettingItem>
                <SettingItem label="Arquitetura" description="Alvo de compilação" ><span className="text-[var(--muted)] font-mono">win-x64</span></SettingItem>
              </SettingGroup>
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsSection({
  title,
  icon,
  children
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)]">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-[var(--fg)]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function SettingGroup({
  title,
  icon,
  children
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-medium text-[var(--muted)] uppercase tracking-wider">
        {icon && <span className="text-[var(--accent)]">{icon}</span>}
        {title}
      </h4>
      <div className="space-y-2 ml-6">
        {children}
      </div>
    </div>
  )
}

function SettingItem({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg hover:border-[var(--accent)] transition-colors">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--fg)]">{label}</p>
        {description && <p className="text-xs text-[var(--muted)] mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className={`w-11 h-6 rounded-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--accent)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-5 after:w-5 after:transition-all ${
        checked ? 'bg-[var(--accent)] peer-checked:after:translate-x-full' : 'bg-[var(--border)]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
    </label>
  )
}
// ==================== Exclusões (v1.2) ====================

function ExclusionsManager() {
  const [items, setItems] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await invoke<string[]>('get_exclusions'))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const p = input.trim().replace(/^"|"$/g, '')
    if (!p) return
    try {
      const r = await invoke<{ ok: boolean; exclusions: string[] }>('add_exclusion', { path: p })
      setItems(r.exclusions)
      setInput('')
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const remove = async (p: string) => {
    try {
      const r = await invoke<{ ok: boolean; exclusions: string[] }>('remove_exclusion', { path: p })
      setItems(r.exclusions)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Pasta ou padrão (ex: C:\Dev, *.tmp)…"
          className="input flex-1 font-mono text-sm"
        />
        <button onClick={add} className="btn-secondary flex items-center gap-1.5 !text-sm">
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <p className="text-xs text-[var(--muted)]">
        Pastas e padrões aqui são <strong className="text-[var(--fg)]">ignorados em todas as análises e limpezas</strong> — incluídas nas limpezas agendadas.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nenhuma exclusão configurada.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map(p => (
            <div key={p} className="flex items-center gap-2 px-3 py-2 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
              <span className="text-xs font-mono truncate flex-1">{p}</span>
              <button onClick={() => remove(p)} className="text-[var(--muted)] hover:text-[var(--danger)]">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== Auto-update (v1.3) ====================

interface UpdateInfo {
  current: string
  latest: string
  has_update: boolean
  url: string
  size: number
  digest: string
  notes: string
}

function AppUpdateCard() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const check = async () => {
    setChecking(true)
    setStatus(null)
    try {
      setInfo(await invoke<UpdateInfo>('check_app_update'))
    } catch (e) {
      setStatus(String(e))
    } finally {
      setChecking(false)
    }
  }

  const download = async () => {
    if (!info?.url) return
    setDownloading(true)
    setStatus(null)
    try {
      await invoke('download_app_update', { url: info.url })
      setStatus('Atualização validada e preparada. O aplicativo será reiniciado para aplicar a versão nova.')
    } catch (e) {
      setStatus(String(e))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <SettingGroup title="Atualizações">
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Download className="w-5 h-5 text-[var(--accent)]" />
          <div className="flex-1">
            <div className="text-sm font-medium">Versão instalada: <span className="font-mono">1.7.0</span></div>
            {info && (
              <div className="text-xs text-[var(--muted)]">
                {info.has_update
                  ? `Nova versão disponível: ${info.latest}`
                  : `Você está na versão mais recente (${info.latest})`}
              </div>
            )}
            {status && <div className="text-xs text-[var(--muted)] mt-1">{status}</div>}
          </div>
          {info?.has_update ? (
            <button onClick={download} disabled={downloading} className="btn-primary !py-1.5 !text-xs flex items-center gap-1.5">
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Baixar e reiniciar
            </button>
          ) : (
            <button onClick={check} disabled={checking} className="btn-secondary !py-1.5 !text-xs flex items-center gap-1.5">
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Verificar atualizações
            </button>
          )}
        </div>
      </div>
    </SettingGroup>
  )
}
