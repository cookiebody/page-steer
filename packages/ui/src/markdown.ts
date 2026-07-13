/**
 * Lightweight markdown renderer for agent output.
 * Supports: headings, bold, italic, inline code, code blocks, links, lists, blockquotes.
 * No external dependencies.
 */
import { escapeHtml } from './utils'

/**
 * Render a markdown string to HTML.
 * Only used for agent output (done tool text) — not user-provided content.
 */
export function renderMarkdown(text: string): string {
	const lines = text.split('\n')
	const result: string[] = []
	let inCodeBlock = false
	let codeBlockContent: string[] = []
	let codeBlockLang = ''
	let inList = false
	let listType: 'ul' | 'ol' = 'ul'

	for (const line of lines) {
		// Code blocks (fenced)
		if (line.trimStart().startsWith('```')) {
			if (!inCodeBlock) {
				inCodeBlock = true
				codeBlockLang = line.trimStart().slice(3).trim()
				codeBlockContent = []
			} else {
				inCodeBlock = false
				const langAttr = codeBlockLang ? ` data-lang="${escapeHtml(codeBlockLang)}"` : ''
				result.push(
					`<pre class="md-code-block"${langAttr}><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`
				)
			}
			continue
		}

		if (inCodeBlock) {
			codeBlockContent.push(line)
			continue
		}

		// Close list if line is not a list item
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
			result.push(`<h${level} class="md-h${level}">${renderInline(headingMatch[2])}</h${level}>`)
			continue
		}

		// Blockquote
		if (line.trimStart().startsWith('> ')) {
			const content = line.trimStart().slice(2)
			result.push(`<blockquote class="md-blockquote">${renderInline(content)}</blockquote>`)
			continue
		}

		// Unordered list
		const ulMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line)
		if (ulMatch) {
			if (!inList || listType !== 'ul') {
				if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')
				result.push('<ul class="md-list">')
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
				result.push('<ol class="md-list">')
				inList = true
				listType = 'ol'
			}
			result.push(`<li>${renderInline(olMatch[2])}</li>`)
			continue
		}

		// Horizontal rule
		if (/^[-*_]{3,}\s*$/.test(line.trim())) {
			result.push('<hr class="md-hr" />')
			continue
		}

		// Paragraph
		result.push(`<p class="md-p">${renderInline(line)}</p>`)
	}

	// Close unclosed blocks
	if (inCodeBlock) {
		result.push(
			`<pre class="md-code-block"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`
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

/** Render inline markdown: bold, italic, code, links, strikethrough */
function renderInline(text: string): string {
	let html = escapeHtml(text)

	// Inline code (must be first to protect content inside)
	html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

	// Bold + italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')

	// Bold
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

	// Italic
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

	// Links [text](url)
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>'
	)

	return html
}
