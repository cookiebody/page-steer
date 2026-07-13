import domTree from './dom_tree/index.js'
import {
	ElementDomNode,
	FlatDomTree,
	InteractiveElementDomNode,
	TextDomNode,
} from './dom_tree/type'

/**
 * Viewport expansion for DOM tree extraction.
 * -1 means full page (no viewport restriction)
 * 0 means viewport only
 * positive values expand the viewport by that many pixels
 *
 * @note Since isTopElement depends on elementFromPoint,
 * it returns null when out of viewport, this feature has no practical use, only differ between -1 and 0
 */
const DEFAULT_VIEWPORT_EXPANSION = -1

export function resolveViewportExpansion(viewportExpansion?: number): number {
	return viewportExpansion ?? DEFAULT_VIEWPORT_EXPANSION
}

export interface DomConfig {
	viewportExpansion?: number
	interactiveBlacklist?: (Element | (() => Element))[]
	interactiveWhitelist?: (Element | (() => Element))[]
	includeAttributes?: string[]
	highlightOpacity?: number
	highlightLabelOpacity?: number

	/**
	 * Preserve semantic landmark tags in dehydrated output even if not interactive
	 * @note maybe confusing for LLM combining with page scrolling, use with caution
	 **/
	keepSemanticTags?: boolean

	/**
	 * Output format for the simplified page content.
	 * - 'simplified': Original format with HTML tags and attributes (default)
	 * - 'a11y': Accessibility tree format inspired by Playwright — uses roles and accessible names,
	 *           more compact and natural for LLMs trained on AgentWorld/a11y snapshots
	 */
	outputFormat?: 'simplified' | 'a11y'
}

// TODO: corresponding roles
const SEMANTIC_TAGS = new Set([
	'nav',
	'menu',
	// 'main',
	'header',
	'footer',
	'aside',
	// 'article',
	// 'form',
	'dialog',
])

/**
 * 用于检测可交互元素是否是新出现的。
 */
const newElementsCache = new WeakMap<HTMLElement, string>()

export function getFlatTree(config: DomConfig): FlatDomTree {
	const viewportExpansion = resolveViewportExpansion(config.viewportExpansion)

	const interactiveBlacklist = [] as Element[]
	for (const item of config.interactiveBlacklist || []) {
		if (typeof item === 'function') {
			interactiveBlacklist.push(item())
		} else {
			interactiveBlacklist.push(item)
		}
	}

	const interactiveWhitelist = [] as Element[]
	for (const item of config.interactiveWhitelist || []) {
		if (typeof item === 'function') {
			interactiveWhitelist.push(item())
		} else {
			interactiveWhitelist.push(item)
		}
	}

	const elements = domTree({
		doHighlightElements: true,
		debugMode: true,
		focusHighlightIndex: -1,
		viewportExpansion,
		interactiveBlacklist,
		interactiveWhitelist,
		highlightOpacity: config.highlightOpacity ?? 0.0,
		highlightLabelOpacity: config.highlightLabelOpacity ?? 0.1,
	}) as FlatDomTree

	const currentUrl = window.location.href

	/**
	 * 标记新出现的元素
	 * @todo browser-use 使用 hash(位置，属性等信息) 来判断是否同一个元素，
	 *       能够解决 1. 元素被删除后重新添加 2. 页面卸载 等问题。
	 *       这里先简单做.
	 */
	for (const nodeId in elements.map) {
		const node = elements.map[nodeId]
		if (node.isInteractive && node.ref) {
			const ref = node.ref as HTMLElement
			// @note 这样太严格，元素是可以跨页面存在的
			// if (newElementsCache.get(ref) !== currentUrl) {
			if (!newElementsCache.has(ref)) {
				newElementsCache.set(ref, currentUrl)
				node.isNew = true
			}
		}
	}

	return elements
}

const globRegexCache = new Map<string, RegExp>()

function globToRegex(pattern: string): RegExp {
	let regex = globRegexCache.get(pattern)
	if (!regex) {
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
		globRegexCache.set(pattern, regex)
	}
	return regex
}

