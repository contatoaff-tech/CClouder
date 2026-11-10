# CClouder

Limpador de sistema para Windows — **open source (MIT), leve (exe único de 2,5 MB), sem telemetria, sem upsell, todas as funções liberadas.**

Interface moderna (React + Tailwind) hospedada em WebView2, com backend nativo C#/.NET 10.

## Funções

| Aba | O que faz |
|---|---|
| **Limpeza** | Temp, prefetch, logs, relatórios de erro, caches de navegadores (Edge/Chrome/Firefox/Brave/Opera) e apps (Spotify, Discord, Steam, VS Code, Teams, Adobe, NVIDIA) · **Health Check (v1.2)**: score de saúde com "Corrigir tudo" · **exclusões globais** (v1.2): pastas/padrões ignorados em todas as análises e limpezas |
| **Registro** | Desinstaladores órfãos, SharedDLLs, COM/ActiveX, extensões inválidas, MRUs, fontes, App Paths — **backup JSON automático com árvore completa** em `%USERPROFILE%\CClouderBackups` e **restauração pela aba** (v1.3) |
| **Ferramentas** | Acesso rápido ao cleanmgr e pastas de sistema · **gerenciador de menu de contexto** (v1.2) · **Dev Cleaner** (v1.5): caches de npm, pip, NuGet, Cargo, Gradle, Yarn, pnpm, Go, VS Code e Docker · **Reparador de Atalhos Quebrados** (v1.6): varredura de .lnk órfãos no Desktop/Iniciar com exclusão em lote · **Otimizador SSD (TRIM)** (v1.6) |
| **Inicialização** | Gerenciador de programas de inicialização (Run/RunOnce HKCU+HKLM+WOW6432Node, pastas Startup) + **tarefas agendadas de logon/boot** (v1.2) — desabilitar é reversível |
| **Desinstalar** | Lista programas instalados e executa o desinstalador · **Atualizações de software via winget** (v1.3): lista apps desatualizados e atualiza com um clique |
| **Processos** *(v1.3)* | Monitor de processos (RAM/CPU por processo, top 60), **otimizador de memória** (`EmptyWorkingSet`), encerrar processo · **Turbo Boost (v1.6)**: modo gamer/performance com suspensão temporária de serviços secundários (SysMain, Telemetria, WSearch) e max RAM |
| **Arquivos** *(v1.5)* | **Duplicatas** (hash parcial + SHA-256), **Imagens similares** (dHash perceptual), **Pastas vazias**, **Arquivos vazios**, **Maiores arquivos** (top 100) e **Triturador** (sobrescreve, renomeia e apaga) |
| **Automação** *(v1.5)* | **Limpeza agendada** via Agendador do Windows, **CLI headless** (`CClouder.exe --clean --quiet` com log em `%LOCALAPPDATA%\CClouder\logs`), bandeja do sistema, iniciar com Windows e instância única |
| **Configurações** *(v1.5)* | Preferências **realmente persistidas** em `%LOCALAPPDATA%\CClouder\settings.json` (tema claro/escuro, exclusões, tray, agendamento) |
| **Drivers** *(v1.1)* | Escaneia todos os drivers assinados via WMI, backup via `pnputil`, ponto de restauração · **Hardware Doctor (v1.6)**: detecção de dispositivos com falha (código de erro WMI) · **Componentes de Jogos & Runtimes (v1.6)**: checagem e instalação via winget (VC++ 2015-2022, DirectX, .NET) · **Reparo Rápido de Hardware (v1.6)**: reset de áudio e pilha de rede/DNS/Winsock |
| **Disco** | Análise paralela: 20 maiores pastas por tamanho |

## Como funciona

```
┌───────────────────────────── Windows ─────────────────────────────┐
│                                                                   │
│  CClouder.exe (2,5 MB, arquivo único)                             │
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

**2. Ponte IPC.** O frontend usa `invoke`/`listen` de `@tauri-apps/api`, mas **não há runtime Tauri no projeto** — o pacote é usado apenas como cliente do contrato. Um **shim** injetado em cada documento (`AddScriptToExecuteOnDocumentCreatedAsync`) implementa esse contrato em cima do WebView2:
- `invoke(cmd, args)` → `postMessage({__req, __cmd, __payload})` → o C# roteia para o backend e responde com `PostWebMessageAsJson({__req, ok, data})`, resolvendo a Promise do JS;
- `transformCallback(callback)` → registra callbacks numerados, igual ao runtime real do Tauri;
- `listen(event, handler)` → o handler é registrado localmente no shim e o C# entrega eventos (`scan-progress`, `scan-complete`) via `ExecuteScriptAsync("window.__TAURI_INTERNALS__.runCallback(id, {event, payload})")`.

**3. Backend nativo (`Backend.cs`).** Cada comando executa operações reais do Windows:

| Comando | O que faz no sistema |
|---|---|
| `get_categories` | Devolve o catálogo de limpeza (5 categorias, 30 itens) |
| `start_scan` | Mede tamanho/quantidade de cada item (dirs, globs, arquivos) em thread separada, emitindo progresso; Registro é auditado de verdade (SharedDLLs apontando p/ arquivo inexistente, desinstaladores órfãos, CLSID sem servidor, extensões sem ProgID, fontes ausentes, App Paths quebrados, MRUs) |
| `clean_selected` | Deleta arquivos/pastas (falha silenciosa em arquivos em uso) e **exporta backup JSON para `%USERPROFILE%\CClouderBackups` antes de apagar qualquer valor/chave de registro** |
| `get_startup_items` / `toggle_startup_item` | Lê Run/RunOnce (HKCU, HKLM, WOW6432Node) + pastas Startup; **desabilitar nunca destrói**: o valor migra para `HKCU\Software\CClouder\StartupDisabled` e pode ser restaurado |
| `get_installed_programs` / `uninstall_program` | Enumera as 3 chaves Uninstall e executa o `UninstallString` |
| `analyze_disk` | Tamanho recursivo **paralelo** (`Parallel.ForEach`) das pastas do caminho |

**4. Por que WPF/WebView2?** O backend nativo é C#/.NET 10, sem Rust no projeto. O shell é a única implementação oficial: publica um exe único de ~3 MB e não requer toolchain além do SDK .NET. (O antigo esqueleto Tauri em `src-tauri/` foi removido para não manter dois backends divergentes.)

**5. Segurança.** `asInvoker` (sem pedir admin por padrão — itens de sistema que exigem elevation simplesmente falham e são contados como "itens pulados"); nada é enviado para fora do computador; nenhum código ofuscado. A ponte IPC só aceita mensagens da origem local `https://cclinear.app` e a navegação para outras origens é bloqueada. O WebView2 roda com DevTools, menus de contexto, downloads, autofill e permissões de dispositivo desativados, `AreHostObjectsAllowed=false` e CSP restritiva (`default-src 'self'`); as fontes são as do próprio Windows, sem `fonts.googleapis.com`.

