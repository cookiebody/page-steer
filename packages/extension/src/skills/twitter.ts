/**
 * Twitter/X Skill v1.0.0
 *
 * Platform-specific automation for x.com / twitter.com.
 * Uses data-testid selectors which are stable React test attributes.
 *
 * All actions run via chrome.scripting.executeScript in ISOLATED world
 * (bypasses CSP, can access DOM but not page JS globals).
 */
import { defineSkill } from './define'

// --- Injected Functions (serialized and run inside the page tab) ---

function injGetTimeline() {
	const tweets = document.querySelectorAll('[data-testid="tweet"]')
	const results: {
		index: number
		user: string
		handle: string
		text: string
		time: string
		likes: string
		retweets: string
		replies: string
	}[] = []

	tweets.forEach((tweet, i) => {
		if (i >= 20) return

		const userNameEl = tweet.querySelector('[data-testid="User-Name"]')
		const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]')
		const timeEl = tweet.querySelector('time')

		let user = ''
		let handle = ''
		if (userNameEl) {
			const links = userNameEl.querySelectorAll('a')
			if (links.length >= 2) {
				user = links[0]?.textContent?.trim() || ''
				handle = links[1]?.textContent?.trim() || ''
			} else if (links.length === 1) {
				user = links[0]?.textContent?.trim() || ''
			}
		}

		const likeBtn =
			tweet.querySelector('[data-testid="like"]') || tweet.querySelector('[data-testid="unlike"]')
		const retweetBtn =
			tweet.querySelector('[data-testid="retweet"]') ||
			tweet.querySelector('[data-testid="unretweet"]')
		const replyBtn = tweet.querySelector('[data-testid="reply"]')

		results.push({
			index: i,
			user,
			handle,
			text: tweetTextEl?.textContent?.slice(0, 500) || '',
			time: timeEl?.getAttribute('datetime') || timeEl?.textContent || '',
			likes: likeBtn?.getAttribute('aria-label') || '',
			retweets: retweetBtn?.getAttribute('aria-label') || '',
			replies: replyBtn?.getAttribute('aria-label') || '',
		})
	})

	return JSON.stringify(results, null, 2)
}

function injGetTweetDetail(tweetIndex: number) {
	const tweets = document.querySelectorAll('[data-testid="tweet"]')
	const tweet = tweets[tweetIndex]
	if (!tweet) return JSON.stringify({ error: `Tweet at index ${tweetIndex} not found` })

	const userNameEl = tweet.querySelector('[data-testid="User-Name"]')
	const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]')
	const timeEl = tweet.querySelector('time')
	const images = tweet.querySelectorAll('[data-testid="tweetPhoto"] img')
	const links = tweet.querySelectorAll('[data-testid="tweetText"] a')

	const imgSrcs: string[] = []
	images.forEach((img) => {
		const src = img.getAttribute('src')
		if (src) imgSrcs.push(src)
	})

	const linkData: { text: string; href: string }[] = []
	links.forEach((a) => {
		linkData.push({
			text: a.textContent || '',
			href: a.getAttribute('href') || '',
		})
	})

	return JSON.stringify({
		user: userNameEl?.textContent?.slice(0, 100) || '',
		text: tweetTextEl?.textContent || '',
		time: timeEl?.getAttribute('datetime') || '',
		images: imgSrcs,
		links: linkData,
	})
}

function injPostTweet(text: string) {
	const textArea = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement | null
	if (!textArea) return 'Error: Tweet compose box not found. Navigate to x.com/home first.'

	textArea.focus()
	// eslint-disable-next-line @typescript-eslint/no-deprecated -- only way to insert text in contenteditable in isolated world
	document.execCommand('selectAll', false)
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	document.execCommand('insertText', false, text)

	return new Promise<string>((resolve) => {
		setTimeout(() => {
			const postBtn = document.querySelector(
				'[data-testid="tweetButtonInline"]'
			) as HTMLElement | null
			if (!postBtn) {
				resolve('Error: Post button not found')
				return
			}
			postBtn.click()
			resolve(`Posted: "${text.slice(0, 50)}..."`)
		}, 500)
	})
}

