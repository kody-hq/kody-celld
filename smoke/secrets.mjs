// Secrets smoke: save a secret, prove the gateway denies unapproved hosts,
// approve the host, prove injection happened without the value ever being
// visible to sandbox code, MCP results, or run history.
import { randomBytes } from 'node:crypto'
import { admin, adminToken, assert, baseUrl, log, sha256, startEchoServer } from './lib.mjs'

export async function smokeSecrets({ mcp, user }) {
	const echo = await startEchoServer()
	// A throwaway random value generated for this run only. It is never a real credential.
	const secretValue = `smoke-${randomBytes(16).toString('hex')}`
	const expectedHeaderHash = sha256(`Bearer ${secretValue}`)
	try {
		const saved = await mcp.call('secretSave', { name: 'smoke-token', value: secretValue, description: 'smoke only' })
		assert(saved.placeholder === '{{secret:smoke-token}}', 'secretSave should return the placeholder', saved)
		assert(JSON.stringify(saved).includes(secretValue) === false, 'secretSave must not echo the value')
		log('secretSave', saved.placeholder)

		const listed = await mcp.call('secretList')
		assert(
			listed.secrets.some((s) => s.name === 'smoke-token'),
			'secretList missing the secret',
			listed,
		)
		assert(!JSON.stringify(listed).includes(secretValue), 'secretList must not include values')

		// Make sure no stale approval exists from a previous run of this smoke.
		await admin.revokeHost(user.id, echo.host)

		const probe = (params) => mcp.callDirect('packageRun', { name: '@kody-smoke/http-probe', params })
		const denied = await probe({ url: `${echo.url}/denied`, secretName: 'smoke-token' })
		assert(denied.ok, 'probe run itself should succeed (fetch returns a 403 Response)', denied)
		assert(
			denied.result.status === 403 && denied.result.body.error === 'secret_host_not_approved',
			'unapproved host must be denied',
			denied.result,
		)
		assert(echo.seen.length === 0, 'denied request must never reach the network', echo.seen)
		assert(
			denied.gateway.some((event) => event.outcome === 'denied' && event.host === echo.host),
			'gateway should record the denial',
			denied.gateway,
		)
		log('unapproved host denied before network', { status: denied.result.status, reason: denied.result.body.error })

		// Sandbox code cannot approve hosts for itself.
		const selfApprove = await mcp.execute(
			`export default async function main() {
  const res = await fetch(${JSON.stringify(`${baseUrl}/admin/users/${user.id}/secret-hosts`)}, {
    method: 'POST', headers: { authorization: ${JSON.stringify(`Bearer ${adminToken}`)}, 'content-type': 'application/json' }, body: JSON.stringify({ host: '127.0.0.1' }) })
  return { status: res.status, body: await res.json() }
}`,
		)
		assert(
			selfApprove.ok && selfApprove.result.status === 403 && selfApprove.result.body.error === 'admin_surface_blocked',
			'sandbox must not reach /admin',
			selfApprove,
		)
		log('sandbox blocked from /admin', selfApprove.result.body.error)

		const unknown = await probe({ url: `${echo.url}/unknown`, secretName: 'does-not-exist' })
		assert(
			unknown.result.status === 403 || unknown.result.status === 404,
			'unknown secret should fail closed',
			unknown.result,
		)
		log('unknown secret fails closed', unknown.result.body.error)

		const approved = await admin.approveHost(user.id, echo.host)
		assert(approved.status === 201, 'admin host approval failed', approved)
		const hosts = await admin.listHosts(user.id)
		assert(
			hosts.json.hosts.some((h) => h.host === echo.host),
			'approved host missing from list',
			hosts.json,
		)
		log('admin approved host', echo.host)

		const injected = await probe({ url: `${echo.url}/ok`, secretName: 'smoke-token' })
		assert(injected.ok && injected.result.status === 200, 'approved request should reach the echo server', injected)
		const seen = echo.seen.at(-1)
		assert(seen.authorizationSha256 === expectedHeaderHash, 'header placeholder was not replaced with the secret', seen)
		assert(
			!seen.headerHadPlaceholder && !seen.bodyHadPlaceholder,
			'placeholders must be gone from header and body',
			seen,
		)
		assert(
			injected.gateway.some((event) => event.outcome === 'injected' && event.secrets.includes('smoke-token')),
			'gateway should record injection',
			injected.gateway,
		)
		const serialized = JSON.stringify(injected)
		assert(!serialized.includes(secretValue), 'MCP result must never contain the secret value')
		log('approved host: placeholder injected at the boundary', {
			authorizationLength: seen.authorizationLength,
			gateway: injected.gateway.map((e) => e.outcome),
		})

		const multipart = await mcp.run(
			`export default async function main({ url }) {
  const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
  const form = new FormData()
  form.append('filename', new Blob([image], { type: 'image/png' }), 'screenshot.png')
  form.append('note', 'partial marker {{secret: is not a placeholder')
  const request = new Request(url + '/multipart', {
    method: 'POST', headers: { authorization: 'Bearer {{secret:smoke-token}}' }, body: form,
  })
  const digest = await crypto.subtle.digest('SHA-256', await request.clone().arrayBuffer())
  const expectedBodyHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  const response = await fetch(request)
  return { status: response.status, expectedBodyHash, received: await response.json() }
}`,
			{ url: echo.url },
		)
		assert(multipart.status === 200, 'multipart upload should reach the echo server', multipart)
		assert(
			multipart.received.bodySha256 === multipart.expectedBodyHash,
			'multipart image bytes changed during header secret injection',
			multipart,
		)
		assert(
			multipart.received.authorizationSha256 === expectedHeaderHash,
			'multipart authorization placeholder was not replaced',
			multipart.received,
		)
		log('multipart image bytes preserved during header secret injection')

		const bodySecret = await mcp.run(
			`export default async function main({ url }) {
  const response = await fetch(url + '/body-secret', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: '{{secret:smoke-token}}' }),
  })
  return await response.json()
}`,
			{ url: echo.url },
		)
		assert(
			bodySecret.bodySha256 === sha256(JSON.stringify({ token: secretValue })),
			'JSON body placeholder must still be replaced',
			bodySecret,
		)
		log('JSON body placeholder injected')

		const runRecord = await mcp.call('runGet', { id: injected.runId })
		assert(!JSON.stringify(runRecord).includes(secretValue), 'run history must never contain the secret value')

		// Placeholders in the URL path/query are supported too (Kody parity).
		const inUrl = await mcp.run(
			`export default async function main({ url }) {
  const res = await fetch(url + '/q?token={{secret:smoke-token}}')
  return await res.json()
}`,
			{ url: echo.url },
		)
		assert(
			inUrl.url === `/q?token=${encodeURIComponent(secretValue)}` || inUrl.url === `/q?token=${secretValue}`,
			'URL placeholder should be replaced',
			inUrl.url?.replace(secretValue, '<value>'),
		)
		log('URL placeholder replaced')

		// Basic-auth placeholder.
		await mcp.call('secretSave', { name: 'smoke-user', value: 'alice' })
		await mcp.call('secretSave', { name: 'smoke-pass', value: secretValue })
		const basic = await mcp.run(
			`export default async function main({ url }) {
  const res = await fetch(url + '/basic', { headers: { authorization: 'Basic {{secret-basic:username=smoke-user,password=smoke-pass}}' } })
  return await res.json()
}`,
			{ url: echo.url },
		)
		assert(
			basic.authorizationSha256 === sha256(`Basic ${Buffer.from(`alice:${secretValue}`).toString('base64')}`),
			'basic-auth placeholder mismatch',
			basic,
		)
		log('basic-auth placeholder injected')

		// Redirects: the gateway follows them itself and re-checks every hop.
		const { placeholder } = saved
		const sameHost = await mcp.run(
			`export default async function main({ url, placeholder }) {
  const res = await fetch(url + '/redirect?status=307&to=/landed-same', {
    method: 'POST', headers: { authorization: 'Bearer ' + placeholder }, body: 'no secret here',
  })
  return { status: res.status, redirected: res.redirected, url: res.url, received: await res.json() }
}`,
			{ url: echo.url, placeholder },
		)
		assert(
			sameHost.status === 200 && sameHost.redirected === true && sameHost.url === `${echo.url}/landed-same`,
			'followed redirect reports its final url and redirected: true',
			sameHost,
		)
		assert(
			sameHost.received.method === 'POST' && sameHost.received.authorizationSha256 === expectedHeaderHash,
			'a 307 to the same approved origin is re-checked and re-injected',
			sameHost.received,
		)
		log('307 to the same approved host re-injected after a fresh check')

		const beforeCross = echo.seen.length
		const crossHost = await mcp.execute(
			`export default async function main({ url, placeholder }) {
  const res = await fetch(url + '/redirect?status=307&alt=1&to=/landed-other', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + placeholder, 'x-smoke-key': placeholder, 'content-type': 'text/plain' },
    body: 'no secret here',
  })
  return { status: res.status, redirected: res.redirected, url: res.url, received: await res.json() }
}`,
			{ url: echo.url, placeholder },
		)
		assert(crossHost.ok, 'cross-host redirect run should succeed', crossHost)
		const crossSeen = echo.seen.slice(beforeCross)
		const landedOther = crossSeen.filter((r) => r.url === '/landed-other')
		assert(
			landedOther.length === 1 && landedOther[0].authorizationSha256 === null && landedOther[0].keySha256 === null,
			'an approved host redirecting to an unapproved one must not pass the secret along',
			crossSeen,
		)
		assert(
			crossHost.result.redirected === true && crossHost.result.url.endsWith('/landed-other'),
			'cross-host redirect reports where it landed',
			crossHost.result,
		)
		assert(
			crossHost.gateway.some(
				(event) =>
					event.redirect === 1 &&
					event.outcome === 'forwarded' &&
					event.reason?.startsWith('placeholder_headers_dropped:'),
			),
			'gateway records the redirect hop and the dropped headers',
			crossHost.gateway,
		)
		log('307 to an unapproved host: placeholder headers dropped, hop recorded', {
			hops: crossHost.gateway.map((e) => [e.redirect ?? 0, e.outcome]),
		})

		const bodyCross = await mcp.execute(
			`export default async function main({ url, placeholder }) {
  const res = await fetch(url + '/redirect?status=307&alt=1&to=/landed-body', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: placeholder }),
  })
  return { status: res.status, redirected: res.redirected, body: await res.json() }
}`,
			{ url: echo.url, placeholder },
		)
		assert(
			bodyCross.ok &&
				bodyCross.result.status === 403 &&
				['secret_host_not_approved', 'secret_requires_https'].includes(bodyCross.result.body.error) &&
				bodyCross.result.redirected === true,
			'a 307 that would replay a secret body to an unapproved host is denied',
			bodyCross,
		)
		assert(!echo.seen.some((r) => r.url === '/landed-body'), 'denied redirect hop never reaches the network', echo.seen)
		assert(
			bodyCross.gateway.some((event) => event.redirect === 1 && event.outcome === 'denied'),
			'gateway records the denied redirect hop',
			bodyCross.gateway,
		)
		log('307 replaying a secret body to an unapproved host denied', bodyCross.result.body.error)

		// A value with a quote, backslash and inner newline: JSON bodies get it escaped,
		// headers refuse it with a clean denial.
		const trickyValue = `${secretValue}"\\\n-end`
		const tricky = await mcp.call('secretSave', { name: 'smoke-tricky', value: trickyValue, description: 'smoke only' })
		const trickyJson = await mcp.run(
			`export default async function main({ url, placeholder }) {
  const res = await fetch(url + '/json-escape', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: placeholder }),
  })
  return await res.json()
}`,
			{ url: echo.url, placeholder: tricky.placeholder },
		)
		assert(
			trickyJson.bodySha256 === sha256(JSON.stringify({ token: trickyValue })),
			'JSON body replacement must be JSON-escaped',
			trickyJson,
		)
		const beforeHeader = echo.seen.length
		const trickyHeader = await mcp.execute(
			`export default async function main({ url, placeholder }) {
  const res = await fetch(url + '/bad-header', { headers: { 'x-smoke-key': placeholder } })
  return { status: res.status, body: await res.json() }
}`,
			{ url: echo.url, placeholder: tricky.placeholder },
		)
		assert(
			trickyHeader.ok &&
				trickyHeader.result.status === 400 &&
				trickyHeader.result.body.error === 'secret_invalid_header_value' &&
				echo.seen.length === beforeHeader,
			'a header value with a newline is refused cleanly before the network',
			trickyHeader,
		)
		assert(!JSON.stringify(trickyHeader).includes(secretValue), 'header refusal must not echo the value')
		await mcp.call('secretDelete', { name: 'smoke-tricky' })
		log('JSON body values escaped; newline header value refused cleanly')

		// Plain HTTP to a non-loopback host must be refused even if approved.
		await admin.approveHost(user.id, 'example.com')
		const insecure = await mcp.run(
			`export default async function main() {
  const res = await fetch('http://example.com/', { headers: { authorization: 'Bearer {{secret:smoke-token}}' } })
  return { status: res.status, body: await res.json() }
}`,
		)
		assert(
			insecure.status === 403 && insecure.body.error === 'secret_requires_https',
			'plain-http secret request must be refused',
			insecure,
		)
		await admin.revokeHost(user.id, 'example.com')
		log('plain-http secret request refused', insecure.body.error)

		// Requests without placeholders pass through untouched.
		const plain = await mcp.run(
			`export default async function main({ url }) { const res = await fetch(url + '/plain'); return await res.json() }`,
			{ url: echo.url },
		)
		assert(
			plain.authorizationLength === 0 && plain.url === '/plain',
			'placeholder-free request should pass through',
			plain,
		)
		log('placeholder-free request forwarded')

		const deleted = await mcp.call('secretDelete', { name: 'smoke-token' })
		assert(deleted.deleted === true, 'secretDelete failed', deleted)
		const afterDelete = await probe({ url: `${echo.url}/gone`, secretName: 'smoke-token' })
		assert(afterDelete.result.status !== 200, 'deleted secret should no longer inject', afterDelete.result)
		log('secretDelete + re-request fails closed', afterDelete.result.body.error)
	} finally {
		await echo.close()
	}
}
