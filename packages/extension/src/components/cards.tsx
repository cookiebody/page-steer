import type {
	AgentActivity,
	AgentErrorEvent,
	AgentStepEvent,
	HistoricalEvent,
	ObservationEvent,
	RetryEvent,
} from '@page-steer/core'
import { Copy, Download, Globe, Keyboard, Mouse, MoveVertical, RefreshCw, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { Markdown } from './Markdown'

/** Save content to Obsidian via obsidian://new URI protocol (markdown format) */
function saveToObsidian(text: string, task: string) {
	const title = task || 'Page Steer Result'
	const fileName = title.slice(0, 60).replace(/[\\/:*?"<>|]/g, '_')
	const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

	const content = `---\ntask: "${task.replace(/"/g, '\\"')}"\ndate: ${timestamp}\n---\n\n${text}`

	// Use encodeURIComponent instead of URLSearchParams to avoid + for spaces
	const uri =
		`obsidian://new?vault=` +
		`&name=${encodeURIComponent(`Page Steer/${fileName}`)}` +
		`&content=${encodeURIComponent(content)}`

	window.open(uri)
}

/** Download content as .md file */
function downloadAsMarkdown(text: string, task: string) {
	const title = task.slice(0, 60).replace(/[\\/:*?"<>|]/g, '_') || 'result'
	const timestamp = new Date().toISOString().slice(0, 10)
	const filename = `${title}-${timestamp}.md`

	const blob = new Blob([text], { type: 'text/markdown' })
	const url = URL.createObjectURL(blob)

	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

// Bottom action bar (Gemini-style icon row)
function ResultToolbar({
	text,
	task,
	onRerun,
}: {
	text: string
	task: string
	onRerun?: () => void
}) {
	const [copied, setCopied] = useState(false)

	return (
		<div className="flex items-center gap-4 mt-4 pt-1">
			<button
				type="button"
				onClick={() => {
					navigator.clipboard.writeText(text)
					setCopied(true)
					setTimeout(() => setCopied(false), 1500)
				}}
				className="p-1 rounded-full hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
				title={copied ? 'Copied!' : 'Copy'}
				aria-label="Copy"
			>
				<Copy className="size-4" />
			</button>
			<button
				type="button"
				onClick={onRerun}
				disabled={!onRerun}
				className="p-1 rounded-full hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
				title="Run again"
				aria-label="Run again"
			>
				<RefreshCw className="size-4" />
			</button>
			<button
				type="button"
				onClick={() => saveToObsidian(text, task)}
				className="p-1 rounded-full hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
				title="Save to Obsidian"
				aria-label="Save to Obsidian"
			>
				<svg viewBox="0 0 24 24" className="size-4 fill-current">
					<path d="M21.038 7.273L16.13 2.365a1.247 1.247 0 00-1.345-.269L8.497 4.572a1.247 1.247 0 00-.584.451L3.26 11.868a1.247 1.247 0 00-.135 1.09l2.476 7.93a1.247 1.247 0 00.773.773l7.93 2.476a1.247 1.247 0 001.09-.135l6.845-4.653a1.247 1.247 0 00.451-.584l2.476-6.288a1.247 1.247 0 00-.269-1.345zM9.5 16.5l-2-6 5-4 5 4-2 6h-6z" />
				</svg>
			</button>
			<button
				type="button"
				onClick={() => downloadAsMarkdown(text, task)}
				className="p-1 rounded-full hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
				title="Download"
				aria-label="Download"
			>
				<Download className="size-4" />
			</button>
		</div>
	)
}

// Result card — clean document-style with bottom toolbar
function ResultCard({
	text,
	task,
	onRerun,
}: {
	success: boolean
	text: string
	task?: string
	onRerun?: () => void
	children?: React.ReactNode
}) {
	const taskStr = task || ''
	const resultRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}, [])

	return (
		<div ref={resultRef} className="py-1.5">
			{/* Content - flowing markdown */}
			<div className="select-text text-left">
				<Markdown content={text} className="text-foreground antialiased" />
			</div>

			{/* Gemini-style bottom toolbar */}
			<ResultToolbar text={text} task={taskStr} onRerun={onRerun} />
		</div>
	)
}

// Get icon for action type
function ActionIcon({ name, className }: { name: string; className?: string }) {
	const icons: Record<string, React.ReactNode> = {
		click_element_by_index: <Mouse className={className} />,
		input: <Keyboard className={className} />,
		scroll: <MoveVertical className={className} />,
		go_to_url: <Globe className={className} />,
	}
	return icons[name] || <Zap className={className} />
}

// Copy button with "Copied!" feedback
function CopyButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false)

	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(text)
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			}}
			className="text-[9px] text-muted-foreground hover:text-foreground transition-colors border px-1 rounded shrink-0 cursor-pointer backdrop-blur-xs"
		>
			{copied ? 'Copied!' : label}
		</button>
	)
}

