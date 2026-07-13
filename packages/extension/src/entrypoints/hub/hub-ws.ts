/**
 * Hub WebSocket Protocol
 *
 * Hub connects as WS client to `ws://localhost:{port}`.
 * All messages are JSON. One task at a time.
 *
 * Inbound (Caller → Hub):
 *   { type: "execute", task: string, config?: object }
 *   { type: "stop" }
 *
 * Outbound (Hub → Caller):
 *   { type: "ready" }
 *   { type: "result", success: boolean, data: string }
 *   { type: "error", message: string }
 */
import type { ExecutionResult } from '@page-steer/core'
import { useEffect, useRef, useState } from 'react'

import type { ExtConfig } from '@/agent/useAgent'

// --- Protocol types ---

interface ExecuteMessage {
	type: 'execute'
	task: string
	config?: Record<string, unknown>
}

interface StopMessage {
	type: 'stop'
}

interface CommandMessage {
	type: 'command'
	command: string
	params?: Record<string, unknown>
}

type InboundMessage = ExecuteMessage | StopMessage | CommandMessage

interface ReadyMessage {
	type: 'ready'
}

interface ResultMessage {
	type: 'result'
	success: boolean
	data: string
}

interface ErrorMessage {
	type: 'error'
	message: string
}

type OutboundMessage = ReadyMessage | ResultMessage | ErrorMessage

export type HubWsState = 'connecting' | 'connected' | 'disconnected'

// --- HubWs class ---

export interface HubWsHandlers {
	onExecute: (
		task: string,
		config?: Record<string, unknown>
	) => Promise<{ success: boolean; data: string }>
	onStop: () => void
	onCommand?: (
		command: string,
		params: Record<string, unknown>
	) => Promise<{ success: boolean; data: unknown }>
}

/**
 * Framework-agnostic WebSocket client for Hub.
 * Connects to an external WS server, receives tasks, dispatches to handlers,
 * and sends results back. No React, no DOM.
 */
export class HubWs {
	#ws: WebSocket | null = null
	#state: HubWsState = 'disconnected'
	#busy = false
	#approved = false
	#handlers: HubWsHandlers
	#port: number
	#onStateChange: (state: HubWsState) => void

	constructor(port: number, handlers: HubWsHandlers, onStateChange: (state: HubWsState) => void) {
		this.#port = port
		this.#handlers = handlers
		this.#onStateChange = onStateChange
	}

	get state() {
		return this.#state
	}

	get busy() {
		return this.#busy
	}

	connect() {
		if (this.#ws) return
		this.#setState('connecting')

		const ws = new WebSocket(`ws://localhost:${this.#port}`)
		this.#ws = ws

		ws.addEventListener('open', () => {
			this.#setState('connected')
			this.#send({ type: 'ready' })
		})

		ws.addEventListener('close', () => {
			this.#ws = null
			this.#busy = false
			this.#approved = false
			this.#setState('disconnected')
		})

		ws.addEventListener('message', (event) => {
			this.#handleMessage(event.data as string)
		})
	}

	disconnect() {
		this.#ws?.close()
		this.#ws = null
		this.#busy = false
		this.#approved = false
		this.#setState('disconnected')
	}

	#setState(state: HubWsState) {
		if (this.#state === state) return
		this.#state = state
		this.#onStateChange(state)
	}

	#send(msg: OutboundMessage) {
		if (this.#ws?.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify(msg))
		}
	}

	async #handleMessage(raw: string) {
		let msg: InboundMessage
		try {
			msg = JSON.parse(raw)
		} catch {
			return
		}

		if (!(await this.#checkApproval())) {
			this.#send({ type: 'error', message: 'User denied the connection request.' })
			return
		}

		switch (msg.type) {
			case 'execute':
				this.#handleExecute(msg)
				break
			case 'command':
				this.#handleCommand(msg)
				break
			case 'stop':
				this.#handlers.onStop()
				break
		}
	}

	async #checkApproval(): Promise<boolean> {
		if (this.#approved) return true

		const { allowAllHubConnection } = await chrome.storage.local.get('allowAllHubConnection')
		if (allowAllHubConnection === true) {
			this.#approved = true
			return true
		}

		const ok = window.confirm(
			'An external application is requesting to control your browser via Page Steer Ext.\nAllow this session?'
		)
		if (ok) this.#approved = true
		return ok
	}

