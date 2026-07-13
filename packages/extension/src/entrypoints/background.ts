import { connectMcpBridge } from '@/agent/McpBridge.background'
import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage, setupTabEventsPort } from '@/agent/TabsController.background'
import { SkillLearner, communityClient, skillRegistry } from '@/skills'
import type { LearnedStep, SkillMeta } from '@/skills'

const skillLearner = new SkillLearner()

const NATIVE_HOST_NAME = 'com.page_steer.native'

/** Handle skill commands from sidepanel / popup */
async function handleSkillCommand(
	command: string,
	params: Record<string, unknown>
): Promise<string> {
	console.debug('[Background] handleSkillCommand:', command, params)
	switch (command) {
		case 'list_skills': {
			const skills = skillRegistry.listSkills()
			const configs = await skillRegistry.getConfigs()
			const info = skills.map((s) => ({
				id: s.id,
				name: s.name,
				version: s.version,
				description: s.description,
				icon: s.icon,
				enabled: configs[s.id]?.enabled ?? true,
				source: s.source,
				matchPatterns: s.matchPatterns,
				actions: s.actions.map((a) => ({
					name: a.name,
					description: a.description,
					params: a.params,
				})),
			}))
			return JSON.stringify(info)
		}

		case 'enable_skill': {
			const skillId = params.skill as string
			const enabled = params.enabled as boolean
			if (!skillId) throw new Error('Missing skill parameter')
			await skillRegistry.setEnabled(skillId, enabled)
			return JSON.stringify({ ok: true, id: skillId, enabled })
		}

		case 'delete_learned_skill': {
			const skillId = params.skill as string
			if (!skillId) throw new Error('Missing skill parameter')
			await skillRegistry.deleteLearnedSkill(skillId)
			return JSON.stringify({ ok: true, deleted: skillId })
		}

		case 'run_skill': {
			const skillId = params.skill as string
			const action = params.action as string
			const skillParams = (params.params as Record<string, unknown>) || {}
			const tabId = params.tabId as number | undefined
			if (!skillId || !action) throw new Error('Missing skill or action parameter')

			const skill = skillRegistry.getSkill(skillId)
			if (!skill) throw new Error(`Skill "${skillId}" not found`)

			const enabled = await skillRegistry.isEnabled(skillId)
			if (!enabled) throw new Error(`Skill "${skillId}" is disabled`)

			// Resolve target tab: provided tabId > matching tab by URL pattern > active tab
			let targetTabId = tabId
			if (!targetTabId) {
				// Try to find an existing tab that matches the skill's URL patterns
				const allTabs = await chrome.tabs.query({ currentWindow: true })
				const matchingTab = allTabs.find(
					(t) => t.url && t.id && skill._matchers.some((m) => m.test(t.url!))
				)
				if (matchingTab?.id) {
					targetTabId = matchingTab.id
				} else {
					// Fall back to active tab, but skip chrome:// and extension pages
					const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
					if (activeTab?.url && !activeTab.url.startsWith('chrome')) {
						targetTabId = activeTab.id
					}
				}
			}
			if (!targetTabId)
				throw new Error(
					`No suitable tab found. Please open a page matching ${skill.matchPatterns.join(' or ')} first.`
				)

			const result = await skill.execute(targetTabId, action, skillParams)

			// Attach tab info so the UI can show which tab was operated on
			let tabInfo: { tabId: number; url?: string; title?: string } | undefined
			try {
				const tab = await chrome.tabs.get(targetTabId)
				tabInfo = { tabId: targetTabId, url: tab.url, title: tab.title }
			} catch {
				tabInfo = { tabId: targetTabId }
			}

			return JSON.stringify({ result, tabInfo })
		}

		default:
			throw new Error(`Unknown skill command: ${command}`)
	}
}

