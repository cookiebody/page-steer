# Page Steer

[![License: MIT](https://img.shields.io/badge/License-MIT-auto.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/) [![GitHub stars](https://img.shields.io/github/stars/cookiebody/page-steer.svg)](https://github.com/cookiebody/PageSteer)

AI-Powered Browser Assistant — Control any web interface with natural language, with a built-in Skill system for platform-specific precision automation.

🌐 **English** | [中文](./docs/README-zh.md)

<a href="https://cookiebody.github.io/docs/page-steer/" target="_blank"><b>📖 Docs</b></a> | <a href="https://github.com/cookiebody/PageSteer" target="_blank"><b>💻 Source</b></a>

---

## ✨ What is Page Steer?

Page Steer is a browser extension + JS library that lets AI directly operate web pages. Instead of taking screenshots and guessing, it reads the live DOM, understands the page structure, and executes precise actions.

<p align="center">
  <img src="docs/indexpage.png" alt="Page Steer sidepanel chat" width="360" />
</p>

**What makes it different:**

- **Skill System** — Platform-specific recipes (like Twitter/X, Google Trends) that bypass DOM guesswork. Skills use stable selectors (data-testid, aria-label) for reliable, token-efficient automation.
- **No screenshots, no vision models** — Pure text-based DOM understanding. Works with any LLM.
- **Three ways, one engine** — Chrome extension (sidepanel chat) for everyday users, MCP server for Cursor/Claude Desktop, or embed as JS for your own app.
- **Learns from use** — AI records successful runs and replays them as reusable skills. Import/export to share.

## 🧩 Skill System

Skills are platform-specific automation recipes that give the AI precise, reliable actions instead of relying on DOM parsing every time.

<p align="center">
  <img src="docs/skillpage.png" alt="Page Steer Skills panel with built-in Twitter/X and Google Trends skills" width="360" />
</p>

```
┌─────────────────────────────────────────────┐
│  User: "Post a tweet saying hello world"    │
│                                             │
│  Agent detects: x.com → twitter skill       │
│  Agent calls: twitter_post_tweet({          │
│    text: "hello world"                      │
│  })                                         │
│                                             │
│  Skill executes via data-testid selectors   │
│  → Reliable, fast, no DOM guessing          │
└─────────────────────────────────────────────┘
```

### Three Sources of Skills

| Source        | Description                                                      |
| ------------- | ---------------------------------------------------------------- |
| **Built-in**  | Ships with the extension (Twitter/X, Google Trends)              |
| **Learned**   | AI records successful interactions and saves as reusable recipes |
| **Community** | Import/export skills, share via the project repo                 |

### Built-in Skills

| Skill             | Actions                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Twitter/X**     | `get_timeline`, `post_tweet`, `like`, `retweet`, `reply`, `search`, `get_profile`, `get_tweet_detail`                                            |
| **Google Trends** | `search_explore`, `compare_terms`, `get_page_data`, `set_location`, `set_time_period`, `set_category`, `get_trending_now`, `get_trending_detail` |

Skills target stable selectors (React `data-testid`, `aria-label`) for reliable, CSP-safe automation. More platforms coming — or write your own.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│  Chrome Extension                                   │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Sidepanel │  │   MCP    │  │   Background     │ │
│  │ (Chat UI) │  │  Server  │  │  (Skill Registry │ │
│  │  + Slash  │  │ (Native  │  │   + Executor)    │ │
│  │   Menu    │  │  Host)   │  │                  │ │
│  └─────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│        │              │                  │           │
│        └──────────────┴──────────────────┘           │
│                       │                              │
│              PageSteerCore (Agent Loop)              │
│              ┌────────┴────────┐                     │
│              │  Skill Tools    │ ← Auto-injected     │
│              │  + DOM Tools    │   based on URL       │
│              └────────┬────────┘                     │
│                       │                              │
│              PageController (DOM Ops)                │
└───────────────────────┼──────────────────────────────┘
                        │
                   Target Tab
```

### Monorepo Packages

| Package                       | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `@page-steer/page-controller` | DOM extraction + visual feedback         |
| `@page-steer/llms`            | LLM client with reflection-before-action |
| `@page-steer/core`            | Headless agent core                      |
| `@page-steer/ui`              | Panel UI + i18n                          |
| `page-steer`                  | Main entry with UI (JS library)          |
| `packages/mcp`                | MCP server for external AI clients       |
| `packages/extension`          | Chrome extension (WXT + React)           |

## 🚀 Quick Start

### Chrome Extension

1. Clone and build:

```bash
git clone https://github.com/cookiebody/PageSteer.git
cd page-steer
npm install
npm run build:ext
```

2. Load in Chrome:
    - Go to `chrome://extensions`
    - Enable Developer mode
    - Click "Load unpacked" → select `packages/extension/.output/chrome-mv3`

3. Open sidepanel, configure your LLM endpoint, and start chatting.

### MCP Server (for Cursor / Claude Desktop)

```bash
cd packages/mcp
node src/install.js
```

Then add to your MCP client config. See [MCP docs](./packages/mcp/README.md).

### JS Library (embed in your app)

```bash
npm install page-steer
```

```javascript
import { PageSteer } from 'page-steer'

const agent = new PageSteer({
    model: 'your-model',
    baseURL: 'https://your-api-endpoint/v1',
    apiKey: 'YOUR_API_KEY',
})

await agent.execute('Fill in the contact form with test data')
```

## 💡 Use Cases

- **Browser Automation** — "Check my timeline" / "Post a tweet" / "Search AI agents"
- **SaaS AI Copilot** — Embed in your product, ship AI copilot in lines of code
- **Smart Form Filling** — Turn 20-click workflows into one sentence
- **Multi-tab Operations** — Agent works across browser tabs via the extension
- **MCP Integration** — Let Cursor/Claude Desktop control your browser

## 🛠️ Development

```bash
npm run dev:ext         # Extension dev mode
npm run dev:demo        # Demo dev server
npm run build           # Build all packages
npm run build:ext       # Build + zip extension
npm run typecheck       # Type check
npm run test            # Run tests
```

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## ⚖️ License

[MIT License](LICENSE)

## 👏 Acknowledgments

DOM processing components derived from [browser-use](https://github.com/browser-use/browser-use) (MIT License, Copyright (c) 2024 Gregor Zunic).

---

**⭐ Star this repo if you find Page Steer useful!**
