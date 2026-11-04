export function opaquePathname(pathname: string): string {
	return pathname
		.split('/')
		.map((segment) => {
			try {
				return encodeURIComponent(decodeURIComponent(segment))
			} catch {
				return encodeURIComponent(segment)
			}
		})
		.join('/')
}
