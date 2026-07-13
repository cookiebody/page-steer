import { BookOpen, ChevronDown, Globe, History, Send, Settings, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ConfigPanel } from '@/components/ConfigPanel'
import { HistoryDetail } from '@/components/HistoryDetail'
import { HistoryList } from '@/components/HistoryList'
import { SkillsPanel } from '@/components/SkillsPanel'
import { SlashMenu } from '@/components/SlashMenu'
import { ActivityCard, EventCard } from '@/components/cards'
import { Logo, MotionOverlay } from '@/components/misc'
import { Button } from '@/components/ui/button'
import { saveSession } from '@/lib/db'

import { useAgent } from '../../agent/useAgent'

type View =
	| { name: 'chat' }
	| { name: 'config' }
	| { name: 'history' }
	| { name: 'history-detail'; sessionId: string }
	| { name: 'skills' }

const SUGGESTIONS = [
	'Summarize this page for me',
	'Find all links on this page',
	'Extract the main content as markdown',
]

interface CurrentTabInfo {
	id?: number
	title?: string
	url?: string
	favIconUrl?: string
}

/** Check if LLM config has the minimum required fields */
function isConfigValid(config: { baseURL?: string; model?: string } | null): boolean {
	return Boolean(config && config.baseURL && config.model)
}

