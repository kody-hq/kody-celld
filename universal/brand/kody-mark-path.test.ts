import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
	kodyFaviconSvgMarkup,
	kodyMarkOutlinedLeftEyePathD,
	kodyMarkOutlinedNosePathD,
	kodyMarkOutlinedOuterPathD,
	kodyMarkOutlinedRightEyePathD,
	kodyMarkOutlinedRingPathD,
	kodyMarkOutlinedSvgMarkup,
	kodyMarkPathTransform,
	kodyMarkSvgMarkup,
} from './kody-mark-path.ts'

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..',
)
const brandDir = path.join(rootDir, 'public/images/brand')
const publicDir = path.join(rootDir, 'public')

describe('kody mark path helpers', () => {
	it('published mark SVGs match the markup helper', () => {
		const published = readFileSync(
			path.join(brandDir, 'kody-mark-outlined.svg'),
			'utf8',
		)
		assert.equal(published, kodyMarkOutlinedSvgMarkup('#000000'))
		const publishedSolid = readFileSync(
			path.join(brandDir, 'kody-mark-white.svg'),
			'utf8',
		)
		assert.equal(publishedSolid, kodyMarkSvgMarkup('#ffffff'))
	})

	it('outlined mark is filled paths, not stroke-and-clip', () => {
		const outlined = kodyMarkOutlinedSvgMarkup('#000000')
		assert.ok(outlined.includes(kodyMarkOutlinedRingPathD))
		assert.ok(outlined.includes(kodyMarkOutlinedLeftEyePathD))
		assert.ok(outlined.includes(kodyMarkOutlinedRightEyePathD))
		assert.ok(outlined.includes(kodyMarkOutlinedNosePathD))
		assert.ok(outlined.includes('fill-rule="evenodd"'))
		assert.ok(!outlined.includes('clipPath'))
		assert.ok(!outlined.includes('stroke='))
		assert.ok(!outlined.includes('stroke-width'))
	})

	it('tab favicon markup is transparent edge-to-edge with scheme swap', () => {
		const favicon = kodyFaviconSvgMarkup()
		assert.ok(favicon.includes(kodyMarkOutlinedOuterPathD))
		assert.ok(favicon.includes(kodyMarkOutlinedRingPathD))
		assert.ok(favicon.includes('fill="#ffffff"'))
		assert.match(favicon, /@media \(prefers-color-scheme: dark\)/)
		assert.ok(!favicon.includes('<rect'))
		assert.ok(!/\bplate\b/.test(favicon))
		const lightGroup = favicon.match(/<g class="light">([\s\S]*?)<\/g>/)?.[1]
		assert.ok(lightGroup)
		const whiteOuter = lightGroup!.indexOf(
			`fill="#ffffff" transform="${kodyMarkPathTransform}" d="${kodyMarkOutlinedOuterPathD}"`,
		)
		const blackRing = lightGroup!.indexOf(kodyMarkOutlinedRingPathD)
		assert.ok(whiteOuter >= 0)
		assert.ok(blackRing > whiteOuter)
	})

	it('published favicon.svg matches the markup helper and has no plate', () => {
		const published = readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8')
		assert.equal(published, kodyFaviconSvgMarkup())
		assert.ok(!published.includes('<rect'))
		assert.ok(!/\bplate\b/.test(published))
		assert.match(published, /@media \(prefers-color-scheme: dark\)/)
		assert.ok(published.includes('fill-rule="evenodd"'))
		const viewBox = published
			.match(/viewBox="([^"]+)"/)?.[1]
			?.split(' ')
			.map(Number)
		assert.ok(viewBox)
		assert.ok(Math.abs((viewBox![2] ?? 0) - (viewBox![3] ?? 0)) < 1e-5)
	})

	it('favicon.ico embeds light PNG frames at 16, 32, and 48', () => {
		const ico = readFileSync(path.join(publicDir, 'favicon.ico'))
		assert.equal(ico.readUInt16LE(0), 0)
		assert.equal(ico.readUInt16LE(2), 1)
		const count = ico.readUInt16LE(4)
		assert.equal(count, 3)
		const sizes = new Set<number>()
		for (let i = 0; i < count; i += 1) {
			const dir = 6 + i * 16
			const width = ico[dir] === 0 ? 256 : ico[dir]!
			sizes.add(width)
			const byteSize = ico.readUInt32LE(dir + 8)
			const offset = ico.readUInt32LE(dir + 12)
			assert.deepEqual(
				[...ico.subarray(offset, offset + 8)],
				[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
			)
			assert.ok(byteSize > 100)
		}
		assert.deepEqual(
			[...sizes].sort((a, b) => a - b),
			[16, 32, 48],
		)
	})

	it('ships light and dark tab PNG favicons plus brand download assets', () => {
		const required = [
			'favicon-16x16.png',
			'favicon-16x16-dark.png',
			'favicon-32x32.png',
			'favicon-32x32-dark.png',
			'apple-touch-icon.png',
			'android-chrome-192x192.png',
			'android-chrome-512x512.png',
			'images/brand/kody-logo-outlined.svg',
			'images/brand/kody-logo-outlined.png',
			'images/brand/kody-logo-white.svg',
			'images/brand/kody-logo-white.png',
			'images/brand/kody-mark-outlined.svg',
			'images/brand/kody-mark-outlined.png',
			'images/brand/kody-mark-white.svg',
			'images/brand/kody-mark-white.png',
			'images/brand/kody-mark-outlined-solid-light.png',
			'images/brand/kody-mark-solid-dark.png',
			'images/kody-mark.png',
			'images/kody-app-icon.png',
		]
		for (const file of required) {
			const bytes = readFileSync(path.join(publicDir, file))
			assert.ok(bytes.byteLength > 0, `${file} should be non-empty`)
		}
	})
})
