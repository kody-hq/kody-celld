import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
	kodyLogoAspectRatio,
	kodyLogoOutlinedSvgMarkup,
	kodyLogoSvgMarkup,
	kodyLogoViewBox,
	kodyWordmarkPathD,
} from './kody-logo.ts'
import {
	kodyBrandAssets,
	kodyMarkOutlinedRingPathD,
	kodyMarkPathD,
} from './kody-mark-path.ts'

const publicDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../public',
)

function readPublic(assetPath: string) {
	return readFileSync(path.join(publicDir, assetPath.slice(1)))
}

describe('kody logo helpers', () => {
	it('logo markup pairs the mark with the outlined wordmark', () => {
		const solid = kodyLogoSvgMarkup('#ffffff')
		assert.ok(solid.includes(`viewBox="${kodyLogoViewBox}"`))
		assert.ok(solid.includes(kodyMarkPathD))
		assert.ok(solid.includes(kodyWordmarkPathD))
		assert.ok(!solid.includes('<text'))
		assert.equal(solid.match(/fill="#ffffff"/g)?.length, 2)

		const outlined = kodyLogoOutlinedSvgMarkup('#000000')
		assert.ok(!outlined.includes('clipPath'))
		assert.ok(outlined.includes(kodyMarkOutlinedRingPathD))
		assert.ok(outlined.includes(kodyWordmarkPathD))
		assert.ok(outlined.includes('fill-rule="evenodd"'))
		assert.ok(!outlined.includes('stroke='))
	})

	it('published logo SVGs match the markup helpers', () => {
		assert.equal(
			readPublic(kodyBrandAssets.logoSvgWhite).toString('utf8'),
			kodyLogoSvgMarkup('#ffffff'),
		)
		assert.equal(
			readPublic(kodyBrandAssets.logoSvgOutlined).toString('utf8'),
			kodyLogoOutlinedSvgMarkup('#000000'),
		)
	})

	it('logo PNGs are 2048px wide at the logo aspect ratio', () => {
		for (const assetPath of [
			kodyBrandAssets.logoPngWhite,
			kodyBrandAssets.logoPngOutlined,
		]) {
			const png = readPublic(assetPath)
			const width = png.readUInt32BE(16)
			const height = png.readUInt32BE(20)
			assert.equal(width, 2048)
			assert.equal(height, Math.round(2048 / kodyLogoAspectRatio))
		}
	})
})
