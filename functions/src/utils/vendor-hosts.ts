// Vendor base-URL seam. Every outbound call to a paid third party (PayPal,
// apilayer's tax service, ShipEngine) resolves its host through here rather
// than hardcoding it at the call site, so the emulator-backed test layers
// can point those calls at scripts/fake-vendors.js instead of the real
// vendor.
//
// Why this exists at all: before it, the money path was the least-covered
// code in the repo precisely because it was the most expensive to run. The
// paid checkout branch died at the PayPal boundary in every emulator test,
// capture_paypal_order had no coverage whatsoever, and the Georgia tax
// branch was actively steered around (integration/money.test.js uses a Texas
// address on purpose). A redirectable host is what makes those testable.
//
// SECURITY: an override that could take effect on a deployed project would
// let anyone who can set an env var redirect real payment verification at a
// server they control - i.e. mint free orders and free book licences. So the
// override is honoured ONLY when this process is demonstrably not a real
// deployment: the Functions emulator sets FUNCTIONS_EMULATOR=true, and the
// emulator/test project id is `demo-`-prefixed (Firebase reserves that
// prefix for projects that can never reach live Google infrastructure).
// Anywhere else the override is ignored AND loudly logged - failing closed
// onto the real vendor, never open onto an attacker's.

/** The vendors whose hosts can be redirected in an emulator run. */
export type VendorName = "paypal" | "tax" | "shipengine";

/** Env var that holds each vendor's override base URL. */
export const VENDOR_BASE_ENV: Record<VendorName, string> = {
  paypal: "FAKE_VENDOR_PAYPAL_BASE",
  tax: "FAKE_VENDOR_TAX_BASE",
  shipengine: "FAKE_VENDOR_SHIPENGINE_BASE",
};

/**
 * Whether this process is a local emulator / demo-project run, and therefore
 * may have its vendor hosts redirected. Takes the environment as a parameter
 * so it is testable without mutating the real process.env.
 * @param {NodeJS.ProcessEnv} env The environment to inspect.
 * @return {boolean} True only for emulator or demo-* project runs.
 */
export function fakeVendorsAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.FUNCTIONS_EMULATOR === "true" ||
    (env.GCLOUD_PROJECT ?? "").startsWith("demo-");
}

/**
 * The base URL to use for a vendor: the override when one is set AND this is
 * an emulator/demo run, otherwise the real host. A trailing slash is trimmed
 * so callers can always concatenate an absolute path onto the result.
 * @param {VendorName} vendor Which vendor is being addressed.
 * @param {string} realHost The vendor's real, production base URL.
 * @param {NodeJS.ProcessEnv} env The environment to inspect.
 * @return {string} The base URL to issue requests against.
 */
export function resolveVendorBase(
  vendor: VendorName,
  realHost: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env[VENDOR_BASE_ENV[vendor]];
  if (!override) return realHost;

  if (!fakeVendorsAllowed(env)) {
    // Not a throw: a deployed function must keep working (against the real
    // vendor) rather than take checkout down because someone set a stray
    // env var. But this must never pass silently - it is either a serious
    // misconfiguration or an attack.
    console.error(
      `REFUSING to redirect ${vendor} to "${override}": ` +
      `${VENDOR_BASE_ENV[vendor]} is only honoured under the Functions ` +
      "emulator or a demo-* project. Using the real vendor host instead. " +
      `(FUNCTIONS_EMULATOR=${env.FUNCTIONS_EMULATOR ?? "unset"}, ` +
      `GCLOUD_PROJECT=${env.GCLOUD_PROJECT ?? "unset"})`
    );
    return realHost;
  }

  return override.replace(/\/+$/, "");
}
