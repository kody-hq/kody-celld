/* oxlint-disable no-undef -- blocking first-party browser script. */
addEventListener('pagehide', function () {
	document.documentElement.hidden = true
	document.querySelectorAll('[data-sensitive-value]').forEach(function (field) {
		field.value = ''
	})
})

addEventListener('pageshow', function (event) {
	if (!event.persisted) return
	const destination = new URL(location.href)
	destination.hash = ''
	// Recheck auth without replaying a credential POST or restoring private fields.
	location.replace(destination.href)
})
