/**
 * Apaleo endpoints (verified against the official documentation, Phase 4):
 * - Token: OAuth 2.0 client credentials grant at identity.apaleo.com/connect/token
 *   (HTTP Basic with client id/secret, form body grant_type=client_credentials)
 * - Reservation: GET /booking/v1/reservations/{id} – scope `reservations.read`
 */
export const APALEO_IDENTITY_URL = "https://identity.apaleo.com/connect/token";
export const APALEO_API_URL = "https://api.apaleo.com";

/** Per-request time limit. */
export const APALEO_TIMEOUT_MS = 8_000;
/** Refresh tokens this long before they expire. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Delay before the single retry of an idempotent request. */
export const RETRY_DELAY_MS = 300;
