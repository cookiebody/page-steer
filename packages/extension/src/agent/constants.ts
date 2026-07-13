import type { LLMConfig } from '@page-steer/llms'

// Demo LLM for testing — configure your own endpoint
export const DEMO_MODEL = ''
export const DEMO_BASE_URL = ''
export const DEMO_API_KEY = ''

export const DEMO_CONFIG: LLMConfig = {
	baseURL: DEMO_BASE_URL,
	model: DEMO_MODEL,
	apiKey: DEMO_API_KEY,
}

/** Named model preset for quick switching */
export interface ModelPreset {
	id: string
	name: string
	config: LLMConfig
}

/** Built-in presets — users configure their own */
export const DEFAULT_PRESETS: ModelPreset[] = []

/** Legacy testing endpoints that should be auto-migrated to DEMO_BASE_URL */
export const LEGACY_TESTING_ENDPOINTS: string[] = []

export function isTestingEndpoint(url: string): boolean {
	if (!DEMO_BASE_URL) return false
	const normalized = url.replace(/\/+$/, '')
	return normalized === DEMO_BASE_URL || LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)
}

export function migrateLegacyEndpoint(config: LLMConfig): LLMConfig {
	const normalized = config.baseURL.replace(/\/+$/, '')
	if (LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)) {
		return { ...DEMO_CONFIG }
	}
	return config
}
