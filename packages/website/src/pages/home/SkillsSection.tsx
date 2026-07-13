import { BookOpen, Cpu, Download, Puzzle, Send, Sparkles, Wand2 } from 'lucide-react'

import { BlurFade } from '../../components/ui/blur-fade'
import { MagicCard } from '../../components/ui/magic-card'
import { SparklesText } from '../../components/ui/sparkles-text'
import { useLanguage } from '../../i18n/context'

/** Built-in skills shown as a live catalog, mirroring the extension's Skills panel. */
const BUILTIN_SKILLS: {
	icon: string
	name: string
	descEn: string
	descZh: string
	actions: string[]
}[] = [
	{
		icon: '𝕏',
		name: 'Twitter / X',
		descEn: 'Read timeline, post, like, retweet, reply, search, view profiles.',
		descZh: '读时间线、发推、点赞、转推、回复、搜索、查看主页。',
		actions: ['get_timeline', 'post_tweet', 'like', 'retweet', 'reply', 'search'],
	},
	{
		icon: '📈',
		name: 'Google Trends',
		descEn: 'Explore keyword interest over time, compare terms, trending now.',
		descZh: '分析关键词热度、对比多词、查看实时热榜。',
		actions: ['search_explore', 'compare_terms', 'set_time_period', 'get_trending_now'],
	},
]

