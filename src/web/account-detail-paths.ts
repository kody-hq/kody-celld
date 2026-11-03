export type AccountDetailPath =
	| { kind: 'package'; name: string }
	| { kind: 'packageFiles'; name: string; relativePath: string | null }
	| { kind: 'packagePreviewFiles'; source: string; relativePath: string | null }
	| { kind: 'job'; jobId: string }

export function matchAccountDetailPath(url: URL): AccountDetailPath | null {
	try {
		const previewFiles = /^\/account\/package-preview\/([^/]+)\/files(?:\/(.*))?$/.exec(url.pathname)
		if (previewFiles) {
			return {
				kind: 'packagePreviewFiles',
				source: decodeURIComponent(previewFiles[1]!),
				relativePath: previewFiles[2] === undefined ? null : decodeURIComponent(previewFiles[2]),
			}
		}

		const packageFiles = /^\/account\/packages\/([^/]+)\/files(?:\/(.*))?$/.exec(url.pathname)
		if (packageFiles) {
			return {
				kind: 'packageFiles',
				name: decodeURIComponent(packageFiles[1]!),
				relativePath: packageFiles[2] === undefined ? null : decodeURIComponent(packageFiles[2]),
			}
		}

		const job = /^\/account\/jobs\/([^/]+)$/.exec(url.pathname)
		if (job) return { kind: 'job', jobId: decodeURIComponent(job[1]!) }

		const pkg = /^\/account\/packages\/([^/]+)$/.exec(url.pathname)
		if (pkg) return { kind: 'package', name: decodeURIComponent(pkg[1]!) }
	} catch {
		return null
	}

	return null
}
