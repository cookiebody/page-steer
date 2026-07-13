import type { SkillDefinition, SkillMeta } from './types'

/**
 * Create a SkillDefinition from metadata + execute function.
 * Compiles matchPatterns strings into RegExp objects.
 */
export function defineSkill(meta: SkillMeta, execute: SkillDefinition['execute']): SkillDefinition {
	return {
		...meta,
		_matchers: meta.matchPatterns.map((p) => new RegExp(p)),
		execute,
	}
}
