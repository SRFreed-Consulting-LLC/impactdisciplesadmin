export type PaypalEnvironment = "sandbox" | "live";

// Public PayPal app client ids - not secrets (PayPal ships these to every
// browser via the JS SDK), hence hardcoded rather than fetched from
// Firestore at call time. These are the LIBRARY/reader PayPal app's ids.
// The WEB storefront is a DIFFERENT PayPal app whose client id lives in
// Firestore's `config` collection - see paypal.functions.ts and
// store-refund.functions.ts, both of which pass their own credentials to
// getAccessTokenWithCredentials() below rather than using these.
// Ported verbatim from impact-discipleship-library-manager-new's
// functions/src/paypal.ts - same PayPal app, same ids. If either PayPal
// app's client id ever rotates, update it here too, not just in that repo
// (soon to be decommissioned) or the reader/store apps' own config.
// Single opaque tokens (PayPal client ids) - wrapping would change the
// literal, not just its formatting, so these two are exempted from max-len.
const CLIENT_ID: Record<PaypalEnvironment, string> = {
  // eslint-disable-next-line max-len
  sandbox: "AV50zoOW01VnMjSFor9aKf22aWVCz_p_3jsJIx0Co9j5GnaZenMZ3UXPRyxxOHPNAdRR97dHAKvSdiXS",
  // eslint-disable-next-line max-len
  live: "AVHO6L2X_NF3_tqmBi1WFiVcLLuesCf1i--wCLj8UreQ04QEzsymXE9Jcyxb9HL4tZ_byMLhB2cDAEd1",
};

/** PayPal's REST hosts, per environment. Exported because the web
 *  storefront's order create/capture calls (paypal.functions.ts) build their
 *  own URLs against the same host this module authenticates against - having
 *  two copies of this map is how a live token ends up pointed at the sandbox
 *  host. */
export const PAYPAL_API_HOST: Record<PaypalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

/**
 * The PayPal environment payments MUST be verified against, derived from the
 * deployed project - NEVER from client input. A caller who could choose this
 * would point a live grant at a self-minted SANDBOX capture (fake money) and
 * still receive real books/licenses. Only the production project
 * (impactdisciples-a82a8) verifies against live PayPal; every other project
 * (dev, emulator) is sandbox.
 * @return {PaypalEnvironment} The server-authoritative environment.
 */
export function resolvePaypalEnvironment(): PaypalEnvironment {
  return process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
    "live" :
    "sandbox";
}

/**
 * Resolves after `ms` milliseconds.
 * @param {number} ms Delay in milliseconds.
 * @return {Promise<void>} Resolves after the delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() with a short retry/backoff for transient failures. Only retries
 * network-level failures and 429/5xx - a 4xx (bad request, auth failure,
 * etc.) won't succeed on retry, so those return immediately. Capped at 2
 * retries with a short backoff (up to ~1.2s of extra latency).
 * @param {string} url Request URL.
 * @param {RequestInit} init Fetch options.
 * @param {number} maxRetries Maximum retry attempts (default 2).
 * @return {Promise<Response>} The fetch response.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        await delay(300 * 3 ** attempt);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await delay(300 * 3 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}

// Per-warm-instance access-token cache. Keyed by environment AND client id,
// never by client id alone: the library app and the web storefront app are
// two DIFFERENT PayPal apps that both authenticate through this module, and
// handing one app's bearer token to the other's API calls fails in ways that
// look like a credential-provisioning bug. The secret is deliberately not
// part of the key - it is never used for lookup, only for the exchange.
const tokenCache = new Map<string, {value: string; expiresAt: number}>();

/**
 * OAuth2 client-credentials token exchange for an EXPLICIT PayPal app - see
 * https://developer.paypal.com/api/rest/authentication/. Callers pass their
 * own client id/secret because this codebase talks to two separate PayPal
 * apps (the library/reader app and the web storefront app); this function is
 * deliberately credential-agnostic so neither can silently borrow the
 * other's identity. Tokens are cached per warm instance until shortly before
 * they expire.
 * @param {PaypalEnvironment} env Which PayPal environment to hit.
 * @param {string} clientId The app's public client id.
 * @param {string} clientSecret The app's client secret.
 * @return {Promise<string>} A bearer access token.
 */
