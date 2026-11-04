/* oxlint-disable no-undef -- blocking first-party browser script. */
addEventListener('pagehide', function () {
	document.documentElement.hidden = true
})

addEventListener('pageshow', function (event) {
	if (!event.persisted) return
	const destination = new URL(location.href)
	destination.hash = ''
	// A fresh GET must recheck auth, not replay the issuance POST.
	location.replace(destination.href)
})