function matchAttributes(
	attrs: Record<string, string>,
	patterns: string[]
): Record<string, string> {
	const result: Record<string, string> = {}

	for (const pattern of patterns) {
		if (pattern.includes('*')) {
			const regex = globToRegex(pattern)
			for (const key of Object.keys(attrs)) {
				if (regex.test(key) && attrs[key].trim()) {
					result[key] = attrs[key].trim()
				}
			}
		} else {
			const value = attrs[pattern]
			if (value && value.trim()) {
				result[pattern] = value.trim()
			}
		}
	}

	return result
}

/**
 * elementsToString 内部使用的类型
 */
interface TreeNode {
	type: 'text' | 'element'
	parent: TreeNode | null
	children: TreeNode[]
	isVisible: boolean
	// Text node properties
	text?: string
	// Element node properties
	tagName?: string
	attributes?: Record<string, string>
	isInteractive?: boolean
	isTopElement?: boolean
	isNew?: boolean
	highlightIndex?: number
	extra?: Record<string, any>
}

/**
 * 对应 python 中的 views::clickable_elements_to_string,
 * 将 dom 信息处理成适合 llm 阅读的文本格式
 * @形如
 * ``` text
 * [0]<a aria-label=page-steer.js 首页 />
 * [1]<div >P />
 * [2]<div >page-steer.js
 * UI Agent in your webpage />
 * [3]<a >文档 />
 * [4]<a aria-label=查看源码（在新窗口打开）>源码 />
 * UI Agent in your webpage
 * 用户输入需求，AI 理解页面并自动操作。
 * [5]<a role=button>快速开始 />
 * [6]<a role=button>查看文档 />
 * 无需后端
 * ```
 * 其中可交互元素用序号标出，提示llm可以用序号操作。
 * 缩进代表父子关系。
 * 普通文本则直接列出来。
 *
 * @todo 数据脱敏过滤器
 */