	async #handleExecute(msg: ExecuteMessage) {
		if (this.#busy) {
			this.#send({ type: 'error', message: 'Hub is busy with another task' })
			return
		}

		this.#busy = true
		try {
			const result = await this.#handlers.onExecute(msg.task, msg.config)
			this.#send({ type: 'result', success: result.success, data: result.data })
		} catch (err) {
			this.#send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
		} finally {
			this.#busy = false
		}
	}

	async #handleCommand(msg: CommandMessage) {
		if (!this.#handlers.onCommand) {
			this.#send({ type: 'result', success: false, data: 'Command handler not available' })
			return
		}

		if (this.#busy) {
			this.#send({ type: 'result', success: false, data: 'Hub is busy' })
			return
		}

		this.#busy = true
		try {
			const result = await this.#handlers.onCommand(msg.command, msg.params || {})
			const data = typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
			this.#send({ type: 'result', success: result.success, data })
		} catch (err) {
			this.#send({
				type: 'result',
				success: false,
				data: err instanceof Error ? err.message : String(err),
			})
		} finally {
			this.#busy = false
		}
	}
}

// --- React hook ---

/**
 * React hook that bridges HubWs to the agent's execute/stop/configure.
 * Handles the config-before-execute dance internally.
 */
export function useHubWs(
	execute: (task: string) => Promise<ExecutionResult>,
	stop: () => void,
	configure: (config: ExtConfig) => Promise<void>,
	config: ExtConfig | null
): { wsState: HubWsState } {
	const wsPort = new URLSearchParams(location.search).get('ws')
	const [wsState, setWsState] = useState<HubWsState>(() => (wsPort ? 'connecting' : 'disconnected'))
	const hubWsRef = useRef<HubWs | null>(null)

	const latestRef = useRef({ execute, stop, configure, config })
	useEffect(() => {
		latestRef.current = { execute, stop, configure, config }
	})

	useEffect(() => {
		if (!wsPort) return

		const hubWs = new HubWs(
			Number(wsPort),
			{
				onExecute: async (task, incomingConfig) => {
					const { execute, configure, config } = latestRef.current
					if (incomingConfig) {
						await configure({ ...config, ...incomingConfig } as ExtConfig)
					}
					const result = await execute(task)
					return { success: result.success, data: result.data }
				},
				onStop: () => latestRef.current.stop(),
				onCommand: handleHubCommand,
			},
			setWsState
		)

		hubWs.connect()
		hubWsRef.current = hubWs

		return () => {
			hubWs.disconnect()
			hubWsRef.current = null
		}
	}, [wsPort])

	return { wsState }
}

/**
 * Find the best active page tab (not extension pages, not chrome:// pages, not localhost launcher).
 */
async function findActivePageTab(): Promise<chrome.tabs.Tab | undefined> {
	const isPageTab = (t: chrome.tabs.Tab) =>
		t.url &&
		!t.url.startsWith('chrome') &&
		!t.url.startsWith('about:') &&
		!/^https?:\/\/localhost:\d+\/?$/.exec(t.url)

	// Try lastFocusedWindow first
	const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
	const good = focused.find(isPageTab)
	if (good) return good

	// Fallback: any active tab that's a real page
	const all = await chrome.tabs.query({ active: true })
	return all.find(isPageTab)
}

/**
 * Execute MCP commands directly in hub context using Chrome APIs.
 * No sidepanel dependency — hub.html is an extension page with full API access.
 */
