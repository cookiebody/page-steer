import {
	Copy,
	CornerUpLeft,
	Eye,
	EyeOff,
	FoldVertical,
	HatGlasses,
	Home,
	Loader2,
	Plus,
	Scale,
	Trash2,
	UnfoldVertical,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { siGithub } from 'simple-icons'

import { DEMO_BASE_URL, DEMO_MODEL, isTestingEndpoint } from '@/agent/constants'
import type { ModelPreset } from '@/agent/constants'
import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface ConfigPanelProps {
	config: ExtConfig | null
	presets: ModelPreset[]
	activePresetId: string | null
	onSave: (config: ExtConfig) => Promise<void>
	onSwitchPreset: (presetId: string) => Promise<void>
	onSavePresets: (presets: ModelPreset[]) => Promise<void>
	onClose: () => void
}

/** MCP connection status and instructions */
function McpSection() {
	const [connected, setConnected] = useState(false)

	useEffect(() => {
		// Poll MCP bridge state
		const check = () => {
			chrome.storage.local.get('mcpBridgeConnected').then((r) => {
				setConnected(r.mcpBridgeConnected === true)
			})
		}
		check()
		const interval = setInterval(check, 2000)
		return () => clearInterval(interval)
	}, [])

	return (
		<div className="flex flex-col gap-2 p-3 bg-muted/50 rounded-md border">
			<div className="flex items-center justify-between">
				<label className="text-xs font-medium text-muted-foreground">MCP Server</label>
				<span
					className={`text-[10px] px-1.5 py-0.5 rounded-full ${connected ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground'}`}
				>
					{connected ? '● Connected' : '○ Not connected'}
				</span>
			</div>
			<p className="text-[10px] text-muted-foreground leading-relaxed">
				Use with Claude Desktop, Cursor, or any MCP client:
			</p>
			<pre className="text-[10px] bg-background border rounded p-2 overflow-x-auto font-mono text-foreground/70 select-text">
				{`npx page-steer-mcp`}
			</pre>
			<p className="text-[10px] text-muted-foreground leading-relaxed">
				Config for <code className="text-[10px]">claude_desktop_config.json</code>:
			</p>
			<pre className="text-[10px] bg-background border rounded p-2 overflow-x-auto font-mono text-foreground/70 select-text">
				{`{
  "mcpServers": {
    "page-steer": {
      "command": "npx",
      "args": ["page-steer-mcp"]
    }
  }
}`}
			</pre>
			<a
				href="/hub.html"
				target="_blank"
				rel="noopener noreferrer"
				className="text-[10px] text-blue-400 hover:text-blue-300 mt-1"
			>
				Open Hub page →
			</a>
		</div>
	)
}

export function ConfigPanel({
	config,
	presets,
	activePresetId,
	onSave,
	onSwitchPreset,
	onSavePresets,
	onClose,
}: ConfigPanelProps) {
	const [baseURL, setBaseURL] = useState(config?.baseURL || DEMO_BASE_URL)
	const [model, setModel] = useState(config?.model || DEMO_MODEL)
	const [apiKey, setApiKey] = useState(config?.apiKey)
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [maxSteps, setMaxSteps] = useState(config?.maxSteps)
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [experimentalLlmsTxt, setExperimentalLlmsTxt] = useState(
		config?.experimentalLlmsTxt ?? false
	)
	const [experimentalIncludeAllTabs, setExperimentalIncludeAllTabs] = useState(
		config?.experimentalIncludeAllTabs ?? false
	)
	const [disableNamedToolChoice, setDisableNamedToolChoice] = useState(
		config?.disableNamedToolChoice ?? false
	)
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [userAuthToken, setUserAuthToken] = useState('')
	const [copied, setCopied] = useState(false)
	const [showToken, setShowToken] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)

	const [prevConfig, setPrevConfig] = useState(config)
	if (prevConfig !== config) {
		setPrevConfig(config)
		setBaseURL(config?.baseURL || DEMO_BASE_URL)
		setModel(config?.model || DEMO_MODEL)
		setApiKey(config?.apiKey)
		setLanguage(config?.language)
		setMaxSteps(config?.maxSteps)
		setSystemInstruction(config?.systemInstruction ?? '')
		setExperimentalLlmsTxt(config?.experimentalLlmsTxt ?? false)
		setExperimentalIncludeAllTabs(config?.experimentalIncludeAllTabs ?? false)
		setDisableNamedToolChoice(config?.disableNamedToolChoice ?? false)
	}

	// Poll for user auth token every second until found
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null

		const fetchToken = async () => {
			const result = await chrome.storage.local.get('PageSteerExtUserAuthToken')
			const token = result.PageSteerExtUserAuthToken
			if (typeof token === 'string' && token) {
				setUserAuthToken(token)
				if (interval) {
					clearInterval(interval)
					interval = null
				}
			}
		}

		fetchToken()
		interval = setInterval(fetchToken, 1000)

		return () => {
			if (interval) clearInterval(interval)
		}
	}, [])

	const handleCopyToken = async () => {
		if (userAuthToken) {
			await navigator.clipboard.writeText(userAuthToken)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	const handleSave = async () => {
		setSaving(true)
		try {
			await onSave({
				apiKey,
				baseURL,
				model,
				language,
				maxSteps: maxSteps || undefined,
				systemInstruction: systemInstruction || undefined,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
			})
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="flex flex-col gap-4 p-4 relative">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold">Settings</h2>
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

			{/* User Auth Token Section */}
			<div className="flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border">
				<label htmlFor="user-auth-token" className="text-xs font-medium text-muted-foreground">
					User Auth Token
				</label>
				<p className="text-[10px] text-muted-foreground mb-1">
					Give a website the ability to call this extension.
				</p>
				<div className="flex gap-2 items-center">
					<Input
						id="user-auth-token"
						readOnly
						value={
							userAuthToken
								? showToken
									? userAuthToken
									: `${userAuthToken.slice(0, 4)}${'•'.repeat(userAuthToken.length - 8)}${userAuthToken.slice(-4)}`
								: 'Loading...'
						}
						className="text-xs h-8 font-mono bg-background"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowToken(!showToken)}
						disabled={!userAuthToken}
						aria-label={showToken ? 'Hide token' : 'Show token'}
						aria-pressed={showToken}
					>
						{showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={handleCopyToken}
						disabled={!userAuthToken}
						aria-label="Copy token"
					>
						{copied ? <span className="">✓</span> : <Copy className="size-3" />}
					</Button>
					<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
						{copied ? 'Token copied' : ''}
					</span>
				</div>
			</div>

			{/* MCP Connection */}
			<McpSection />

			{/* Model Presets */}
			<div className="flex flex-col gap-2 p-3 bg-muted/50 rounded-md border">
				<div className="flex items-center justify-between">
					<label className="text-xs font-medium text-muted-foreground">Model Presets</label>
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-5 cursor-pointer"
						onClick={() => {
							const newPreset: ModelPreset = {
								id: `custom-${Date.now()}`,
								name: model || 'New Model',
								config: { baseURL, model, apiKey: apiKey || '' },
							}
							onSavePresets([...presets, newPreset])
						}}
						title="Save current config as preset"
						aria-label="Save as preset"
					>
						<Plus className="size-3" />
					</Button>
				</div>
				<div className="flex flex-col gap-1">
					{presets.map((preset) => (
						<div
							key={preset.id}
							className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
								activePresetId === preset.id
									? 'bg-primary/10 text-primary font-medium'
									: 'hover:bg-muted'
							}`}
							onClick={() => {
								onSwitchPreset(preset.id)
								setBaseURL(preset.config.baseURL)
								setModel(preset.config.model)
								setApiKey(preset.config.apiKey)
							}}
						>
							<span className="truncate flex-1">{preset.name}</span>
							<span className="text-[10px] text-muted-foreground ml-2 shrink-0">
								{preset.config.model}
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								className="size-5 ml-1 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100 hover:text-destructive cursor-pointer"
								onClick={(e) => {
									e.stopPropagation()
									onSavePresets(presets.filter((p) => p.id !== preset.id))
								}}
								aria-label={`Delete ${preset.name}`}
							>
								<Trash2 className="size-2.5" />
							</Button>
						</div>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="base-url" className="text-xs text-muted-foreground">
					Base URL
				</label>
				<Input
					id="base-url"
					placeholder="https://api.openai.com/v1"
					value={baseURL}
					onChange={(e) => setBaseURL(e.target.value)}
					className="text-xs h-8"
				/>
			</div>

			{/* Testing API notice */}
			{isTestingEndpoint(baseURL) && (
				<div className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-[11px] text-muted-foreground leading-relaxed">
					<Scale className="size-3 inline-block mr-1 -mt-0.5 text-amber-600" />
					You are using our testing API. By using this you agree to the{' '}
					<a
						href="https://github.com/cookiebody/PageSteer/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="underline hover:text-foreground"
					>
						Terms of Use & Privacy Policy
					</a>
				</div>
			)}

			<div className="flex flex-col gap-1.5">
				<label htmlFor="model" className="text-xs text-muted-foreground">
					Model
				</label>
				<Input
					id="model"
					placeholder="gpt-5.1"
					value={model}
					onChange={(e) => setModel(e.target.value)}
					className="text-xs h-8"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="api-key" className="text-xs text-muted-foreground">
					API Key
				</label>
				<div className="flex gap-2 items-center">
					<Input
						id="api-key"
						type={showApiKey ? 'text' : 'password'}
						// placeholder="sk-..."
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						className="text-xs h-8"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowApiKey(!showApiKey)}
						aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
					>
						{showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<label className="text-xs text-muted-foreground">Response Language</label>
				<select
					value={language ?? ''}
					onChange={(e) => setLanguage((e.target.value || undefined) as LanguagePreference)}
					className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
				>
					<option value="">System</option>
					<option value="en-US">English</option>
					<option value="zh-CN">中文</option>
					<option value="ja-JP">日本語</option>
					<option value="fr-FR">Français</option>
				</select>
			</div>

			{/* Advanced Config */}
			<button
				type="button"
				onClick={() => setAdvancedOpen(!advancedOpen)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mt-1 font-bold"
			>
				Advanced
				{advancedOpen ? <FoldVertical className="size-3" /> : <UnfoldVertical className="size-3" />}
			</button>

			{advancedOpen && (
				<>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="max-steps" className="text-xs text-muted-foreground">
							Max Steps
						</label>
						<Input
							id="max-steps"
							type="number"
							placeholder="40"
							min={1}
							max={200}
							value={maxSteps ?? ''}
							onChange={(e) => setMaxSteps(e.target.value ? Number(e.target.value) : undefined)}
							className="text-xs h-8 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">System Instruction</label>
						<textarea
							placeholder="Additional instructions for the agent..."
							value={systemInstruction}
							onChange={(e) => setSystemInstruction(e.target.value)}
							rows={3}
							className="text-xs rounded-md border border-input bg-background px-3 py-2 resize-y min-h-[60px]"
						/>
					</div>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">Disable named tool_choice</span>
						<Switch checked={disableNamedToolChoice} onCheckedChange={setDisableNamedToolChoice} />
					</label>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">Experimental llms.txt support</span>
						<Switch checked={experimentalLlmsTxt} onCheckedChange={setExperimentalLlmsTxt} />
					</label>

					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<label className="text-xs text-muted-foreground cursor-pointer">
								Experimental include all tabs
							</label>
							<p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">
								Include every supported unpinned tab in the current window as an agent target.
							</p>
						</div>
						<Switch
							checked={experimentalIncludeAllTabs}
							onCheckedChange={setExperimentalIncludeAllTabs}
						/>
					</div>
				</>
			)}

			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onClose} className="flex-1 h-8 text-xs cursor-pointer">
					Cancel
				</Button>
				<Button
					onClick={handleSave}
					disabled={saving}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					{saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
				</Button>
			</div>

			{/* Footer */}
			<div className="mt-4 mb-4 pt-4 border-t border-border/50 flex gap-2 justify-between text-[10px] text-muted-foreground">
				<div className="flex flex-col justify-between">
					<span>
						Version <span className="font-mono">v{__VERSION__}</span>
					</span>

					<a
						href="https://github.com/cookiebody/PageSteer"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<svg role="img" viewBox="0 0 24 24" className="size-3 fill-current">
							<path d={siGithub.path} />
						</svg>
						<span>Source Code</span>
					</a>
				</div>

				<div className="flex flex-col items-end">
					<a
						href="https://cookiebody.github.io/docs/page-steer/"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<Home className="size-3" />
						<span>Home Page</span>
					</a>

					<a
						href="https://github.com/cookiebody/PageSteer/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<HatGlasses className="size-3" />
						<span>Privacy</span>
					</a>
				</div>
			</div>

			{/* attribute */}
			<div className="text-[10px] text-muted-foreground bg-background fixed bottom-0 w-full flex justify-around">
				<span className="leading-loose">
					Built with ♥️ by{' '}
					<a
						href="https://cookiebody.github.io"
						target="_blank"
						rel="noopener noreferrer"
						className="underline hover:text-foreground"
					>
						@CookieBody
					</a>
				</span>
			</div>
		</div>
	)
}
