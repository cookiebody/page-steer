import { Code2, PanelRight, Plug } from 'lucide-react'

import { BlurFade } from '../../components/ui/blur-fade'
import { SparklesText } from '../../components/ui/sparkles-text'
import { useLanguage } from '../../i18n/context'

/** Three entry points, one engine — pick by who you are. */
export default function UsageSection() {
	const { isZh } = useLanguage()

	const ways = [
		{
			icon: PanelRight,
			color: 'text-blue-500',
			ring: 'from-blue-50 to-white dark:from-blue-950/40 dark:to-gray-800 border-blue-200/70 dark:border-blue-800/50',
			titleEn: 'Chrome Extension',
			titleZh: '浏览器扩展',
			forEn: 'For everyday users',
			forZh: '面向普通用户',
			bodyEn:
				'A sidepanel chat that operates any tab. Install, configure your LLM, and start steering pages in natural language.',
			bodyZh: '侧边栏聊天，直接操作任意标签页。装好、配好模型，即可用自然语言驾驭页面。',
			tagsEn: ['Sidepanel chat', 'Slash skills', 'Multi-tab'],
			tagsZh: ['侧边栏聊天', '斜杠技能', '多标签'],
		},
		{
			icon: Plug,
			color: 'text-purple-500',
			ring: 'from-purple-50 to-white dark:from-purple-950/40 dark:to-gray-800 border-purple-200/70 dark:border-purple-800/50',
			titleEn: 'MCP Server',
			titleZh: 'MCP 服务',
			forEn: 'For Cursor / Claude Desktop',
			forZh: '面向 Cursor / Claude Desktop',
			bodyEn:
				'Expose your browser to any MCP client. Let your coding agent read pages and run tasks — no extra API keys needed.',
			bodyZh: '把浏览器接入任意 MCP 客户端，让你的编程 Agent 读页面、跑任务，无需额外配置密钥。',
			tagsEn: ['execute_task', 'One-line config', 'Reuses ext model'],
			tagsZh: ['execute_task', '一行配置', '复用扩展模型'],
		},
		{
			icon: Code2,
			color: 'text-emerald-500',
			ring: 'from-emerald-50 to-white dark:from-emerald-950/40 dark:to-gray-800 border-emerald-200/70 dark:border-emerald-800/50',
			titleEn: 'Embed as JS',
			titleZh: '嵌入 JS 库',
			forEn: 'For web developers',
			forZh: '面向网站开发者',
			bodyEn:
				'One script tag turns your web app into an AI-native product. Ship an in-product copilot in a few lines.',
			bodyZh: '一个 script 标签，让你的网站变身 AI 原生应用，几行代码交付产品内 Copilot。',
			tagsEn: ['npm i page-steer', 'CDN', 'Custom instructions'],
			tagsZh: ['npm i page-steer', 'CDN 引入', '自定义指令'],
		},
	]

	return (
		<section className="px-6 py-16" aria-labelledby="usage-heading">
			<div className="max-w-6xl mx-auto">
				<BlurFade inView>
					<div className="text-center mb-12">
						<SparklesText
							className="text-4xl lg:text-5xl mb-4"
							colors={{ first: '#3b82f6', second: '#8b5cf6' }}
						>
							{isZh ? '三种方式，同一个引擎' : 'Three Ways, One Engine'}
						</SparklesText>
						<p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
							{isZh
								? '同一套精准 DOM 操作能力，按你的身份挑一种用法。'
								: 'The same precise DOM engine — pick the entry point that fits you.'}
						</p>
					</div>
				</BlurFade>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					{ways.map((way, i) => {
						const Icon = way.icon
						return (
							<BlurFade key={way.titleEn} inView delay={0.05 + i * 0.05}>
								<div
									className={`group h-full rounded-2xl border bg-linear-to-b p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-500 ${way.ring}`}
								>
									<div className="w-12 h-12 rounded-xl bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center mb-4">
										<Icon className={`w-6 h-6 ${way.color}`} strokeWidth={1.75} />
									</div>
									<div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
										{isZh ? way.forZh : way.forEn}
									</div>
									<h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
										{isZh ? way.titleZh : way.titleEn}
									</h3>
									<p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
										{isZh ? way.bodyZh : way.bodyEn}
									</p>
									<div className="flex flex-wrap gap-1.5">
										{(isZh ? way.tagsZh : way.tagsEn).map((tag) => (
											<span
												key={tag}
												className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700 text-gray-600 dark:text-gray-300"
											>
												{tag}
											</span>
										))}
									</div>
								</div>
							</BlurFade>
						)
					})}
				</div>
			</div>
		</section>
	)
}
