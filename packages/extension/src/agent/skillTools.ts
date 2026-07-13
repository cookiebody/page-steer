/**
 * Bridge between the structured skill system (background) and the agent tool system.
 *
 * When a skill matches the current page URL, its actions are injected as
 * agent tools so the LLM can invoke them directly without user selection.
 */
import type { PageSteerTool } from '@page-steer/core'
import * as z from 'zod/v4'

interface SkillActionParam {
	type: string
	description: string
	required?: boolean
}

interface SkillActionInfo {
	name: string
	description: string
	params: Record<string, SkillActionParam>
}

interface SkillInfo {
	id: string
	name: string
	enabled: boolean
	matchPatterns: string[]
	actions: SkillActionInfo[]
}

/**
 * Query background for skills matching the given URL, then generate
 * PageSteerTool entries that delegate execution to the background skill runner.
 */
export async function getSkillToolsForUrl(url: string): Promise<Map<string, PageSteerTool>> {
	const toolsMap = new Map<string, PageSteerTool>()

	let skills: SkillInfo[]
	try {
		const response = await chrome.runtime.sendMessage({
			type: 'SKILL_COMMAND',
			command: 'list_skills',
		})
		if (!response?.data) return toolsMap
		skills = JSON.parse(response.data)
	} catch {
		return toolsMap
	}

	// Filter skills that match the current URL and are enabled. Google Trends is
	// also a navigation skill, so expose it before the user is already on Trends;
	// otherwise the model falls back to generic navigation and may construct
	// brittle Explore URLs with unsupported date parameters.
	const matchingSkills = skills.filter((skill) => {
		if (!skill.enabled) return false
		if (skill.id === 'google-trends') return true
		return skill.matchPatterns.some((pattern) => {
			try {
				return new RegExp(pattern).test(url)
			} catch {
				return false
			}
		})
	})

	for (const skill of matchingSkills) {
		for (const action of skill.actions) {
			const toolName = `${skill.id}_${action.name}`

			// Build zod schema from action params
			const schemaShape: Record<string, z.ZodType> = {}
			for (const [key, param] of Object.entries(action.params)) {
				let field: z.ZodType
				if (param.type === 'number') {
					field = z.number().describe(param.description)
				} else {
					field = z.string().describe(param.description)
				}
				if (!param.required) {
					field = field.optional()
				}
				schemaShape[key] = field
			}

			const inputSchema = Object.keys(schemaShape).length > 0 ? z.object(schemaShape) : z.object({})

			toolsMap.set(toolName, {
				description: `[${skill.name}] ${action.description}`,
				inputSchema,
				execute: async function (this: any, args: any) {
					const response = await chrome.runtime.sendMessage({
						type: 'SKILL_COMMAND',
						command: 'run_skill',
						params: {
							skill: skill.id,
							action: action.name,
							params: args,
						},
					})
					if (response?.error) {
						return `❌ Skill error: ${response.error}`
					}
					if (!response?.data) return '✅ Action completed'

					// Parse response to extract tab info
					try {
						const parsed = JSON.parse(response.data)
						if (parsed.tabInfo) {
							const { tabId, url, title } = parsed.tabInfo
							const tabLabel = title || `Tab ${tabId}`
							const tabUrl = url || ''
							const header = `📍 [Tab ${tabId}] ${tabLabel}\n🔗 ${tabUrl}\n\n`
							return header + (parsed.result || '✅ Done')
						}
					} catch {
						// Not JSON or no tabInfo — return raw
					}
					return response.data
				},
			})
		}
	}

	return toolsMap
}
