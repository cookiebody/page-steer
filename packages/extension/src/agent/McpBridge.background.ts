/**
 * MCP Bridge — Background-integrated WebSocket handler.
 *
 * When the MCP Node process sends OPEN_HUB, instead of opening hub.html,
 * background directly establishes a WS connection to the MCP server and
 * proxies execute/stop commands to the sidepanel agent via chrome.runtime messages.
 *
 * Flow:
 *   MCP Node (stdio) → WS Server ← Background (WS Client) → Sidepanel Agent
 */

let ws: WebSocket | null = null
let mcpPort: number | null = null

/**
 * Connect background to the MCP WS server.
 * Called when OPEN_HUB external message arrives.
 */
export function connectMcpBridge(port: number) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		// Already connected to same port
		if (mcpPort === port) return
		ws.close()
	}

	mcpPort = port
	console.debug(`[MCP Bridge] Connecting to ws://localhost:${port}`)

	ws = new WebSocket(`ws://localhost:${port}`)

	ws.addEventListener('open', () => {
		console.debug('[MCP Bridge] Connected')
		ws!.send(JSON.stringify({ type: 'ready' }))
		updateState(true)
	})

	ws.addEventListener('close', () => {
		console.debug('[MCP Bridge] Disconnected')
		ws = null
		updateState(false)
	})

	ws.addEventListener('error', (e) => {
		console.error('[MCP Bridge] WebSocket error:', e)
	})

	ws.addEventListener('message', (event) => {
		handleMessage(event.data as string)
	})
}

export function disconnectMcpBridge() {
	ws?.close()
	ws = null
	mcpPort = null
	updateState(false)
}

export function isMcpConnected(): boolean {
	return ws?.readyState === WebSocket.OPEN
}

function updateState(connected: boolean) {
	chrome.storage.local.set({ mcpBridgeConnected: connected }).catch(() => {})
}

function sendToMcp(msg: Record<string, unknown>) {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg))
	}
}

async function handleMessage(raw: string) {
	let msg: {
		type: string
		task?: string
		command?: string
		params?: Record<string, unknown>
		config?: Record<string, unknown>
	}
	try {
		msg = JSON.parse(raw)
	} catch {
		return
	}

	if (msg.type === 'execute' && msg.task) {
		// Forward to sidepanel via chrome.runtime message
		try {
			const response = await chrome.runtime.sendMessage({
				type: 'MCP_EXECUTE',
				task: msg.task,
				config: msg.config,
			})

			if (response?.error) {
				sendToMcp({ type: 'error', message: response.error })
			} else {
				sendToMcp({
					type: 'result',
					success: response?.success ?? false,
					data: response?.data ?? '',
				})
			}
		} catch (err) {
			sendToMcp({
				type: 'error',
				message: err instanceof Error ? err.message : 'Failed to reach sidepanel agent',
			})
		}
	} else if (msg.type === 'command' && msg.command) {
		// Fine-grained command — forward to sidepanel
		try {
			const response = await chrome.runtime.sendMessage({
				type: 'MCP_COMMAND',
				command: msg.command,
				params: msg.params || {},
			})

			if (response?.error) {
				sendToMcp({ type: 'result', success: false, data: response.error })
			} else {
				sendToMcp({
					type: 'result',
					success: response?.success ?? true,
					data: response?.data ?? '',
				})
			}
		} catch (err) {
			sendToMcp({
				type: 'result',
				success: false,
				data: err instanceof Error ? err.message : 'Failed to reach extension',
			})
		}
	} else if (msg.type === 'stop') {
		chrome.runtime.sendMessage({ type: 'MCP_STOP' }).catch(() => {})
	}
}
