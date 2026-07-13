import { compileLearnedSkill } from './learned-executor'
import type {
	CommunitySkillPackage,
	LearnedSkillRecipe,
	SkillConfig,
	SkillDefinition,
	SkillMeta,
	SkillRegistry,
} from './types'

const STORAGE_KEY_CONFIGS = 'skill_configs'
const STORAGE_KEY_LEARNED = 'skill_learned'
const STORAGE_KEY_COMMUNITY = 'skill_community'

class SkillRegistryImpl implements SkillRegistry {
	private skills = new Map<string, SkillDefinition>()
	private configCache: Record<string, SkillConfig> | null = null

	// --- Registration ---

	register(skill: SkillDefinition): void {
		this.skills.set(skill.id, skill)
	}

	private canRegisterPersistedSkill(id: string): boolean {
		const existing = this.skills.get(id)
		return existing?.source !== 'builtin'
	}

	unregister(id: string): void {
		this.skills.delete(id)
	}

	// --- Lookup ---

	getSkillForUrl(url: string): SkillDefinition | undefined {
		for (const skill of this.skills.values()) {
			if (skill._matchers.some((p) => p.test(url))) {
				return skill
			}
		}
		return undefined
	}

	getSkill(id: string): SkillDefinition | undefined {
		return this.skills.get(id)
	}

	listSkills(): SkillDefinition[] {
		return [...this.skills.values()]
	}

	// --- Config ---

	async isEnabled(id: string): Promise<boolean> {
		const configs = await this.getConfigs()
		return configs[id]?.enabled ?? true
	}

	async setEnabled(id: string, enabled: boolean): Promise<void> {
		const configs = await this.getConfigs()
		configs[id] = {
			...configs[id],
			enabled,
			updatedAt: new Date().toISOString(),
		}
		await chrome.storage.local.set({ [STORAGE_KEY_CONFIGS]: configs })
		this.configCache = configs
	}

	async getConfigs(): Promise<Record<string, SkillConfig>> {
		if (this.configCache) return this.configCache
		const result = await chrome.storage.local.get(STORAGE_KEY_CONFIGS)
		this.configCache = (result[STORAGE_KEY_CONFIGS] as Record<string, SkillConfig>) || {}
		return this.configCache
	}

	// --- Learned Skills ---

	async saveLearnedSkill(meta: SkillMeta, recipe: LearnedSkillRecipe): Promise<void> {
		if (!this.canRegisterPersistedSkill(meta.id)) {
			throw new Error(`Cannot override built-in skill "${meta.id}"`)
		}

		const learned = await this.getLearnedSkillsRaw()
		const existing = learned.findIndex((s) => s.meta.id === meta.id)

		const entry = {
			meta: { ...meta, source: 'learned' as const, updatedAt: new Date().toISOString() },
			recipe,
		}

		if (existing >= 0) {
			learned[existing] = entry
		} else {
			learned.push(entry)
		}

		await chrome.storage.local.set({ [STORAGE_KEY_LEARNED]: learned })

		// Compile and register the skill so it's immediately available
		const compiled = compileLearnedSkill(meta, recipe)
		this.register(compiled)
	}

	async getLearnedSkills(): Promise<{ meta: SkillMeta; recipe: LearnedSkillRecipe }[]> {
		return this.getLearnedSkillsRaw()
	}

	async deleteLearnedSkill(id: string): Promise<void> {
		const learned = await this.getLearnedSkillsRaw()
		const filtered = learned.filter((s) => s.meta.id !== id)
		await chrome.storage.local.set({ [STORAGE_KEY_LEARNED]: filtered })
		this.unregister(id)
	}

	private async getLearnedSkillsRaw(): Promise<{ meta: SkillMeta; recipe: LearnedSkillRecipe }[]> {
		const result = await chrome.storage.local.get(STORAGE_KEY_LEARNED)
		return (result[STORAGE_KEY_LEARNED] as { meta: SkillMeta; recipe: LearnedSkillRecipe }[]) || []
	}

	// --- Community Skills ---

	async installCommunitySkill(pkg: CommunitySkillPackage): Promise<void> {
		if (!this.canRegisterPersistedSkill(pkg.meta.id)) {
			throw new Error(`Cannot override built-in skill "${pkg.meta.id}"`)
		}

		const community = await this.getInstalledCommunitySkills()
		const existing = community.findIndex((s) => s.meta.id === pkg.meta.id)

		if (existing >= 0) {
			community[existing] = pkg
		} else {
			community.push(pkg)
		}

		await chrome.storage.local.set({ [STORAGE_KEY_COMMUNITY]: community })

		// Compile and register
		if (pkg.recipe) {
			const compiled = compileLearnedSkill(pkg.meta, pkg.recipe)
			this.register(compiled)
		}
	}

	async getInstalledCommunitySkills(): Promise<CommunitySkillPackage[]> {
		const result = await chrome.storage.local.get(STORAGE_KEY_COMMUNITY)
		return (result[STORAGE_KEY_COMMUNITY] as CommunitySkillPackage[]) || []
	}

	async uninstallCommunitySkill(id: string): Promise<void> {
		const community = await this.getInstalledCommunitySkills()
		const filtered = community.filter((s) => s.meta.id !== id)
		await chrome.storage.local.set({ [STORAGE_KEY_COMMUNITY]: filtered })
		this.unregister(id)
	}

	// --- Boot: load persisted skills on startup ---

	async loadPersistedSkills(): Promise<void> {
		// Load learned skills
		const learned = await this.getLearnedSkillsRaw()
		for (const { meta, recipe } of learned) {
			if (!this.canRegisterPersistedSkill(meta.id)) continue
			try {
				const compiled = compileLearnedSkill(meta, recipe)
				this.register(compiled)
			} catch {
				// Skip corrupted skills
			}
		}

		// Load community skills
		const community = await this.getInstalledCommunitySkills()
		for (const pkg of community) {
			if (pkg.recipe) {
				if (!this.canRegisterPersistedSkill(pkg.meta.id)) continue
				try {
					const compiled = compileLearnedSkill(pkg.meta, pkg.recipe)
					this.register(compiled)
				} catch {
					// Skip corrupted
				}
			}
		}
	}
}

export const skillRegistry = new SkillRegistryImpl()