export default function App() {
	const [view, setView] = useState<View>({ name: 'chat' })
	const [inputValue, setInputValue] = useState('')
	const [showSlashMenu, setShowSlashMenu] = useState(false)
	const historyRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const {
		status,
		history,
		activity,
		currentTask,
		config,
		presets,
		activePresetId,
		execute,
		stop,
		configure,
		switchPreset,
		savePresets,
	} = useAgent()

	// Auto-show config panel if LLM is not configured
	const [hasCheckedConfig, setHasCheckedConfig] = useState(false)
	useEffect(() => {
		if (config && !hasCheckedConfig) {
			setHasCheckedConfig(true)
			if (!isConfigValid(config)) {
				setView({ name: 'config' })
			}
		}
	}, [config, hasCheckedConfig])
	// Persist session when task finishes
	const prevStatusRef = useRef(status)
	useEffect(() => {
		const prev = prevStatusRef.current
		prevStatusRef.current = status

		if (
			prev === 'running' &&
			(status === 'completed' || status === 'error' || status === 'stopped') &&
			history.length > 0 &&
			currentTask
		) {
			saveSession({ task: currentTask, history, status }).catch((err) =>
				console.error('[SidePanel] Failed to save session:', err)
			)
		}
	}, [status, history, currentTask])

	// Auto-scroll to bottom on new events
	useEffect(() => {
		if (historyRef.current && status === 'running') {
			historyRef.current.scrollTop = historyRef.current.scrollHeight
		}
	}, [history, activity, status])

	const runTask = useCallback(
		(task: string) => {
			const normalizedTask = task.trim()
			if (!normalizedTask || status === 'running') return

			setInputValue('')
			setView({ name: 'chat' })

			execute(normalizedTask).catch((error) => {
				console.error('[SidePanel] Failed to execute task:', error)
			})
		},
		[execute, status]
	)

	const handleSubmit = useCallback(
		(e?: React.SyntheticEvent) => {
			e?.preventDefault()
			runTask(inputValue)
		},
		[inputValue, runTask]
	)

	const handleStop = useCallback(() => {
		stop()
	}, [stop])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !showSlashMenu) {
			e.preventDefault()
			handleSubmit()
		}
	}

	// Show slash menu when input starts with /
	const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value
		setInputValue(val)
		setShowSlashMenu(val.startsWith('/') && val.length < 30)
	}

	// Select a skill from slash menu — insert prompt hint for natural input
	const handleSkillSelect = useCallback((_skillId: string, promptHint: string) => {
		setShowSlashMenu(false)
		setInputValue(promptHint)
		// Focus the textarea so user can continue typing
		textareaRef.current?.focus()
	}, [])

	// --- View routing ---

	if (view.name === 'config') {
		return (
			<ConfigPanel
				config={config}
				presets={presets}
				activePresetId={activePresetId}
				onSave={async (newConfig) => {
					await configure(newConfig)
					setView({ name: 'chat' })
				}}
				onSwitchPreset={switchPreset}
				onSavePresets={savePresets}
				onClose={() => setView({ name: 'chat' })}
			/>
		)
	}

	if (view.name === 'history') {
		return (
			<HistoryList
				onSelect={(id) => setView({ name: 'history-detail', sessionId: id })}
				onBack={() => setView({ name: 'chat' })}
				onRerun={runTask}
			/>
		)
	}

	if (view.name === 'history-detail') {
		return (
			<HistoryDetail
				sessionId={view.sessionId}
				onBack={() => setView({ name: 'history' })}
				onRerun={runTask}
			/>
		)
	}

	if (view.name === 'skills') {
		return <SkillsPanel onClose={() => setView({ name: 'chat' })} />
	}
	// --- Chat view ---

	const isRunning = status === 'running'
	const showEmptyState = !currentTask && history.length === 0 && !isRunning

	return (
		<div className="relative flex flex-col h-screen bg-background">
			<MotionOverlay active={isRunning} />

			{/* Content area */}
			<main className="flex-1 overflow-hidden flex flex-col">
				<div ref={historyRef} className="flex-1 overflow-y-auto">
					{showEmptyState ? (
						<EmptyGreeting onSuggestion={runTask} />
					) : (
						<div className="px-5 py-5 space-y-3">
							{/* User task as right-aligned bubble */}
							{currentTask && (
								<div className="flex justify-end mb-5">
									<div className="bg-slate-100 dark:bg-white/10 rounded-[28px] rounded-tr-lg px-5 py-3 max-w-[82%]">
										<span className="text-[15px] text-foreground leading-relaxed">
											{currentTask}
										</span>
									</div>
								</div>
							)}

							{/* AI response with logo icon */}
							{history.length > 0 && (
								<div className="space-y-2.5">
									<AssistantMark className="size-6" />
									<div className="min-w-0 space-y-1.5">
										{history.map((event, index) => (
											<EventCard
												key={index}
												event={event}
												task={currentTask}
												onRerun={currentTask ? () => runTask(currentTask) : undefined}
											/>
										))}
									</div>
								</div>
							)}

							{/* Activity indicator */}
							{activity && (
								<div className="flex items-start gap-2.5">
									<AssistantMark className="size-6 shrink-0 mt-0.5 animate-pulse" />
									<ActivityCard activity={activity} />
								</div>
							)}
						</div>
					)}
				</div>
			</main>

			{/* Bottom input area — Gemini style */}
			<footer className="bg-background px-3 pb-3 pt-2">
				{/* Input box */}
				<div className="relative rounded-2xl border border-border/80 bg-muted/20 shadow-sm">
					<CurrentTabContext />
					{showSlashMenu && (
						<SlashMenu
							query={inputValue.slice(1)}
							onSelect={handleSkillSelect}
							onClose={() => setShowSlashMenu(false)}
						/>
					)}
					<textarea
						ref={textareaRef}
						placeholder="Type / to use skills"
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyDown}
						disabled={isRunning}
						rows={1}
						className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 px-4 pt-3 pb-2 min-h-[40px] max-h-[120px]"
						style={{ fieldSizing: 'content' } as React.CSSProperties}
					/>

					{/* Toolbar row inside input box */}
					<div className="flex items-center justify-between px-2 pb-2">
						<div className="flex items-center gap-0.5">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setView({ name: 'history' })}
								className="size-8 cursor-pointer text-muted-foreground hover:text-foreground rounded-full"
								aria-label="History"
								title="History"
							>
								<History className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setView({ name: 'skills' })}
								className="size-8 cursor-pointer text-muted-foreground hover:text-foreground rounded-full"
								aria-label="Skills"
								title="Skills"
							>
								<BookOpen className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setView({ name: 'config' })}
								className="size-8 cursor-pointer text-muted-foreground hover:text-foreground rounded-full"
								aria-label="Settings"
								title="Settings"
							>
								<Settings className="size-4" />
							</Button>
						</div>

						<div className="flex items-center gap-1.5">
							{/* Model selector */}
							<ModelSelector
								presets={presets}
								activePresetId={activePresetId}
								config={config}
								isRunning={isRunning}
								onSwitch={switchPreset}
							/>
							{/* Send / Stop button */}
							{isRunning ? (
								<Button
									size="icon-sm"
									variant="destructive"
									onClick={handleStop}
									className="size-8 shrink-0 rounded-full"
									aria-label="Stop"
								>
									<Square className="size-3.5" />
								</Button>
							) : (
								<Button
									size="icon-sm"
									variant="default"
									onClick={() => handleSubmit()}
									disabled={!inputValue.trim()}
									className="size-8 shrink-0 rounded-full cursor-pointer"
									aria-label="Send"
								>
									<Send className="size-3.5" />
								</Button>
							)}
						</div>
					</div>
				</div>
			</footer>
		</div>
	)
}

function AssistantMark({ className }: { className?: string }) {
	return (
		<img src="/assets/page-steer-logo-transparent.png" alt="Page Steer" className={className} />
	)
}

