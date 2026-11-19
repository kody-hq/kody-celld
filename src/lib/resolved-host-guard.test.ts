import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KodyError } from './errors.ts'
import { outboundFetch, assertOutboundUrlAllowed } from './resolved-host-guard.ts'
import {
	egressOrigin,
	egressTargetHeader,
	egressErrorHeader,
	egressMessageHeader,
	egressRefusedStatus,
} from './egress-protocol.ts'

const policy = { allowPrivateHosts: ['nas.example'] }

describe('outbound transport', () => {
	it('sends the original method, headers and body to the forwarder without following redirects', async () => {
		const response = new Response('redirect', { status: 302, headers: { location: 'https://next.example/' } })
		const base = (async (input, init) => {
			assert.equal(input, egressOrigin + '/fetch')
			assert.equal(init?.method, 'POST')
			assert.equal(init?.body, 'payload')
			assert.equal(init?.redirect, 'manual')
			const headers = new Headers(init?.headers)
			assert.equal(headers.get(egressTargetHeader), 'https://public.example/path')
			assert.equal(headers.get('authorization'), 'Bearer fixture')
			return response
		}) as typeof fetch
		assert.equal(
			await outboundFetch(
				'https://public.example/path',
				{
					method: 'POST',
					headers: { authorization: 'Bearer fixture' },
					body: 'payload',
				},
				policy,
				{ fetch: base },
			),
			response,
		)
	})

	it('refuses private literals before contacting the forwarder', async () => {
		await assert.rejects(
			outboundFetch('http://127.0.0.1/', {}, policy, {
				fetch: async () => {
					throw new Error('must not be called')
				},
			}),
			/loopback\/private host/,
		)
	})

	it('maps forwarder refusals to the caller error and keeps upstream statuses', async () => {
		const refuse = (message: string) => new KodyError('custom_refused', message, { status: 403 })
		await assert.rejects(
			outboundFetch('https://public.example/', {}, policy, {
				fetch: async () =>
					Response.json(
						{ message: 'private address' },
						{
							status: egressRefusedStatus,
							headers: { [egressErrorHeader]: 'refused', [egressMessageHeader]: encodeURIComponent('private address') },
						},
					),
				refuse,
			}),
			{ name: 'KodyError:custom_refused:403' },
		)
		const upstream = new Response('upstream', { status: egressRefusedStatus })
		assert.equal(await outboundFetch('https://public.example/', {}, policy, { fetch: async () => upstream }), upstream)
	})

	it('maps HEAD errors from headers without requiring a response body', async () => {
		for (const [kind, status, code] of [
			['refused', egressRefusedStatus, 'custom_refused'],
			['unavailable', 502, 'egress_unavailable'],
		] as const) {
			const message = 'Outbound policy: "höst.example" could not be reached.'
			await assert.rejects(
				outboundFetch('https://public.example/', { method: 'HEAD' }, policy, {
					fetch: async (_input, init) => {
						assert.equal(init?.method, 'HEAD')
						return new Response(null, {
							status,
							headers: {
								[egressErrorHeader]: kind,
								[egressMessageHeader]: encodeURIComponent(message),
							},
						})
					},
					refuse: (reason) => new KodyError('custom_refused', reason, { status: 403 }),
				}),
				{ name: `KodyError:${code}:${status === egressRefusedStatus ? 403 : 502}`, message },
			)
		}
	})

	it('keeps structured errors when the error message header is missing or malformed', async () => {
		for (const encoded of [null, '%invalid']) {
			const headers = new Headers({ [egressErrorHeader]: 'unavailable' })
			if (encoded !== null) headers.set(egressMessageHeader, encoded)
			await assert.rejects(
				outboundFetch('https://public.example/', { method: 'HEAD' }, policy, {
					fetch: async () => new Response(null, { status: 502, headers }),
				}),
				{ name: 'KodyError:egress_unavailable:502' },
			)
		}
	})

	it('fails closed when the forwarder cannot answer and preserves cancellation', async () => {
		const unavailable = async () => {
			throw new TypeError('connection refused')
		}
		await assert.rejects(
			outboundFetch('https://public.example/', {}, policy, { fetch: unavailable }),
			/egress_unavailable/,
		)
		const controller = new AbortController()
		controller.abort()
		await assert.rejects(
			outboundFetch('https://public.example/', { signal: controller.signal }, policy, {
				fetch: async () => {
					throw controller.signal.reason
				},
			}),
			{ name: 'AbortError' },
		)
	})

	it('uses the same forwarder for browser resolution and refuses an unsuccessful response', async () => {
		await assertOutboundUrlAllowed(new URL('https://public.example/'), policy, {
			fetch: async (input, init) => {
				assert.equal(input, egressOrigin + '/resolve')
				assert.equal(new Headers(init?.headers).get(egressTargetHeader), 'https://public.example/')
				return new Response(null, { status: 204 })
			},
		})
		await assert.rejects(
			assertOutboundUrlAllowed(new URL('https://public.example/'), policy, {
				fetch: async () => new Response('', { status: 502 }),
			}),
			/egress_unavailable/,
		)
	})
})
