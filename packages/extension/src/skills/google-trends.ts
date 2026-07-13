/**
 * Google Trends Skill v1.3.0
 *
 * Platform-specific automation for trends.google.com.
 * Supports BOTH page variants:
 *   - Explore page (Angular: hierarchy-picker, md-select, trends-widget)
 *   - Trending page (Material: button[aria-label], table[role="grid"])
 *
 * All actions run via chrome.scripting.executeScript in MAIN world.
 */
import { defineSkill } from './define'

// --- Injected Functions (serialized and run inside the page tab) ---

function injGetTrendingNow() {
	const table = document.querySelector('table[role="grid"]')
	if (!table) {
		return JSON.stringify({
			error: 'Trending table not found. Navigate to trends.google.com/trending first.',
		})
	}

	const rows = table.querySelectorAll('tbody tr')
	const results: {
		index: number
		title: string
		searchVolume: string
		started: string
		status: string
	}[] = []

	rows.forEach((row, i) => {
		if (i >= 30) return
		const cells = row.querySelectorAll('td')
		if (cells.length < 3) return

		let title = ''
		let searchVolume = ''
		let started = ''
		let status = ''

		for (const cell of cells) {
			const link = cell.querySelector('a')
			if (link && !title) {
				title = link.textContent?.trim() || ''
				continue
			}
			const text = cell.textContent?.trim() || ''
			if (!title && text.length > 1 && !/^\d/.exec(text) && !text.includes('%')) {
				const span = cell.querySelector('span')
				if (span) title = span.textContent?.trim() || ''
			}
			if (/^\d+[KMB]?\+?$/i.exec(text) && !searchVolume) searchVolume = text
			if (/\d+\s*(hours?|minutes?|days?)\s*ago/i.exec(text)) started = text
			if (/^(Active|New|Breakout)$/i.exec(text)) status = text
		}

		if (title) results.push({ index: i, title, searchVolume, started, status })
	})

	return JSON.stringify(results, null, 2)
}
function injGetTrendingDetail(trendIndex: number) {
	const table = document.querySelector('table[role="grid"]')
	if (!table) return JSON.stringify({ error: 'Trending table not found' })

	const rows = table.querySelectorAll('tbody tr')
	const row = rows[trendIndex]
	if (!row) return JSON.stringify({ error: `Trend at index ${trendIndex} not found` })

	const expandBtn = row.querySelector(
		'button, [role="button"], [aria-expanded]'
	) as HTMLElement | null
	if (expandBtn) expandBtn.click()

	const links: { text: string; href: string }[] = []
	row.querySelectorAll('a[href]').forEach((a) => {
		links.push({ text: a.textContent?.trim() || '', href: a.getAttribute('href') || '' })
	})

	return JSON.stringify({
		index: trendIndex,
		fullText: row.textContent?.trim().slice(0, 1000) || '',
		links,
	})
}

/** Detect which page variant we're on */
function detectPageType(): 'explore' | 'trending' | 'other' {
	if (window.location.pathname.includes('/explore')) return 'explore'
	if (window.location.pathname.includes('/trending')) return 'trending'
	return 'other'
}

