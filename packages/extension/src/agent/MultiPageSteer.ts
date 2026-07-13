import { type AgentConfig, PageSteerCore } from '@page-steer/core'
import { SkillStore } from '@page-steer/core/skill-store'

import { ChromeSkillStorage } from './ChromeSkillStorage'
import { RemotePageController } from './RemotePageController'
import { TabsController } from './TabsController'
import { getSkillToolsForUrl } from './skillTools'
import SYSTEM_PROMPT from './system_prompt.md?raw'
import { createTabTools } from './tabTools'

/** Detect user language from browser settings */
function detectLanguage(): NonNullable<AgentConfig['language']> {
	const lang = navigator.language || navigator.languages?.[0] || 'en-US'
	if (lang.startsWith('zh')) return 'zh-CN'
	if (lang.startsWith('ja')) return 'ja-JP'
	if (lang.startsWith('fr')) return 'fr-FR'
	return 'en-US'
}

function getLanguageName(language: NonNullable<AgentConfig['language']>): string {
	const languageNames: Record<NonNullable<AgentConfig['language']>, string> = {
		'en-US': 'English',
		'zh-CN': '中文',
		'ja-JP': '日本語',
		'fr-FR': 'Français',
	}
	return languageNames[language]
}

interface MultiPageSteerConfig extends AgentConfig {
	includeInitialTab?: boolean
	experimentalIncludeAllTabs?: boolean
}

/**
 * MultiPageSteer
 * - use with extension
 * - can be used from a side panel or a content script
 */
export class MultiPageSteer extends PageSteerCore {
	constructor(config: MultiPageSteerConfig) {
		// multi page controller
		const tabsController = new TabsController()
		const pageController = new RemotePageController(tabsController)
		const customTools = createTabTools(tabsController)

		// Skill store for auto-learning from retries
		const skillStore = new SkillStore(new ChromeSkillStorage())
		// Load skills async — won't block construction, available by first step
		skillStore.load().catch(() => {})

		// system prompt - auto-detect language if not specified
		const language = config.language ?? detectLanguage()
		const targetLanguage = getLanguageName(language)
		const systemPrompt = SYSTEM_PROMPT.replace(
			/Default working language: \*\*.*?\*\*/,
			`Default working language: **${targetLanguage}**`
		)

		const includeInitialTab = config.includeInitialTab ?? true
		const experimentalIncludeAllTabs = config.experimentalIncludeAllTabs ?? false

		/**
		 * Project agent status into chrome.storage. The content script polls
		 * `isAgentRunning` + `agentHeartbeat` (eventually consistent by design).
		 *
		 * When the agent is in side-panel and user closed the side-panel.
		 * There is no chance for isAgentRunning to be set false.
		 * (unload event doesn't work well in side panel.)
		 * (I'm trying not to use long-lived connection because the lifecycle of a sw is hard to predict.)
		 * This heartbeat mechanism acts as a backup.
		 */
		let heartBeatInterval: number | null = null

		/** Track injected skill tool names so we can clean them up on URL change */
		let injectedSkillTools: string[] = []

		super({
			...config,
			// Disabled: AbortSignal cannot cross contexts
			experimentalScriptExecutionTool: false,
			pageController: pageController as any,
			customTools: customTools,
			customSystemPrompt: systemPrompt,
			skillStore,

			onBeforeTask: async (agent) => {
				await tabsController.init(agent.task, { includeInitialTab, experimentalIncludeAllTabs })
			},

			onBeforeStep: async (agent) => {
				if (!tabsController.currentTabId) return
				// make sure the current tab is loaded before the step starts
				await tabsController.waitUntilTabLoaded(tabsController.currentTabId!)

				// Inject skill tools based on current page URL
				try {
					const tab = await chrome.tabs.get(tabsController.currentTabId!)
					if (tab?.url) {
						// Remove previously injected skill tools
						for (const name of injectedSkillTools) {
							agent.tools.delete(name)
						}
						injectedSkillTools = []

						// Add matching skill tools
						const skillTools = await getSkillToolsForUrl(tab.url)
						for (const [name, tool] of skillTools) {
							agent.tools.set(name, tool)
							injectedSkillTools.push(name)
						}
					}
				} catch {
					// Skill injection is best-effort
				}
			},

			onDispose: () => {
				if (heartBeatInterval) {
					clearInterval(heartBeatInterval)
					heartBeatInterval = null
				}
				chrome.storage.local.set({ isAgentRunning: false }).catch(console.error)

				tabsController.dispose()
			},
		})

		this.addEventListener('statuschange', () => {
			const running = this.status === 'running'

			if (running && !heartBeatInterval) {
				heartBeatInterval = window.setInterval(() => {
					void chrome.storage.local.set({ agentHeartbeat: Date.now() })
				}, 1_000)
			} else if (!running && heartBeatInterval) {
				clearInterval(heartBeatInterval)
				heartBeatInterval = null
			}

			chrome.storage.local.set({ isAgentRunning: running }).catch(console.error)
		})
	}
}
