#!/usr/bin/env node
/**
 * Page Steer — Native Messaging Host
 *
 * This process is launched by Chrome via native messaging.
 * It bridges between the MCP server (stdio) and the Chrome extension (native messaging).
 *
 * Architecture:
 *   Claude Desktop ←stdio→ MCP Server (this process) ←native messaging→ Extension Background
 *
 * Native Messaging Protocol:
 *   - Messages are length-prefixed: 4-byte LE uint32 + JSON payload
 *   - Chrome sends messages to stdin, reads from stdout
 *   - Each request has a unique `requestId`; extension responds with `responseToRequestId`
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
// --- Start MCP over stdio (fd 3/4 for MCP, fd 0/1 for native messaging) ---
// NOTE: Native Messaging uses stdin/stdout (fd 0/1).
// MCP StdioServerTransport also uses stdin/stdout by default.
// We need to separate them — MCP will use fd 3 (input) and fd 4 (output),
// or we run MCP on a different transport.
//
// Actually, the standard approach for native messaging hosts that also serve MCP:
// Chrome launches this process → stdin/stdout = native messaging
// MCP client (Claude Desktop) launches a SEPARATE process → stdin/stdout = MCP stdio
//
// So we need TWO entry points:
//   1. native-host.js — launched by Chrome, native messaging on stdin/stdout
//   2. index.js — launched by Claude Desktop, MCP stdio on stdin/stdout, talks to extension via native messaging indirectly
//
// The chrome-mcp-server solves this by having the native host START an HTTP server,
// and MCP clients connect to that HTTP server.
//
// For simplicity, let's do the same: native host starts, extension connects,
// then MCP server listens on SSE or we keep stdio but launch separately.
//
// REVISED ARCHITECTURE:
//   Chrome launches native-host.js → native messaging on stdin/stdout
//   native-host.js starts an MCP SSE server on localhost:PORT
//   Claude Desktop connects to the SSE endpoint
//
// But MCP SDK supports stdio best. Let's use the SAME approach as chrome-mcp-server:
//   The native host is launched by Chrome and keeps the native messaging channel open.
//   It also starts an MCP stdio server — but Claude Desktop doesn't launch this process directly.
//   Instead, Claude Desktop launches a thin wrapper that connects to the native host via... HTTP/SSE.
//
// SIMPLEST APPROACH (matching chrome-mcp-server exactly):
//   1. Chrome launches native-host.js via connectNative
//   2. native-host.js starts an HTTP+SSE MCP server on a local port
//   3. Claude Desktop config points to: { "command": "npx", "args": ["page-steer-mcp"] }
//      which is a thin stdio wrapper connecting to the SSE server
//   OR
//   4. Claude Desktop uses the SSE URL directly (Claude Desktop supports SSE transport)
//
// Let's go with option 4 — start an SSE MCP server directly in the native host.

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import * as z from 'zod/v4'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// Prevent any accidental stdout output from polluting the native messaging channel
const originalStdoutWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, ...args) => {
	// Only allow our explicit native messaging writes (Buffer with 4-byte header)
	if (Buffer.isBuffer(chunk) || (typeof chunk === 'string' && chunk.length > 0)) {
		return originalStdoutWrite(chunk, ...args)
	}
	return true
}

// Keep process alive
process.stdin.resume()
process.stdin.on('end', () => {
	process.exit(0)
})

// --- Native Messaging I/O ---

const pendingRequests = new Map()
const REQUEST_TIMEOUT_MS = 30_000

let nativeBuffer = Buffer.alloc(0)
let expectedLength = -1

process.stdin.on('readable', () => {
	let chunk
	while ((chunk = process.stdin.read()) !== null) {
		nativeBuffer = Buffer.concat([nativeBuffer, chunk])

		while (true) {
			if (expectedLength === -1 && nativeBuffer.length >= 4) {
				expectedLength = nativeBuffer.readUInt32LE(0)
				nativeBuffer = nativeBuffer.slice(4)
			}

			if (expectedLength !== -1 && nativeBuffer.length >= expectedLength) {
				const msgBuf = nativeBuffer.slice(0, expectedLength)
				nativeBuffer = nativeBuffer.slice(expectedLength)
				expectedLength = -1

				try {
					const msg = JSON.parse(msgBuf.toString())
					handleNativeMessage(msg)
				} catch {
					// ignore parse errors
				}
			} else {
				break
			}
		}
	}
})

function sendNativeMessage(msg) {
	const json = JSON.stringify(msg)
	const buf = Buffer.from(json)
	const header = Buffer.alloc(4)
	header.writeUInt32LE(buf.length, 0)
	// stdout is used for native messaging with Chrome, NOT for MCP stdio
	// MCP uses a separate fd pair — see StdioServerTransport
	process.stdout.write(Buffer.concat([header, buf]))
}

function handleNativeMessage(msg) {
	// Response to a pending request
	if (msg.responseToRequestId) {
		const pending = pendingRequests.get(msg.responseToRequestId)
		if (pending) {
			clearTimeout(pending.timeoutId)
			pendingRequests.delete(msg.responseToRequestId)
			if (msg.payload?.status === 'error') {
				pending.reject(new Error(msg.payload.message || 'Extension error'))
			} else {
				pending.resolve(msg.payload?.data ?? msg.payload)
			}
		}
		return
	}

	// Status updates from extension
	if (msg.type === 'server_started' || msg.type === 'pong_to_extension') {
		// ignore
	}
}

/**
 * Send a command to the extension and wait for response.
 */
