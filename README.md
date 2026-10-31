# CClinear

Limpador de sistema para Windows — **open source (MIT), leve (exe único de 2,5 MB), sem telemetria, sem upsell, todas as funções liberadas.**

Interface moderna (React + Tailwind) hospedada em WebView2, com backend nativo C#/.NET 10.

## Funções

| Aba | O que faz |
|---|---|
| **Limpeza** | Temp, prefetch, logs, relatórios de erro, caches de navegadores (Edge/Chrome/Firefox/Brave/Opera) e apps (Spotify, Discord, Steam, VS Code, Teams, Adobe, NVIDIA) · **Health Check (v1.2)**: score de saúde com "Corrigir tudo" · **exclusões globais** (v1.2): pastas/padrões ignorados em todas as análises e limpezas |
| **Registro** | Desinstaladores órfãos, SharedDLLs, COM/ActiveX, extensões inválidas, MRUs, fontes, App Paths — **backup JSON automático com árvore completa** em `%USERPROFILE%\CClinearBackups` e **restauração pela aba** (v1.3) |
| **Ferramentas** | Acesso rápido ao cleanmgr e pastas de sistema · **gerenciador de menu de contexto** (v1.2): habilita/desabilita extensões do botão direito de forma reversível |
| **Inicialização** | Gerenciador de programas de inicialização (Run/RunOnce HKCU+HKLM+WOW6432Node, pastas Startup) + **tarefas agendadas de logon/boot** (v1.2) — desabilitar é reversível |
| **Desinstalar** | Lista programas instalados e executa o desinstalador · **Atualizações de software via winget** (v1.3): lista apps desatualizados e atualiza com um clique |
| **Processos** *(v1.3)* | Monitor de processos (RAM/CPU por processo, top 60), **otimizador de memória** (`EmptyWorkingSet`) e encerrar processo |
| **Arquivos** *(v1.2)* | **Buscador de Duplicatas** (hash parcial + SHA-256, com pré-seleção inteligente) e **Triturador de Arquivos** (sobrescreve com dados aleatórios, renomeia e apaga — irreversível) |
| **Drivers** *(v1.1)* | Escaneia todos os drivers assinados via WMI (Win32_PnPSignedDriver), **busca na web** por atualização de cada driver (abre a busca no navegador), **backup completo dos drivers** via `pnputil /export-driver` e **ponto de restauração** do Windows antes de mexer em qualquer driver — com **verificação de capacidades** em tempo real (admin, pnputil, PowerShell, System Restore) |
| **Disco** | Análise paralela: 20 maiores pastas por tamanho |

## Como funciona

```
┌───────────────────────────── Windows ─────────────────────────────┐
│                                                                   │
│  CClinear.exe (2,5 MB, arquivo único)                             │
│  ┌────────────────────────────┬────────────────────────────────┐  │
│  │  UI  (React + Tailwind)    │  Nativo  (C# / .NET 10 + WPF)  │  │
│  │  7 abas, 12 componentes    │  WebView2 host + Backend.cs    │  │
│  │  compilada pelo Vite →     │                                │  │
│  │  dist/ (1 arquivo JS+CSS)  │  Registry / FileSystem / Win32 │  │
│  └────────────┬───────────────┴───────────────┬────────────────┘  │
│               │  window.__TAURI_INTERNALS__   │                   │
│               │  (shim de compatibilidade)    │                   │
│               └───────── postMessage ─────────┘                   │
└───────────────────────────────────────────────────────────────────┘
```

**1. Interface.** A UI é um app React normal (React 18 + Tailwind + Lucide) compilado pelo Vite. O resultado (`dist/`) é embutido dentro do exe no publish (`IncludeAllContentForSelfExtract`) e extraído em tempo de execução. O WebView2 carrega tudo via host virtual `https://cclinear.app`.

