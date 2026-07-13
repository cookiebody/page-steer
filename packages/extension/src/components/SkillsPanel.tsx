import { BookOpen, CornerUpLeft, Download, Power, PowerOff, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

interface SkillsPanelProps {
	onClose: () => void
}

/** Skill info returned from background list_skills command */
interface SkillInfo {
	id: string
	name: string
	version?: string
	description?: string
	icon?: string
	enabled: boolean
	source?: 'builtin' | 'learned' | 'community'
	matchPatterns?: string[]
	actions: { name: string; description: string; params: Record<string, unknown> }[]
}

/** Learned skill from storage */
interface LearnedSkillEntry {
	id: string
	name: string
	version?: string
	description?: string
	stepsCount: number
	confidence: number
	successCount: number
	failCount: number
}

export function SkillsPanel({ onClose }: SkillsPanelProps) {
	const [skills, setSkills] = useState<SkillInfo[]>([])
	const [learned, setLearned] = useState<LearnedSkillEntry[]>([])
	const [loading, setLoading] = useState(true)
	const fileInputRef = useRef<HTMLInputElement>(null)

	// Load skills from background
	const loadSkills = async () => {
		try {
			const response = await chrome.runtime.sendMessage({
				type: 'SKILL_COMMAND',
				command: 'list_skills',
			})
			if (response?.error) {
				console.error('[SkillsPanel] list_skills error:', response.error)
				return
			}
			const allSkills: SkillInfo[] = JSON.parse(response.data)
			setSkills(allSkills)

			// Extract learned entries for stats display
			const learnedResult = await chrome.storage.local.get('skill_learned')
			const learnedRaw = (learnedResult.skill_learned || []) as {
				meta: { id: string; name: string; version?: string; description?: string }
				recipe: {
					steps: unknown[]
					confidence: number
					successCount: number
					failCount: number
				}
			}[]
			setLearned(
				learnedRaw.map((s) => ({
					id: s.meta.id,
					name: s.meta.name,
					version: s.meta.version,
					description: s.meta.description,
					stepsCount: s.recipe.steps.length,
					confidence: s.recipe.confidence,
					successCount: s.recipe.successCount,
					failCount: s.recipe.failCount,
				}))
			)
		} catch (err) {
			console.error('[SkillsPanel] Failed to load skills:', err)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		loadSkills()
	}, [])

	const toggleSkill = async (id: string, currentEnabled: boolean) => {
		await chrome.runtime.sendMessage({
			type: 'SKILL_COMMAND',
			command: 'enable_skill',
			params: { skill: id, enabled: !currentEnabled },
		})
		setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !currentEnabled } : s)))
	}

	const deleteSkill = async (id: string) => {
		await chrome.runtime.sendMessage({
			type: 'SKILL_COMMAND',
			command: 'delete_learned_skill',
			params: { skill: id },
		})
		setSkills((prev) => prev.filter((s) => s.id !== id))
		setLearned((prev) => prev.filter((s) => s.id !== id))
	}

	const handleExport = async () => {
		const result = await chrome.storage.local.get('skill_learned')
		const data = result.skill_learned || []
		const json = JSON.stringify(data, null, 2)
		const blob = new Blob([json], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `page-steer-skills-${new Date().toISOString().slice(0, 10)}.json`
		a.click()
		URL.revokeObjectURL(url)
	}

	const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = async () => {
			try {
				const imported = JSON.parse(reader.result as string)
				if (!Array.isArray(imported)) return

				const result = await chrome.storage.local.get('skill_learned')
				const existing = (result.skill_learned || []) as { meta: { id: string } }[]
				const existingIds = new Set(existing.map((s) => s.meta.id))
				const newSkills = imported.filter(
					(s: { meta?: { id?: string } }) => s.meta?.id && !existingIds.has(s.meta.id)
				)
				await chrome.storage.local.set({ skill_learned: [...existing, ...newSkills] })
				loadSkills()
			} catch {
				console.error('[SkillsPanel] Invalid JSON file')
			}
		}
		reader.readAsText(file)
		e.target.value = ''
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen text-sm text-muted-foreground">
				Loading skills...
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-3 p-4 h-screen overflow-y-auto">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold flex items-center gap-2">
					<BookOpen className="size-4" /> Skills
				</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onClose}
					className="absolute top-2 right-3 cursor-pointer"
					aria-label="Back"
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</div>

			<p className="text-[11px] text-muted-foreground -mt-1">
				Platform-specific automations. Built-in skills ship with the extension; learned skills are
				recorded by AI during use.
			</p>

			{/* Toolbar */}
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[11px] gap-1 cursor-pointer"
					onClick={handleExport}
					disabled={learned.length === 0}
				>
					<Download className="size-3" /> Export
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[11px] gap-1 cursor-pointer"
					onClick={() => fileInputRef.current?.click()}
				>
					<Upload className="size-3" /> Import
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".json"
					className="hidden"
					onChange={handleImport}
				/>
			</div>

			{/* Skills list */}
			{skills.length === 0 && (
				<div className="text-center text-xs text-muted-foreground py-8">
					No skills available. Use MCP to learn new skills from page interactions.
				</div>
			)}

			{skills.map((skill) => (
				<div
					key={skill.id}
					className={`flex flex-col gap-1.5 p-3 border rounded-lg ${skill.enabled ? 'bg-muted/20' : 'bg-muted/5 opacity-60'}`}
				>
					{/* Header row */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							{skill.icon && <span className="text-base">{skill.icon}</span>}
							<span className="text-[13px] font-medium">{skill.name}</span>
							{skill.version && (
								<span className="text-[9px] text-muted-foreground bg-muted rounded px-1 py-0.5">
									v{skill.version}
								</span>
							)}
							{skill.source && (
								<span
									className={`text-[9px] rounded px-1 py-0.5 ${
										skill.source === 'builtin'
											? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
											: skill.source === 'learned'
												? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
												: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
									}`}
								>
									{skill.source}
								</span>
							)}
						</div>
						<div className="flex items-center gap-0.5">
							<Button
								variant="ghost"
								size="icon-sm"
								className="size-6 cursor-pointer"
								onClick={() => toggleSkill(skill.id, skill.enabled)}
								aria-label={skill.enabled ? 'Disable' : 'Enable'}
								title={skill.enabled ? 'Disable' : 'Enable'}
							>
								{skill.enabled ? (
									<Power className="size-3 text-green-600" />
								) : (
									<PowerOff className="size-3 text-muted-foreground" />
								)}
							</Button>
							{skill.source === 'learned' && (
								<Button
									variant="ghost"
									size="icon-sm"
									className="size-6 cursor-pointer hover:text-destructive"
									onClick={() => deleteSkill(skill.id)}
									aria-label="Delete"
								>
									<Trash2 className="size-3" />
								</Button>
							)}
						</div>
					</div>

					{/* Description */}
					{skill.description && (
						<p className="text-[11px] text-muted-foreground">{skill.description}</p>
					)}

					{/* Actions */}
					<div className="flex flex-wrap gap-1">
						{skill.actions.map((action) => (
							<span
								key={action.name}
								className="text-[9px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground"
								title={action.description}
							>
								{action.name}
							</span>
						))}
					</div>

					{/* Learned skill stats */}
					{skill.source === 'learned' && learned.find((l) => l.id === skill.id) && (
						<div className="flex items-center gap-3 text-[9px] text-muted-foreground/70 mt-0.5">
							<span>{learned.find((l) => l.id === skill.id)!.stepsCount} steps</span>
							<span>
								confidence: {Math.round(learned.find((l) => l.id === skill.id)!.confidence * 100)}%
							</span>
							<span>✓ {learned.find((l) => l.id === skill.id)!.successCount}</span>
							<span>✗ {learned.find((l) => l.id === skill.id)!.failCount}</span>
						</div>
					)}
				</div>
			))}
		</div>
	)
}