function injSetLocation(location: string) {
	const pageType = detectPageType()

	if (pageType === 'explore') {
		// Explore page: hierarchy-picker with md-autocomplete
		const picker = document.querySelector('hierarchy-picker:first-of-type') as HTMLElement | null
		if (!picker) return 'Error: Location picker not found on Explore page'

		// Click the picker button to activate it
		const selectBtn = picker.querySelector('.hierarchy-select[role="button"]') as HTMLElement | null
		if (selectBtn) selectBtn.click()

		return new Promise<string>((resolve) => {
			setTimeout(() => {
				// Find the search input inside the picker
				const input = picker.querySelector('input[type="search"]') as HTMLInputElement | null
				if (!input) {
					resolve('Error: Location search input not found')
					return
				}

				input.focus()
				input.value = ''
				input.dispatchEvent(new Event('input', { bubbles: true }))

				// Type character by character for Angular change detection
				for (const char of location) {
					input.value += char
					input.dispatchEvent(new Event('input', { bubbles: true }))
				}

				// Wait for autocomplete results
				setTimeout(() => {
					const items = document.querySelectorAll('md-virtual-repeat-container li')
					let matched = false
					for (const item of items) {
						const text = item.textContent?.trim().toLowerCase() || ''
						if (text.includes(location.toLowerCase())) {
							;(item as HTMLElement).click()
							matched = true
							resolve(`Selected location: ${item.textContent?.trim()}`)
							break
						}
					}
					if (!matched && items.length > 0) {
						;(items[0] as HTMLElement).click()
						resolve(`Selected first result: ${items[0].textContent?.trim()}`)
					} else if (!matched) {
						resolve(`Error: No location matching "${location}" found`)
					}
				}, 800)
			}, 300)
		})
	}
	// Trending page: button[aria-label*="select location"]
	const locationBtn = document.querySelector(
		'button[aria-label*="select location"]'
	) as HTMLElement | null
	if (!locationBtn) return 'Error: Location selector button not found'

	locationBtn.click()

	return new Promise<string>((resolve) => {
		setTimeout(() => {
			const searchInput = document.querySelector(
				'input[aria-label="Search locations"]'
			) as HTMLInputElement | null
			if (!searchInput) {
				resolve('Error: Location search input not found')
				return
			}

			searchInput.focus()
			searchInput.value = location
			searchInput.dispatchEvent(new Event('input', { bubbles: true }))

			setTimeout(() => {
				const items = document.querySelectorAll('li[role="menuitemradio"], li[role="option"]')
				let matched = false
				for (const item of items) {
					const text = item.textContent?.trim().toLowerCase() || ''
					if (text.includes(location.toLowerCase())) {
						;(item as HTMLElement).click()
						matched = true
						resolve(`Selected location: ${item.textContent?.trim()}`)
						break
					}
				}
				if (!matched) {
					const first = items[0] as HTMLElement | undefined
					if (first) {
						first.click()
						resolve(`Selected first match: ${first.textContent?.trim()}`)
					} else {
						resolve(`Error: No location matching "${location}" found`)
					}
				}
			}, 600)
		}, 300)
	})
}