// Extract message content by role from raw request
function extractPrompt(rawRequest: unknown, role: 'system' | 'user'): string | null {
	const messages = (rawRequest as { messages?: { role: string; content?: unknown }[] })?.messages
	if (!messages) return null
	if (!Array.isArray(messages)) return null
	const msg =
		role === 'system'
			? messages.find((m) => m.role === role)
			: messages.findLast((m) => m.role === role)
	if (!msg?.content) return null
	return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
}

// Raw request/response section (collapsible tabs, for debugging)
function RawSection({ rawRequest, rawResponse }: { rawRequest?: unknown; rawResponse?: unknown }) {
	const [activeTab, setActiveTab] = useState<'request' | 'response' | null>(null)

	if (!rawRequest && !rawResponse) return null

	const handleTabClick = (tab: 'request' | 'response') => {
		setActiveTab(activeTab === tab ? null : tab)
	}

	const content =
		activeTab === 'request' ? rawRequest : activeTab === 'response' ? rawResponse : null

	const systemPrompt = activeTab === 'request' ? extractPrompt(rawRequest, 'system') : null
	const userPrompt = activeTab === 'request' ? extractPrompt(rawRequest, 'user') : null

	return (
		<div className="mt-2 border-t border-dashed pt-2">
			<div className="flex items-center gap-3 -my-1">
				{rawRequest != null && (
					<button
						type="button"
						onClick={() => handleTabClick('request')}
						className={cn(
							'text-[10px] mt-0.5 transition-colors border-b cursor-pointer',
							activeTab === 'request'
								? 'text-foreground border-foreground'
								: 'text-muted-foreground border-transparent hover:text-foreground'
						)}
					>
						Raw Request
					</button>
				)}
				{rawResponse != null && (
					<button
						type="button"
						onClick={() => handleTabClick('response')}
						className={cn(
							'text-[10px] mt-0.5 transition-colors border-b cursor-pointer',
							activeTab === 'response'
								? 'text-foreground border-foreground'
								: 'text-muted-foreground border-transparent hover:text-foreground'
						)}
					>
						Raw Response
					</button>
				)}
			</div>
			{content != null && (
				<div className="relative mt-1.5">
					<div className="absolute top-1 right-1 flex gap-1">
						{systemPrompt && <CopyButton text={systemPrompt} label="Copy System" />}
						{userPrompt && <CopyButton text={userPrompt} label="Copy User" />}
						<CopyButton text={JSON.stringify(content, null, 4)} label="Copy" />
					</div>
					<pre className="p-2 pt-5 text-[10px] text-foreground/70 bg-muted rounded overflow-x-auto max-h-60 overflow-y-auto">
						{JSON.stringify(content, null, 4)}
					</pre>
				</div>
			)}
		</div>
	)
}

