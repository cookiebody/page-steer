/**
 * Skill Learner
 *
 * Records user/AI operations on a page and generates a LearnedSkillRecipe.
 * Captures robust selectors (data-testid > aria-label > id > CSS path).
 *
 * Usage:
 *   const learner = new SkillLearner()
 *   learner.startRecording('xiaohongshu-publish', 'https://xiaohongshu.com')
 *   learner.recordClick('[data-testid="publish-btn"]')
 *   learner.recordInput('[data-testid="title-input"]', '{{title}}')
 *   const recipe = learner.stopRecording()
 *   await skillRegistry.saveLearnedSkill(meta, recipe)
 */
import type { LearnedSkillRecipe, LearnedStep } from './types'

export class SkillLearner {
	private steps: LearnedStep[] = []
	private recording = false
	private skillId = ''

	get isRecording(): boolean {
		return this.recording
	}

	startRecording(skillId: string): void {
		this.steps = []
		this.recording = true
		this.skillId = skillId
	}

	recordStep(step: LearnedStep): void {
		if (!this.recording) return
		this.steps.push(step)
	}

	recordClick(selector: string, fallbacks?: string[], description?: string): void {
		this.recordStep({ type: 'click', selector, fallbackSelectors: fallbacks, description })
	}

	recordInput(selector: string, value: string, isParam = false, fallbacks?: string[]): void {
		this.recordStep({
			type: 'input',
			selector,
			value,
			isParam,
			fallbackSelectors: fallbacks,
		})
	}

	recordNavigate(url: string): void {
		this.recordStep({ type: 'navigate', selector: '', value: url })
	}

	recordWait(ms: number, description?: string): void {
		this.recordStep({ type: 'wait', selector: '', waitMs: ms, description })
	}

	recordScroll(selector?: string): void {
		this.recordStep({ type: 'scroll', selector: selector || '' })
	}

	recordExtract(selector: string, fallbacks?: string[], description?: string): void {
		this.recordStep({ type: 'extract', selector, fallbackSelectors: fallbacks, description })
	}

	stopRecording(): LearnedSkillRecipe {
		this.recording = false
		const recipe: LearnedSkillRecipe = {
			steps: [...this.steps],
			confidence: this.calculateConfidence(),
			successCount: 0,
			failCount: 0,
		}
		this.steps = []
		return recipe
	}

	cancelRecording(): void {
		this.recording = false
		this.steps = []
	}

	getSteps(): LearnedStep[] {
		return [...this.steps]
	}

	private calculateConfidence(): number {
		if (this.steps.length === 0) return 0
		// Score based on how many steps have fallback selectors
		const withFallbacks = this.steps.filter(
			(s) => s.fallbackSelectors && s.fallbackSelectors.length > 0
		).length
		// Also consider data-testid usage (more reliable)
		const withTestId = this.steps.filter((s) => s.selector.includes('data-testid')).length
		return (withFallbacks / this.steps.length) * 0.4 + (withTestId / this.steps.length) * 0.6
	}
}

/**
 * Generate robust selectors for an element.
 * Returns primary selector + fallbacks ordered by reliability.
 */
export function generateSelectors(tabId: number, elementIndex: number) {
	return chrome.scripting.executeScript({
		target: { tabId },
		func: (idx: number) => {
			const interactiveEls = document.querySelectorAll(
				'a, button, input, select, textarea, [role="button"], [onclick], [tabindex], [contenteditable]'
			)
			const el = interactiveEls[idx] as HTMLElement
			if (!el) return JSON.stringify({ error: 'Element not found' })

			const selectors: string[] = []

			// 1. data-testid (most stable)
			const testId = el.getAttribute('data-testid')
			if (testId) selectors.push(`[data-testid="${testId}"]`)

			// 2. aria-label
			const ariaLabel = el.getAttribute('aria-label')
			if (ariaLabel) selectors.push(`[aria-label="${ariaLabel}"]`)

			// 3. id
			if (el.id) selectors.push(`#${el.id}`)

			// 4. Unique class + tag combo
			if (el.className && typeof el.className === 'string') {
				const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 2)
				if (classes.length > 0) {
					const sel = `${el.tagName.toLowerCase()}.${classes.join('.')}`
					if (document.querySelectorAll(sel).length === 1) {
						selectors.push(sel)
					}
				}
			}

			// 5. CSS path (last resort)
			const path: string[] = []
			let current: HTMLElement | null = el
			for (let i = 0; i < 4 && current && current !== document.body; i++) {
				let segment = current.tagName.toLowerCase()
				if (current.id) {
					segment = `#${current.id}`
					path.unshift(segment)
					break
				}
				const parent: HTMLElement | null = current.parentElement
				if (parent) {
					const siblings = Array.from(parent.children).filter(
						(c: Element) => c.tagName === current!.tagName
					)
					if (siblings.length > 1) {
						const idx = siblings.indexOf(current) + 1
						segment += `:nth-of-type(${idx})`
					}
				}
				path.unshift(segment)
				current = parent
			}
			if (path.length > 0) selectors.push(path.join(' > '))

			return JSON.stringify({
				primary: selectors[0] || null,
				fallbacks: selectors.slice(1),
				text: el.textContent?.slice(0, 50),
				tag: el.tagName.toLowerCase(),
			})
		},
		args: [elementIndex],
	})
}