function injSetTimePeriod(period: string) {
	const pageType = detectPageType()

	if (pageType === 'explore') {
		// Explore page: custom-date-picker contains an md-select for time period
		// The md-select has aria-label like "Select time period: Past 90 days"
		const datePicker = document.querySelector('custom-date-picker') as HTMLElement | null
		const timeSelect = datePicker
			? (datePicker.querySelector('md-select') as HTMLElement | null)
			: null

		// Fallback: find any md-select with aria-label containing "time period"
		const select =
			timeSelect ||
			(document.querySelector('md-select[aria-label*="time period"]') as HTMLElement | null) ||
			(document.querySelector('md-select[aria-label*="Time"]') as HTMLElement | null)

		if (!select) return 'Error: Time period selector not found on Explore page'

		select.click()

		// Map user-friendly names to option text
		const periodMap: Record<string, string> = {
			'1h': 'past hour',
			'4h': 'past 4 hours',
			'1d': 'past day',
			'7d': 'past 7 days',
			'30d': 'past 30 days',
			'90d': 'past 90 days',
			'6m': 'past 6 months',
			'12m': 'past 12 months',
			'5y': 'past 5 years',
			all: '2004 - present',
			custom: 'custom time range',
		}

		const searchText = (periodMap[period.toLowerCase()] || period).toLowerCase()

		return new Promise<string>((resolve) => {
			setTimeout(() => {
				// md-option elements appear in the dropdown container
				const container = document.querySelector(
					'.custom-date-picker-select-container, .explore-select-dropdown'
				)
				const options = container
					? container.querySelectorAll('md-option')
					: document.querySelectorAll('md-option')

				let matched = false
				for (const opt of options) {
					const textEl = opt.querySelector('.md-text')
					const text = (textEl?.textContent || opt.textContent || '').trim().toLowerCase()
					if (text.includes(searchText)) {
						;(opt as HTMLElement).click()
						matched = true
						resolve(`Selected time period: ${textEl?.textContent?.trim() || text}`)
						break
					}
				}
				if (!matched) {
					// Try partial match
					for (const opt of options) {
						const text = (opt.textContent || '').trim().toLowerCase()
						if (text.includes(period.toLowerCase())) {
							;(opt as HTMLElement).click()
							matched = true
							resolve(`Selected time period: ${opt.textContent?.trim()}`)
							break
						}
					}
				}
				if (!matched) {
					// List available options for debugging
					const available = Array.from(options)
						.map((o) => o.textContent?.trim())
						.filter(Boolean)
						.join(', ')
					resolve(
						`Error: No time period matching "${period}" found. ` +
							`Available: ${available || '1h, 4h, 1d, 7d, 30d, 90d, 6m, 12m, 5y, all'}`
					)
				}
			}, 400)
		})
	}

	// Trending page: button with aria-label
	const periodBtn = document.querySelector(
		'button[aria-label*="select period"]'
	) as HTMLElement | null
	if (!periodBtn) return 'Error: Period selector button not found'

	periodBtn.click()

	const periodMap: Record<string, string> = {
		'4h': '4',
		'24h': '24',
		'48h': '48',
		'7d': '168',
		'past 4 hours': '4',
		'past 24 hours': '24',
		'past 48 hours': '48',
		'past 7 days': '168',
	}
	const dataValue = periodMap[period.toLowerCase()] || period

	return new Promise<string>((resolve) => {
		setTimeout(() => {
			const items = document.querySelectorAll('[role="menu"] li[role="menuitemradio"]')
			let matched = false
			for (const item of items) {
				const val = item.getAttribute('data-value')
				const text = item.textContent?.trim().toLowerCase() || ''
				if (val === dataValue || text.includes(period.toLowerCase())) {
					;(item as HTMLElement).click()
					matched = true
					resolve(`Selected time period: ${item.textContent?.trim()}`)
					break
				}
			}
			if (!matched) {
				resolve(
					`Error: No time period matching "${period}" found. ` +
						'Available data-values: 4 (4h), 24 (24h), 48 (48h), 168 (7d)'
				)
			}
		}, 300)
	})
}
function injSetCategory(category: string) {
	const pageType = detectPageType()

	if (pageType === 'explore') {
		// Explore page: second hierarchy-picker is the category picker
		const pickers = document.querySelectorAll('hierarchy-picker')
		const catPicker = pickers[1] as HTMLElement | null
		if (!catPicker) return 'Error: Category picker not found on Explore page'

		// Click the picker button
		const selectBtn = catPicker.querySelector(
			'.hierarchy-select[role="button"]'
		) as HTMLElement | null
		if (selectBtn) selectBtn.click()

		return new Promise<string>((resolve) => {
			setTimeout(() => {
				const input = catPicker.querySelector('input[type="search"]') as HTMLInputElement | null
				if (!input) {
					resolve('Error: Category search input not found')
					return
				}

				input.focus()
				input.value = ''
				input.dispatchEvent(new Event('input', { bubbles: true }))

				for (const char of category) {
					input.value += char
					input.dispatchEvent(new Event('input', { bubbles: true }))
				}

				setTimeout(() => {
					const items = document.querySelectorAll('md-virtual-repeat-container li')
					let matched = false
					for (const item of items) {
						const text = item.textContent?.trim().toLowerCase() || ''
						if (text.includes(category.toLowerCase())) {
							;(item as HTMLElement).click()
							matched = true
							resolve(`Selected category: ${item.textContent?.trim()}`)
							break
						}
					}
					if (!matched && items.length > 0) {
						;(items[0] as HTMLElement).click()
						resolve(`Selected first result: ${items[0].textContent?.trim()}`)
					} else if (!matched) {
						resolve(`Error: No category matching "${category}" found`)
					}
				}, 800)
			}, 300)
		})
	}

	// Trending page
	const catBtn = document.querySelector(
		'button[aria-label*="select category"]'
	) as HTMLElement | null
	if (!catBtn) return 'Error: Category selector button not found'

	catBtn.click()

	return new Promise<string>((resolve) => {
		setTimeout(() => {
			const items = document.querySelectorAll('[role="menu"] li[role="menuitemradio"]')
			let matched = false
			for (const item of items) {
				const text = item.textContent?.trim().toLowerCase() || ''
				if (text.includes(category.toLowerCase())) {
					;(item as HTMLElement).click()
					matched = true
					resolve(`Selected category: ${item.textContent?.trim()}`)
					break
				}
			}
			if (!matched) {
				resolve(`Error: No category matching "${category}" found`)
			}
		}, 300)
	})
}

function injSearchExplore(query: string) {
	// Preserve stable filters from current URL. Do not carry `date`; some Google Trends
	// date values/combinations make Explore render its generic "Oops" page.
	const currentParams = new URLSearchParams(window.location.search)
	const params = new URLSearchParams()
	params.set('q', query)
	if (currentParams.has('geo')) params.set('geo', currentParams.get('geo')!)
	if (currentParams.has('hl')) params.set('hl', currentParams.get('hl')!)

	window.location.href = `https://trends.google.com/trends/explore?${params.toString()}`
	return `Navigating to explore: ${query}`
}

