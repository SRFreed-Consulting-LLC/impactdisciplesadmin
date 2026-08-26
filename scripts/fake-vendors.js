// Fake vendor server for the emulator-backed test layers.
//
// WHY THIS EXISTS
// The money path was the least-covered code in this repo precisely because
// it was the most expensive to run: create_paypal_order died at the PayPal
// boundary in every emulator test, capture_paypal_order had no coverage at
// all (a real capture needs buyer approval in a browser, so it cannot be
// automated even against sandbox), the Georgia tax branch was actively
// steered around, and get_shipping_label could never be tested because a
// passing test would buy real postage.
//
// This server stands in for all three vendors so those paths become
// reachable. Functions reach it because utils/vendor-hosts.ts redirects
// their base URLs - and refuses to do so anywhere that could be a real
// deployment.
//
// WHAT IT IS NOT
// It is NOT an attempt to reimplement PayPal, apilayer or ShipEngine. It
// answers only the handful of fields our own code actually reads, in the
// shape those vendors return them. That is a real limitation: if a vendor
// changes its contract, this fake will happily keep saying the old thing.
// Mitigation is a periodic manual run against PayPal SANDBOX - see the
// "Vendor drift" note in the test program section of CLAUDE.md.
//
// ONE PORT, ROUTED BY PATH. The three vendors' paths do not collide
// (/v1/oauth2/token, /v2/checkout/orders, /v2/payments/captures for PayPal;
// /tax_data/tax_rates for apilayer; /v1/rates, /v1/labels/rates for
// ShipEngine), and the ShipEngine SDK builds its URL with
// `new URL("/v1/rates", baseURL)` - which DISCARDS any path prefix on the
// base - so per-vendor path namespacing is not an option anyway.
//
// Usage:
//   node scripts/fake-vendors.js             # port 5055
//   FAKE_VENDORS_PORT=6000 node scripts/fake-vendors.js
// Started automatically by `npm run emu` (scripts/start-emu.js).

const http = require("http");

const PORT = Number(process.env.FAKE_VENDORS_PORT || 5055);

// ---------------------------------------------------------------------------
// Mutable scenario state.
//
// Failure modes are driven through an explicit control endpoint rather than
// smuggled through order data, because the production code owns the request
// body - a test cannot add a marker to what create_paypal_order sends to
// PayPal. Tests POST /__control before driving the function under test.
// Tax is the exception: its request carries a zip the test DOES control, so
// tax scenarios are keyed off well-known zips instead (see TAX_BY_ZIP).
// ---------------------------------------------------------------------------
const DEFAULTS = {
  // HTTP status for the OAuth token exchange. 401 exercises the
  // credential-mismatch diagnostics in library-paypal.ts.
  oauthStatus: 200,
  // Lifetime PayPal claims for the token it issues. library-paypal.ts caches
  // a token for (expires_in - 60) seconds per warm instance, so the DEFAULT
  // here is deliberately 60: that yields a zero-second TTL and the client
  // re-exchanges on every call.
  //
  // Without that, the cache silently swallows most PayPal auth testing. The
  // first successful checkout in a run caches a 9-hour token, and every
  // later test that wants to see an exchange - or wants a 401 to take
  // effect - never reaches the vendor at all, failing in a way that looks
  // like the code not calling PayPal rather than the code being efficient.
  // A test that wants to prove the cache WORKS raises this instead.
  oauthExpiresIn: 60,
  // HTTP status for order creation.
  createOrderStatus: 200,
  // Force order creation to answer without an `id` - the other branch of
  // create_paypal_order's "Failed to create PayPal order" guard.
  createOrderOmitId: false,
  // HTTP status for capture.
  captureStatus: 200,
  // PayPal's own status field on a capture. Anything but COMPLETED must
  // stop capture_paypal_order from writing a Purchase.
  captureOrderStatus: "COMPLETED",
  // Per-capture status inside purchase_units.
  captureDetailStatus: "COMPLETED",
  // When set, the capture reports this amount instead of the amount the
  // order was created with - the tampered-amount case capture_paypal_order
  // is explicitly written to catch.
  captureAmountOverride: null,
  // Fixed shipping rate (USD) the fake ShipEngine quotes as its cheapest.
  shippingRate: "9.42",
  // HTTP status for refunds.
  refundStatus: 200,
};

