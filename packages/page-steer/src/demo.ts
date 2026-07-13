/**
 * IIFE demo entry - auto-initializes with built-in demo API for testing
 */
import { PageSteer, type PageSteerConfig } from './PageSteer'

const currentScript = document.currentScript as HTMLScriptElement | null
const currentScriptURL = currentScript?.src ? new URL(currentScript.src) : null
const autoInit = currentScriptURL?.searchParams.get('autoInit') !== 'false'

// Clean up existing instances to prevent multiple injections from bookmarklet
if (autoInit && window.pageSteer) {
	window.pageSteer.dispose()
}

// Mount to global window object
window.PageSteer = PageSteer

console.log('🚀 page-steer.js loaded!')

const DEMO_MODEL = ''
const DEMO_BASE_URL = ''
const DEMO_API_KEY = ''

// in case document.x is not ready yet
if (autoInit) {
	setTimeout(() => {
		let config: PageSteerConfig
		let showPanel = true

		if (currentScriptURL) {
			const url = currentScriptURL
			const model = url.searchParams.get('model') || DEMO_MODEL
			const baseURL = url.searchParams.get('baseURL') || DEMO_BASE_URL
			const apiKey = url.searchParams.get('apiKey') || DEMO_API_KEY
			const language = (url.searchParams.get('lang') as 'zh-CN' | 'en-US') || 'zh-CN'
			showPanel = ((url.searchParams.get('showPanel') as 'true' | 'false') || 'true') === 'true'
			config = { model, baseURL, apiKey, language }
		} else {
			console.log('🚀 page-steer.js no current script detected, using default demo config')
			config = {
				model: import.meta.env.LLM_MODEL_NAME ? import.meta.env.LLM_MODEL_NAME : DEMO_MODEL,
				baseURL: import.meta.env.LLM_BASE_URL ? import.meta.env.LLM_BASE_URL : DEMO_BASE_URL,
				apiKey: import.meta.env.LLM_API_KEY ? import.meta.env.LLM_API_KEY : DEMO_API_KEY,
			}
		}

		// Create agent
		window.pageSteer = new PageSteer(config)
		if (showPanel) {
			window.pageSteer.panel.show()
		}

		console.log('🚀 page-steer.js initialized with config:', window.pageSteer.config)
	})
}
