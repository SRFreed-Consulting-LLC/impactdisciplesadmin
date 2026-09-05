// The in-memory brake on the coupon-code oracle. Pinned: the limit is per
// key, the window slides, and the proxy's forwarded address is the caller.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {RateLimiter, clientIp} = require("../lib/utils/rate-limit");

test("allows up to the limit in a window and refuses the next", () => {
  const limiter = new RateLimiter(3, 60_000);
  const t = 1_000_000;
  assert.equal(limiter.allow("a", t), true);
  assert.equal(limiter.allow("a", t + 1), true);
  assert.equal(limiter.allow("a", t + 2), true);
  assert.equal(limiter.allow("a", t + 3), false);
});

test("keys are independent", () => {
  const limiter = new RateLimiter(1, 60_000);
  assert.equal(limiter.allow("a", 1), true);
  assert.equal(limiter.allow("b", 1), true);
  assert.equal(limiter.allow("a", 2), false);
});

test("the window slides - old hits stop counting", () => {
  const limiter = new RateLimiter(2, 1_000);
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 500), true);
  assert.equal(limiter.allow("a", 900), false);
  assert.equal(limiter.allow("a", 1_001), true);
});

test("clientIp takes the first forwarded address, else request.ip", () => {
  assert.equal(clientIp({headers: {"x-forwarded-for": "1.2.3.4, 10.0.0.1"}}),
    "1.2.3.4");
  assert.equal(clientIp({headers: {"x-forwarded-for": ["5.6.7.8"]}}),
    "5.6.7.8");
  assert.equal(clientIp({headers: {}, ip: "9.9.9.9"}), "9.9.9.9");
  assert.equal(clientIp({headers: {}}), "unknown");
});