function injLikeTweet(tweetIndex: number) {
	const tweets = document.querySelectorAll('[data-testid="tweet"]')
	const tweet = tweets[tweetIndex]
	if (!tweet) return `Error: Tweet at index ${tweetIndex} not found`

	const likeBtn = tweet.querySelector('[data-testid="like"]') as HTMLElement | null
	if (!likeBtn) {
		const unlikeBtn = tweet.querySelector('[data-testid="unlike"]')
		if (unlikeBtn) return 'Already liked'
		return 'Error: Like button not found'
	}
	likeBtn.click()
	return `Liked tweet ${tweetIndex}`
}

function injRetweetTweet(tweetIndex: number) {
	const tweets = document.querySelectorAll('[data-testid="tweet"]')
	const tweet = tweets[tweetIndex]
	if (!tweet) return `Error: Tweet at index ${tweetIndex} not found`

	const retweetBtn = tweet.querySelector('[data-testid="retweet"]') as HTMLElement | null
	if (!retweetBtn) {
		const unretweetBtn = tweet.querySelector('[data-testid="unretweet"]')
		if (unretweetBtn) return 'Already retweeted'
		return 'Error: Retweet button not found'
	}
	retweetBtn.click()

	return new Promise<string>((resolve) => {
		setTimeout(() => {
			const menuItem = document.querySelector(
				'[data-testid="retweetConfirm"]'
			) as HTMLElement | null
			if (menuItem) {
				menuItem.click()
				resolve(`Retweeted tweet ${tweetIndex}`)
			} else {
				resolve('Retweet menu opened — confirm manually or retry')
			}
		}, 500)
	})
}

function injReplyToTweet(tweetIndex: number, replyText: string) {
	const tweets = document.querySelectorAll('[data-testid="tweet"]')
	const tweet = tweets[tweetIndex]
	if (!tweet) return `Error: Tweet at index ${tweetIndex} not found`

	const replyBtn = tweet.querySelector('[data-testid="reply"]') as HTMLElement | null
	if (!replyBtn) return 'Error: Reply button not found'
	replyBtn.click()

	return new Promise<string>((resolve) => {
		setTimeout(() => {
			const replyTextarea = document.querySelector(
				'[data-testid="tweetTextarea_0"]'
			) as HTMLElement | null
			if (!replyTextarea) {
				resolve('Error: Reply textarea not found after clicking reply')
				return
			}
			replyTextarea.focus()
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			document.execCommand('selectAll', false)
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			document.execCommand('insertText', false, replyText)

			setTimeout(() => {
				const postBtn = document.querySelector('[data-testid="tweetButton"]') as HTMLElement | null
				if (postBtn) {
					postBtn.click()
					resolve(`Replied to tweet ${tweetIndex}: "${replyText.slice(0, 50)}"`)
				} else {
					resolve('Error: Reply post button not found')
				}
			}, 500)
		}, 800)
	})
}

