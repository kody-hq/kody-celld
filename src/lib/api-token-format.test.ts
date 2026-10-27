import assert from 'node:assert/strict'
import test from 'node:test'
import {
	apiTokenPrefix,
	formatApiToken,
	generateApiTokenId,
	generateApiTokenSecret,
	parseApiToken,
	redactApiTokens,
	redactKodyCredentials,
} from './api-token-format.ts'
import { bytesToBase64Url } from './base64.ts'

test('API token generation, formatting, and parsing round-trip', () => {
	const tokenId = generateApiTokenId()
	const secret = generateApiTokenSecret()
	const token = formatApiToken({ tokenId, secret })
	assert.match(tokenId, /^[a-z0-9]{20}$/)
	assert.match(secret, /^[A-Za-z0-9_-]{43}$/)
	assert.equal(token, `${apiTokenPrefix}${tokenId}_${secret}`)
	assert.deepEqual(parseApiToken(token), { tokenId, secret })
	assert.deepEqual(parseApiToken(` ${token} `), { tokenId, secret })
})

test('API token parsing rejects malformed values', () => {
	for (const value of ['', 'not-a-token', 'kody_at_bad', 'KODY_AT_invalid']) {
		assert.equal(parseApiToken(value), null)
	}
})

test('redaction removes generated API tokens and bootstrap codes from text', () => {
	const apiToken = formatApiToken({
		tokenId: generateApiTokenId(),
		secret: generateApiTokenSecret(),
	})
	const idBytes = crypto.getRandomValues(new Uint8Array(16))
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
	const id = Array.from(idBytes, (byte) => alphabet[byte % alphabet.length]).join('')
	const bootstrap = `kody_bc_${id}_${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)))}`
	assert.equal(redactApiTokens(apiToken), `${apiTokenPrefix}[redacted]`)
	assert.equal(
		redactKodyCredentials(`api ${apiToken} bootstrap ${bootstrap}`),
		`api ${apiTokenPrefix}[redacted] bootstrap kody_bc_[redacted]`,
	)
})