export async function getAccessTokenWithCredentials(
  env: PaypalEnvironment,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const cacheKey = `${env}|${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const host = PAYPAL_API_HOST[env];
  const response = await fetchWithRetry(`${host}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    // A 401 here is nearly always a credential/environment mismatch: three
    // things have to agree and each is provisioned separately - the API host
    // (from GCLOUD_PROJECT), the client id, and the client secret. Getting a
    // live id with a sandbox secret (or the reverse) 401s here and takes the
    // whole storefront down, so name all three in the error rather than
    // leaving a bare "failed". Only the client id's last 6 characters are
    // logged - enough to tell two apps apart, not enough to be a credential -
    // and the secret is never logged.
    throw new Error(
      `Failed to obtain a PayPal access token (HTTP ${response.status}) ` +
      `from ${host} using clientId ending ...${clientId.slice(-6)} ` +
      `and a client secret (${clientSecret ? "set" : "NOT SET"}). ` +
      "A 401 means the id, the secret and the host do not all belong to the " +
      "same PayPal app - check that this project's secret and client id are " +
      `both the ${env.toUpperCase()} credentials.`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };
  // 60s of slack so a token never expires mid-request on the far side.
  const ttlSeconds = Math.max((data.expires_in ?? 600) - 60, 0);
  tokenCache.set(cacheKey, {
    value: data.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return data.access_token;
}

/**
 * OAuth2 token exchange for the LIBRARY/reader PayPal app specifically - a
 * thin wrapper over getAccessTokenWithCredentials that supplies that app's
 * hardcoded public client id.
 * @param {PaypalEnvironment} env Which PayPal environment to hit.
 * @param {string} clientSecret The library app's client secret.
 * @return {Promise<string>} A bearer access token.
 */
export async function getAccessToken(
  env: PaypalEnvironment,
  clientSecret: string
): Promise<string> {
  return getAccessTokenWithCredentials(env, CLIENT_ID[env], clientSecret);
}

/**
 * Resolves a PayPal order id to the capture id needed to issue a refund -
 * see https://developer.paypal.com/docs/api/orders/v2/#orders_get.
 * @param {PaypalEnvironment} env Which PayPal environment to hit.
 * @param {string} accessToken Bearer token from getAccessToken.
 * @param {string} orderId The PayPal order id.
 * @return {Promise<string>} The order's capture id.
 */
export async function getCaptureId(
  env: PaypalEnvironment,
  accessToken: string,
  orderId: string
): Promise<string> {
  const response = await fetchWithRetry(
    `${PAYPAL_API_HOST[env]}/v2/checkout/orders/` +
      `${encodeURIComponent(orderId)}`,
    {headers: {Authorization: `Bearer ${accessToken}`}}
  );
  if (!response.ok) {
    throw new Error(
      `PayPal order lookup failed (${response.status}): ` +
        `${await response.text()}`
    );
  }
  const data = (await response.json()) as {
    purchase_units?: { payments?: { captures?: { id: string }[] } }[];
  };
  const captureId = data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) {
    throw new Error(`PayPal order ${orderId} has no capture on it.`);
  }
  return captureId;
}

/** Result of inspecting a PayPal order for verifyAndGrantReaderStorePurchase -
 *  server-side proof a claimed purchase was actually paid for, before
 *  granting anything. */
export interface OrderCapture {
  captureId: string;
  /** PayPal's own capture status - only 'COMPLETED' represents money
   *  actually collected; a caller must check this, not just that a
   *  captureId exists. */
  status: string;
  /** Total captured amount, as PayPal reports it (its own string, parsed
   *  to a number) - compare against the claimed cart total with a small
   *  tolerance for rounding, never for equality. */
  amount: number;
  currencyCode: string;
}

/**
 * Looks up a PayPal order and returns its capture's status/amount - needed
 * to actually verify a claimed purchase happened rather than just locating
 * a capture id to refund later. Throws if the order has no capture at all.
 * @param {PaypalEnvironment} env Which PayPal environment to hit.
 * @param {string} accessToken Bearer token from getAccessToken.
 * @param {string} orderId The PayPal order id.
 * @return {Promise<OrderCapture>} The order's capture status/amount.
 */
export async function getOrderCapture(
  env: PaypalEnvironment,
  accessToken: string,
  orderId: string
): Promise<OrderCapture> {
  const response = await fetchWithRetry(
    `${PAYPAL_API_HOST[env]}/v2/checkout/orders/` +
      `${encodeURIComponent(orderId)}`,
    {headers: {Authorization: `Bearer ${accessToken}`}}
  );
  if (!response.ok) {
    throw new Error(
      `PayPal order lookup failed (${response.status}): ` +
        `${await response.text()}`
    );
  }
  const data = (await response.json()) as {
    purchase_units?: {
      payments?: {
        captures?: {
          id: string;
          status: string;
          amount?: { value: string; currency_code: string };
        }[];
      };
    }[];
  };
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) {
    throw new Error(`PayPal order ${orderId} has no capture on it.`);
  }
  return {
    captureId: capture.id,
    status: capture.status,
    amount: Number(capture.amount?.value ?? NaN),
    currencyCode: capture.amount?.currency_code ?? "",
  };
}

/**
 * Refunds all or part of a capture - see
 * https://developer.paypal.com/docs/api/payments/v2/#captures_refund.
 * Omitting `amount` refunds whatever remains captured, in full.
 * `idempotencyKey` should be deterministic per distinct revoke action (not
 * a fresh random value each call) so a genuine retry after a partial
 * failure reuses PayPal's own idempotency window instead of risking a
 * second refund.
 * @param {PaypalEnvironment} env Which PayPal environment to hit.
 * @param {string} accessToken Bearer token from getAccessToken.
 * @param {string} captureId The capture to refund.
 * @param {number | undefined} amount Partial amount, or undefined for full.
 * @param {string} idempotencyKey Deterministic per distinct revoke action.
 * @return {Promise<{id: string, status: string}>} The refund's id/status.
 */
export async function refundCapture(
  env: PaypalEnvironment,
  accessToken: string,
  captureId: string,
  amount: number | undefined,
  idempotencyKey: string
): Promise<{ id: string; status: string }> {
  const response = await fetchWithRetry(
    `${PAYPAL_API_HOST[env]}/v2/payments/captures/` +
      `${encodeURIComponent(captureId)}/refund`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": idempotencyKey,
      },
      body: JSON.stringify(
        amount !== undefined ?
          {amount: {value: amount.toFixed(2), currency_code: "USD"}} :
          {}
      ),
    }
  );
  const body = (await response.json()) as {
    id: string;
    status: string;
    message?: string;
    details?: { description?: string }[];
  };
  if (!response.ok) {
    throw new Error(
      `PayPal refund failed: ${
        body.details?.[0]?.description ?? body.message ?? response.statusText
      }`
    );
  }
  return {id: body.id, status: body.status};
}