export function flatTreeToString(
	flatTree: FlatDomTree,
	includeAttributes: string[] = [],
	keepSemanticTags = false
): string {
	const DEFAULT_INCLUDE_ATTRIBUTES = [
		'title',
		'type',
		'checked',
		'name',
		'role',
		'value',
		'placeholder',
		'data-date-format',
		'alt',
		'aria-label',
		'aria-expanded',
		'data-state',
		'aria-checked',

		// @edit added for better form handling
		'id',
		'for',

		// for jump check
		'target',

		// absolute position dropdown menu
		'aria-haspopup',
		'aria-controls',
		'aria-owns',

		// content editable
		'contenteditable',
	]

	const includeAttrs = [...includeAttributes, ...DEFAULT_INCLUDE_ATTRIBUTES]

	// Helper function to cap text length
	const capTextLength = (text: string, maxLength: number): string => {
		if (text.length > maxLength) {
			return text.substring(0, maxLength) + '...'
		}
		return text
	}

	// Build tree structure from flat map
	const buildTreeNode = (nodeId: string): TreeNode | null => {
		const node = flatTree.map[nodeId]
		if (!node) return null

		if (node.type === 'TEXT_NODE') {
			const textNode = node as TextDomNode
			return {
				type: 'text',
				text: textNode.text,
				isVisible: textNode.isVisible,
				parent: null,
				children: [],
			}
		} else {
			const elementNode = node as ElementDomNode
			const children: TreeNode[] = []

			if (elementNode.children) {
				for (const childId of elementNode.children) {
					const child = buildTreeNode(childId)
					if (child) {
						child.parent = null // Will be set later
						children.push(child)
					}
				}
			}

			return {
				type: 'element',
				tagName: elementNode.tagName,
				attributes: elementNode.attributes ?? {},
				isVisible: elementNode.isVisible ?? false,
				isInteractive: elementNode.isInteractive ?? false,
				isTopElement: elementNode.isTopElement ?? false,
				isNew: elementNode.isNew ?? false,
				highlightIndex: elementNode.highlightIndex,
				parent: null,
				children,
				extra: elementNode.extra ?? {},
			}
		}
	}

	// Set parent references
	const setParentReferences = (node: TreeNode, parent: TreeNode | null = null) => {
		node.parent = parent
		for (const child of node.children) {
			setParentReferences(child, node)
		}
	}

	// Build root node
	const rootNode = buildTreeNode(flatTree.rootId)
	if (!rootNode) return ''

	setParentReferences(rootNode)

	// Helper to check if text node has parent with highlight index
	const hasParentWithHighlightIndex = (node: TreeNode): boolean => {
		let current = node.parent
		while (current) {
			if (current.type === 'element' && current.highlightIndex !== undefined) {
				return true
			}
			current = current.parent
		}
		return false
	}

	// Helper to check if a subtree contains any interactive descendants
	const hasInteractiveDescendants = (node: TreeNode): boolean => {
		if (node.type === 'element' && node.highlightIndex !== undefined) {
			return true
		}
		for (const child of node.children) {
			if (hasInteractiveDescendants(child)) {
				return true
			}
		}
		return false
	}

	// Helper to check if parent element is hidden (display:none, visibility:hidden, opacity:0)
	const isParentHidden = (node: TreeNode): boolean => {
		const parent = node.parent
		if (!parent || parent.type !== 'element') return false
		// Use isVisible flag computed by buildDomTree
		if (!parent.isVisible) return true
		// Also check style-related attributes
		const attrs = parent.attributes
		if (!attrs) return false
		const style = attrs.style
		if (style) {
			if (/display\s*:\s*none/i.test(style)) return true
			if (/visibility\s*:\s*hidden/i.test(style)) return true
			if (/opacity\s*:\s*0(?:[;\s]|$)/i.test(style)) return true
		}
		return false
	}

	// Max length for non-interactive text nodes
	const TEXT_MAX_LENGTH = 200

	// Main processing function
	const processNode = (node: TreeNode, depth: number, result: string[]): void => {
		let nextDepth = depth
		const depthStr = '\t'.repeat(depth)

		if (node.type === 'element') {
			const attrs = node.attributes ?? {}

			// Skip aria-hidden="true" subtrees entirely (unless interactive)
			if (
				attrs['aria-hidden'] === 'true' &&
				node.highlightIndex === undefined &&
				!hasInteractiveDescendants(node)
			) {
				return
			}

			// Skip role="presentation" / role="none" containers
			// but still process children if they have interactive descendants
			const role = attrs.role
			const isPresentational = role === 'presentation' || role === 'none'
			const skipAsContainer = isPresentational && node.highlightIndex === undefined

			const isSemantic = keepSemanticTags && node.tagName && SEMANTIC_TAGS.has(node.tagName)

			// Add element with highlight_index
			if (node.highlightIndex !== undefined) {
				nextDepth += 1

				const text = getAllTextTillNextClickableElement(node)
				let attributesHtmlStr = ''

				if (includeAttrs.length > 0 && node.attributes) {
					const attributesToInclude = matchAttributes(node.attributes, includeAttrs)

					// Remove duplicate values (for attributes longer than 5 chars)
					const keys = Object.keys(attributesToInclude)
					if (keys.length > 1) {
						const keysToRemove = new Set<string>()
						const seenValues: Record<string, string> = {}

						for (const key of keys) {
							const value = attributesToInclude[key]
							if (value.length > 5) {
								if (value in seenValues) {
									keysToRemove.add(key)
								} else {
									seenValues[value] = key
								}
							}
						}

						for (const key of keysToRemove) {
							delete attributesToInclude[key]
						}
					}

					// Remove role if it matches tagName
					if (attributesToInclude.role === node.tagName) {
						delete attributesToInclude.role
					}

					// Remove attributes that duplicate text content
					const attrsToRemoveIfTextMatches = ['aria-label', 'placeholder', 'title']
					for (const attr of attrsToRemoveIfTextMatches) {
						if (
							attributesToInclude[attr] &&
							attributesToInclude[attr].toLowerCase().trim() === text.toLowerCase().trim()
						) {
							delete attributesToInclude[attr]
						}
					}

					if (Object.keys(attributesToInclude).length > 0) {
						attributesHtmlStr = Object.entries(attributesToInclude)
							.map(([key, value]) => `${key}=${capTextLength(value, 20)}`)
							.join(' ')
					}
				}

				// Build the line
				const highlightIndicator = node.isNew
					? `*[${node.highlightIndex}]`
					: `[${node.highlightIndex}]`
				let line = `${depthStr}${highlightIndicator}<${node.tagName ?? ''}`

				if (attributesHtmlStr) {
					line += ` ${attributesHtmlStr}`
				}

				/**
				 * @edit scrollable 数据
				 */
				if (node.extra) {
					if (node.extra.scrollable) {
						let scrollDataText = ''
						if (node.extra.scrollData?.left)
							scrollDataText += `left=${node.extra.scrollData.left}, `
						if (node.extra.scrollData?.top) scrollDataText += `top=${node.extra.scrollData.top}, `
						if (node.extra.scrollData?.right)
							scrollDataText += `right=${node.extra.scrollData.right}, `
						if (node.extra.scrollData?.bottom)
							scrollDataText += `bottom=${node.extra.scrollData.bottom}`

						line += ` data-scrollable="${scrollDataText}"`
					}
				}

				if (text) {
					const trimmedText = text.trim()
					if (!attributesHtmlStr) {
						line += ' '
					}
					line += `>${trimmedText}`
				} else if (!attributesHtmlStr) {
					line += ' '
				}

				line += ' />'
				result.push(line)
			}

			// For presentational containers, skip semantic/container output but recurse children
			if (skipAsContainer) {
				for (const child of node.children) {
					processNode(child, nextDepth, result)
				}
				return
			}

			// special treatment for semantic tags
			// even if they are not interactive, we can keep them for clear context

			const emitSemantic = isSemantic && node.highlightIndex === undefined
			// to check if this tag is empty
			const mark = emitSemantic ? result.length : -1

			if (emitSemantic) {
				result.push(`${depthStr}<${node.tagName}>`)
				nextDepth += 1
			}

			for (const child of node.children) {
				processNode(child, nextDepth, result)
			}

			if (emitSemantic) {
				// empty tag should be removed
				if (result.length === mark + 1) {
					result.pop()
				} else {
					result.push(`${depthStr}</${node.tagName}>`)
				}
			}
		} else if (node.type === 'text') {
			// Add text only if it doesn't have a highlighted parent
			if (hasParentWithHighlightIndex(node)) {
				return
			}

			// Skip text nodes under hidden parents
			if (isParentHidden(node)) {
				return
			}

			if (node.parent && node.parent.type === 'element' && node.parent.isVisible) {
				const text = node.text ?? ''
				// Truncate long text nodes to save tokens
				const truncated =
					text.length > TEXT_MAX_LENGTH ? text.substring(0, TEXT_MAX_LENGTH) + '...' : text
				result.push(`${depthStr}${truncated}`)
			}
		}
	}

	const result: string[] = []
	processNode(rootNode, 0, result)

	// Post-process: merge consecutive whitespace-only lines and deduplicate adjacent text
	const cleaned: string[] = []
	let lastWasEmpty = false
	for (const line of result) {
		const isEmptyLine = line.trim().length === 0

		// Collapse consecutive empty/whitespace-only lines into one
		if (isEmptyLine) {
			if (!lastWasEmpty) {
				cleaned.push(line)
			}
			lastWasEmpty = true
			continue
		}
		lastWasEmpty = false

		// Skip duplicate adjacent text lines (common in repeated UI patterns)
		// Only deduplicate non-interactive lines (those without [index] markers)
		if (cleaned.length > 0 && !line.includes(']<') && line === cleaned[cleaned.length - 1]) {
			continue
		}

		cleaned.push(line)
	}

	return cleaned.join('\n')
}