export default function SkillsSection() {
	const { isZh } = useLanguage()

	return (
		<section
			className="px-6 py-16 bg-linear-to-b from-white to-blue-50/60 dark:from-gray-900 dark:to-gray-950"
			aria-labelledby="skills-heading"
		>
			<div className="max-w-6xl mx-auto">
				{/* Section header */}
				<BlurFade inView>
					<div className="text-center mb-4">
						<div className="inline-flex items-center gap-2 px-4 py-1.5 mb-5 text-sm font-medium bg-white dark:bg-gray-800 rounded-full shadow-sm border border-gray-200 dark:border-gray-700">
							<Puzzle className="w-4 h-4 text-blue-500" />
							<span className="text-gray-700 dark:text-gray-200">
								{isZh ? 'Skill 系统' : 'Skill System'}
							</span>
						</div>
						<SparklesText
							className="text-4xl lg:text-5xl mb-4"
							colors={{ first: '#3b82f6', second: '#8b5cf6' }}
						>
							{isZh ? '不止会点，更懂平台' : 'Precision, Not Guesswork'}
						</SparklesText>
						<p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
							{isZh
								? 'Skill 是平台专属的操作配方，用稳定选择器直达目标，告别每次都靠 DOM 猜测。内置即用，AI 边用边学，还能一键导入导出。'
								: 'Skills are platform-specific recipes that hit stable selectors directly — no DOM guessing every time. Built-in and ready, learned by AI as you go, shareable with one click.'}
						</p>
					</div>
				</BlurFade>

				{/* Three sources of skills */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10 mb-6">
					<BlurFade inView delay={0.05}>
						<div className="h-full rounded-2xl border border-blue-200/70 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-950/20 p-5">
							<BookOpen className="w-6 h-6 text-blue-500 mb-3" />
							<h3 className="font-semibold text-gray-900 dark:text-white mb-1">
								{isZh ? '内置技能' : 'Built-in'}
							</h3>
							<p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
								{isZh
									? '随扩展开箱即用，稳定可靠。'
									: 'Ship with the extension. Reliable from day one.'}
							</p>
						</div>
					</BlurFade>
					<BlurFade inView delay={0.1}>
						<div className="h-full rounded-2xl border border-purple-200/70 dark:border-purple-800/50 bg-purple-50/60 dark:bg-purple-950/20 p-5">
							<Wand2 className="w-6 h-6 text-purple-500 mb-3" />
							<h3 className="font-semibold text-gray-900 dark:text-white mb-1">
								{isZh ? 'AI 自学' : 'Learned'}
							</h3>
							<p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
								{isZh
									? 'AI 记录成功操作，沉淀为可复用配方。'
									: 'AI records successful runs and saves them as reusable recipes.'}
							</p>
						</div>
					</BlurFade>
					<BlurFade inView delay={0.15}>
						<div className="h-full rounded-2xl border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-5">
							<Download className="w-6 h-6 text-emerald-500 mb-3" />
							<h3 className="font-semibold text-gray-900 dark:text-white mb-1">
								{isZh ? '社区共享' : 'Community'}
							</h3>
							<p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
								{isZh
									? '一键导入导出，与团队和社区共享。'
									: 'Import & export in one click. Share with your team and community.'}
							</p>
						</div>
					</BlurFade>
				</div>

				{/* Live catalog + chat preview */}
				<div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
					{/* Skills catalog (mirrors the extension Skills panel) */}
					<BlurFade inView delay={0.2} className="lg:col-span-3">
						<MagicCard
							className="h-full rounded-2xl"
							gradientFrom="#3b82f6"
							gradientTo="#8b5cf6"
							gradientColor="#6366f1"
							gradientOpacity={0.12}
						>
							<div className="p-6">
								<div className="flex items-center gap-2 mb-4">
									<BookOpen className="w-5 h-5 text-gray-700 dark:text-gray-200" />
									<h3 className="font-semibold text-lg text-gray-900 dark:text-white">
										{isZh ? '内置技能一览' : 'Built-in Skills'}
									</h3>
								</div>
								<div className="space-y-3">
									{BUILTIN_SKILLS.map((skill) => (
										<div
											key={skill.name}
											className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/40 p-4"
										>
											<div className="flex items-center gap-2 mb-1.5">
												<span className="text-lg leading-none">{skill.icon}</span>
												<span className="font-semibold text-gray-900 dark:text-white">
													{skill.name}
												</span>
												<span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
													builtin
												</span>
											</div>
											<p className="text-sm text-gray-600 dark:text-gray-300 mb-2.5 leading-relaxed">
												{isZh ? skill.descZh : skill.descEn}
											</p>
											<div className="flex flex-wrap gap-1.5">
												{skill.actions.map((action) => (
													<span
														key={action}
														className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300"
													>
														{action}
													</span>
												))}
											</div>
										</div>
									))}
								</div>
								<p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
									{isZh
										? '更多平台持续加入，也可自行编写。'
										: 'More platforms coming — or write your own.'}
								</p>
							</div>
						</MagicCard>
					</BlurFade>

					{/* Chat preview (sidepanel experience) */}
					<BlurFade inView delay={0.25} className="lg:col-span-2">
						<MagicCard
							className="h-full rounded-2xl"
							gradientFrom="#8b5cf6"
							gradientTo="#a855f7"
							gradientColor="#8b5cf6"
							gradientOpacity={0.12}
						>
							<div className="flex h-full flex-col p-6">
								<div className="flex items-center gap-2 mb-4">
									<Sparkles className="w-5 h-5 text-purple-500" />
									<h3 className="font-semibold text-lg text-gray-900 dark:text-white">
										{isZh ? '像聊天一样操作' : 'Just Chat'}
									</h3>
								</div>

								{/* Faux sidepanel chat */}
								<div className="flex-1 flex flex-col justify-end gap-2.5">
									<div className="flex justify-end">
										<div className="bg-slate-100 dark:bg-white/10 rounded-2xl rounded-tr-md px-3.5 py-2 text-sm text-gray-800 dark:text-gray-100 max-w-[85%]">
											{isZh ? '帮我发条推文说 hello world' : 'Post a tweet saying hello world'}
										</div>
									</div>
									<div className="flex items-start gap-2">
										<div className="shrink-0 w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center">
											<Sparkles className="w-3.5 h-3.5 text-blue-500" />
										</div>
										<div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
											<span className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 mb-1.5">
												<Cpu className="w-3 h-3" />
												twitter · post_tweet
											</span>
											<br />
											{isZh ? '已发布，链接如下 ✓' : 'Posted. Here is the link ✓'}
										</div>
									</div>
								</div>

								{/* Faux input bar */}
								<div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 px-3 py-2">
									<span className="flex-1 text-sm text-gray-400 dark:text-gray-500">
										{isZh ? '输入 / 使用技能' : 'Type / to use skills'}
									</span>
									<div className="w-7 h-7 rounded-full bg-linear-to-r from-blue-500 to-purple-500 flex items-center justify-center">
										<Send className="w-3.5 h-3.5 text-white" />
									</div>
								</div>
							</div>
						</MagicCard>
					</BlurFade>
				</div>
			</div>
		</section>
	)
}