export default defineBackground(() => {
	console.debug('[Background] Service Worker started')

	// tab change events

	setupTabEventsPort()

	// Re-inject content scripts into all existing tabs on extension startup/reload.
	reinjectContentScripts()

	// generate user auth token

	chrome.storage.local.get('PageSteerExtUserAuthToken').then((result) => {
		if (result.PageSteerExtUserAuthToken) return
		const userAuthToken = crypto.randomUUID()
		chrome.storage.local.set({ PageSteerExtUserAuthToken: userAuthToken })
	})

	// message proxy

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type === 'TAB_CONTROL') {
			return handleTabControlMessage(message, sender, sendResponse)
		} else if (message.type === 'PAGE_CONTROL') {
			return handlePageControlMessage(message, sender, sendResponse)
		} else if (message.type === 'CONNECT_NATIVE') {
			connectNativeHost()
			sendResponse({ ok: true })
			return
		} else if (message.type === 'SKILL_COMMAND') {
			handleSkillCommand(message.command, message.params || {})
				.then((data) => sendResponse({ data }))
				.catch((err) => sendResponse({ error: String(err.message || err) }))
			return true // async response
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})

	// external messages (from localhost launcher page via externally_connectable)

	chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
		if (message.type === 'OPEN_HUB') {
			connectMcpBridge(message.wsPort)
			openOrFocusHubTab(message.wsPort).then(() => {
				if (sender.tab?.id) chrome.tabs.remove(sender.tab.id)
				sendResponse({ ok: true })
			})
			return true
		}
	})

	// Native Messaging — connect on startup
	connectNativeHost()

	// setup
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

// --- Native Messaging ---

let nativePort: chrome.runtime.Port | null = null

function connectNativeHost() {
	if (nativePort) return

	try {
		nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME)

		nativePort.onMessage.addListener((message: NativeMessage) => {
			handleNativeMessage(message)
		})

		nativePort.onDisconnect.addListener(() => {
			const err = chrome.runtime.lastError
			console.debug('[Background] Native host disconnected', err?.message || '')
			nativePort = null
			// Reconnect after a delay
			setTimeout(connectNativeHost, 5000)
		})

		console.debug('[Background] Connected to native host')
	} catch (err) {
		console.error('[Background] Failed to connect native host:', err)
		nativePort = null
	}
}

interface NativeMessage {
	type: string
	requestId?: string
	responseToRequestId?: string
	payload?: Record<string, unknown>
}

async function handleNativeMessage(message: NativeMessage) {
	// The native host sends `call_tool` with a requestId; we execute and respond
	if (message.type === 'call_tool' && message.requestId) {
		const { command, params } = (message.payload || {}) as {
			command: string
			params: Record<string, unknown>
		}
		try {
			const result = await executeCommand(command, params || {})
			nativePort?.postMessage({
				responseToRequestId: message.requestId,
				payload: { status: 'success', data: result },
			})
		} catch (err) {
			nativePort?.postMessage({
				responseToRequestId: message.requestId,
				payload: {
					status: 'error',
					message: err instanceof Error ? err.message : String(err),
				},
			})
		}
		return
	}

	// Ping from native host
	if (message.type === 'ping') {
		nativePort?.postMessage({ type: 'pong' })
	}
}

// --- MCP Work Tab Management ---
// All MCP operations run in a dedicated background tab so they don't disrupt the user's active page.

let mcpWorkTabId: number | null = null

async function getOrCreateMcpWorkTab(): Promise<chrome.tabs.Tab> {
	// Check if existing work tab is still alive
	if (mcpWorkTabId !== null) {
		try {
			const tab = await chrome.tabs.get(mcpWorkTabId)
			if (tab) return tab
		} catch {
			// Tab was closed by the user
			mcpWorkTabId = null
		}
	}

	// Create a new background tab (not active, so it won't steal focus)
	const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
	mcpWorkTabId = tab.id!
	return tab
}

// Clean up reference if user closes the MCP work tab
chrome.tabs.onRemoved.addListener((tabId) => {
	if (tabId === mcpWorkTabId) {
		mcpWorkTabId = null
	}
})

// --- Command Execution (runs in background, no hub/sidepanel needed) ---

async function findActivePageTab(): Promise<chrome.tabs.Tab | undefined> {
	const isPageTab = (t: chrome.tabs.Tab) =>
		t.url &&
		!t.url.startsWith('chrome') &&
		!t.url.startsWith('about:') &&
		!/^https?:\/\/localhost:\d+\/?$/.exec(t.url)

	const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
	const good = focused.find(isPageTab)
	if (good) return good

	const all = await chrome.tabs.query({ active: true })
	return all.find(isPageTab)
}

/** Get the MCP work tab for MCP commands, or fallback to active page tab for non-MCP use */
async function getMcpTargetTab(): Promise<chrome.tabs.Tab> {
	const tab = await getOrCreateMcpWorkTab()
	return tab
}