let scenario = { ...DEFAULTS };

// Orders created through the fake, by PayPal order id.
const orders = new Map();
// Every vendor request served, for assertions about what we SENT.
let requestLog = [];

let orderSeq = 0;
let captureSeq = 0;
let refundSeq = 0;

// ---------------------------------------------------------------------------
// Tax scenarios, keyed by zip. A test picks its failure mode by choosing the
// shipping address it checks out with - no control call needed.
//
// NOTE these must be GEORGIA zips to be reached at all: checkout-pricing
// only looks tax up when shippingAddress.state === "Georgia".
// ---------------------------------------------------------------------------
const TAX_BY_ZIP = {
  // Happy path: a real rate from the service.
  "30301": { kind: "rate", combinedRate: 0.089 },
  // Vendor 500 -> code must fall back to the 7% default.
  "30302": { kind: "status", status: 500 },
  // Vendor hangs past TAX_LOOKUP_TIMEOUT_MS (3s) -> AbortController fires
  // and the catch returns the default. Held open 6s for clear headroom.
  "30303": { kind: "hang", ms: 6000 },
  // 200 with a body that has no numeric combined_rate -> also the default.
  // A separate branch from the 500 above, and separately untested before.
  "30304": { kind: "malformed" },
};
const DEFAULT_TAX_RATE = 0.08;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ __raw: raw });
      }
    });
  });
}

function log(vendor, entry) {
  requestLog.push({ vendor, at: new Date().toISOString(), ...entry });
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

function paypalOauth(req, res) {
  // Our code sends Basic base64(clientId:clientSecret). Decoding it lets a
  // test assert the WEB storefront app's credentials were used and not the
  // library app's - the two are different PayPal apps and silently swapping
  // them is a real failure mode library-paypal.ts warns about at length.
  const auth = req.headers["authorization"] || "";
  let clientId = null;
  let clientSecret = null;
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    clientId = idx >= 0 ? decoded.slice(0, idx) : decoded;
    clientSecret = idx >= 0 ? decoded.slice(idx + 1) : "";
  }
  log("paypal", { op: "oauth", clientId, hasSecret: Boolean(clientSecret) });

  if (scenario.oauthStatus !== 200) {
    return send(res, scenario.oauthStatus, {
      error: "invalid_client",
      error_description: "Client Authentication failed",
    });
  }
  send(res, 200, {
    scope: "https://uri.paypal.com/services/payments/payment",
    access_token: "FAKE-TOKEN-" + (clientId || "unknown"),
    token_type: "Bearer",
    app_id: "APP-FAKE",
    expires_in: scenario.oauthExpiresIn,
  });
}

function paypalCreateOrder(req, res, body) {
  const unit = body && body.purchase_units && body.purchase_units[0];
  const amount = unit && unit.amount && unit.amount.value;
  log("paypal", {
    op: "create_order",
    intent: body && body.intent,
    amount,
    breakdown: unit && unit.amount && unit.amount.breakdown,
    items: unit && unit.items,
  });

  if (scenario.createOrderStatus !== 200) {
    return send(res, scenario.createOrderStatus, {
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "FAKE_VENDOR_FORCED_FAILURE" }],
    });
  }
  if (scenario.createOrderOmitId) {
    // 200 but no id - create_paypal_order's other rejection branch.
    return send(res, 200, { status: "CREATED" });
  }

  const id = "FAKEORDER" + String(++orderSeq).padStart(4, "0");
  orders.set(id, {
    id,
    amount: amount || "0.00",
    currency: (unit && unit.amount && unit.amount.currency_code) || "USD",
    captured: false,
    captureId: null,
  });
  send(res, 201, {
    id,
    status: "CREATED",
    links: [
      {
        href: "https://fake.paypal.local/checkoutnow?token=" + id,
        rel: "approve",
        method: "GET",
      },
    ],
  });
}

