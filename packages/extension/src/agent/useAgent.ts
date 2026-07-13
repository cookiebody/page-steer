/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
} from '@page-steer/core'
import type { LLMConfig } from '@page-steer/llms'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MultiPageSteer } from './MultiPageSteer'
import { DEFAULT_PRESETS, DEMO_CONFIG, migrateLegacyEndpoint } from './constants'
import type { ModelPreset } from './constants'

/** Language preference: undefined means follow system */
export type LanguagePreference = SupportedLanguage | undefined

export interface AdvancedConfig {
	maxSteps?: number
	systemInstruction?: string
	experimentalLlmsTxt?: boolean
	experimentalIncludeAllTabs?: boolean
	disableNamedToolChoice?: boolean
}

export interface ExtConfig extends LLMConfig, AdvancedConfig {
	language?: LanguagePreference
}

export interface UseAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	config: ExtConfig | null
	presets: ModelPreset[]
	activePresetId: string | null
	execute: (task: string) => Promise<ExecutionResult>
	stop: () => void
	configure: (config: ExtConfig) => Promise<void>
	switchPreset: (presetId: string) => Promise<void>
	savePresets: (presets: ModelPreset[]) => Promise<void>
}

export function useAgent(): UseAgentResult {
	const agentRef = useRef<MultiPageSteer | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [config, setConfig] = useState<ExtConfig | null>(null)
	const [presets, setPresets] = useState<ModelPreset[]>(DEFAULT_PRESETS)
	const [activePresetId, setActivePresetId] = useState<string | null>(null)

	useEffect(() => {
		chrome.storage.local
			.get(['llmConfig', 'language', 'advancedConfig', 'modelPresets', 'activePresetId'])
			.then((result) => {
				let llmConfig = (result.llmConfig as LLMConfig) ?? DEMO_CONFIG
				const language = (result.language as SupportedLanguage) || undefined
				const advancedConfig = (result.advancedConfig as AdvancedConfig) ?? {}

				// Load presets (use defaults if none saved)
				const savedPresets = result.modelPresets as ModelPreset[] | undefined
				if (savedPresets && savedPresets.length > 0) {
					setPresets(savedPresets)
				} else {
					// Persist default presets on first run
					chrome.storage.local.set({ modelPresets: DEFAULT_PRESETS })
				}

				// Load active preset ID
				const savedActiveId = result.activePresetId as string | undefined
				if (savedActiveId) {
					setActivePresetId(savedActiveId)
				}

				// Auto-migrate legacy testing endpoints
				const migrated = migrateLegacyEndpoint(llmConfig)
				if (migrated !== llmConfig) {
					llmConfig = migrated
					chrome.storage.local.set({ llmConfig: migrated })
				} else if (!result.llmConfig) {
					chrome.storage.local.set({ llmConfig: DEMO_CONFIG })
				}

				setConfig({ ...llmConfig, ...advancedConfig, language })
			})
	}, [])

	useEffect(() => {
		if (!config) return
		// Don't create agent if LLM is not configured
		if (!config.baseURL || !config.model) return

		const { systemInstruction, ...agentConfig } = config
		const agent = new MultiPageSteer({
			...agentConfig,
			instructions: systemInstruction ? { system: systemInstruction } : undefined,
		})
		agentRef.current = agent

		const handleStatusChange = (e: Event) => {
			const newStatus = agent.status as AgentStatus
			setStatus(newStatus)
			if (newStatus !== 'running') {
				setActivity(null)
			}
		}

		const handleHistoryChange = (e: Event) => {
			setHistory([...agent.history])
		}

		const handleActivity = (e: Event) => {
			const newActivity = (e as CustomEvent).detail as AgentActivity
			setActivity(newActivity)
		}

		agent.addEventListener('statuschange', handleStatusChange)
		agent.addEventListener('historychange', handleHistoryChange)
		agent.addEventListener('activity', handleActivity)

		return () => {
			agent.removeEventListener('statuschange', handleStatusChange)
			agent.removeEventListener('historychange', handleHistoryChange)
			agent.removeEventListener('activity', handleActivity)
			agent.dispose()
		}
	}, [config])

	const execute = useCallback(async (task: string) => {
		const agent = agentRef.current
		if (!agent) throw new Error('Agent not initialized')

		setCurrentTask(task)
		setHistory([])
		return agent.execute(task)
	}, [])

	const stop = useCallback(() => {
		agentRef.current?.stop()
	}, [])

	// Listen for MCP messages from background (MCP_EXECUTE / MCP_STOP / MCP_COMMAND)
	useEffect(() => {
		const handler = (
			message: {
				type: string
				task?: string
				command?: string
				params?: Record<string, unknown>
				config?: Record<string, unknown>
			},
			_sender: chrome.runtime.MessageSender,
			sendResponse: (response: unknown) => void
		): true | undefined => {
			if (message.type === 'MCP_EXECUTE' && message.task) {
				const agent = agentRef.current
				if (!agent) {
					sendResponse({ error: 'Agent not initialized' })
					return
				}
				if (agent.status === 'running') {
					sendResponse({ error: 'Agent is already running a task' })
					return
				}

				setCurrentTask(message.task)
				setHistory([])
				agent
					.execute(message.task)
					.then((result) => {
						sendResponse({ success: result.success, data: result.data })
					})
					.catch((err) => {
						sendResponse({ error: err instanceof Error ? err.message : String(err) })
					})
				return true // async response
			}

			if (message.type === 'MCP_COMMAND' && message.command) {
				handleMcpCommand(message.command, message.params || {}, agentRef.current)
					.then((result) => sendResponse(result))
					.catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }))
				return true // async response
			}

			if (message.type === 'MCP_STOP') {
				agentRef.current?.stop()
				sendResponse({ ok: true })
				return
			}
		}

		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [])

	const configure = useCallback(
		async ({
			language,
			maxSteps,
			systemInstruction,
			experimentalLlmsTxt,
			experimentalIncludeAllTabs,
			disableNamedToolChoice,
			...llmConfig
		}: ExtConfig) => {
			await chrome.storage.local.set({ llmConfig })
			if (language) {
				await chrome.storage.local.set({ language })
			} else {
				await chrome.storage.local.remove('language')
			}
			const advancedConfig: AdvancedConfig = {
				maxSteps,
				systemInstruction,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
			}
			await chrome.storage.local.set({ advancedConfig })
			// Clear active preset since user manually edited config
			setActivePresetId(null)
			await chrome.storage.local.remove('activePresetId')
			setConfig({ ...llmConfig, ...advancedConfig, language })
		},
		[]
	)

	const switchPreset = useCallback(
		async (presetId: string) => {
			const preset = presets.find((p) => p.id === presetId)
			if (!preset) return

			const llmConfig = preset.config
			await chrome.storage.local.set({ llmConfig, activePresetId: presetId })
			setActivePresetId(presetId)

			// Keep advanced config and language, just swap the LLM config
			setConfig((prev) => {
				if (!prev) return { ...llmConfig }
				const { apiKey: _, baseURL: __, model: ___, ...rest } = prev
				return { ...rest, ...llmConfig }
			})
		},
		[presets]
	)

	const savePresets = useCallback(async (newPresets: ModelPreset[]) => {
		setPresets(newPresets)
		await chrome.storage.local.set({ modelPresets: newPresets })
	}, [])

	return {
		status,
		history,
		activity,
		currentTask,
		config,
		presets,
		activePresetId,
		execute,
		stop,
		configure,
		switchPreset,
		savePresets,
	}
}

