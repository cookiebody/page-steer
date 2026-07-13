/**
 * Card HTML generation utilities for Panel
 */
import { renderMarkdown } from '../markdown'
import { escapeHtml } from '../utils'

import styles from './Panel.module.css'

type CardType = 'default' | 'input' | 'output' | 'question' | 'observation'

interface CardOptions {
	icon: string
	content: string | string[]
	meta?: string
	type?: CardType
}

/** Create a single history card */
export function createCard({ icon, content, meta, type }: CardOptions): string {
	const typeClass = type ? styles[type] : ''

	let contentHtml: string
	if (Array.isArray(content)) {
		contentHtml = `<div class="${styles.reflectionLines}">${content.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</div>`
	} else if (type === 'output') {
		// Render markdown for agent output (done tool text)
		contentHtml = `<div class="${styles.markdownOutput}">${renderMarkdown(content)}</div>`
	} else {
		contentHtml = `<span>${escapeHtml(content)}</span>`
	}

	const copyButton =
		type === 'output'
			? `<button class="${styles.copyButton}" data-copy-content="${escapeHtml(Array.isArray(content) ? content.join('\n') : content)}" title="Copy">📋</button>`
			: ''

	return `
		<div class="${styles.historyItem} ${typeClass}">
			<div class="${styles.historyContent}">
				<span class="${styles.statusIcon}">${icon}</span>
				${contentHtml}
			</div>
			${copyButton}
			${meta ? `<div class="${styles.historyMeta}">${meta}</div>` : ''}
		</div>
	`
}

/** Create reflection lines from reflection object */
export function createReflectionLines(reflection: {
	evaluation_previous_goal?: string
	memory?: string
	next_goal?: string
}): string[] {
	const lines: string[] = []
	if (reflection.evaluation_previous_goal) {
		lines.push(`🔍 ${reflection.evaluation_previous_goal}`)
	}
	if (reflection.memory) {
		lines.push(`💾 ${reflection.memory}`)
	}
	if (reflection.next_goal) {
		lines.push(`🎯 ${reflection.next_goal}`)
	}
	return lines
}
