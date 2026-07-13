/**
 * Community Skill Client
 *
 * Fetches, publishes, and syncs skills from a remote registry.
 * The registry endpoint is configurable (defaults to a GitHub-based JSON registry).
 */
import type { CommunitySkillPackage, SkillMeta } from './types'

const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/cookiebody/page-steer/main/skills'

export class CommunitySkillClient {
	private registryUrl: string

	constructor(registryUrl?: string) {
		this.registryUrl = registryUrl || DEFAULT_REGISTRY_URL
	}

	/** Fetch the skill catalog (list of available community skills) */
	async fetchCatalog(): Promise<CommunitySkillPackage[]> {
		try {
			const res = await fetch(`${this.registryUrl}/catalog.json`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return await res.json()
		} catch (err) {
			console.warn('[CommunitySkills] Failed to fetch catalog:', err)
			return []
		}
	}

	/** Fetch a specific skill package by ID */
	async fetchSkill(skillId: string): Promise<CommunitySkillPackage | null> {
		try {
			const res = await fetch(`${this.registryUrl}/skills/${skillId}.json`)
			if (!res.ok) return null
			return await res.json()
		} catch {
			return null
		}
	}

	/** Search skills by keyword */
	async search(query: string): Promise<CommunitySkillPackage[]> {
		const catalog = await this.fetchCatalog()
		const q = query.toLowerCase()
		return catalog.filter(
			(pkg) =>
				pkg.meta.name.toLowerCase().includes(q) ||
				pkg.meta.description.toLowerCase().includes(q) ||
				pkg.meta.tags?.some((t) => t.toLowerCase().includes(q))
		)
	}

	/** Export a local skill as a community package (for sharing) */
	exportSkill(
		meta: SkillMeta,
		recipe?: import('./types').LearnedSkillRecipe
	): CommunitySkillPackage {
		return {
			meta: { ...meta, source: 'community' },
			recipe,
			hash: this.simpleHash(JSON.stringify({ meta, recipe })),
		}
	}

	/** Get the registry URL */
	getRegistryUrl(): string {
		return this.registryUrl
	}

	/** Set a custom registry URL */
	setRegistryUrl(url: string): void {
		this.registryUrl = url
	}

	private simpleHash(str: string): string {
		let hash = 0
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(16).padStart(8, '0')
	}
}

export const communityClient = new CommunitySkillClient()
