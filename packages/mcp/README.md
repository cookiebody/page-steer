# @page-steer/mcp

MCP server that lets AI agent clients (Claude Desktop, Copilot, etc.) control your browser through the [Page Steer](https://github.com/cookiebody/PageSteer) extension.

## Prerequisites

- Node.js >= 20
- [Page Steer Extension](https://chromewebstore.google.com/detail/page-steer-ext/akldabonmimlicnjlflnapfeklbfemhj) installed in Chrome
- An LLM API key (OpenAI-compatible)

## Installation

Page Steer supports two MCP connection modes. Use the stdio package for most MCP clients. Use the native host only when your client requires an HTTP/SSE endpoint.

### Recommended: stdio package

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
    "mcpServers": {
        "page-steer": {
            "command": "npx",
            "args": ["-y", "@page-steer/mcp"]
        }
    }
}
```

The stdio package starts a local launcher on `http://localhost:38401` by default, then opens the Page Steer extension hub tab.

> **Model config lives in the extension.** By default the MCP server uses the LLM you configured inside the Page Steer extension — you do **not** need to set any keys here. Only add the optional `env` overrides below if you want `execute_task` to use a different model than the extension's:
>
> ```json
> {
>     "mcpServers": {
>         "page-steer": {
>             "command": "npx",
>             "args": ["-y", "@page-steer/mcp"],
>             "env": {
>                 "LLM_BASE_URL": "https://api.your-provider.com/v1",
>                 "LLM_API_KEY": "sk-xxx",
>                 "LLM_MODEL_NAME": "your-model"
>             }
>         }
>     }
> }
> ```

### Alternative: native host SSE endpoint

Install the Chrome native messaging host:

```bash
node packages/mcp/src/install.js
```

This mode exposes an SSE endpoint at `http://127.0.0.1:12315/sse` after Chrome starts the native host. Use this URL only for MCP clients that support remote/SSE servers.

### Cursor / Copilot

Use the stdio package config above unless your client explicitly asks for an SSE URL.

## MCP Tools

| Tool           | Input              | Description                                           |
| -------------- | ------------------ | ----------------------------------------------------- |
| `execute_task` | `{ task: string }` | Execute a browser task in natural language. Blocking. |
| `get_status`   | —                  | Returns `{ connected, busy }`                         |
| `stop_task`    | —                  | Stop the currently running task.                      |

## Environment Variables

All LLM variables are **optional**. When unset, `execute_task` uses the model configured inside the Page Steer extension. Set them only to override the extension's model for MCP-driven tasks.

| Variable         | Default | Description                                    |
| ---------------- | ------- | ---------------------------------------------- |
| `LLM_BASE_URL`   | —       | LLM API base URL (optional override)           |
| `LLM_API_KEY`    | —       | LLM API key (optional override)                |
| `LLM_MODEL_NAME` | —       | Model name (optional override)                 |
| `PORT`           | `38401` | Stdio package launcher + WebSocket bridge port |

Native host SSE mode always listens on `127.0.0.1:12315`.

## How It Works

```
┌──────────────┐  stdio   ┌──────────────────┐  WebSocket   ┌──────────────┐
│ Claude /     │◄────────►│ @page-steer/mcp  │◄────────────►│ Hub tab      │
│ Copilot      │  (MCP)   │ (Node.js)        │  (localhost) │ (extension)  │
└──────────────┘          └──────────────────┘              └──────┬───────┘
                                   │                               │
                                   │ HTTP                          │ useAgent
                                   ▼                               ▼
                          ┌──────────────────┐              ┌──────────────┐
                          │ Launcher page    │              │ MultiPage    │
                          │ (localhost:PORT) │              │ Agent        │
                          └──────────────────┘              └──────────────┘
```

1. Agent client starts the MCP server via stdio (`npx @page-steer/mcp`).
2. Server starts HTTP + WS on `localhost:PORT`, opens the launcher page in browser.
3. Launcher page triggers the extension to open a **hub tab** (`hub.html?ws=PORT`).
4. Hub connects to the WS server. MCP tools now proxy tasks to the hub.

The hub tab speaks a generic WebSocket protocol (defined in `hub-ws.ts` in the extension package) and has no knowledge of MCP. See the hub's protocol docs for message format details.

## Architecture

Pure JS ESM, no build step. Source files are the published artifacts.

```
src/
├── index.js        # CLI entry: MCP server (stdio) + opens launcher
├── hub-bridge.js   # HTTP server + WebSocket bridge to hub tab
└── launcher.html   # Bootstrap page: detects extension, triggers hub open
```

## Dev

```bash
npm run dev:ext
npx @modelcontextprotocol/inspector node packages/mcp/src/index.js
```
