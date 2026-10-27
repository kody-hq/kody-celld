import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	applyIndividualClaSigningComment,
	applyIndividualClaSigningComments,
	checkClaIdentities,
	formatClaFailure,
	individualClaSigningPhrase,
	isIndividualClaSigningComment,
	parseClaSignersFile,
	serializeClaSignersFile,
	type ClaSignersFile,
} from './check-cla.ts'

function signersFile(overrides: Partial<ClaSignersFile> = {}): ClaSignersFile {
	return {
		version: 1,
		document: 'docs/legal/individual-cla.md',
		allowlist: {
			github: ['kentcdodds', 'kody-bot', 'cursoragent'],
			email: ['me@kentcdodds.com', 'me+github@kentcdodds.com'],
		},
		signers: [],
		...overrides,
	}
}

describe('check-cla', () => {
	it('allowlists the Licensor, bots, signed humans, and rejects everyone else', () => {
		const file = signersFile({
			signers: [{ github: 'ExampleSigner', signedAt: '2026-08-16', cla: 'individual' }],
		})

		const identity = (githubLogin: string | null, name: string, email: string | null = null) => ({
			githubLogin,
			name,
			email,
		})

		assert.deepEqual(
			checkClaIdentities(
				[
					identity('kentcdodds', 'Kent'),
					identity('kody-bot', 'Kody'),
					identity('cursoragent', 'Cursor Agent', 'cursoragent@cursor.com'),
					identity('cursor[bot]', 'cursor[bot]'),
					identity('app/imgbot', 'ImgBot'),
					identity(null, 'Kent C. Dodds', 'me+github@kentcdodds.com'),
					identity('examplesigner', 'Example Signer', 'signer@example.com'),
				],
				file,
			),
			{ ok: true },
		)

		const failing = checkClaIdentities(
			[
				identity('kentcdodds', 'Kent'),
				identity('mirkosalvato1-ctrl', 'Mirko', 'mirkosalvato1@gmail.com'),
				identity(null, 'Someone', 'someone@example.com'),
			],
			file,
		)
		assert.equal(failing.ok, false)
		if (failing.ok) {
			throw new Error('expected missing signatures')
		}
		assert.deepEqual(
			failing.missing.map((entry) => entry.reason),
			[
				'@mirkosalvato1-ctrl has not signed the CLA',
				'someone@example.com has no GitHub login and is not a Licensor email',
			],
		)
		assert.match(formatClaFailure(failing), new RegExp(individualClaSigningPhrase))
		assert.match(formatClaFailure(failing), /That signing comment on the pull request satisfies this check\./)
		assert.match(formatClaFailure(failing), /The signer is recorded on main after the pull request merges\./)
	})

	it('records the signing comment once and ignores everything else', () => {
		const empty = signersFile()
		assert.equal(isIndividualClaSigningComment(`  ${individualClaSigningPhrase}  `), true)
		assert.equal(isIndividualClaSigningComment('I agree'), false)

		const ignored = applyIndividualClaSigningComment({
			file: empty,
			github: 'ExampleSigner',
			signedAt: '2026-08-16',
			comment: 'I agree',
		})
		assert.deepEqual(ignored, {
			file: empty,
			status: 'ignored',
			reason: 'not_signing_comment',
		})

		const recorded = applyIndividualClaSigningComment({
			file: empty,
			github: 'ExampleSigner',
			signedAt: '2026-08-16',
			comment: individualClaSigningPhrase,
		})
		assert.equal(recorded.status, 'recorded')
		if (recorded.status !== 'recorded') {
			throw new Error('expected a new signature')
		}
		assert.equal(recorded.github, 'ExampleSigner')
		assert.deepEqual(recorded.file.signers, [
			{
				github: 'ExampleSigner',
				signedAt: '2026-08-16',
				cla: 'individual',
			},
		])
		assert.deepEqual(
			checkClaIdentities([{ githubLogin: 'examplesigner', name: 'Example', email: null }], recorded.file),
			{ ok: true },
		)

		const again = applyIndividualClaSigningComment({
			file: recorded.file,
			github: 'examplesigner',
			signedAt: '2026-08-17',
			comment: individualClaSigningPhrase,
		})
		assert.deepEqual(again, {
			file: recorded.file,
			status: 'already_signed',
			github: 'examplesigner',
		})
		const serialized = serializeClaSignersFile(recorded.file)
		assert.match(serialized, /"ExampleSigner"/)
		assert.equal(serialized.endsWith('\n'), true)
		assert.deepEqual(parseClaSignersFile(serialized), recorded.file)
		assert.throws(() => parseClaSignersFile('{"version":2}'), /version 1/)
		assert.deepEqual(
			applyIndividualClaSigningComment({
				file: empty,
				github: '   ',
				signedAt: '2026-08-16',
				comment: individualClaSigningPhrase,
			}),
			{ file: empty, status: 'ignored', reason: 'missing_login' },
		)
	})

	it('accepts the PR author signing in a comment', () => {
		const author = {
			githubLogin: 'example-signer',
			name: 'Example Signer',
			email: null,
		}
		const comments = [
			{
				login: 'example-signer',
				createdAt: '2026-08-16T10:30:00Z',
				body: individualClaSigningPhrase,
			},
		]

		const signed = applyIndividualClaSigningComments(signersFile(), comments)
		assert.deepEqual(signed.recorded, ['example-signer'])
		assert.deepEqual(checkClaIdentities([author], signed.file), { ok: true })
	})

	it('rejects a signing comment from another login or with extra text', () => {
		const author = {
			githubLogin: 'example-signer',
			name: 'Example Signer',
			email: null,
		}
		const otherLogin = applyIndividualClaSigningComments(signersFile(), [
			{
				login: 'different-signer',
				createdAt: '2026-08-16T10:30:00Z',
				body: individualClaSigningPhrase,
			},
		])
		const extraText = applyIndividualClaSigningComments(signersFile(), [
			{
				login: 'example-signer',
				createdAt: '2026-08-16T10:30:00Z',
				body: `${individualClaSigningPhrase} thanks`,
			},
		])

		assert.equal(checkClaIdentities([author], otherLogin.file).ok, false)
		assert.equal(checkClaIdentities([author], extraText.file).ok, false)
	})

	it('records each new signer only once across multiple comments', () => {
		const initial = signersFile({
			signers: [{ github: 'AlreadySigned', signedAt: '2026-08-01', cla: 'individual' }],
		})
		const result = applyIndividualClaSigningComments(initial, [
			{
				login: 'FirstSigner',
				createdAt: '2026-08-16T10:30:00Z',
				body: individualClaSigningPhrase,
			},
			{
				login: 'SecondSigner',
				createdAt: '2026-08-17T11:45:00Z',
				body: individualClaSigningPhrase,
			},
			{
				login: 'firstsigner',
				createdAt: '2026-08-18T12:00:00Z',
				body: individualClaSigningPhrase,
			},
			{
				login: 'alreadysigned',
				createdAt: '2026-08-19T12:00:00Z',
				body: individualClaSigningPhrase,
			},
		])

		assert.deepEqual(result.recorded, ['FirstSigner', 'SecondSigner'])
		assert.deepEqual(result.file.signers, [
			...initial.signers,
			{ github: 'FirstSigner', signedAt: '2026-08-16', cla: 'individual' },
			{ github: 'SecondSigner', signedAt: '2026-08-17', cla: 'individual' },
		])

		const alreadySigned = applyIndividualClaSigningComments(result.file, [
			{
				login: 'firstsigner',
				createdAt: '2026-08-20T12:00:00Z',
				body: individualClaSigningPhrase,
			},
		])
		assert.deepEqual(alreadySigned, { file: result.file, recorded: [] })
	})
})
