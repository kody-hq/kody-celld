import { isCodeModulePath } from '../execute/strip-types.ts'
import { base64ToBytes, bytesToBase64 } from '../lib/base64.ts'
import { KodyError } from '../lib/errors.ts'
import type { PackageBinaryFile, PackageFileContent, PackageFiles } from './manifest.ts'

/**
 * Binary package files (images, fonts, wasm; #85). A text file is a plain
 * string; a binary file is `{ base64 }` everywhere a file map crosses a
 * boundary (packageSave input, packageGet `includeFiles`, previews, RPC), so
 * a file map read back can be saved again unchanged. Storage keeps the raw
 * bytes (`package_files.bytes`). Binaries never enter the module graph: code
 * and JSON modules, README.md and AGENTS.md must be text.
 */

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export function isBinaryPackageFile(content: PackageFileContent | undefined): content is PackageBinaryFile {
	return typeof content === 'object' && content !== null
}

/** Paths that must hold UTF-8 text because something parses them. */
export function isTextOnlyPackagePath(path: string) {
	return isCodeModulePath(path) || path.endsWith('.json') || path === 'README.md' || path === 'AGENTS.md'
}

/** The text files of a package; binary entries are left out. */
export function packageTextFiles(files: PackageFiles): Record<string, string> {
	const text: Record<string, string> = {}
	for (const [path, content] of Object.entries(files)) {
		if (typeof content === 'string') text[path] = content
	}
	return text
}

export function binaryPackageFile(bytes: Uint8Array): PackageBinaryFile {
	return { base64: bytesToBase64(bytes) }
}

/** The bytes a file is served as: UTF-8 for text, the decoded bytes for a binary file. */
export function packageFileBytes(content: PackageFileContent): Uint8Array {
	return typeof content === 'string' ? new TextEncoder().encode(content) : base64ToBytes(content.base64)
}

/** Size counted against the package caps (byte limits): UTF-8 bytes for text, decoded bytes for binaries. */
export function packageFileSize(content: PackageFileContent): number {
	if (typeof content === 'string') return new TextEncoder().encode(content).byteLength
	const { base64 } = content
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
	return (base64.length / 4) * 3 - padding
}

/**
 * One file of a packageSave / JSON-source file map: a string, or `{ base64 }`
 * with standard, padded base64. Anything else is refused.
 */
export function readPackageFileInput(path: string, content: unknown): PackageFileContent {
	if (typeof content === 'string') return content
	if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
		const keys = Object.keys(content)
		const base64 = (content as { base64?: unknown }).base64
		if (keys.length === 1 && typeof base64 === 'string') {
			if (!base64Pattern.test(base64)) {
				throw new KodyError('invalid_package', `File "${path}" has invalid base64 (use standard, padded base64).`)
			}
			if (isTextOnlyPackagePath(path)) {
				throw new KodyError(
					'invalid_package',
					`File "${path}" must be UTF-8 text: code and JSON modules, README.md and AGENTS.md cannot be binary.`,
				)
			}
			// Zero bytes is valid UTF-8: store it as an empty text file, so a binary row always has bytes.
			return base64 === '' ? '' : { base64 }
		}
	}
	throw new KodyError('invalid_package', `File "${path}" must be a string, or { base64 } for a binary file.`)
}

/**
 * An archive or git file as a package file: UTF-8 text stays a string, anything
 * else is kept as a binary file. A module, JSON, README.md or AGENTS.md that
 * is not UTF-8 is skipped with a warning (it could never load).
 */
export function archiveFileContent(
	path: string,
	bytes: Uint8Array,
	warnings: Array<string>,
): PackageFileContent | null {
	try {
		return utf8.decode(bytes)
	} catch {
		if (!isTextOnlyPackagePath(path)) return binaryPackageFile(bytes)
		warnings.push(`Skipped ${path}: not UTF-8 text (code and JSON modules, README.md and AGENTS.md must be text).`)
		return null
	}
}