**6. Proteções de exclusão.** `delete_files`/`shred_paths` (e as limpezas) recusam unidades inteiras, pastas de sistema (Windows, Program Files, ProgramData), a raiz do perfil e links simbólicos/junctions; as exclusões configuradas também são respeitadas. A limpeza do Firefox toca apenas o diretório `cache2` de cada perfil lido de `profiles.ini`, nunca o perfil inteiro. A sobrescrita do triturador não garante apagamento físico em SSDs, armazenamento flash ou volumes com snapshots.

## Auto-update (v1.3)

A aba **Configurações → Sobre** consulta `api.github.com/repos/contatoaff-tech/CClouder/releases/latest`, compara com a versão instalada e, se houver versão nova, baixa o `CClouder.exe` da release. Antes de instalar, o app confere se a URL é o asset oficial mais recente, valida o tamanho e o **SHA-256 publicado no asset** (`digest` da API do GitHub) e recusa atualizações sem digest. O executável é preparado ao lado do instalado e um helper do PowerShell faz a troca com backup e reabre o app; falhas ficam registradas em `%LOCALAPPDATA%\CClouder\update.log`.

> Releases sem `digest` SHA-256 no asset não são instaladas. Publique o executável pela interface de releases do GitHub (ou envie o digest no asset) para habilitar o auto-update.

## Estrutura

```
CClouder/
├── src/               # Frontend React + TypeScript + Tailwind (10 abas, 17 componentes)
├── shell/             # Shell nativo WPF + WebView2 (C#/.NET 10) — único backend
│   ├── MainWindow.xaml.cs   # Ponte IPC: shim window.__TAURI_INTERNALS__ ↔ C#
│   ├── Backend.cs           # Scan/limpeza de arquivos, registro, inicialização, disco
│   ├── Tools.cs             # Duplicatas, triturador, menu de contexto, tasks, exclusões
│   ├── FileTools.cs         # Pastas/arquivos vazios, maiores arquivos, imagens similares
│   ├── Drivers.cs           # Drivers, hardware, runtimes, reparos
│   ├── Updates.cs           # winget, processos, auto-update
│   └── RegistryBackup.cs    # Backup e restauração do registro
├── dist/              # Frontend compilado (npm run build)
└── LICENSE            # MIT
```

## Como rodar

```bash
# Frontend
npm install && npm run build

# Shell nativo → exe único (~3 MB)
npm run publish
# ou: dotnet publish shell/CClouder.csproj -c Release -r win-x64 \
#       --self-contained false -p:PublishSingleFile=true \
#       -p:IncludeAllContentForSelfExtract=true
# resultado: shell/bin/Release/net10.0-windows/win-x64/publish/CClouder.exe
```

Requisitos: .NET 10 Desktop Runtime + WebView2 Runtime (ambos já presentes no Windows 11 atualizado).

A versão é definida **apenas** em `package.json`: o Vite injeta `__APP_VERSION__` na UI e o `.csproj` lê o mesmo arquivo para o `FileVersion` do exe.

## Testes e CI

```bash
npm test        # dotnet test tests/CClouder.Tests (xunit)
npm run build   # tsc + vite
```

A suíte cobre descoberta do cache do Firefox via `profiles.ini`, preservação de dados do perfil, validação de caminhos de exclusão, uso do catálogo (não do payload) em `clean_selected` e verificação SHA-256 do auto-update. O workflow em `.github/workflows/ci.yml` compila frontend e shell, roda os testes, publica o exe e confere se o `FileVersion` corresponde ao `package.json`.

## Nota

O CClouder é um programa **original e independente** — não contém código do CCleaner/Piriform/Avast. As funções de limpeza de sistema (temp, cache, registro, inicialização, desinstalação) são operações genéricas do Windows implementadas do zero.