function injSearch(query: string) {
	window.location.href = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=top`
	return `Navigating to search: ${query}`
}

function injGetProfile() {
	const nameEl = document.querySelector('[data-testid="UserName"]')
	const bioEl = document.querySelector('[data-testid="UserDescription"]')
	const locationEl = document.querySelector('[data-testid="UserLocation"]')
	const urlEl = document.querySelector('[data-testid="UserUrl"]')
	const joinDateEl = document.querySelector('[data-testid="UserJoinDate"]')
	const birthdateEl = document.querySelector('[data-testid="UserBirthdate"]')

	const allLinks = document.querySelectorAll('a[href]')
	let followers = ''
	let following = ''
	allLinks.forEach((a) => {
		const href = a.getAttribute('href') || ''
		if (href.endsWith('/followers') || href.endsWith('/verified_followers')) {
			followers = a.textContent?.trim() || ''
		}
		if (href.endsWith('/following')) {
			following = a.textContent?.trim() || ''
		}
	})

	return JSON.stringify({
		name: nameEl?.textContent || '',
		bio: bioEl?.textContent || '',
		location: locationEl?.textContent || '',
		website: urlEl?.textContent || '',
		joinDate: joinDateEl?.textContent || '',
		birthdate: birthdateEl?.textContent || '',
		followers,
		following,
		url: window.location.href,
	})
}

// --- Skill Definition ---

export const twitterSkill = defineSkill(
	{
		id: 'twitter',
		name: 'Twitter/X',
		version: '1.0.0',
		description:
			'Read timeline, post tweets, like, retweet, reply, search, and view profiles on X/Twitter.',
		author: 'page-steer',
		icon: '𝕏',
		source: 'builtin',
		matchPatterns: ['^https?://(x\\.com|twitter\\.com)'],
		actions: [
			{
				name: 'get_timeline',
				description: 'Get tweets from the current timeline (up to 20)',
				params: {},
			},
			{
				name: 'get_tweet_detail',
				description: 'Get full detail of a specific tweet by index',
				params: {
					index: { type: 'number', description: 'Tweet index (0-based)', required: true },
				},
			},
			{
				name: 'post_tweet',
				description: 'Post a new tweet (must be on x.com/home)',
				params: {
					text: { type: 'string', description: 'Tweet content (max 280 chars)', required: true },
				},
			},
			{
				name: 'like',
				description: 'Like a tweet by index',
				params: {
					index: { type: 'number', description: 'Tweet index to like', required: true },
				},
			},
			{
				name: 'retweet',
				description: 'Retweet/repost a tweet by index',
				params: {
					index: { type: 'number', description: 'Tweet index to retweet', required: true },
				},
			},
			{
				name: 'reply',
				description: 'Reply to a tweet by index',
				params: {
					index: { type: 'number', description: 'Tweet index to reply to', required: true },
					text: { type: 'string', description: 'Reply content', required: true },
				},
			},
			{
				name: 'search',
				description: 'Search Twitter for a query',
				params: {
					query: { type: 'string', description: 'Search query', required: true },
				},
			},
			{
				name: 'get_profile',
				description: 'Get user profile info (navigate to x.com/username first)',
				params: {},
			},
		],
	},
	async (tabId, action, params) => {
		switch (action) {
			case 'get_timeline': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injGetTimeline,
				})
				return results[0]?.result || '[]'
			}
			case 'get_tweet_detail': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injGetTweetDetail,
					args: [(params.index as number) ?? 0],
				})
				return results[0]?.result || '{}'
			}
			case 'post_tweet': {
				const text = params.text as string
				if (!text) return 'Error: text is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injPostTweet,
					args: [text],
				})
				return results[0]?.result || 'Error'
			}
			case 'like': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injLikeTweet,
					args: [(params.index as number) ?? 0],
				})
				return results[0]?.result || 'Error'
			}
			case 'retweet': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injRetweetTweet,
					args: [(params.index as number) ?? 0],
				})
				return results[0]?.result || 'Error'
			}
			case 'reply': {
				const text = params.text as string
				if (!text) return 'Error: text is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injReplyToTweet,
					args: [(params.index as number) ?? 0, text],
				})
				return results[0]?.result || 'Error'
			}
			case 'search': {
				const query = params.query as string
				if (!query) return 'Error: query is required'
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injSearch,
					args: [query],
				})
				return results[0]?.result || 'Error'
			}
			case 'get_profile': {
				const results = await chrome.scripting.executeScript({
					target: { tabId },
					func: injGetProfile,
				})
				return results[0]?.result || '{}'
			}
			default:
				return `Error: Unknown action "${action}"`
		}
	}
)
