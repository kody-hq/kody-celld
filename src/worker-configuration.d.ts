import type * as MainModule from './index.ts'

declare global {
	namespace Cloudflare {
		interface GlobalProps {
			mainModule: typeof MainModule
			durableNamespaces: 'RegistryCell' | 'UserCell' | 'PackageStorageCell'
		}
	}

	// @cloudflare/workers-types marks both options required; the WHATWG spec
	// (and lib.webworker, which hosted Kody compiles with) defaults them to
	// false. Shared code such as universal/package-file-media.ts relies on that.
	interface TextDecoderConstructorOptions {
		fatal?: boolean
		ignoreBOM?: boolean
	}
}
