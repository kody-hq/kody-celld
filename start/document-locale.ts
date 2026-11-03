export type DocumentTimestampLocale = Pick<Intl.ResolvedDateTimeFormatOptions, 'locale' | 'timeZone'>

export function getDocumentTimestampLocale(): DocumentTimestampLocale {
	const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions()
	return { locale, timeZone }
}

export function formatDocumentTimestamp(value: string, { locale, timeZone }: DocumentTimestampLocale) {
	const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { timeZone })
}