// --- Accessibility Tree Output Format ---

/** Map HTML tag names to ARIA roles for a11y output */
const TAG_TO_ROLE: Record<string, string> = {
	a: 'link',
	button: 'button',
	input: 'textbox',
	textarea: 'textbox',
	select: 'combobox',
	option: 'option',
	img: 'img',
	nav: 'navigation',
	main: 'main',
	header: 'banner',
	footer: 'contentinfo',
	aside: 'complementary',
	form: 'form',
	dialog: 'dialog',
	table: 'table',
	ul: 'list',
	ol: 'list',
	li: 'listitem',
	h1: 'heading',
	h2: 'heading',
	h3: 'heading',
	h4: 'heading',
	h5: 'heading',
	h6: 'heading',
	details: 'group',
	summary: 'button',
	video: 'video',
	audio: 'audio',
}

/** Resolve input type to more specific role */
function getInputRole(attrs: Record<string, string>): string {
	const type = (attrs.type || 'text').toLowerCase()
	switch (type) {
		case 'checkbox':
			return 'checkbox'
		case 'radio':
			return 'radio'
		case 'range':
			return 'slider'
		case 'number':
			return 'spinbutton'
		case 'search':
			return 'searchbox'
		case 'email':
		case 'tel':
		case 'url':
		case 'password':
		case 'text':
		default:
			return 'textbox'
	}
}

