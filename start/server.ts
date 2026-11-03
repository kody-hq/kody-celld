import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { getGlobalStartContext } from '@tanstack/react-start'

const handler = createStartHandler(async (context) => {
	const nonce = getGlobalStartContext()?.nonce
	if (!nonce || context.router.options.ssr?.nonce !== nonce) {
		throw new Error('Document rendering requires its matching request nonce')
	}
	return defaultStreamHandler(context)
})

export default { fetch: handler }