/**
 * Handle fine-grained MCP commands (navigate, click, get_page_content, etc.)
 */
async function handleMcpCommand(
	command: string,
	params: Record<string, unknown>,
	agent: MultiPageSteer | null
): Promise<{ success: boolean; data: unknown }> {
	if (!agent) {
		return { success: false, data: 'Agent not initialized. Open the sidepanel first.' }
	}

	const pc = agent.pageController as any // RemotePageController
	const tc = pc.tabsController

	switch (command) {
		case 'navigate': {
			const url = params.url as string
			if (!url) return { success: false, data: 'Missing url parameter' }
			await chrome.tabs.update(tc.currentTabId!, { url })
			// Wait for page to start loading
			await new Promise((r) => setTimeout(r, 2000))
			return { success: true, data: `Navigated to ${url}` }
		}

		case 'open_new_tab': {
			const url = params.url as string
			if (!url) return { success: false, data: 'Missing url parameter' }
			const result = await tc.openNewTab(url)
			return { success: true, data: result }
		}

		case 'switch_tab': {
			const tabId = params.tab_id as number
			if (!tabId) return { success: false, data: 'Missing tab_id parameter' }
			const result = await tc.switchToTab(tabId)
			return { success: true, data: result }
		}

		case 'close_tab': {
			const tabId = params.tab_id as number
			if (!tabId) return { success: false, data: 'Missing tab_id parameter' }
			const result = await tc.closeTab(tabId)
			return { success: true, data: result }
		}

		case 'get_tabs': {
			const summary = await tc.summarizeTabs()
			return { success: true, data: summary }
		}

		case 'get_page_content': {
			await pc.updateTree()
			const state = await pc.getBrowserState()
			return { success: true, data: state.content }
		}

		case 'get_page_info': {
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
			const tab = tabs[0]
			return {
				success: true,
				data: JSON.stringify({ url: tab?.url || '', title: tab?.title || '', tabId: tab?.id }),
			}
		}

		case 'click': {
			const index = params.index as number
			if (index === undefined) return { success: false, data: 'Missing index parameter' }
			await pc.updateTree()
			const result = await pc.clickElement(index)
			return { success: result.success, data: result.message }
		}

		case 'type_text': {
			const index = params.index as number
			const text = params.text as string
			if (index === undefined || !text) return { success: false, data: 'Missing index or text' }
			await pc.updateTree()
			const result = await pc.inputText(index, text)
			return { success: result.success, data: result.message }
		}

		case 'select_option': {
			const index = params.index as number
			const option = params.option as string
			if (index === undefined || !option) return { success: false, data: 'Missing index or option' }
			await pc.updateTree()
			const result = await pc.selectOption(index, option)
			return { success: result.success, data: result.message }
		}

		case 'scroll': {
			const direction = params.direction as string
			const amount = (params.amount as number) || 1
			const index = params.index as number | undefined
			const down = direction === 'down'
			const result = await pc.scroll({ down, numPages: amount, elementIndex: index })
			return { success: result.success, data: result.message }
		}

		case 'execute_javascript': {
			const code = params.code as string
			if (!code) return { success: false, data: 'Missing code parameter' }
			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: tc.currentTabId! },
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

		default:
			return { success: false, data: `Unknown command: ${command}` }
	}
}
