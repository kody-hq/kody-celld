export function opaquePathname(pathname: string): string {
	try {
		decodeURIComponent(pathname)
		return pathname
	} catch {
		return pathname
			.split('/')
			.map((segment) => {
				try {
					decodeURIComponent(segment)
					return segment
				} catch {
					return encodeURIComponent(segment)
				}
			})
			.join('/')
	}
}