async function executeCommand(command: string, params: Record<string, unknown>): Promise<string> {
	switch (command) {
		case 'get_page_info': {
			const tab = await getMcpTargetTab()
			return JSON.stringify({ url: tab?.url || '', title: tab?.title || '', tabId: tab?.id })
		}

		case 'get_tabs': {
			const tabs = await chrome.tabs.query({})
			const lines = tabs
				.filter((t) => !t.url?.startsWith('chrome-extension://') && t.id !== mcpWorkTabId)
				.map((t) => `- [${t.id}] ${t.title} (${t.url})`)
				.join('\n')
			return lines || 'No tabs open.'
		}

		case 'navigate': {
			const url = params.url as string
			if (!url) throw new Error('Missing url parameter')
			const workTab = await getOrCreateMcpWorkTab()
			await chrome.tabs.update(workTab.id!, { url })
			await new Promise((r) => setTimeout(r, 2500))
			return `Navigated to ${url} (in MCP work tab ${workTab.id})`
		}

		case 'open_new_tab': {
			const url = params.url as string
			if (!url) throw new Error('Missing url parameter')
			const tab = await chrome.tabs.create({ url, active: false })
			await new Promise((r) => setTimeout(r, 2000))
			return `Opened tab ${tab.id}: ${url}`
		}

		case 'switch_tab': {
			const tabId = params.tab_id as number
			if (!tabId) throw new Error('Missing tab_id parameter')
			// Switch MCP work context to an existing tab
			mcpWorkTabId = tabId
			return `MCP work context switched to tab ${tabId}`
		}

		case 'close_tab': {
			const tabId = params.tab_id as number
			if (!tabId) throw new Error('Missing tab_id parameter')
			await chrome.tabs.remove(tabId)
			return `Closed tab ${tabId}`
		}

		case 'get_page_content': {
			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')
			const results = await chrome.scripting.executeScript({
				target: { tabId: workTab.id },
				func: () => document.body.innerText.slice(0, 80000),
			})
			return results[0]?.result || ''
		}

		case 'execute_javascript': {
			const code = params.code as string
			if (!code) throw new Error('Missing code parameter')
			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')
			// Try MAIN world first, fall back to ISOLATED if CSP blocks eval
			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: workTab.id },
					world: 'MAIN',
					func: (c: string) => {
						return String(eval(c))
					},
					args: [code],
				})
				return results[0]?.result || ''
			} catch {
				// MAIN world may fail on some pages, try ISOLATED
				const results = await chrome.scripting.executeScript({
					target: { tabId: workTab.id },
					func: (c: string) => {
						try {
							// eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional eval for MCP execute_javascript
							return String(new Function('return ' + c)())
						} catch (e) {
							return `Error: ${e}`
						}
					},
					args: [code],
				})
				return results[0]?.result || ''
			}
		}

		case 'query_dom': {
			// DOM querying that works regardless of CSP (runs in ISOLATED world)
			const selector = params.selector as string
			const action = (params.action as string) || 'info'
			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')
			const results = await chrome.scripting.executeScript({
				target: { tabId: workTab.id },
				func: (sel: string, act: string) => {
					if (act === 'list_testids') {
						const ids = new Set<string>()
						document.querySelectorAll('[data-testid]').forEach((el) => {
							const id = el.getAttribute('data-testid')
							if (id) ids.add(id)
						})
						return JSON.stringify([...ids].sort())
					}
					if (act === 'structure') {
						// Analyze a specific element's structure
						const el = document.querySelector(sel)
						if (!el) return JSON.stringify({ error: 'Element not found', selector: sel })
						const children: { tag: string; testId: string | null; text: string }[] = []
						el.querySelectorAll('[data-testid]').forEach((child) => {
							children.push({
								tag: child.tagName.toLowerCase(),
								testId: child.getAttribute('data-testid'),
								text: child.textContent?.slice(0, 80) || '',
							})
						})
						return JSON.stringify({
							tag: el.tagName.toLowerCase(),
							testId: el.getAttribute('data-testid'),
							role: el.getAttribute('role'),
							text: el.textContent?.slice(0, 200),
							childTestIds: children.slice(0, 30),
						})
					}
					if (act === 'count') {
						return String(document.querySelectorAll(sel).length)
					}
					if (act === 'texts') {
						const els = document.querySelectorAll(sel)
						const texts: string[] = []
						els.forEach((el, i) => {
							if (i < 20) texts.push(el.textContent?.slice(0, 300) || '')
						})
						return JSON.stringify(texts)
					}
					if (act === 'html') {
						const el = document.querySelector(sel)
						return el ? el.outerHTML.slice(0, 5000) : 'Not found'
					}
					// Default: info
					const el = document.querySelector(sel)
					if (!el) return JSON.stringify({ found: false, selector: sel })
					return JSON.stringify({
						found: true,
						tag: el.tagName.toLowerCase(),
						text: el.textContent?.slice(0, 200),
						attrs: {
							role: el.getAttribute('role'),
							testId: el.getAttribute('data-testid'),
							contentEditable: el.getAttribute('contenteditable'),
							ariaLabel: el.getAttribute('aria-label'),
						},
					})
				},
				args: [selector || '', action],
			})
			return results[0]?.result || ''
		}

		case 'scroll': {
			const direction = params.direction as string
			const amount = (params.amount as number) || 1
			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')
			const pixels = amount * 600 * (direction === 'up' ? -1 : 1)
			await chrome.scripting.executeScript({
				target: { tabId: workTab.id },
				func: (px: number) => window.scrollBy(0, px),
				args: [pixels],
			})
			return `Scrolled ${direction} ${amount} page(s)`
		}

		case 'click': {
			const index = params.index as number
			if (index === undefined) throw new Error('Missing index parameter')
			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')
			const results = await chrome.scripting.executeScript({
				target: { tabId: workTab.id },
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
			return results[0]?.result || 'clicked'
		}

		case 'type_text': {
			const index = params.index as number
			const text = params.text as string
			if (index === undefined || !text) throw new Error('Missing index or text')
			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')
			const results = await chrome.scripting.executeScript({
				target: { tabId: workTab.id },
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
			return results[0]?.result || 'typed'
		}

		case 'execute_task': {
			// Forward to sidepanel agent
			const task = params.task as string
			if (!task) throw new Error('Missing task parameter')
			const response = await chrome.runtime.sendMessage({
				type: 'MCP_EXECUTE',
				task,
			})
			if (response?.error) throw new Error(response.error)
			return response?.data || 'Task completed'
		}

		case 'list_skills': {
			const skills = skillRegistry.listSkills()
			const configs = await skillRegistry.getConfigs()
			const info = skills.map((s) => ({
				id: s.id,
				name: s.name,
				version: s.version,
				description: s.description,
				icon: s.icon,
				enabled: configs[s.id]?.enabled ?? true,
				matchPatterns: s.matchPatterns,
				actions: s.actions.map((a) => ({
					name: a.name,
					description: a.description,
					params: a.params,
				})),
			}))
			return JSON.stringify(info, null, 2)
		}

		case 'run_skill': {
			const skillId = params.skill as string
			const action = params.action as string
			const skillParams = (params.params as Record<string, unknown>) || {}
			if (!skillId || !action) throw new Error('Missing skill or action parameter')

			const skill = skillRegistry.getSkill(skillId)
			if (!skill) throw new Error(`Skill "${skillId}" not found`)

			const enabled = await skillRegistry.isEnabled(skillId)
			if (!enabled) throw new Error(`Skill "${skillId}" is disabled`)

			const workTab = await getMcpTargetTab()
			if (!workTab?.id) throw new Error('No MCP work tab available')

			return await skill.execute(workTab.id, action, skillParams)
		}

		case 'enable_skill': {
			const skillId = params.skill as string
			const enabled = params.enabled as boolean
			if (!skillId) throw new Error('Missing skill parameter')
			if (typeof enabled !== 'boolean') throw new Error('Missing enabled parameter (boolean)')
			await skillRegistry.setEnabled(skillId, enabled)
			return `Skill "${skillId}" ${enabled ? 'enabled' : 'disabled'}`
		}

		// --- Skill Learning ---

		case 'learn_skill_start': {
			const skillId = params.skill_id as string
			if (!skillId) throw new Error('Missing skill_id parameter')
			skillLearner.startRecording(skillId)
			return `Recording started for skill "${skillId}"`
		}

		case 'learn_skill_step': {
			if (!skillLearner.isRecording) throw new Error('Not recording. Call learn_skill_start first.')
			const step = params.step as LearnedStep
			if (!step || !step.type) throw new Error('Missing step parameter with type field')
			skillLearner.recordStep(step)
			return `Recorded step: ${step.type} → ${step.selector || step.value || ''}`
		}

		case 'learn_skill_save': {
			if (!skillLearner.isRecording) throw new Error('Not recording')
			const meta = params.meta as SkillMeta
			if (!meta || !meta.id || !meta.name)
				throw new Error('Missing meta parameter (id, name required)')
			const recipe = skillLearner.stopRecording()
			meta.source = 'learned'
			meta.createdAt = meta.createdAt || new Date().toISOString()
			await skillRegistry.saveLearnedSkill(meta, recipe)
			return JSON.stringify({
				saved: true,
				id: meta.id,
				steps: recipe.steps.length,
				confidence: recipe.confidence,
			})
		}

		case 'learn_skill_cancel': {
			skillLearner.cancelRecording()
			return 'Recording cancelled'
		}

		case 'get_learned_skills': {
			const learned = await skillRegistry.getLearnedSkills()
			return JSON.stringify(
				learned.map((s) => ({
					id: s.meta.id,
					name: s.meta.name,
					version: s.meta.version,
					description: s.meta.description,
					stepsCount: s.recipe.steps.length,
					confidence: s.recipe.confidence,
					successCount: s.recipe.successCount,
					failCount: s.recipe.failCount,
				})),
				null,
				2
			)
		}

		case 'delete_learned_skill': {
			const skillId = params.skill as string
			if (!skillId) throw new Error('Missing skill parameter')
			await skillRegistry.deleteLearnedSkill(skillId)
			return `Deleted learned skill "${skillId}"`
		}

		// --- Community Skills ---

		case 'community_search': {
			const query = params.query as string
			if (!query) throw new Error('Missing query parameter')
			const results = await communityClient.search(query)
			return JSON.stringify(
				results.map((p) => ({
					id: p.meta.id,
					name: p.meta.name,
					description: p.meta.description,
					version: p.meta.version,
					author: p.meta.author,
					downloads: p.downloads,
					rating: p.rating,
				})),
				null,
				2
			)
		}

		case 'community_install': {
			const skillId = params.skill as string
			if (!skillId) throw new Error('Missing skill parameter')
			const pkg = await communityClient.fetchSkill(skillId)
			if (!pkg) throw new Error(`Skill "${skillId}" not found in community registry`)
			await skillRegistry.installCommunitySkill(pkg)
			return `Installed community skill "${pkg.meta.name}" v${pkg.meta.version}`
		}

		case 'community_uninstall': {
			const skillId = params.skill as string
			if (!skillId) throw new Error('Missing skill parameter')
			await skillRegistry.uninstallCommunitySkill(skillId)
			return `Uninstalled community skill "${skillId}"`
		}

		case 'export_skill': {
			const skillId = params.skill as string
			if (!skillId) throw new Error('Missing skill parameter')
			const learned = await skillRegistry.getLearnedSkills()
			const found = learned.find((s) => s.meta.id === skillId)
			if (!found) throw new Error(`Learned skill "${skillId}" not found`)
			const pkg = communityClient.exportSkill(found.meta, found.recipe)
			return JSON.stringify(pkg, null, 2)
		}

		default:
			throw new Error(`Unknown command: ${command}`)
	}
}

async function openOrFocusHubTab(wsPort: number) {
	const hubUrl = chrome.runtime.getURL('hub.html')
	const existing = await chrome.tabs.query({ url: `${hubUrl}*` })

	if (existing.length > 0 && existing[0].id) {
		await chrome.tabs.update(existing[0].id, {
			active: true,
			url: `${hubUrl}?ws=${wsPort}`,
		})
		return
	}

	await chrome.tabs.create({ url: `${hubUrl}?ws=${wsPort}`, pinned: true })
}

/**
 * Re-inject content scripts into all existing tabs.
 * Called on background startup to restore communication with tabs
 * that were open before the extension was reloaded.
 */
async function reinjectContentScripts() {
	const tabs = await chrome.tabs.query({})

	for (const tab of tabs) {
		if (!tab.id || !tab.url) continue

		// Skip restricted URLs where content scripts can't run
		if (
			tab.url.startsWith('chrome://') ||
			tab.url.startsWith('chrome-extension://') ||
			tab.url.startsWith('about:') ||
			tab.url.startsWith('edge://') ||
			tab.url.startsWith('file://')
		) {
			continue
		}

		chrome.scripting
			.executeScript({
				target: { tabId: tab.id },
				files: ['content-scripts/content.js'],
			})
			.catch(() => {
				// Silently ignore tabs that can't be injected (e.g. web store pages)
			})
	}
}