function isInspectableUrl(url?: string): boolean {
	return Boolean(url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://'))
}

function getHostLabel(url?: string): string {
	if (!url) return 'No active page'
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

function CurrentTabContext() {
	const [tab, setTab] = useState<CurrentTabInfo | null>(null)

	const refreshTab = useCallback(async () => {
		try {
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
			const activeTab = tabs.find((t) => isInspectableUrl(t.url)) ?? tabs[0]
			setTab(
				activeTab
					? {
							id: activeTab.id,
							title: activeTab.title,
							url: activeTab.url,
							favIconUrl: activeTab.favIconUrl,
						}
					: null
			)
		} catch (error) {
			console.debug('[SidePanel] Failed to read active tab:', error)
			setTab(null)
		}
	}, [])

	useEffect(() => {
		refreshTab()

		const handleActivated = () => refreshTab()
		const handleUpdated = (
			_tabId: number,
			changeInfo: { title?: string; url?: string; favIconUrl?: string; status?: string }
		) => {
			if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl || changeInfo.status) {
				refreshTab()
			}
		}
		const handleWindowFocus = () => refreshTab()

		chrome.tabs.onActivated.addListener(handleActivated)
		chrome.tabs.onUpdated.addListener(handleUpdated)
		chrome.windows.onFocusChanged.addListener(handleWindowFocus)
		window.addEventListener('focus', refreshTab)

		return () => {
			chrome.tabs.onActivated.removeListener(handleActivated)
			chrome.tabs.onUpdated.removeListener(handleUpdated)
			chrome.windows.onFocusChanged.removeListener(handleWindowFocus)
			window.removeEventListener('focus', refreshTab)
		}
	}, [refreshTab])

	const title = tab?.title || getHostLabel(tab?.url)
	const host = getHostLabel(tab?.url)

	return (
		<div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 min-w-0">
			<div className="size-5 rounded-md bg-background border border-border/70 flex items-center justify-center shrink-0 overflow-hidden">
				{tab?.favIconUrl ? (
					<img src={tab.favIconUrl} alt="" className="size-4" />
				) : (
					<Globe className="size-3.5 text-muted-foreground" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-[13px] leading-4 font-medium truncate" title={title}>
					{title}
				</p>
				<p className="text-[10px] leading-3 text-muted-foreground truncate" title={tab?.url}>
					{host}
				</p>
			</div>
		</div>
	)
}

/** Compact model selector like Gemini's "Flash v" chip */
function ModelSelector({
	presets,
	activePresetId,
	config,
	isRunning,
	onSwitch,
}: {
	presets: { id: string; name: string }[]
	activePresetId: string | null
	config: { model?: string } | null
	isRunning: boolean
	onSwitch: (id: string) => void
}) {
	const activePresetName =
		presets.find((p) => p.id === activePresetId)?.name || config?.model || 'Model'

	return (
		<div className="relative">
			<select
				value={activePresetId ?? ''}
				onChange={(e) => {
					if (e.target.value) onSwitch(e.target.value)
				}}
				disabled={isRunning}
				className="appearance-none text-xs font-medium text-muted-foreground bg-transparent pl-2 pr-5 py-1 rounded-md hover:bg-muted/60 cursor-pointer outline-none"
				aria-label="Model"
			>
				{!activePresetId && <option value="">{config?.model || 'Custom'}</option>}
				{presets.map((p) => (
					<option key={p.id} value={p.id}>
						{p.name}
					</option>
				))}
			</select>
			<ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
		</div>
	)
}

/** Gemini-style empty state with logo + greeting + suggestions */
function EmptyGreeting({ onSuggestion }: { onSuggestion: (text: string) => void }) {
	return (
		<div className="flex flex-col h-full px-5">
			{/* Top logo */}
			<div className="pt-6 pb-2">
				<Logo className="size-10" />
			</div>

			{/* Spacer pushes greeting to center-ish */}
			<div className="flex-1 flex flex-col justify-center -mt-12">
				<h1 className="text-2xl font-normal">
					<span className="text-blue-500">Hello</span>
				</h1>
				<h2 className="text-2xl font-normal text-foreground/80 mt-0.5">
					How can I help you today?
				</h2>
			</div>

			{/* Suggestions at bottom */}
			<div className="pb-4 space-y-2">
				{SUGGESTIONS.map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => onSuggestion(s)}
						className="w-full text-left text-sm text-foreground/80 bg-muted/40 hover:bg-muted rounded-xl px-4 py-3 transition-colors cursor-pointer border border-border/50"
					>
						{s}
					</button>
				))}
			</div>
		</div>
	)
}