// The purchase_units shape both capture and order-lookup return.
function captureEnvelope(order) {
  const value =
    scenario.captureAmountOverride === null ?
      order.amount :
      scenario.captureAmountOverride;
  return [
    {
      reference_id: "default",
      payments: {
        captures: [
          {
            id: order.captureId,
            status: scenario.captureDetailStatus,
            amount: { currency_code: order.currency, value },
            final_capture: true,
            create_time: new Date().toISOString(),
          },
        ],
      },
    },
  ];
}

function paypalCaptureOrder(req, res, orderId) {
  const order = orders.get(orderId);
  log("paypal", { op: "capture", orderId, known: Boolean(order) });

  if (!order) {
    return send(res, 404, {
      name: "RESOURCE_NOT_FOUND",
      details: [{ issue: "INVALID_RESOURCE_ID" }],
    });
  }
  if (scenario.captureStatus !== 200) {
    return send(res, scenario.captureStatus, {
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "INSTRUMENT_DECLINED" }],
    });
  }

  // Capturing twice must not mint a second capture id: PayPal is idempotent
  // per order here, and capture_paypal_order's own replay guard is only the
  // FIRST line of defence - this is the second.
  if (!order.captured) {
    order.captured = true;
    order.captureId = "FAKECAPTURE" + String(++captureSeq).padStart(4, "0");
  }

  send(res, 201, {
    id: orderId,
    status: scenario.captureOrderStatus,
    purchase_units: captureEnvelope(order),
    payer: { payer_id: "FAKEPAYER01" },
  });
}

function paypalGetOrder(req, res, orderId) {
  const order = orders.get(orderId);
  log("paypal", { op: "get_order", orderId, known: Boolean(order) });
  if (!order) {
    return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
  }
  send(res, 200, {
    id: orderId,
    status: order.captured ? "COMPLETED" : "CREATED",
    // An uncaptured order genuinely has no `payments` block - that is the
    // "order has no capture on it" case getOrderCapture throws for.
    purchase_units: order.captured ?
      captureEnvelope(order) :
      [{ reference_id: "default" }],
  });
}

function paypalRefund(req, res, captureId, body) {
  log("paypal", {
    op: "refund",
    captureId,
    amount: (body && body.amount && body.amount.value) || null,
    idempotencyKey: req.headers["paypal-request-id"] || null,
  });
  if (scenario.refundStatus !== 200) {
    return send(res, scenario.refundStatus, {
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "CAPTURE_FULLY_REFUNDED" }],
    });
  }
  send(res, 201, {
    id: "FAKEREFUND" + String(++refundSeq).padStart(4, "0"),
    status: "COMPLETED",
    amount: (body && body.amount) || undefined,
  });
}

// ---------------------------------------------------------------------------
// apilayer tax_data
// ---------------------------------------------------------------------------

function taxRates(req, res, url) {
  const zip = url.searchParams.get("zip") || "";
  const forZip = TAX_BY_ZIP[zip];
  log("tax", {
    op: "tax_rates",
    zip,
    apikey: req.headers["apikey"] ? "sent" : "missing",
    scenario: forZip ? forZip.kind : "default",
  });

  if (forZip && forZip.kind === "status") {
    return send(res, forZip.status, { message: "fake vendor failure" });
  }
  if (forZip && forZip.kind === "malformed") {
    // 200, well-formed JSON, no numeric combined_rate.
    return send(res, 200, { zip, country: "US", combined_rate: null });
  }
  if (forZip && forZip.kind === "hang") {
    // Deliberately never answer until after the caller's own timeout. The
    // timer is unref'd so a hanging request can never hold the process open.
    const timer = setTimeout(() => {
      send(res, 200, { zip, combined_rate: 0.05 });
    }, forZip.ms);
    timer.unref();
    return;
  }

  const rate = forZip ? forZip.combinedRate : DEFAULT_TAX_RATE;
  send(res, 200, {
    zip,
    country: "US",
    state: "GA",
    combined_rate: rate,
    state_rate: 0.04,
    county_rate: 0.03,
    city_rate: 0.019,
    combined_district_rate: 0,
    freight_taxable: false,
  });
}

