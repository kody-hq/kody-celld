/**
 * Set by FetchGateway on the final response of a redirect it followed; the
 * sandbox fetch wrapper strips them and exposes `response.url` and
 * `response.redirected` instead.
 */
export const LANDING_URL_HEADER = 'x-kody-gateway-url'
export const LANDING_REDIRECTED_HEADER = 'x-kody-gateway-redirected'
