# CClinear

Limpador de sistema para Windows — **open source (MIT), leve (exe único de 2,5 MB), sem telemetria, sem upsell, todas as funções liberadas.**

Interface moderna (React + Tailwind) hospedada em WebView2, com backend nativo C#/.NET 10.

## Funções

| Aba | O que faz |
|---|---|
| **Limpeza** | Temp, prefetch, logs, relatórios de erro, caches de navegadores (Edge/Chrome/Firefox/Brave/Opera) e apps (Spotify, Discord, Steam, VS Code, Teams, Adobe, NVIDIA) |
| **Registro** | Desinstaladores órfãos, SharedDLLs, COM/ActiveX, extensões inválidas, MRUs, fontes, App Paths — **com backup JSON automático** em `%USERPROFILE%\CClinearBackups` |
| **Ferramentas** | Acesso rápido ao cleanmgr e pastas de sistema |
| **Inicialização** | Gerenciador de programas de inicialização (Run/RunOnce HKCU+HKLM+WOW6432Node, pastas Startup) — desabilitar é reversível (armazenado em `HKCU\Software\CClinear\StartupDisabled`) |
| **Desinstalar** | Lista programas instalados e executa o desinstalador |
| **Disco** | Análise paralela: 20 maiores pastas por tamanho |

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