// ---------------------------------------------------------------------------
// ShipEngine
//
// The SDK's formatResponse() is not defensive - it dereferences
// total_weight.value, ship_to.name, advanced_options.bill_to_account and
// friends without null checks - so these canned bodies are deliberately
// complete rather than minimal. A partial body throws inside the SDK and the
// failure looks nothing like "the fake was incomplete".
// ---------------------------------------------------------------------------

const SE_ADDRESS = {
  name: "Impact Disciples",
  phone: "555-0100",
  company_name: null,
  address_line1: "1 Test Way",
  address_line2: null,
  address_line3: null,
  city_locality: "Atlanta",
  state_province: "GA",
  postal_code: "30301",
  country_code: "US",
  address_residential_indicator: "no",
};

function seRate(rateId, amount, serviceCode, serviceType, days) {
  const usd = (value) => ({ currency: "usd", amount: value });
  return {
    rate_id: rateId,
    rate_type: "shipment",
    carrier_id: "se-fake-carrier",
    shipping_amount: usd(amount),
    insurance_amount: usd(0),
    confirmation_amount: usd(0),
    other_amount: usd(0),
    tax_amount: null,
    zone: 4,
    package_type: "package",
    delivery_days: days,
    guaranteed_service: false,
    estimated_delivery_date: null,
    carrier_delivery_days: String(days),
    ship_date: null,
    negotiated_rate: false,
    service_type: serviceType,
    service_code: serviceCode,
    trackable: true,
    carrier_code: "fake",
    carrier_nickname: "Fake Carrier",
    carrier_friendly_name: "Fake Carrier",
    validation_status: "valid",
    warning_messages: [],
    error_messages: [],
  };
}

function shipEngineRates(req, res, body) {
  const packages = (body && body.shipment && body.shipment.packages) || [];
  const weight = packages.reduce(
    (sum, p) => sum + Number((p && p.weight && p.weight.value) || 0),
    0
  );
  log("shipengine", { op: "rates", weight, packages: packages.length });

  const cheap = Number(scenario.shippingRate);
  // Two rates, deliberately out of order: ShippingService sorts ascending
  // and takes [0], so an unsorted answer is what proves the sort is real.
  const rates = [
    seRate(
      "se-rate-express",
      (cheap + 12).toFixed(2),
      "fake_express",
      "Fake Express",
      1
    ),
    seRate("se-rate-ground", cheap.toFixed(2), "fake_ground", "Fake Ground", 5),
  ];

  const mappedPackages = packages.length ?
    packages.map((p) => ({
      package_code: (p && p.package_code) || "package",
      weight: (p && p.weight) || { value: 0, unit: "ounce" },
      dimensions: (p && p.dimensions) || null,
      insured_value: null,
      tracking_number: null,
      label_messages: null,
      external_package_id: null,
    })) :
    [
      {
        package_code: "package",
        weight: { value: 0, unit: "ounce" },
        dimensions: null,
        insured_value: null,
        tracking_number: null,
        label_messages: null,
        external_package_id: null,
      },
    ];

  send(res, 200, {
    shipment_id: "se-fake-shipment",
    carrier_id: "se-fake-carrier",
    service_code: null,
    external_order_id: null,
    items: [],
    tax_identifiers: null,
    external_shipment_id: null,
    ship_date: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
    shipment_status: "pending",
    ship_to: SE_ADDRESS,
    ship_from: SE_ADDRESS,
    warehouse_id: null,
    return_to: SE_ADDRESS,
    confirmation: "none",
    customs: null,
    advanced_options: {},
    origin_type: null,
    insurance_provider: "none",
    tags: [],
    order_source_code: null,
    packages: mappedPackages,
    total_weight: { value: weight, unit: "ounce" },
    rate_response: {
      rates,
      invalid_rates: [],
      rate_request_id: "se-fake-request",
      shipment_id: "se-fake-shipment",
      created_at: "2026-01-01T00:00:00.000Z",
      status: "completed",
      errors: [],
    },
  });
}