**2. Ponte IPC.** O frontend usa as APIs do `@tauri-apps/api` (`invoke` e `listen`). Como o shell é C#, não Tauri, um **shim** injetado em cada documento (`AddScriptToExecuteOnDocumentCreatedAsync`) replica o contrato exato da API v2:
- `invoke(cmd, args)` → `postMessage({__req, __cmd, __payload})` → o C# roteia para o backend e responde com `PostWebMessageAsJson({__req, ok, data})`, resolvendo a Promise do JS;
- `transformCallback(callback)` → registra callbacks numerados, igual ao runtime real do Tauri;
- `listen(event, handler)` → o handler é registrado localmente no shim e o C# entrega eventos (`scan-progress`, `scan-complete`) via `ExecuteScriptAsync("window.__TAURI_INTERNALS__.runCallback(id, {event, payload})")`.

**3. Backend nativo (`Backend.cs`).** Cada comando executa operações reais do Windows:

| Comando | O que faz no sistema |
|---|---|
| `get_categories` | Devolve o catálogo de limpeza (5 categorias, 30 itens) |
| `start_scan` | Mede tamanho/quantidade de cada item (dirs, globs, arquivos) em thread separada, emitindo progresso; Registro é auditado de verdade (SharedDLLs apontando p/ arquivo inexistente, desinstaladores órfãos, CLSID sem servidor, extensões sem ProgID, fontes ausentes, App Paths quebrados, MRUs) |
| `clean_selected` | Deleta arquivos/pastas (falha silenciosa em arquivos em uso) e **exporta backup JSON para `%USERPROFILE%\CClinearBackups` antes de apagar qualquer valor/chave de registro** |
| `get_startup_items` / `toggle_startup_item` | Lê Run/RunOnce (HKCU, HKLM, WOW6432Node) + pastas Startup; **desabilitar nunca destrói**: o valor migra para `HKCU\Software\CClinear\StartupDisabled` e pode ser restaurado |
| `get_installed_programs` / `uninstall_program` | Enumera as 3 chaves Uninstall e executa o `UninstallString` |
| `analyze_disk` | Tamanho recursivo **paralelo** (`Parallel.ForEach`) das pastas do caminho |

**4. Por que WPF/WebView2 e não Tauri?** Portabilidade: a UI React de um projeto Tauri funciona em qualquer host que forneça `__TAURI_INTERNALS__`. Sem Rust instalado, o mesmo frontend roda sobre um host C# de ~2,5 MB. O backend C# substitui 1:1 os comandos Tauri originais.

**5. Segurança.** `asInvoker` (sem pedir admin por padrão — itens de sistema que exigem elevation simplesmente falham e são contados como "itens pulados"); nada é enviado para fora do computador; nenhum updater; nenhum código ofuscado.

## Auto-update (v1.3)

A aba **Configurações → Sobre** consulta `api.github.com/repos/contatoaff-tech/CClinear/releases/latest`, compara com a versão instalada e, se houver versão nova, baixa o exe da release e se substitui em tempo de execução (script de troca aguarda o processo sair e reabre).

## Estrutura

```
CClinear/
├── src/               # Frontend React + TypeScript + Tailwind (7 abas, 12 componentes)
├── src-tauri/         # (opcional) configuração Tauri original
├── shell/             # Shell nativo WPF + WebView2 (C#/.NET 10)
│   ├── MainWindow.xaml.cs   # Ponte IPC: shim window.__TAURI_INTERNALS__ ↔ C#
│   └── Backend.cs           # Scan/limpeza de arquivos, registro, inicialização, disco
├── dist/              # Frontend compilado (npm run build)
└── LICENSE            # MIT
```

## Como rodar

```bash
# Frontend
npm install && npm run build

# Shell nativo → exe único (~2,5 MB)
cd shell
dotnet publish -c Release -r win-x64 --self-contained false \
  -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true
# resultado: bin/Release/net10.0-windows/win-x64/publish/CClinear.exe
```

Requisitos: .NET 10 Desktop Runtime + WebView2 Runtime (ambos já presentes no Windows 11 atualizado).

## Nota

O CClinear é um programa **original e independente** — não contém código do CCleaner/Piriform/Avast. As funções de limpeza de sistema (temp, cache, registro, inicialização, desinstalação) são operações genéricas do Windows implementadas do zero.