function injCompareTerms(termsStr: string) {
	const terms = termsStr
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)
		.slice(0, 5)
	const q = terms.join(',')

	// Preserve stable filters from current URL. Do not carry `date`; some Google Trends
	// date values/combinations make Explore render its generic "Oops" page.
	const currentParams = new URLSearchParams(window.location.search)
	const params = new URLSearchParams()
	params.set('q', q)
	if (currentParams.has('geo')) params.set('geo', currentParams.get('geo')!)
	if (currentParams.has('hl')) params.set('hl', currentParams.get('hl')!)

	window.location.href = `https://trends.google.com/trends/explore?${params.toString()}`
	return `Navigating to compare: ${terms.join(', ')}`
}
function injGetPageData() {
	const pageType = detectPageType()

	const results: {
		pageType: 'explore' | 'trending' | 'other'
		pageTitle: string
		url: string
		filters: { location: string; period: string; category: string; searchType: string }
		widgets: { title: string; content: string }[]
	} = {
		pageType,
		pageTitle: document.title,
		url: window.location.href,
		filters: { location: '', period: '', category: '', searchType: '' },
		widgets: [],
	}

	if (pageType === 'explore') {
		// Explore page: read filters from hierarchy-picker, custom-date-picker, and md-select
		const pickers = document.querySelectorAll('hierarchy-picker')
		if (pickers[0]) {
			const btn = pickers[0].querySelector('.hierarchy-select span')
			results.filters.location = btn?.textContent?.trim() || ''
		}
		if (pickers[1]) {
			const btn = pickers[1].querySelector('.hierarchy-select span')
			results.filters.category = btn?.textContent?.trim() || ''
		}

		// Time period from custom-date-picker > md-select
		const datePicker = document.querySelector('custom-date-picker')
		if (datePicker) {
			const selectValue = datePicker.querySelector(
				'md-select-value .md-text, md-select-value span div'
			)
			results.filters.period = selectValue?.textContent?.trim() || ''
		}
		if (!results.filters.period) {
			// Fallback: any md-select with time-related label
			const selects = document.querySelectorAll('md-select')
			for (const sel of selects) {
				const label = sel.getAttribute('aria-label') || ''
				if (
					label.toLowerCase().includes('time period') ||
					label.toLowerCase().includes('select time')
				) {
					const text = sel.querySelector('md-select-value span')?.textContent?.trim() || ''
					results.filters.period = text
					break
				}
			}
		}

		// Search type from separate md-select
		const selects = document.querySelectorAll('md-select')
		for (const sel of selects) {
			const label = sel.getAttribute('aria-label') || ''
			if (label.includes('stories location') || label.includes('search type')) {
				const text = sel.querySelector('md-select-value span')?.textContent?.trim() || ''
				results.filters.searchType = text
			}
		}

		// Extract trends-widget data
		const widgets = document.querySelectorAll('trends-widget')
		widgets.forEach((w) => {
			// Title is in the first div with text in widget header
			const headerDiv = w.querySelector('widget > div > div > div > div')
			const title =
				headerDiv?.textContent
					?.replace(/\s*(help_outline|Help|file_download|code|share|more_vert)\s*/g, '')
					.trim() || ''
			if (!title) return

			// Extract meaningful content
			let content: string
			const tableRows = w.querySelectorAll(
				'table tr, .bullet-list-item, .fe-atoms-generic-content-container'
			)
			if (tableRows.length > 0) {
				const items: string[] = []
				tableRows.forEach((row, i) => {
					if (i >= 20) return
					items.push(row.textContent?.trim().replace(/\s+/g, ' ') || '')
				})
				content = items.join('\n')
			} else {
				content =
					w.textContent
						?.replace(/(help_outline|file_download|code|share|more_vert|arrow_\w+)/g, '')
						.replace(/\s+/g, ' ')
						.trim()
						.slice(0, 2000) || ''
			}

			results.widgets.push({ title, content })
		})
	} else if (pageType === 'trending') {
		// Trending page: read filters from buttons
		const locationBtn = document.querySelector('button[aria-label*="select location"]')
		if (locationBtn) results.filters.location = locationBtn.textContent?.trim() || ''
		const periodBtn = document.querySelector('button[aria-label*="select period"]')
		if (periodBtn) results.filters.period = periodBtn.textContent?.trim() || ''
		const catBtn = document.querySelector('button[aria-label*="select category"]')
		if (catBtn) results.filters.category = catBtn.textContent?.trim() || ''

		const table = document.querySelector('table[role="grid"]')
		if (table) {
			results.widgets.push({
				title: 'Trending Searches',
				content: table.textContent?.trim().slice(0, 3000) || '',
			})
		}
	}

	return JSON.stringify(results, null, 2)
}

// --- Skill Definition ---

