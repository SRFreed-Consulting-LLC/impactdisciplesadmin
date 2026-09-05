// guardedHandler is the method check + catch-all every public endpoint
// shares. The catch is the part that has to be able to go red: a thrown
// handler used to become an unhandled rejection with NOTHING sent, and the
// shopper's request hung until the function timed out.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {guardedHandler} = require("../lib/utils/public-http");

const fakeResponse = () => {
  const res = {
    code: 200, body: undefined, headersSent: false,
    status(c) {
      res.code = c; return res;
    },
    send(b) {
      res.body = b; res.headersSent = true; return res;
    },
  };
  return res;
};

test("refuses the wrong verb with 405 before the handler runs", async () => {
  let ran = false;
  const handler = guardedHandler("x", "POST", async () => {
    ran = true;
  });
  const res = fakeResponse();
  await handler({method: "GET"}, res);
  assert.equal(res.code, 405);
  assert.deepEqual(res.body, {error: "POST required."});
  assert.equal(ran, false);
});

test("runs the handler for the right verb, or any verb when none is set",
  async () => {
    const handler = guardedHandler("x", "POST", async (req, res) => {
      res.send({ok: req.method});
    });
    const res = fakeResponse();
    await handler({method: "POST"}, res);
    assert.deepEqual(res.body, {ok: "POST"});

    const any = guardedHandler("x", undefined, async (req, res) => {
      res.send({ok: req.method});
    });
    const res2 = fakeResponse();
    await any({method: "GET"}, res2);
    assert.deepEqual(res2.body, {ok: "GET"});
  });

test("a thrown handler answers 500 instead of hanging", async () => {
  const handler = guardedHandler("x", "POST", async () => {
    throw new Error("boom");
  });
  const res = fakeResponse();
  await handler({method: "POST"}, res);
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, {error: "Something went wrong"});
});

test("a handler that already answered is not answered twice", async () => {
  const handler = guardedHandler("x", "POST", async (req, res) => {
    res.status(400).send({error: "bad"});
    throw new Error("after send");
  });
  const res = fakeResponse();
  await handler({method: "POST"}, res);
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, {error: "bad"});
});
