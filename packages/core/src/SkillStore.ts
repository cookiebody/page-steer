/**
 * SkillStore - Automatically learns operational skills from successful retries
 * and injects them as page instructions on future visits.
 */

// ==================== Data Models ====================

export interface LearnedSkill {
	id: string
	// Matching criteria
	urlPattern: string // glob-style pattern, e.g. "https://*.feishu.cn/*"
	pageSignatures: string[] // keywords from page title/content for fuzzy matching

	// Operational knowledge (injected into prompt)
	instruction: string // Human-readable guidance for the LLM

	// Metadata
	learnedFrom: string // task description that produced this skill
	createdAt: number // timestamp
	lastUsed: number // timestamp
	successCount: number // times this skill was matched and task succeeded
	failureCount: number // times matched but task still failed (for pruning)
}

export interface RetryContext {
	url: string
	title: string
	task: string
	failedAction: { tool: string; input: any; error: string }
	successAction: { tool: string; input: any; result: string }
}

// ==================== Storage Interface ====================

export interface SkillStorage {
	get(): Promise<LearnedSkill[]>
	set(skills: LearnedSkill[]): Promise<void>
}

/** Default localStorage-based storage backend */
export class LocalSkillStorage implements SkillStorage {
	private key = 'page-steer-skills'

	async get(): Promise<LearnedSkill[]> {
		try {
			const raw = localStorage.getItem(this.key)
			if (!raw) return []
			return JSON.parse(raw) as LearnedSkill[]
		} catch {
			return []
		}
	}

	async set(skills: LearnedSkill[]): Promise<void> {
		localStorage.setItem(this.key, JSON.stringify(skills))
	}
}

// ==================== Utilities ====================

const MAX_SKILLS = 50

/** Convert a glob pattern to a RegExp (same approach as page-controller) */
function globToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
}

/**
 * Generate a URL pattern from a concrete URL.
 * Strips query params, keeps only first 2 path segments, wildcards the rest.
 * e.g. "https://www.example.com/path/to/page?q=123" -> "https://www.example.com/path/to/*"
 */
function generateUrlPattern(url: string): string {
	try {
		const parsed = new URL(url)
		const segments = parsed.pathname.split('/').filter(Boolean)
		const kept = segments.slice(0, 2).join('/')
		const basePath = kept ? `/${kept}/*` : '/*'
		return `${parsed.origin}${basePath}`
	} catch {
		// Fallback for malformed URLs
		return url.replace(/\?.*$/, '').replace(/\/[^/]*$/, '/*')
	}
}

/** Generate a unique skill ID */
function generateId(): string {
	return `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Generate instruction text from a retry context using templates.
 */
function generateInstruction(context: RetryContext): string {
	const error = context.failedAction.error

	if (error.includes('covered by')) {
		const match = /covered by (.+)/.exec(error)
		const element = match?.[1] || 'an overlay'
		return (
			`This site has overlay elements (${element}) that may block interactions. ` +
			`Look for a close/dismiss button first.`
		)
	}

	if (error.includes('No interactive element found at index')) {
		return (
			`Elements on this page may shift indices after interaction. ` +
			`Always re-observe before acting on indices.`
		)
	}

	if (error.includes('Element is not an input')) {
		return (
			`Some interactive-looking elements on this page are not standard inputs. ` +
			`Try using execute_javascript for text entry.`
		)
	}

	// Default template
	return (
		`Previous attempts on this site encountered: ${error}. ` +
		`After retrying with ${context.successAction.tool}(${JSON.stringify(context.successAction.input)}), it worked.`
	)
}

// ==================== SkillStore Class ====================

export class SkillStore {
	private skills: LearnedSkill[] = []
	private storage: SkillStorage

	constructor(storage?: SkillStorage) {
		this.storage = storage ?? new LocalSkillStorage()
	}

	/** Load skills from storage */
	async load(): Promise<void> {
		this.skills = await this.storage.get()
	}

	/** Save skills to storage */
	async save(): Promise<void> {
		await this.storage.set(this.skills)
	}

	/** Find skills matching a URL and optional page title */
	findMatching(url: string, title?: string): LearnedSkill[] {
		return this.skills.filter((skill) => {
			// URL pattern match
			const regex = globToRegex(skill.urlPattern)
			if (!regex.test(url)) return false

			// If skill has page signatures, at least one must match the title
			if (skill.pageSignatures.length > 0 && title) {
				const lowerTitle = title.toLowerCase()
				const hasSignatureMatch = skill.pageSignatures.some((sig) =>
					lowerTitle.includes(sig.toLowerCase())
				)
				if (!hasSignatureMatch) return false
			}

			return true
		})
	}

	/** Learn a new skill from a retry success */
	async learnFromRetry(context: RetryContext): Promise<LearnedSkill> {
		const skill: LearnedSkill = {
			id: generateId(),
			urlPattern: generateUrlPattern(context.url),
			pageSignatures: context.title
				? context.title
						.split(/[\s\-|·_]+/)
						.filter((w) => w.length > 2)
						.slice(0, 5)
				: [],
			instruction: generateInstruction(context),
			learnedFrom: context.task,
			createdAt: Date.now(),
			lastUsed: Date.now(),
			successCount: 0,
			failureCount: 0,
		}

		this.skills.push(skill)
		this.#pruneIfNeeded()
		await this.save()

		return skill
	}

	/** Mark a skill as successfully used (increment successCount) */
	async markSuccess(skillId: string): Promise<void> {
		const skill = this.skills.find((s) => s.id === skillId)
		if (skill) {
			skill.successCount++
			skill.lastUsed = Date.now()
			await this.save()
		}
	}

	/** Mark a skill as failed (increment failureCount, prune if too many failures) */
	async markFailure(skillId: string): Promise<void> {
		const skill = this.skills.find((s) => s.id === skillId)
		if (skill) {
			skill.failureCount++
			// Auto-prune skills with too many failures
			if (skill.failureCount > skill.successCount * 2) {
				this.skills = this.skills.filter((s) => s.id !== skillId)
			}
			await this.save()
		}
	}

	/** Get instructions string for a URL (for use with getPageInstructions) */
	getInstructionsForPage(url: string, title?: string): string | undefined {
		const matching = this.findMatching(url, title)
		if (matching.length === 0) return undefined

		const instructions = matching.map((s) => `- ${s.instruction}`).join('\n')
		return `[Learned from previous interactions]\n${instructions}`
	}

	/** Export all skills (for debugging/sharing) */
	export(): LearnedSkill[] {
		return [...this.skills]
	}

	/** Import skills */
	import(skills: LearnedSkill[]): void {
		for (const skill of skills) {
			// Avoid duplicates by ID
			if (!this.skills.some((s) => s.id === skill.id)) {
				this.skills.push(skill)
			}
		}
		this.#pruneIfNeeded()
	}

	/**
	 * Prune skills when exceeding the max limit.
	 * Removes skills with too many failures first, then oldest/least-used.
	 */
	#pruneIfNeeded(): void {
		// First: remove skills where failureCount > successCount * 2
		this.skills = this.skills.filter((s) => s.failureCount <= s.successCount * 2)

		// Then: if still over limit, remove oldest/least-used
		if (this.skills.length > MAX_SKILLS) {
			this.skills.sort((a, b) => {
				// Prefer keeping skills with higher success count
				const scoreA = a.successCount - a.failureCount
				const scoreB = b.successCount - b.failureCount
				if (scoreA !== scoreB) return scoreB - scoreA
				// Then by most recently used
				return b.lastUsed - a.lastUsed
			})
			this.skills = this.skills.slice(0, MAX_SKILLS)
		}
	}
}