/** Compute accessible name from attributes and text content */
function getAccessibleName(node: TreeNode, textContent: string): string {
	const attrs = node.attributes ?? {}
	// Priority: aria-label > aria-labelledby (skip) > label/title > placeholder > text content
	return (
		attrs['aria-label'] ||
		attrs.title ||
		attrs.placeholder ||
		attrs.alt ||
		textContent ||
		''
	).trim()
}

/** Get state flags for a11y output */
function getStateFlags(node: TreeNode): string[] {
	const attrs = node.attributes ?? {}
	const flags: string[] = []

	if (attrs['aria-expanded'] === 'true') flags.push('expanded')
	if (attrs['aria-expanded'] === 'false') flags.push('collapsed')
	if (attrs['aria-checked'] === 'true' || attrs.checked) flags.push('checked')
	if (attrs['aria-selected'] === 'true') flags.push('selected')
	if (attrs['aria-disabled'] === 'true' || attrs.disabled !== undefined) flags.push('disabled')
	if (attrs['aria-required'] === 'true' || attrs.required !== undefined) flags.push('required')
	if (attrs.contenteditable === 'true') flags.push('editable')

	// Heading level
	const tag = node.tagName?.toLowerCase() || ''
	if (tag.startsWith('h') && tag.length === 2) {
		flags.push(`level=${tag[1]}`)
	}

	return flags
}

/**
 * Convert FlatDomTree to Playwright-style accessibility tree format.
 *
 * Output format:
 * ```
 * [0] button "Submit"
 * [1] link "Home page"
 * [2] textbox "Search..." [placeholder]
 *   [3] option "English" [selected]
 * Some context text here
 * ```
 *
 * Benefits over simplified HTML:
 * - ~40-60% fewer tokens (roles are shorter than full tag+attributes)
 * - More natural for models trained on a11y data (AgentWorld, Playwright)
 * - Semantic stability — identifies by role+name, not CSS classes
 */
