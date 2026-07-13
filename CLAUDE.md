# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Page Steer is an AI-Powered Browser Assistant — control web interfaces with natural language. No browser extension, Python, or headless browser required for basic use.

This is a **monorepo** with npm workspaces (must remain in topological order in root `package.json`):

| Package                     | npm name                      | Purpose                                                             |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `packages/page-controller/` | `@page-steer/page-controller` | DOM operations + visual feedback (SimulatorMask). No LLM dependency |
| `packages/ui/`              | `@page-steer/ui`              | Panel and i18n. Decoupled from PageSteer via PanelAgentAdapter      |
| `packages/llms/`            | `@page-steer/llms`            | LLM client with reflection-before-action mental model               |
| `packages/core/`            | `@page-steer/core`            | PageSteerCore (headless). Imports llms + page-controller            |
| `packages/page-steer/`      | `page-steer`                  | Main entry with UI. Extends Core, adds Panel                        |
| `packages/mcp/`             | —                             | MCP server                                                          |
| `packages/extension/`       | —                             | Browser extension (WXT + React)                                     |
| `packages/website/`         | —                             | React docs/landing (see `packages/website/AGENTS.md`)               |

## Commands

```bash
npm start                       # Website dev server
npm run dev:demo                # Demo dev server (page-steer IIFE)
npm run dev:ext                 # Extension dev mode (WXT)
npm run build                   # Build all packages (via scripts/build.js)
npm run build:libs              # Build libraries only
npm run build:ext               # Build + zip extension
npm run typecheck               # Typecheck all (extension checked separately)
npm run test                    # Unit tests across all workspaces
npm run lint                    # ESLint
node scripts/ci.js              # Full CI: commitlint + lint + format + typecheck + test + build
node scripts/ci.js --no-build   # CI without build step
```

Single-package testing:

```bash
npm test -w @page-steer/llms        # Run tests for one package
cd packages/llms && npx vitest      # Watch mode in one package
```

## Architecture

### Source-First Monorepo

Library `package.json` exports point to `src/*.ts` during development. At publish time, `scripts/pre-publish.js` promotes `publishConfig` fields (swapping to `dist/`), and `scripts/post-publish.js` restores the originals.

### Dependency Graph

```
page-steer → core → llms
                  → page-controller
page-steer → ui
```

- **LLMs** exposes the `MacroToolInput` contract. No dependency on page-steer or DOM.
- **Page Controller** handles DOM extraction, simplified HTML, and indexed element operations. No LLM dependency. Enable visual mask via `enableMask: true`.
- **UI** connects to agents only through the `PanelAgentAdapter` interface.

### DOM Pipeline

1. Live DOM → `FlatDomTree` (via `page-controller/src/dom/dom_tree/`)
2. DOM tree → dehydrated simplified text for LLM
3. LLM returns action plans with element indices
4. PageSteer calls PageController by index: `clickElement(index)`, `inputText(index, text)`, `scroll(...)`, etc.

### PageController ↔ PageSteer Communication

All communication is async. PageSteer delegates DOM operations:

```typescript
await this.pageController.updateTree()
await this.pageController.clickElement(index)
await this.pageController.inputText(index, text)
await this.pageController.scroll({ down: true, numPages: 1 })
const html = await this.pageController.getSimplifiedHTML()
```

## Adding Features

### New Agent Tool

1. Implement in `packages/core/src/tools/index.ts`
2. If it needs DOM ops, add method to PageController first
3. Tool calls `this.pageController.methodName()`

### New PageController Action

1. Add in `packages/page-controller/src/actions.ts`
2. Expose via async method in `PageController.ts`
3. Export from `packages/page-controller/src/index.ts`

## Testing

- **Framework**: Vitest, co-located (`src/foo.test.ts` next to `src/foo.ts`)
- **Coverage today**: primarily `packages/llms`; other packages follow incrementally
- **New package tests**: add `vitest.config.ts` + `"test": "vitest run"` script; root `npm test` picks it up

## Code Standards

- All code and comments in English
- Explicit typing for exported/public APIs
- Prettier: tabs, single quotes, no semicolons, 100 print width, sorted imports
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint
- Git hooks: `commit-msg` → commitlint, `pre-commit` → lint-staged (prettier + eslint)
- Do not hide errors or risks — make them visible and actionable
- Traceability and predictability over success rate
- Required engine: Node ^22.22.1 || >=24, npm ^11.6.3
