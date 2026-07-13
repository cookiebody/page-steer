/// <reference types="vite/client" />
import type { PageSteer } from './PageSteer'

declare global {
	interface Window {
		pageSteer?: PageSteer
		PageSteer: typeof PageSteer
	}
}