export function flatTreeToA11yString(flatTree: FlatDomTree): string {
	// Reuse the same tree-building logic from flatTreeToString
	const buildTreeNode = (nodeId: string): TreeNode | null => {
		const node = flatTree.map[nodeId]
		if (!node) return null

		if (node.type === 'TEXT_NODE') {
			const textNode = node as TextDomNode
			return {
				type: 'text',
				text: textNode.text,
				isVisible: textNode.isVisible,
				parent: null,
				children: [],
			}
		} else {
			const elementNode = node as ElementDomNode
			const children: TreeNode[] = []

			if (elementNode.children) {
				for (const childId of elementNode.children) {
					const child = buildTreeNode(childId)
					if (child) children.push(child)
				}
			}

			return {
				type: 'element',
				tagName: elementNode.tagName,
				attributes: elementNode.attributes ?? {},
				isVisible: elementNode.isVisible ?? false,
				isInteractive: elementNode.isInteractive ?? false,
				isTopElement: elementNode.isTopElement ?? false,
				isNew: elementNode.isNew ?? false,
				highlightIndex: elementNode.highlightIndex,
				parent: null,
				children,
				extra: elementNode.extra ?? {},
			}
		}
	}

	const setParentRefs = (node: TreeNode, parent: TreeNode | null = null) => {
		node.parent = parent
		for (const child of node.children) setParentRefs(child, node)
	}

	const rootNode = buildTreeNode(flatTree.rootId)
	if (!rootNode) return ''
	setParentRefs(rootNode)

	// Max text length for non-interactive context
	const TEXT_MAX_LENGTH = 150

	const hasParentWithHighlightIndex = (node: TreeNode): boolean => {
		let current = node.parent
		while (current) {
			if (current.type === 'element' && current.highlightIndex !== undefined) return true
			current = current.parent
		}
		return false
	}

	const hasInteractiveDescendants = (node: TreeNode): boolean => {
		if (node.type === 'element' && node.highlightIndex !== undefined) return true
		for (const child of node.children) {
			if (hasInteractiveDescendants(child)) return true
		}
		return false
	}

	/** Collect text from node until hitting another interactive element */
	const collectTextContent = (node: TreeNode): string => {
		const parts: string[] = []
		const collect = (n: TreeNode) => {
			if (n.type === 'text' && n.text) {
				parts.push(n.text)
			} else if (n.type === 'element') {
				for (const child of n.children) {
					// Stop at nested interactive elements
					if (child.type === 'element' && child.highlightIndex !== undefined && child !== node) {
						continue
					}
					collect(child)
				}
			}
		}
		collect(node)
		return parts.join(' ').trim()
	}

	const result: string[] = []

	const processNode = (node: TreeNode, depth: number): void => {
		const indent = '\t'.repeat(depth)

		if (node.type === 'element') {
			const attrs = node.attributes ?? {}

			// Skip aria-hidden subtrees (unless interactive)
			if (
				attrs['aria-hidden'] === 'true' &&
				node.highlightIndex === undefined &&
				!hasInteractiveDescendants(node)
			) {
				return
			}

			if (node.highlightIndex !== undefined) {
				// Interactive element — output as a11y role line
				const tag = (node.tagName || 'div').toLowerCase()
				let role = attrs.role || TAG_TO_ROLE[tag] || tag
				if (tag === 'input') role = attrs.role || getInputRole(attrs)

				const textContent = collectTextContent(node)
				const name = getAccessibleName(node, textContent)
				const flags = getStateFlags(node)

				// Build indicator
				const indicator = node.isNew ? `*[${node.highlightIndex}]` : `[${node.highlightIndex}]`

				// Build line: [0] button "Submit" [expanded]
				let line = `${indent}${indicator} ${role}`
				if (name) {
					// Cap name length
					const cappedName = name.length > 60 ? name.substring(0, 57) + '...' : name
					line += ` "${cappedName}"`
				}
				if (flags.length > 0) {
					line += ` [${flags.join(', ')}]`
				}

				// Add value for inputs
				if (attrs.value && role !== 'button' && role !== 'link') {
					const val = attrs.value.length > 30 ? attrs.value.substring(0, 27) + '...' : attrs.value
					line += ` value="${val}"`
				}

				result.push(line)

				// Process children at deeper indent
				for (const child of node.children) {
					processNode(child, depth + 1)
				}
				return
			}

			// Non-interactive element — just recurse children
			// For semantic landmarks, emit a role wrapper
			const tag = (node.tagName || '').toLowerCase()
			const isSemantic = SEMANTIC_TAGS.has(tag)

			if (isSemantic) {
				const mark = result.length
				result.push(`${indent}${TAG_TO_ROLE[tag] || tag}:`)
				for (const child of node.children) {
					processNode(child, depth + 1)
				}
				// Remove empty landmarks
				if (result.length === mark + 1) {
					result.pop()
				}
			} else {
				for (const child of node.children) {
					processNode(child, depth)
				}
			}
		} else if (node.type === 'text') {
			// Text context — skip if parent is interactive (already captured in name)
			if (hasParentWithHighlightIndex(node)) return

			if (node.parent && node.parent.type === 'element' && node.parent.isVisible) {
				const text = (node.text ?? '').trim()
				if (!text) return
				const truncated =
					text.length > TEXT_MAX_LENGTH ? text.substring(0, TEXT_MAX_LENGTH) + '...' : text
				result.push(`${indent}${truncated}`)
			}
		}
	}

	processNode(rootNode, 0)

	// Post-process: collapse consecutive empty lines, deduplicate adjacent text
	const cleaned: string[] = []
	let lastWasEmpty = false
	for (const line of result) {
		const isEmptyLine = line.trim().length === 0
		if (isEmptyLine) {
			if (!lastWasEmpty) cleaned.push(line)
			lastWasEmpty = true
			continue
		}
		lastWasEmpty = false
		// Deduplicate adjacent non-interactive lines
		if (cleaned.length > 0 && !line.includes(']') && line === cleaned[cleaned.length - 1]) {
			continue
		}
		cleaned.push(line)
	}

	return cleaned.join('\n')
}

