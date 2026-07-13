/**
 * Copyright (C) 2026 Page Steer Contributors
 * All rights reserved.
 */
import { type AgentConfig, PageSteerCore } from '@page-steer/core'
import { PageController, type PageControllerConfig } from '@page-steer/page-controller'
import { Panel, type PanelConfig } from '@page-steer/ui'

export * from '@page-steer/core'

export type PageSteerConfig = AgentConfig & PageControllerConfig & Omit<PanelConfig, 'language'>

export class PageSteer extends PageSteerCore {
	panel: Panel

	constructor(config: PageSteerConfig) {
		const pageController = new PageController({
			...config,
			enableMask: config.enableMask ?? true,
		})

		super({ ...config, pageController })

		const panelLanguage =
			config.language === 'en-US' || config.language === 'zh-CN' ? config.language : undefined

		this.panel = new Panel(this, {
			language: panelLanguage,
			promptForNextTask: config.promptForNextTask,
		})
	}
}
