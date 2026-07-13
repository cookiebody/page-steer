/**
 * Chrome extension storage backend for SkillStore.
 * Uses chrome.storage.local for persistence across sessions.
 */
import type { LearnedSkill, SkillStorage } from '@page-steer/core/skill-store'

const STORAGE_KEY = 'pageSteerSkills'

export class ChromeSkillStorage implements SkillStorage {
	async get(): Promise<LearnedSkill[]> {
		try {
			const result = await chrome.storage.local.get(STORAGE_KEY)
			return (result[STORAGE_KEY] as LearnedSkill[]) || []
		} catch {
			return []
		}
	}

	async set(skills: LearnedSkill[]): Promise<void> {
		await chrome.storage.local.set({ [STORAGE_KEY]: skills })
	}
}