// Get all text until next clickable element
export const getAllTextTillNextClickableElement = (node: TreeNode, maxDepth = -1): string => {
	const textParts: string[] = []

	const collectText = (currentNode: TreeNode, currentDepth: number) => {
		if (maxDepth !== -1 && currentDepth > maxDepth) {
			return
		}

		// Skip this branch if we hit a highlighted element (except for the current node)
		if (
			currentNode.type === 'element' &&
			currentNode !== node &&
			currentNode.highlightIndex !== undefined
		) {
			return
		}

		if (currentNode.type === 'text' && currentNode.text) {
			textParts.push(currentNode.text)
		} else if (currentNode.type === 'element') {
			for (const child of currentNode.children) {
				collectText(child, currentDepth + 1)
			}
		}
	}

	collectText(node, 0)
	return textParts.join('\n').trim()
}

export function getSelectorMap(flatTree: FlatDomTree): Map<number, InteractiveElementDomNode> {
	const selectorMap = new Map<number, InteractiveElementDomNode>()

	const keys = Object.keys(flatTree.map)
	for (const key of keys) {
		const node = flatTree.map[key]
		if (node.isInteractive && typeof node.highlightIndex === 'number') {
			selectorMap.set(node.highlightIndex, node as InteractiveElementDomNode)
		}
	}

	return selectorMap
}

export function getElementTextMap(simplifiedHTML: string) {
	const lines = simplifiedHTML
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
	const elementTextMap = new Map<number, string>()
	for (const line of lines) {
		const regex = /^\[(\d+)\]<[^>]+>([^<]*)/
		const match = regex.exec(line)
		if (match) {
			const index = parseInt(match[1], 10)
			elementTextMap.set(index, line)
		}
	}

	return elementTextMap
}

export function cleanUpHighlights() {
	const cleanupFunctions = (window as any)._highlightCleanupFunctions || []
	for (const cleanup of cleanupFunctions) {
		if (typeof cleanup === 'function') {
			cleanup()
		}
	}

	;(window as any)._highlightCleanupFunctions = []
}

// 监听 URL 的任何变化，立刻清空 highLights
window.addEventListener('popstate', () => {
	// console.log('URL changed (popstate), highlights cleaned up.')
	cleanUpHighlights()
})
window.addEventListener('hashchange', () => {
	// console.log('URL changed (hashchange), highlights cleaned up.')
	cleanUpHighlights()
})
window.addEventListener('beforeunload', () => {
	// console.log('Page is unloading, highlights cleaned up.')
	cleanUpHighlights()
})

const navigation = (window as any).navigation
if (navigation && typeof navigation.addEventListener === 'function') {
	navigation.addEventListener('navigate', () => {
		// console.log('Navigation event detected, highlights cleaned up.')
		cleanUpHighlights()
	})
} else {
	// 定时器
	let currentUrl = window.location.href
	setInterval(() => {
		if (window.location.href !== currentUrl) {
			currentUrl = window.location.href
			// console.log('URL changed (interval), highlights cleaned up.')
			cleanUpHighlights()
		}
	}, 500)
}
