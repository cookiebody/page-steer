import { useEffect } from 'react'

const DEFAULT_TITLE = 'Page Steer - AI-Powered Browser Assistant'

export function useDocumentTitle(title?: string) {
	useEffect(() => {
		document.title = title ? `${title} - PageSteer` : DEFAULT_TITLE
	}, [title])
}
