import { initPageController } from '@/agent/RemotePageController.content'

// import { DEMO_CONFIG } from '@/agent/constants'

const DEBUG_PREFIX = '[Content]'

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',

	main() {
		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()

		// if auth token matches, expose agent to page
		chrome.storage.local.get('PageSteerExtUserAuthToken').then((result) => {
			// extension side token.
			// @note this is isolated world. it is safe to assume user script cannot access it
			const extToken = result.PageSteerExtUserAuthToken
			if (!extToken) return

			// page side token
			const pageToken = localStorage.getItem('PageSteerExtUserAuthToken')
			if (!pageToken) return

			if (pageToken !== extToken) return

			console.debug('[PageSteerExt]: Auth tokens match. Exposing agent to page.')

			// add isolated world script
			exposeAgentToPage().then(
				// add main-world script
				() => injectScript('/main-world.js')
			)
		})
	},
})

async function exposeAgentToPage() {
	const { MultiPageSteer } = await import('@/agent/MultiPageSteer')
	console.debug('[PageSteerExt]: MultiPageSteer loaded')

	/**
	 * singleton MultiPageSteer to handle requests from the page
	 */
	let multiPageSteer: InstanceType<typeof MultiPageSteer> | null = null

	window.addEventListener('message', async (e) => {
		if (e.source !== window) return

		const data = e.data
		if (typeof data !== 'object' || data === null) return
		if (data.channel !== 'PAGE_STEER_EXT_REQUEST') return

		const { action, payload, id } = data

		switch (action) {
			case 'execute': {
				// singleton check
				if (multiPageSteer && multiPageSteer.status === 'running') {
					window.postMessage(
						{
							channel: 'PAGE_STEER_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: 'Agent is already running a task. Please wait until it finishes.',
						},
						'*'
					)
					return
				}

				try {
					const { task, config } = payload
					const { systemInstruction, ...agentConfig } = config

					// Dispose old instance before creating new one
					multiPageSteer?.dispose()

					multiPageSteer = new MultiPageSteer({
						...agentConfig,
						instructions: systemInstruction ? { system: systemInstruction } : undefined,
					})

					// events

					multiPageSteer.addEventListener('statuschange', (event) => {
						if (!multiPageSteer) return
						window.postMessage(
							{
								channel: 'PAGE_STEER_EXT_RESPONSE',
								id,
								action: 'status_change_event',
								payload: multiPageSteer.status,
							},
							'*'
						)
					})

					multiPageSteer.addEventListener('activity', (event) => {
						if (!multiPageSteer) return
						window.postMessage(
							{
								channel: 'PAGE_STEER_EXT_RESPONSE',
								id,
								action: 'activity_event',
								payload: (event as CustomEvent).detail,
							},
							'*'
						)
					})

					multiPageSteer.addEventListener('historychange', (event) => {
						if (!multiPageSteer) return
						window.postMessage(
							{
								channel: 'PAGE_STEER_EXT_RESPONSE',
								id,
								action: 'history_change_event',
								payload: multiPageSteer.history,
							},
							'*'
						)
					})

					// result

					const result = await multiPageSteer.execute(task)

					window.postMessage(
						{
							channel: 'PAGE_STEER_EXT_RESPONSE',
							id,
							action: 'execute_result',
							payload: result,
						},
						'*'
					)
				} catch (error) {
					window.postMessage(
						{
							channel: 'PAGE_STEER_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: (error as Error).message,
						},
						'*'
					)
				}

				break
			}

			case 'stop': {
				multiPageSteer?.stop()
				break
			}

			default:
				console.warn(`${DEBUG_PREFIX} Unknown action from page:`, action)
				break
		}
	})
}
