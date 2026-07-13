/**
 * Skill Lifecycle System
 *
 * Three sources of skills:
 * 1. Built-in: Shipped with extension (e.g. twitter.ts) — code-level, versioned
 * 2. Learned: AI auto-discovers selectors during operation, saves as replayable recipes
 * 3. Community: Downloaded from remote registry, shared by other users
 *
 * Storage: chrome.storage.local for configs + IndexedDB for learned skill data
 * Sync: Optional remote endpoint for publishing/subscribing community skills
 */

// --- Skill Action Parameter ---

export interface SkillActionParam {
	type: 'string' | 'number' | 'boolean'
	description: string
	required?: boolean
	default?: unknown
}

// --- Skill Action ---

export interface SkillAction {
	name: string
	description: string
	params: Record<string, SkillActionParam>
}

// --- Skill Metadata (serializable, shareable) ---

export interface SkillMeta {
	/** Unique skill ID, e.g. "twitter", "xiaohongshu" */
	id: string
	/** Display name */
	name: string
	/** Skill version (semver) */
	version: string
	/** Short description */
	description: string
	/** Author identifier */
	author?: string
	/** URL pattern(s) this skill works on (regex strings) */
	matchPatterns: string[]
	/** Icon URL or emoji */
	icon?: string
	/** Available actions */
	actions: SkillAction[]
	/** Skill source */
	source?: 'builtin' | 'learned' | 'community'
	/** When the skill was created */
	createdAt?: string
	/** When the skill was last modified */
	updatedAt?: string
	/** Tags for discovery */
	tags?: string[]
}

// --- Learned Skill Step (recorded operation) ---

export interface LearnedStep {
	/** Action type: click, input, navigate, wait, extract */
	type: 'click' | 'input' | 'navigate' | 'wait' | 'extract' | 'scroll'
	/** CSS selector for the target element */
	selector: string
	/** Fallback selectors (data-testid, aria-label, text content) */
	fallbackSelectors?: string[]
	/** Value for input actions / URL for navigate */
	value?: string
	/** Whether value is a parameter placeholder (e.g. "{{text}}") */
	isParam?: boolean
	/** Wait duration in ms */
	waitMs?: number
	/** Description of what this step does */
	description?: string
	/** Screenshot reference (stored separately) */
	screenshotRef?: string
}

/** A learned skill recipe — recorded sequence of DOM operations */
export interface LearnedSkillRecipe {
	/** Steps to execute in order (used when skill has a single action) */
	steps: LearnedStep[]
	/** Per-action step sequences (used when skill has multiple actions) */
	actionSteps?: Record<string, LearnedStep[]>
	/** Selector stability score (0-1, based on how many fallbacks exist) */
	confidence: number
	/** Number of times this recipe has been successfully executed */
	successCount: number
	/** Number of times this recipe has failed */
	failCount: number
	/** Last successful execution timestamp */
	lastSuccess?: string
}

// --- Full Skill Definition (runtime, includes execute function) ---

export interface SkillDefinition extends SkillMeta {
	/** Compiled match patterns (runtime only, not serialized) */
	_matchers: RegExp[]
	/** Execute an action in the target tab */
	execute: (tabId: number, action: string, params: Record<string, unknown>) => Promise<string>
}

// --- Skill Config (per-skill settings, persisted) ---

export interface SkillConfig {
	/** Whether the skill is enabled */
	enabled: boolean
	/** When the config was last changed */
	updatedAt?: string
	/** Custom user notes */
	notes?: string
}

// --- Community Skill Package (for sharing/downloading) ---

export interface CommunitySkillPackage {
	meta: SkillMeta
	/** The skill recipe (for learned skills) or action implementations */
	recipe?: LearnedSkillRecipe
	/** Remote source URL this was downloaded from */
	sourceUrl?: string
	/** SHA256 hash for integrity verification */
	hash?: string
	/** Download count (from registry) */
	downloads?: number
	/** Rating (from registry) */
	rating?: number
}

// --- Skill Registry Interface ---

export interface SkillRegistry {
	// --- Registration ---
	register(skill: SkillDefinition): void
	unregister(id: string): void

	// --- Lookup ---
	getSkillForUrl(url: string): SkillDefinition | undefined
	getSkill(id: string): SkillDefinition | undefined
	listSkills(): SkillDefinition[]

	// --- Config (enable/disable) ---
	isEnabled(id: string): Promise<boolean>
	setEnabled(id: string, enabled: boolean): Promise<void>
	getConfigs(): Promise<Record<string, SkillConfig>>

	// --- Learned Skills ---
	saveLearnedSkill(meta: SkillMeta, recipe: LearnedSkillRecipe): Promise<void>
	getLearnedSkills(): Promise<{ meta: SkillMeta; recipe: LearnedSkillRecipe }[]>
	deleteLearnedSkill(id: string): Promise<void>

	// --- Community Skills ---
	installCommunitySkill(pkg: CommunitySkillPackage): Promise<void>
	getInstalledCommunitySkills(): Promise<CommunitySkillPackage[]>
	uninstallCommunitySkill(id: string): Promise<void>
}
