/**
 * Lightweight markdown renderer for React.
 * Supports: headings, bold, italic, inline code, code blocks, links, lists, blockquotes, hr.
 * No external dependencies.
 */
import { Fragment, useMemo } from 'react'

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/** Render inline markdown to HTML string */
function renderInline(text: string): string {
	let html = escapeHtml(text)

	// Inline code
	html = html.replace(
		/`([^`]+)`/g,
		'<code class="md-inline-code bg-muted px-1.5 py-0.5 rounded-md text-[0.88em] font-mono">$1</code>'
	)
	// Bold + italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
	// Bold
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
	// Italic
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
	// Links
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-500">$1</a>'
	)

	return html
}

interface MarkdownProps {
	content: string
	className?: string
}

export function Markdown({ content, className }: MarkdownProps) {
	const html = useMemo(() => renderToHtml(content), [content])

	return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

function renderToHtml(text: string): string {
	const lines = text.split('\n')
	const result: string[] = []
	let inCodeBlock = false
	let codeBlockContent: string[] = []
	let codeBlockLang = ''
	let inList = false
	let listType: 'ul' | 'ol' = 'ul'

	for (const line of lines) {
		// Fenced code blocks
		if (line.trimStart().startsWith('```')) {
			if (!inCodeBlock) {
				inCodeBlock = true
				codeBlockLang = line.trimStart().slice(3).trim()
				codeBlockContent = []
			} else {
				inCodeBlock = false
				result.push(
					`<pre class="bg-muted/60 dark:bg-black/30 border border-border/50 rounded-lg p-3 my-3 overflow-x-auto text-[12px] leading-relaxed font-mono"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`
				)
			}
			continue
		}

		if (inCodeBlock) {
			codeBlockContent.push(line)
			continue
		}

		// Close list if needed
		if (inList && !isListItem(line) && line.trim() !== '') {
			result.push(listType === 'ul' ? '</ul>' : '</ol>')
			inList = false
		}

		// Empty line
		if (line.trim() === '') {
			if (inList) {
				result.push(listType === 'ul' ? '</ul>' : '</ol>')
				inList = false
			}
			continue
		}

		// Headings
		const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line)
		if (headingMatch) {
			const level = headingMatch[1].length
			const sizes = [
				'text-[17px] font-medium leading-7',
				'text-[16px] font-medium leading-7',
				'text-[15px] font-medium leading-6',
				'text-[14px] font-medium leading-6',
			]
			result.push(
				`<div class="${sizes[level - 1]} mt-4 mb-2">${renderInline(headingMatch[2])}</div>`
			)
			continue
		}

		// Blockquote
		if (line.trimStart().startsWith('> ')) {
			const content = line.trimStart().slice(2)
			result.push(
				`<div class="border-l-2 border-border pl-3 my-2 text-[15px] opacity-80 leading-7">${renderInline(content)}</div>`
			)
			continue
		}

		// Unordered list
		const ulMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line)
		if (ulMatch) {
			if (!inList || listType !== 'ul') {
				if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')
				result.push('<ul class="list-disc pl-5 my-2.5 space-y-1.5 text-[15px] leading-7">')
				inList = true
				listType = 'ul'
			}
			result.push(`<li>${renderInline(ulMatch[2])}</li>`)
			continue
		}

		// Ordered list
		const olMatch = /^(\s*)\d+[.)]\s+(.+)$/.exec(line)
		if (olMatch) {
			if (!inList || listType !== 'ol') {
				if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')
				result.push('<ol class="list-decimal pl-5 my-2.5 space-y-1.5 text-[15px] leading-7">')
				inList = true
				listType = 'ol'
			}
			result.push(`<li>${renderInline(olMatch[2])}</li>`)
			continue
		}

		// Horizontal rule
		if (/^[-*_]{3,}\s*$/.test(line.trim())) {
			result.push('<hr class="border-t border-border my-3" />')
			continue
		}

		// Paragraph
		result.push(`<p class="text-[15px] my-1.5 leading-7 font-normal">${renderInline(line)}</p>`)
	}

	// Close unclosed blocks
	if (inCodeBlock) {
		result.push(
			`<pre class="bg-black/30 border border-white/10 rounded-md p-3 my-3 overflow-x-auto text-[12px] leading-relaxed font-mono"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`
		)
	}
	if (inList) {
		result.push(listType === 'ul' ? '</ul>' : '</ol>')
	}

	return result.join('\n')
}

function isListItem(line: string): boolean {
	return /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)
}