function shipEngineLabel(req, res, rateId, body) {
  // In production this line spends money. That is the entire reason
  // get_shipping_label has never had a test.
  log("shipengine", { op: "label", rateId, params: body });
  send(res, 200, {
    label_id: "se-fake-label-0001",
    status: "completed",
    shipment_id: "se-fake-shipment",
    ship_date: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    shipment_cost: { currency: "usd", amount: Number(scenario.shippingRate) },
    insurance_cost: { currency: "usd", amount: 0 },
    tracking_number: "FAKETRACK0001",
    is_return_label: false,
    rma_number: null,
    is_international: false,
    batch_id: "",
    carrier_id: "se-fake-carrier",
    charge_event: "carrier_default",
    service_code: "fake_ground",
    package_code: "package",
    voided: false,
    voided_at: null,
    label_format: (body && body.label_format) || "pdf",
    display_scheme: (body && body.display_scheme) || "label",
    label_layout: (body && body.label_layout) || "4x6",
    trackable: true,
    label_image_id: null,
    carrier_code: "fake",
    tracking_status: "in_transit",
    label_download: {
      href: "https://fake.shipengine.local/labels/se-fake-label-0001.pdf",
      pdf: "https://fake.shipengine.local/labels/se-fake-label-0001.pdf",
      png: null,
      zpl: null,
    },
    form_download: null,
    insurance_claim: null,
    packages: [
      {
        package_code: "package",
        tracking_number: "FAKETRACK0001",
        weight: { value: 16, unit: "ounce" },
        dimensions: null,
        insured_value: { currency: "usd", amount: 0 },
        label_messages: null,
        external_package_id: null,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);
  const p = url.pathname;
  const body =
    req.method === "POST" || req.method === "PUT" ? await readBody(req) : {};

  try {
    // --- control plane ---------------------------------------------------
    if (p === "/__health") {
      return send(res, 200, { ok: true, port: PORT });
    }
    if (p === "/__control" && req.method === "POST") {
      const unknown = Object.keys(body).filter((k) => !(k in DEFAULTS));
      if (unknown.length) {
        // A typo'd knob would silently do nothing and the test would fail
        // for a reason that looks like a product bug. Refuse instead.
        return send(res, 400, {
          error: "Unknown scenario key(s): " + unknown.join(", "),
          known: Object.keys(DEFAULTS),
        });
      }
      scenario = { ...scenario, ...body };
      return send(res, 200, { scenario });
    }
    if (p === "/__reset" && req.method === "POST") {
      scenario = { ...DEFAULTS };
      orders.clear();
      requestLog = [];
      orderSeq = 0;
      captureSeq = 0;
      refundSeq = 0;
      return send(res, 200, { ok: true });
    }
    if (p === "/__log") {
      return send(res, 200, { requests: requestLog });
    }
    if (p === "/__orders") {
      return send(res, 200, { orders: [...orders.values()] });
    }

    // --- PayPal ----------------------------------------------------------
    if (p === "/v1/oauth2/token") return paypalOauth(req, res);
    if (p === "/v2/checkout/orders" && req.method === "POST") {
      return paypalCreateOrder(req, res, body);
    }
    let m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (m) return paypalCaptureOrder(req, res, decodeURIComponent(m[1]));
    m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (m) return paypalGetOrder(req, res, decodeURIComponent(m[1]));
    m = p.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
    if (m) return paypalRefund(req, res, decodeURIComponent(m[1]), body);

    // --- apilayer --------------------------------------------------------
    if (p === "/tax_data/tax_rates") return taxRates(req, res, url);

    // --- ShipEngine ------------------------------------------------------
    if (p === "/v1/rates" && req.method === "POST") {
      return shipEngineRates(req, res, body);
    }
    m = p.match(/^\/v1\/labels\/rates\/([^/]+)$/);
    if (m) return shipEngineLabel(req, res, decodeURIComponent(m[1]), body);

    log("unknown", { op: "unrouted", method: req.method, path: p });
    send(res, 404, {
      error: "fake-vendors has no route for " + req.method + " " + p,
    });
  } catch (err) {
    console.error("[fake-vendors] handler threw", err);
    send(res, 500, { error: String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[fake-vendors] listening on http://127.0.0.1:" + PORT);
  console.log(
    "[fake-vendors] paypal /v1/oauth2/token /v2/checkout/orders " +
      "/v2/payments/captures | tax /tax_data/tax_rates | " +
      "shipengine /v1/rates /v1/labels/rates"
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = { server, PORT };
