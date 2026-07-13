import { useEffect, useRef, useState } from 'react'

interface SkillOption {
	id: string
	name: string
	icon?: string
	description: string
	actions: { name: string; description: string }[]
}

interface SlashMenuProps {
	query: string
	onSelect: (skillId: string, prompt: string) => void
	onClose: () => void
}

export function SlashMenu({ query, onSelect, onClose }: SlashMenuProps) {
	const [skills, setSkills] = useState<SkillOption[]>([])
	const [focusIndex, setFocusIndex] = useState(0)
	const menuRef = useRef<HTMLDivElement>(null)

	// Load skills on mount
	useEffect(() => {
		chrome.runtime
			.sendMessage({ type: 'SKILL_COMMAND', command: 'list_skills' })
			.then((response) => {
				if (response?.data) {
					const all = JSON.parse(response.data) as (SkillOption & { enabled: boolean })[]
					setSkills(all.filter((s) => s.enabled))
				}
			})
			.catch(() => {})
	}, [])

	// Filter by query (text after /)
	const searchTerm = query.toLowerCase()
	const filtered = skills.filter(
		(s) =>
			s.name.toLowerCase().includes(searchTerm) ||
			s.id.toLowerCase().includes(searchTerm) ||
			s.description.toLowerCase().includes(searchTerm)
	)

	// Reset focus when items change
	useEffect(() => {
		setFocusIndex(0)
	}, [filtered.length])

	// Keyboard nav
	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault()
				setFocusIndex((i) => Math.min(i + 1, filtered.length - 1))
			} else if (e.key === 'ArrowUp') {
				e.preventDefault()
				setFocusIndex((i) => Math.max(i - 1, 0))
			} else if (e.key === 'Enter') {
				e.preventDefault()
				if (filtered.length > 0) handleSelect(focusIndex)
			} else if (e.key === 'Escape') {
				e.preventDefault()
				onClose()
			}
		}
		document.addEventListener('keydown', handleKey)
		return () => document.removeEventListener('keydown', handleKey)
	}, [filtered, focusIndex])

	const handleSelect = (index: number) => {
		const skill = filtered[index]
		if (!skill) return
		// Generate a natural prompt hint based on the skill
		const hint = getSkillHint(skill)
		onSelect(skill.id, hint)
	}

	if (skills.length === 0) {
		return (
			<div
				ref={menuRef}
				className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg p-3 text-xs text-muted-foreground"
			>
				No skills available
			</div>
		)
	}

	return (
		<div
			ref={menuRef}
			className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-xl shadow-lg overflow-hidden max-h-[240px] overflow-y-auto z-50"
		>
			{/* Header */}
			<div className="px-3 py-1.5 border-b text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
				Skills
			</div>

			{/* Items — single level, no action sub-menu */}
			{filtered.map((skill, i) => (
				<button
					key={skill.id}
					type="button"
					className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
						i === focusIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
					}`}
					onMouseEnter={() => setFocusIndex(i)}
					onClick={() => handleSelect(i)}
				>
					{skill.icon && <span className="text-base shrink-0">{skill.icon}</span>}
					<div className="flex-1 min-w-0">
						<span className="font-medium text-[13px]">{skill.name}</span>
						<p className="text-[11px] text-muted-foreground truncate mt-0.5">{skill.description}</p>
					</div>
				</button>
			))}

			{filtered.length === 0 && (
				<div className="px-3 py-3 text-xs text-muted-foreground text-center">No match</div>
			)}
		</div>
	)
}

/** Generate a natural language prompt hint when a skill is selected */
function getSkillHint(skill: SkillOption): string {
	// Provide a contextual starter that encourages natural language input
	const hints: Record<string, string> = {
		twitter: 'On Twitter, ',
		'google-trends': 'On Google Trends, ',
	}
	return hints[skill.id] || `Using ${skill.name}, `
}
