// --- Register built-in skills ---
import { googleTrendsSkill } from './google-trends'
import { skillRegistry } from './registry'
import { twitterSkill } from './twitter'

// --- Exports ---
export { skillRegistry } from './registry'
export { defineSkill } from './define'
export { googleTrendsSkill } from './google-trends'
export { twitterSkill } from './twitter'
export { SkillLearner, generateSelectors } from './learner'
export { compileLearnedSkill } from './learned-executor'
export { communityClient } from './community'
export type {
	SkillDefinition,
	SkillAction,
	SkillActionParam,
	SkillMeta,
	SkillConfig,
	SkillRegistry,
	LearnedStep,
	LearnedSkillRecipe,
	CommunitySkillPackage,
} from './types'

skillRegistry.register(twitterSkill)
skillRegistry.register(googleTrendsSkill)

// --- Load persisted skills (learned + community) on import ---
skillRegistry.loadPersistedSkills().catch((err) => {
	console.warn('[Skills] Failed to load persisted skills:', err)
})
