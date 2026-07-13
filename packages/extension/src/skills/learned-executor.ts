/**
 * Learned Skill Executor
 *
 * Compiles a LearnedSkillRecipe (stored steps) into an executable SkillDefinition.
 * Each action in the recipe becomes a sequence of DOM operations injected via
 * chrome.scripting.executeScript.
 */
import type { LearnedSkillRecipe, LearnedStep, SkillDefinition, SkillMeta } from './types'

/**
 * Compile a learned skill recipe into a runnable SkillDefinition.
 */
export function compileLearnedSkill(meta: SkillMeta, recipe: LearnedSkillRecipe): SkillDefinition {
	return {
		...meta,
		_matchers: meta.matchPatterns.map((p) => new RegExp(p)),
		async execute(tabId: number, action: string, params: Record<string, unknown>): Promise<string> {
			// Multi-action recipe: look up steps by action name
			if (recipe.actionSteps && recipe.actionSteps[action]) {
				return executeRecipe(tabId, recipe.actionSteps[action], params)
			}

			// Single-action fallback: execute the flat steps array
			if (action === 'run' || action === meta.actions[0]?.name) {
				return executeRecipe(tabId, recipe.steps, params)
			}
			return `Error: Unknown action "${action}" for learned skill "${meta.id}"`
		},
	}
}

/**
 * Execute a sequence of learned steps in the target tab.
 */
async function executeRecipe(
	tabId: number,
	steps: LearnedStep[],
	params: Record<string, unknown>
): Promise<string> {
	const results: string[] = []

	for (const step of steps) {
		const result = await executeStep(tabId, step, params)
		results.push(result)

		// If a step fails, stop execution
		if (result.startsWith('Error:')) {
			return JSON.stringify({
				success: false,
				stepsCompleted: results.length - 1,
				error: result,
				log: results,
			})
		}

		// Small delay between steps for DOM to settle
		if (step.type !== 'wait') {
			await new Promise((r) => setTimeout(r, 300))
		}
	}

	return JSON.stringify({ success: true, stepsCompleted: steps.length, log: results })
}

/**
 * Execute a single step.
 */
async function executeStep(
	tabId: number,
	step: LearnedStep,
	params: Record<string, unknown>
): Promise<string> {
	// Resolve parameter placeholders in value (e.g. "{{text}}" → params.text)
	const resolvedValue = step.value ? resolveParams(step.value, params) : undefined

	switch (step.type) {
		case 'navigate': {
			if (!resolvedValue) return 'Error: navigate step missing URL'
			await chrome.tabs.update(tabId, { url: resolvedValue })
			await new Promise((r) => setTimeout(r, 2500))
			return `Navigated to ${resolvedValue}`
		}

		case 'wait': {
			const ms = step.waitMs || 1000
			await new Promise((r) => setTimeout(r, ms))
			return `Waited ${ms}ms`
		}

		case 'click': {
			const [result] = await chrome.scripting.executeScript({
				target: { tabId },
				func: (selector: string, fallbacks: string[]) => {
					let el = document.querySelector(selector) as HTMLElement | null
					if (!el && fallbacks) {
						for (const fb of fallbacks) {
							el = document.querySelector(fb) as HTMLElement | null
							if (el) break
						}
					}
					if (!el) return `Error: Element not found: ${selector}`
					el.click()
					return `Clicked: ${selector}`
				},
				args: [step.selector, step.fallbackSelectors || []],
			})
			return result?.result || 'Error: click failed'
		}

		case 'input': {
			if (resolvedValue === undefined) return 'Error: input step missing value'
			const [result] = await chrome.scripting.executeScript({
				target: { tabId },
				func: (selector: string, fallbacks: string[], value: string) => {
					let el = document.querySelector(selector) as HTMLElement | null
					if (!el && fallbacks) {
						for (const fb of fallbacks) {
							el = document.querySelector(fb) as HTMLElement | null
							if (el) break
						}
					}
					if (!el) return `Error: Input not found: ${selector}`

					el.focus()
					if ('value' in el) {
						;(el as HTMLInputElement).value = value
						el.dispatchEvent(new Event('input', { bubbles: true }))
					} else {
						// contenteditable — execCommand is deprecated but only reliable way in isolated world
						// eslint-disable-next-line @typescript-eslint/no-deprecated
						document.execCommand('selectAll', false)
						// eslint-disable-next-line @typescript-eslint/no-deprecated
						document.execCommand('insertText', false, value)
					}
					return `Input: "${value.slice(0, 50)}" into ${selector}`
				},
				args: [step.selector, step.fallbackSelectors || [], resolvedValue],
			})
			return result?.result || 'Error: input failed'
		}

		case 'scroll': {
			const [result] = await chrome.scripting.executeScript({
				target: { tabId },
				func: (selector: string) => {
					if (selector) {
						const el = document.querySelector(selector)
						if (el) {
							el.scrollIntoView({ behavior: 'smooth' })
							return `Scrolled to ${selector}`
						}
					}
					window.scrollBy(0, 600)
					return 'Scrolled down'
				},
				args: [step.selector || ''],
			})
			return result?.result || 'Scrolled'
		}

		case 'extract': {
			const [result] = await chrome.scripting.executeScript({
				target: { tabId },
				func: (selector: string, fallbacks: string[]) => {
					let el = document.querySelector(selector) as HTMLElement | null
					if (!el && fallbacks) {
						for (const fb of fallbacks) {
							el = document.querySelector(fb) as HTMLElement | null
							if (el) break
						}
					}
					if (!el) return `Error: Element not found: ${selector}`
					return el.textContent?.slice(0, 2000) || ''
				},
				args: [step.selector, step.fallbackSelectors || []],
			})
			return result?.result || 'Error: extract failed'
		}

		default:
			return `Error: Unknown step type "${step.type}"`
	}
}

/**
 * Replace {{paramName}} placeholders in a string with actual values.
 */
function resolveParams(template: string, params: Record<string, unknown>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
		const val = params[key]
		if (val === undefined) return `{{${key}}}`
		return typeof val === 'string' ? val : JSON.stringify(val)
	})
}
