#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { platform } from 'node:os'
import * as z from 'zod/v4'

import { HubBridge } from './hub-bridge.js'

const env = process.env
const port = parseInt(env.PORT || '38401')
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// Optional LLM override. When unset, execute_task falls back to the model
// configured inside the Page Steer extension (config is passed as undefined).
/** @type {Record<string, string>} */
const llmConfig = {}
if (env.LLM_BASE_URL) llmConfig.baseURL = env.LLM_BASE_URL
if (env.LLM_MODEL_NAME) llmConfig.model = env.LLM_MODEL_NAME
if (env.LLM_API_KEY) llmConfig.apiKey = env.LLM_API_KEY

// --- Hub bridge (HTTP + WebSocket) ---

const hub = new HubBridge(port)
await hub.start()

// Open launcher in default browser
const url = `http://localhost:${port}`
const openCmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start ""' : 'xdg-open'
exec(`${openCmd} "${url}"`, (err) => {
	if (err) console.error(`[page-steer-mcp] Could not open browser: ${err.message}`)
})

// --- Helper ---

function textResult(text) {
	return { content: [{ type: 'text', text }] }
}

function errorResult(msg) {
	return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

async function runCommand(command, params = {}) {
	try {
		const result = await hub.sendCommand(command, params)
		return textResult(
			typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
		)
	} catch (err) {
		return errorResult(err.message)
	}
}

// --- MCP server (stdio) ---

const mcpServer = new McpServer({ name: 'page-steer', version })

// ==================== High-level ====================

mcpServer.registerTool(
	'execute_task',
	{
		description:
			'Execute a full automation task using the built-in AI agent. The agent will observe the page, plan, and execute multiple steps autonomously. Best for complex multi-step tasks.',
		inputSchema: {
			task: z
				.string()
				.describe(
					'Natural language task description. Be specific about what to do and what result you expect.'
				),
		},
	},
	async ({ task }) => {
		try {
			// Pass overrides only if provided; otherwise let the extension use its own model config.
			const config = Object.keys(llmConfig).length > 0 ? llmConfig : undefined
			const result = await hub.executeTask(task, config)
			return textResult(
				result.success ? `Task completed.\n\n${result.data}` : `Task failed.\n\n${result.data}`
			)
		} catch (err) {
			return errorResult(err.message)
		}
	}
)

mcpServer.registerTool(
	'get_status',
	{ description: 'Check the connection status of the Page Steer extension.' },
	async () => textResult(JSON.stringify({ connected: hub.connected, busy: hub.busy }, null, 2))
)

mcpServer.registerTool(
	'stop_task',
	{ description: 'Stop the currently running automation task.' },
	async () => {
		hub.stopTask()
		return textResult('Stop signal sent.')
	}
)

// ==================== Navigation ====================

mcpServer.registerTool(
	'navigate',
	{
		description: 'Navigate the current tab to a URL.',
		inputSchema: {
			url: z.string().describe('The URL to navigate to'),
		},
	},
	async ({ url }) => runCommand('navigate', { url })
)

mcpServer.registerTool(
	'open_new_tab',
	{
		description:
			'Open a new browser tab with the specified URL. The new tab becomes the active tab.',
		inputSchema: {
			url: z.string().describe('The URL to open'),
		},
	},
	async ({ url }) => runCommand('open_new_tab', { url })
)

mcpServer.registerTool(
	'switch_tab',
	{
		description: 'Switch to an existing browser tab by its ID.',
		inputSchema: {
			tab_id: z.number().int().describe('The tab ID to switch to (from get_tabs)'),
		},
	},
	async ({ tab_id }) => runCommand('switch_tab', { tab_id })
)

mcpServer.registerTool(
	'close_tab',
	{
		description: 'Close a browser tab by its ID.',
		inputSchema: {
			tab_id: z.number().int().describe('The tab ID to close'),
		},
	},
	async ({ tab_id }) => runCommand('close_tab', { tab_id })
)

mcpServer.registerTool(
	'get_tabs',
	{
		description: 'List all open browser tabs with their IDs, URLs, and titles.',
	},
	async () => runCommand('get_tabs')
)

// ==================== Page Content ====================

mcpServer.registerTool(
	'get_page_content',
	{
		description:
			'Get the current page content as simplified DOM tree. Interactive elements are marked with [index] for use with click/type actions.',
	},
	async () => runCommand('get_page_content')
)

mcpServer.registerTool(
	'get_page_info',
	{
		description: 'Get the current page URL and title.',
	},
	async () => runCommand('get_page_info')
)

// ==================== Page Actions ====================

mcpServer.registerTool(
	'click',
	{
		description: 'Click an interactive element by its index (from get_page_content).',
		inputSchema: {
			index: z.number().int().describe('The element index to click (e.g. [42] → index: 42)'),
		},
	},
	async ({ index }) => runCommand('click', { index })
)

mcpServer.registerTool(
	'type_text',
	{
		description: 'Type text into an input element by its index.',
		inputSchema: {
			index: z.number().int().describe('The input element index'),
			text: z.string().describe('The text to type'),
		},
	},
	async ({ index, text }) => runCommand('type_text', { index, text })
)

mcpServer.registerTool(
	'select_option',
	{
		description: 'Select a dropdown option by element index and option text.',
		inputSchema: {
			index: z.number().int().describe('The select element index'),
			option: z.string().describe('The option text to select'),
		},
	},
	async ({ index, option }) => runCommand('select_option', { index, option })
)

mcpServer.registerTool(
	'scroll',
	{
		description: 'Scroll the page or a specific element.',
		inputSchema: {
			direction: z.enum(['up', 'down']).describe('Scroll direction'),
			amount: z.number().optional().describe('Number of pages to scroll (default: 1)'),
			index: z.number().int().optional().describe('Element index to scroll (omit for page scroll)'),
		},
	},
	async ({ direction, amount, index }) => runCommand('scroll', { direction, amount, index })
)

mcpServer.registerTool(
	'execute_javascript',
	{
		description:
			'Execute JavaScript code in the current page context. Returns the result as a string.',
		inputSchema: {
			code: z.string().describe('JavaScript code to execute in the page'),
		},
	},
	async ({ code }) => runCommand('execute_javascript', { code })
)

mcpServer.registerTool(
	'wait',
	{
		description: 'Wait for a specified number of seconds.',
		inputSchema: {
			seconds: z.number().describe('Number of seconds to wait (1-30)'),
		},
	},
	async ({ seconds }) => {
		const ms = Math.min(Math.max(seconds, 0.1), 30) * 1000
		await new Promise((resolve) => setTimeout(resolve, ms))
		return textResult(`Waited ${seconds}s.`)
	}
)

// --- Start ---

const transport = new StdioServerTransport()
await mcpServer.connect(transport)
console.error('[page-steer-mcp] MCP server ready (stdio)')
