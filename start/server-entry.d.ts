import type { CelldStartRequestContext } from './request-context.ts'

declare const server: {
	fetch(request: Request, options: { context: CelldStartRequestContext }): Promise<Response>
}
export default server