function StepCard({ event }: { event: AgentStepEvent }) {
	const [expanded, setExpanded] = useState(false)

	// Single-line summary: action icon + name + brief input
	const actionName = event.action?.name || 'thinking'
	const actionInput =
		event.action && event.action.name !== 'done' ? JSON.stringify(event.action.input) : ''
	const output = typeof event.action?.output === 'string' ? event.action.output : ''
	const isFailed = output.startsWith('❌')

	return (
		<div
			className="flex items-start gap-2 py-1 cursor-pointer group"
			onClick={() => setExpanded(!expanded)}
		>
			{/* Step indicator */}
			<div className="shrink-0 mt-0.5">
				{event.action ? (
					<ActionIcon
						name={actionName}
						className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors"
					/>
				) : (
					<Zap className="size-3.5 text-muted-foreground/50" />
				)}
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0">
				<p className="text-[12px] text-muted-foreground/70 truncate group-hover:text-muted-foreground transition-colors">
					<span className="font-medium">{actionName}</span>
					{actionInput && <span className="ml-1 opacity-60">{actionInput}</span>}
					{output && !isFailed && <span className="ml-1 text-green-600/50">✓</span>}
					{isFailed && <span className="ml-1 text-destructive/50">✗</span>}
				</p>

				{/* Expanded: reflection + output + raw */}
				{expanded && (
					<div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground/60">
						{event.reflection?.next_goal && <p>🎯 {event.reflection.next_goal}</p>}
						{event.reflection?.memory && <p>🧠 {event.reflection.memory}</p>}
						{output && <p className="break-all">└ {output}</p>}
						<RawSection rawRequest={event.rawRequest} rawResponse={event.rawResponse} />
					</div>
				)}
			</div>
		</div>
	)
}

function ObservationCard({ event }: { event: ObservationEvent }) {
	return (
		<div className="flex items-start gap-2 py-1">
			<span className="text-[12px] text-muted-foreground/40 shrink-0 mt-0.5">👁</span>
			<span className="text-[12px] text-muted-foreground/60">{event.content}</span>
		</div>
	)
}

function RetryCard({ event }: { event: RetryEvent }) {
	return (
		<div className="flex items-start gap-2 py-1">
			<RefreshCw className="size-3 text-amber-500/60 shrink-0 mt-0.5" />
			<span className="text-[12px] text-amber-600/70 dark:text-amber-400/70">
				{event.message} ({event.attempt}/{event.maxAttempts})
			</span>
		</div>
	)
}

function ErrorCard({ event }: { event: AgentErrorEvent }) {
	return (
		<div className="flex items-start gap-2 py-1">
			<span className="text-[12px] text-destructive/60 shrink-0 mt-0.5">⚠</span>
			<span className="text-[12px] text-destructive/80">{event.message}</span>
		</div>
	)
}

// History event card component
export function EventCard({
	event,
	task,
	onRerun,
}: {
	event: HistoricalEvent
	task?: string
	onRerun?: () => void
}) {
	// Done action - show as result card
	if (event.type === 'step' && event.action?.name === 'done') {
		const input = event.action.input as { text?: string; success?: boolean }
		return (
			<ResultCard
				success={input?.success ?? true}
				text={input?.text || event.action.output || ''}
				task={task}
				onRerun={onRerun}
			/>
		)
	}

	if (event.type === 'step') {
		return <StepCard event={event as AgentStepEvent} />
	}

	if (event.type === 'observation') {
		return <ObservationCard event={event as ObservationEvent} />
	}

	if (event.type === 'retry') {
		return <RetryCard event={event as RetryEvent} />
	}

	if (event.type === 'error') {
		return <ErrorCard event={event as AgentErrorEvent} />
	}

	return null
}

// Activity indicator — minimal animated line
export function ActivityCard({ activity }: { activity: AgentActivity }) {
	const getActivityInfo = () => {
		switch (activity.type) {
			case 'thinking':
				return { text: 'Thinking', color: 'text-blue-500' }
			case 'executing':
				return { text: activity.tool, color: 'text-muted-foreground' }
			case 'executed':
				return { text: `${activity.tool} ✓`, color: 'text-green-600/70' }
			case 'retrying':
				return {
					text: `Retrying (${activity.attempt}/${activity.maxAttempts})`,
					color: 'text-amber-500',
				}
			case 'error':
				return { text: activity.message, color: 'text-destructive' }
		}
	}

	const info = getActivityInfo()

	return (
		<div className="flex items-center gap-2 py-1.5">
			{/* Animated dots */}
			<span className="flex gap-0.5">
				<span className="size-1 rounded-full bg-blue-500 animate-bounce [animation-delay:0ms]" />
				<span className="size-1 rounded-full bg-blue-500 animate-bounce [animation-delay:150ms]" />
				<span className="size-1 rounded-full bg-blue-500 animate-bounce [animation-delay:300ms]" />
			</span>
			<span className={cn('text-[12px]', info.color)}>{info.text}</span>
		</div>
	)
}