export const googleTrendsSkill = defineSkill(
	{
		id: 'google-trends',
		name: 'Google Trends',
		version: '1.3.0',
		description:
			'Research keyword trends via Google Trends Explore page. Compare terms, view interest over time, regional data, and related queries. Also supports Trending Now page for real-time hot topics.',
		author: 'page-steer',
		icon: '📈',
		source: 'builtin',
		matchPatterns: ['^https?://trends\\.google\\.com'],
		actions: [
			{
				name: 'search_explore',
				description:
					'[PRIMARY] Navigate to Google Trends Explore to research a keyword. Do not use generic navigation for Explore URLs, and do not include a date URL parameter; set time later with set_time_period if needed.',
				params: {
					query: { type: 'string', description: 'Search keyword to explore', required: true },
				},
			},
			{
				name: 'compare_terms',
				description:
					'Navigate to Google Trends Explore to compare up to 5 keywords side by side. Do not use generic navigation for Explore URLs, and do not include a date URL parameter; set time later with set_time_period if needed.',
				params: {
					terms: {
						type: 'string',
						description: 'Comma-separated terms to compare (max 5)',
						required: true,
					},
				},
			},
			{
				name: 'get_page_data',
				description:
					'Extract all data from the current page — on Explore page returns interest over time, regional breakdown, related queries/topics with current filters; on Trending page returns the hot topics list',
				params: {},
			},
			{
				name: 'set_location',
				description:
					'Change the location/country filter (works on both Explore and Trending pages). On Explore page uses the geo hierarchy picker; on Trending uses the location button.',
				params: {
					location: {
						type: 'string',
						description:
							'Location name (e.g. "United States", "Japan", "United Kingdom", "Worldwide")',
						required: true,
					},
				},
			},
			{
				name: 'set_time_period',
				description:
					'Change the time period filter. On Explore page: 1h, 4h, 1d, 7d, 30d, 90d, 6m, 12m, 5y, all. On Trending page: 4h, 24h, 48h, 7d.',
				params: {
					period: {
						type: 'string',
						description:
							'Explore: "1h","4h","1d","7d","30d","90d","6m","12m","5y","all" or natural text like "Past 6 months". Trending: "4h","24h","48h","7d"',
						required: true,
					},
				},
			},
			{
				name: 'set_category',
				description: 'Change the category filter (works on both Explore and Trending pages)',
				params: {
					category: {
						type: 'string',
						description:
							'Category name (e.g. "Entertainment", "Sports", "Business", "Science", "Health", "Technology")',
						required: true,
					},
				},
			},
			{
				name: 'get_trending_now',
				description:
					'Get real-time trending searches list (only works on the Trending Now page at trends.google.com/trending)',
				params: {},
			},
			{
				name: 'get_trending_detail',
				description:
					'Expand a trending item to see details and related links (Trending Now page only)',
				params: {
					index: {
						type: 'number',
						description: 'Trending item index (0-based)',
						required: true,
					},
				},
			},
		],
	},
	async (tabId, action, params) => {
		switch (action) {
			case 'get_trending_now': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injGetTrendingNow,
					world: 'MAIN',
				})
				return results[0]?.result || '[]'
			}
			case 'get_trending_detail': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injGetTrendingDetail,
					args: [(params.index as number) ?? 0],
					world: 'MAIN',
				})
				return results[0]?.result || '{}'
			}
			case 'set_location': {
				const location = params.location as string
				if (!location) return 'Error: location is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injSetLocation,
					args: [location],
					world: 'MAIN',
				})
				return results[0]?.result || 'Error'
			}
			case 'set_time_period': {
				const period = params.period as string
				if (!period) return 'Error: period is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injSetTimePeriod,
					args: [period],
					world: 'MAIN',
				})
				return results[0]?.result || 'Error'
			}
			case 'set_category': {
				const category = params.category as string
				if (!category) return 'Error: category is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injSetCategory,
					args: [category],
					world: 'MAIN',
				})
				return results[0]?.result || 'Error'
			}
			case 'search_explore': {
				const query = params.query as string
				if (!query) return 'Error: query is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injSearchExplore,
					args: [query],
					world: 'MAIN',
				})
				return results[0]?.result || 'Error'
			}
			case 'compare_terms': {
				const terms = params.terms as string
				if (!terms) return 'Error: terms is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injCompareTerms,
					args: [terms],
					world: 'MAIN',
				})
				return results[0]?.result || 'Error'
			}
			case 'get_page_data': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injGetPageData,
					world: 'MAIN',
				})
				return results[0]?.result || '{}'
			}
			default:
				return `Error: Unknown action "${action}"`
		}
	}
)