async function handleHubCommand(
	command: string,
	params: Record<string, unknown>
): Promise<{ success: boolean; data: unknown }> {
	switch (command) {
		case 'get_page_info': {
			const tab = await findActivePageTab()
			return {
				success: true,
				data: JSON.stringify({
					url: tab?.url || '',
					title: tab?.title || '',
					tabId: tab?.id,
				}),
			}
		}

		case 'get_tabs': {
			const tabs = await chrome.tabs.query({})
			const lines = tabs
				.filter((t) => !t.url?.startsWith('chrome-extension://'))
				.map((t) => `- [${t.id}] ${t.title} (${t.url})`)
				.join('\n')
			return { success: true, data: lines || 'No tabs open.' }
		}

		case 'navigate': {
			const url = params.url as string
			if (!url) return { success: false, data: 'Missing url parameter' }
			const target = await findActivePageTab()
			if (target?.id) {
				await chrome.tabs.update(target.id, { url })
				await new Promise((r) => setTimeout(r, 2500))
				return { success: true, data: `Navigated to ${url}` }
			}
			// No suitable tab found, create one
			const newTab = await chrome.tabs.create({ url })
			await new Promise((r) => setTimeout(r, 2500))
			return { success: true, data: `Opened ${url} in new tab ${newTab.id}` }
		}

		case 'open_new_tab': {
			const url = params.url as string
			if (!url) return { success: false, data: 'Missing url parameter' }
			const tab = await chrome.tabs.create({ url })
			await new Promise((r) => setTimeout(r, 2000))
			return { success: true, data: `Opened tab ${tab.id}: ${url}` }
		}

		case 'switch_tab': {
			const tabId = params.tab_id as number
			if (!tabId) return { success: false, data: 'Missing tab_id parameter' }
			await chrome.tabs.update(tabId, { active: true })
			return { success: true, data: `Switched to tab ${tabId}` }
		}

		case 'close_tab': {
			const tabId = params.tab_id as number
			if (!tabId) return { success: false, data: 'Missing tab_id parameter' }
			await chrome.tabs.remove(tabId)
			return { success: true, data: `Closed tab ${tabId}` }
		}

		case 'get_page_content': {
			const target = await findActivePageTab()
			if (!target?.id) return { success: false, data: 'No active page tab found' }
			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: target.id },
					func: () => document.body.innerText.slice(0, 80000),
				})
				return { success: true, data: results[0]?.result || '' }
			} catch (err) {
				return { success: false, data: `Failed to get content: ${err}` }
			}
		}

		case 'execute_javascript': {
			const code = params.code as string
			if (!code) return { success: false, data: 'Missing code parameter' }
			const target = await findActivePageTab()
			if (!target?.id) return { success: false, data: 'No active page tab found' }
			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: target.id },
					func: (c: string) => {
						try {
							return String(eval(c))
						} catch (e) {
							return `Error: ${e}`
						}
					},
					args: [code],
				})
				return { success: true, data: results[0]?.result || '' }
			} catch (err) {
				return { success: false, data: `Failed: ${err}` }
			}
		}

		case 'scroll': {
			const direction = params.direction as string
			const amount = (params.amount as number) || 1
			const target = await findActivePageTab()
			if (!target?.id) return { success: false, data: 'No active page tab found' }
			const pixels = amount * 600 * (direction === 'up' ? -1 : 1)
			await chrome.scripting.executeScript({
				target: { tabId: target.id },
				func: (px: number) => window.scrollBy(0, px),
				args: [pixels],
			})
			return { success: true, data: `Scrolled ${direction} ${amount} page(s)` }
		}

		case 'click': {
			const index = params.index as number
			if (index === undefined) return { success: false, data: 'Missing index parameter' }
			const target = await findActivePageTab()
			if (!target?.id) return { success: false, data: 'No active page tab found' }
			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: target.id },
					func: (idx: number) => {
						const els = document.querySelectorAll(
							'a, button, input, select, textarea, [role="button"], [onclick], [tabindex]'
						)
						const el = els[idx] as HTMLElement | undefined
						if (!el) return `Element [${idx}] not found (total: ${els.length})`
						el.click()
						return `Clicked [${idx}]: ${el.tagName.toLowerCase()} "${el.textContent?.slice(0, 40)}"`
					},
					args: [index],
				})
				return { success: true, data: results[0]?.result || 'clicked' }
			} catch (err) {
				return { success: false, data: `Click failed: ${err}` }
			}
		}

		case 'type_text': {
			const index = params.index as number
			const text = params.text as string
			if (index === undefined || !text) return { success: false, data: 'Missing index or text' }
			const target = await findActivePageTab()
			if (!target?.id) return { success: false, data: 'No active page tab found' }
			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: target.id },
					func: (idx: number, val: string) => {
						const els = document.querySelectorAll('input, textarea, [contenteditable]')
						const el = els[idx] as HTMLInputElement | undefined
						if (!el) return `Input [${idx}] not found (total: ${els.length})`
						el.focus()
						el.value = val
						el.dispatchEvent(new Event('input', { bubbles: true }))
						return `Typed into [${idx}]: "${val}"`
					},
					args: [index, text],
				})
				return { success: true, data: results[0]?.result || 'typed' }
			} catch (err) {
				return { success: false, data: `Type failed: ${err}` }
			}
		}

		default:
			return { success: false, data: `Unknown command: ${command}` }
	}
}