function callExtension(command, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		const requestId = randomUUID()
		const timeoutId = setTimeout(() => {
			pendingRequests.delete(requestId)
			reject(new Error(`Request timed out after ${timeoutMs}ms`))
		}, timeoutMs)

		pendingRequests.set(requestId, { resolve, reject, timeoutId })

		sendNativeMessage({
			type: 'call_tool',
			requestId,
			payload: { command, params },
		})
	})
}

// --- Helpers ---

function textResult(text) {
	return { content: [{ type: 'text', text }] }
}

function errorResult(msg) {
	return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

async function runCommand(command, params = {}) {
	try {
		const result = await callExtension(command, params)
		const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
		return textResult(text)
	} catch (err) {
		return errorResult(err.message)
	}
}

// --- MCP Server ---

const mcpServer = new McpServer({ name: 'page-steer', version })

// Navigation
mcpServer.registerTool(
	'navigate',
	{
		description: 'Navigate the current tab to a URL.',
		inputSchema: { url: z.string().describe('The URL to navigate to') },
	},
	async ({ url }) => runCommand('navigate', { url })
)

mcpServer.registerTool(
	'open_new_tab',
	{
		description: 'Open a new browser tab with the specified URL.',
		inputSchema: { url: z.string().describe('The URL to open') },
	},
	async ({ url }) => runCommand('open_new_tab', { url })
)

mcpServer.registerTool(
	'switch_tab',
	{
		description: 'Switch to an existing browser tab by its ID.',
		inputSchema: { tab_id: z.number().int().describe('The tab ID to switch to') },
	},
	async ({ tab_id }) => runCommand('switch_tab', { tab_id })
)

mcpServer.registerTool(
	'close_tab',
	{
		description: 'Close a browser tab by its ID.',
		inputSchema: { tab_id: z.number().int().describe('The tab ID to close') },
	},
	async ({ tab_id }) => runCommand('close_tab', { tab_id })
)

mcpServer.registerTool(
	'get_tabs',
	{ description: 'List all open browser tabs with their IDs, URLs, and titles.' },
	async () => runCommand('get_tabs')
)

// Page Content
mcpServer.registerTool(
	'get_page_content',
	{ description: 'Get the text content of the current page (up to 80K chars).' },
	async () => runCommand('get_page_content')
)

mcpServer.registerTool(
	'get_page_info',
	{ description: 'Get the current page URL, title, and tab ID.' },
	async () => runCommand('get_page_info')
)

// Page Actions
mcpServer.registerTool(
	'click',
	{
		description: 'Click an interactive element by its index.',
		inputSchema: { index: z.number().int().describe('The element index to click') },
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
	'scroll',
	{
		description: 'Scroll the page or a specific element.',
		inputSchema: {
			direction: z.enum(['up', 'down']).describe('Scroll direction'),
			amount: z.number().optional().describe('Pages to scroll (default: 1)'),
		},
	},
	async ({ direction, amount }) => runCommand('scroll', { direction, amount })
)

mcpServer.registerTool(
	'execute_javascript',
	{
		description:
			'Execute JavaScript code in the current page context. May fail on pages with strict CSP (like x.com). Use query_dom for DOM operations on such pages.',
		inputSchema: { code: z.string().describe('JavaScript code to execute') },
	},
	async ({ code }) => runCommand('execute_javascript', { code })
)

mcpServer.registerTool(
	'query_dom',
	{
		description:
			'Query DOM elements on the current page. Works on all pages regardless of CSP. Actions: "info" (default, get element details), "list_testids" (list all data-testid values), "structure" (get element and its child testids), "count" (count matching elements), "texts" (get text of matching elements, up to 20), "html" (get outerHTML of first match, up to 5000 chars).',
		inputSchema: {
			selector: z
				.string()
				.optional()
				.describe('CSS selector to query (required for all actions except list_testids)'),
			action: z
				.enum(['info', 'list_testids', 'structure', 'count', 'texts', 'html'])
				.optional()
				.describe('What to do with the matched elements (default: info)'),
		},
	},
	async ({ selector, action }) =>
		runCommand('query_dom', { selector: selector || '', action: action || 'info' })
)

mcpServer.registerTool(
	'execute_task',
	{
		description:
			'Execute a full automation task using the built-in AI agent. Best for complex multi-step tasks.',
		inputSchema: { task: z.string().describe('Natural language task description') },
	},
	async ({ task }) => runCommand('execute_task', { task })
)

mcpServer.registerTool(
	'list_skills',
	{
		description: 'List all available platform-specific skills and their actions.',
	},
	async () => runCommand('list_skills')
)

mcpServer.registerTool(
	'run_skill',
	{
		description:
			'Run a platform-specific skill action. Skills provide precise DOM automation for platforms like Twitter/X. Use list_skills to see available skills and actions.',
		inputSchema: {
			skill: z.string().describe('Skill ID (e.g. "twitter")'),
			action: z.string().describe('Action name (e.g. "get_timeline", "post_tweet", "like")'),
			params: z.record(z.any()).optional().describe('Action parameters (depends on the action)'),
		},
	},
	async ({ skill, action, params }) =>
		runCommand('run_skill', { skill, action, params: params || {} })
)

mcpServer.registerTool(
	'enable_skill',
	{
		description: 'Enable or disable a skill.',
		inputSchema: {
			skill: z.string().describe('Skill ID to enable/disable'),
			enabled: z.boolean().describe('Whether to enable (true) or disable (false) the skill'),
		},
	},
	async ({ skill, enabled }) => runCommand('enable_skill', { skill, enabled })
)

// --- Skill Learning ---

mcpServer.registerTool(
	'learn_skill_start',
	{
		description:
			'Start recording a new learned skill. AI observes operations and records them as reusable steps.',
		inputSchema: {
			skill_id: z.string().describe('Unique ID for the new skill (e.g. "xiaohongshu-publish")'),
		},
	},
	async ({ skill_id }) => runCommand('learn_skill_start', { skill_id })
)

mcpServer.registerTool(
	'learn_skill_step',
	{
		description:
			'Record a single step during skill learning. Steps: click, input, navigate, wait, scroll, extract.',
		inputSchema: {
			step: z
				.object({
					type: z
						.enum(['click', 'input', 'navigate', 'wait', 'scroll', 'extract'])
						.describe('Step type'),
					selector: z.string().describe('CSS selector for target element'),
					fallbackSelectors: z
						.array(z.string())
						.optional()
						.describe('Fallback selectors in priority order'),
					value: z
						.string()
						.optional()
						.describe('Value for input/navigate. Use {{paramName}} for parameters'),
					isParam: z.boolean().optional().describe('Whether value contains parameter placeholders'),
					waitMs: z.number().optional().describe('Wait duration in ms (for wait steps)'),
					description: z.string().optional().describe('What this step does'),
				})
				.describe('The step to record'),
		},
	},
	async ({ step }) => runCommand('learn_skill_step', { step })
)

mcpServer.registerTool(
	'learn_skill_save',
	{
		description: 'Stop recording and save the learned skill with metadata.',
		inputSchema: {
			meta: z
				.object({
					id: z.string().describe('Skill ID'),
					name: z.string().describe('Display name'),
					version: z.string().optional().describe('Version (default: 1.0.0)'),
					description: z.string().describe('What this skill does'),
					matchPatterns: z.array(z.string()).describe('URL regex patterns this skill works on'),
					icon: z.string().optional().describe('Emoji or icon URL'),
					actions: z
						.array(
							z.object({
								name: z.string(),
								description: z.string(),
								params: z.record(z.any()).optional(),
							})
						)
						.optional()
						.describe('Action definitions'),
					tags: z.array(z.string()).optional().describe('Tags for discovery'),
				})
				.describe('Skill metadata'),
		},
	},
	async ({ meta }) =>
		runCommand('learn_skill_save', {
			meta: {
				...meta,
				version: meta.version || '1.0.0',
				actions: meta.actions || [{ name: 'run', description: meta.description, params: {} }],
			},
		})
)

mcpServer.registerTool(
	'learn_skill_cancel',
	{
		description: 'Cancel the current skill recording.',
	},
	async () => runCommand('learn_skill_cancel')
)

mcpServer.registerTool(
	'get_learned_skills',
	{
		description: 'List all learned (user-recorded) skills.',
	},
	async () => runCommand('get_learned_skills')
)

mcpServer.registerTool(
	'delete_learned_skill',
	{
		description: 'Delete a learned skill.',
		inputSchema: {
			skill: z.string().describe('Skill ID to delete'),
		},
	},
	async ({ skill }) => runCommand('delete_learned_skill', { skill })
)

// --- Community Skills ---

mcpServer.registerTool(
	'community_search',
	{
		description: 'Search the community skill registry for shareable skills.',
		inputSchema: {
			query: z.string().describe('Search query (skill name, description, or tags)'),
		},
	},
	async ({ query }) => runCommand('community_search', { query })
)

mcpServer.registerTool(
	'community_install',
	{
		description: 'Install a skill from the community registry.',
		inputSchema: {
			skill: z.string().describe('Skill ID to install'),
		},
	},
	async ({ skill }) => runCommand('community_install', { skill })
)

mcpServer.registerTool(
	'community_uninstall',
	{
		description: 'Uninstall a community skill.',
		inputSchema: {
			skill: z.string().describe('Skill ID to uninstall'),
		},
	},
	async ({ skill }) => runCommand('community_uninstall', { skill })
)

mcpServer.registerTool(
	'export_skill',
	{
		description: 'Export a learned skill as a shareable JSON package.',
		inputSchema: {
			skill: z.string().describe('Learned skill ID to export'),
		},
	},
	async ({ skill }) => runCommand('export_skill', { skill })
)

mcpServer.registerTool(
	'wait',
	{
		description: 'Wait for a specified number of seconds.',
		inputSchema: { seconds: z.number().describe('Seconds to wait (1-30)') },
	},
	async ({ seconds }) => {
		const ms = Math.min(Math.max(seconds, 0.1), 30) * 1000
		await new Promise((r) => setTimeout(r, ms))
		return textResult(`Waited ${seconds}s.`)
	}
)

const MCP_PORT = 12315

const httpServer = http.createServer()
let sseTransport = null

httpServer.on('request', async (req, res) => {
	if (req.method === 'GET' && req.url === '/sse') {
		// Close previous connection before accepting a new one
		if (sseTransport) {
			try {
				await mcpServer.close()
			} catch {
				// ignore close errors on stale connection
			}
			sseTransport = null
		}
		sseTransport = new SSEServerTransport('/messages', res)
		await mcpServer.connect(sseTransport)
		return
	}
	if (req.method === 'POST' && req.url?.startsWith('/messages')) {
		if (!sseTransport) {
			res.writeHead(503)
			res.end('No active SSE connection')
			return
		}
		await sseTransport.handlePostMessage(req, res)
		return
	}
	// Health check
	if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ status: 'ok', version }))
		return
	}
	res.writeHead(404)
	res.end('Not found')
})

httpServer.listen(MCP_PORT, '127.0.0.1', () => {
	// Notify extension that server is ready
	sendNativeMessage({ type: 'server_started', payload: { port: MCP_PORT } })
})

httpServer.on('error', (err) => {
	sendNativeMessage({ type: 'error', payload: { message: err.message } })
})
