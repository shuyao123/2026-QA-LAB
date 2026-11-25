"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const { cases, runCase } = require("../dist/booking.js");
const { createBookingServer } = require("../booking-server.cjs");

const version = process.env.BOOKING_VERSION || "fixed";
if (!["legacy", "fixed"].includes(version)) throw new Error("BOOKING_VERSION must be legacy or fixed.");

for (const testCase of cases) {
  test(testCase.id + " " + testCase.title + " [" + version + "]", async () => {
    const result = await runCase(testCase, version);
    assert.deepEqual(result.checks.filter(check => !check.passed), []);
  });
}

test("HTTP 整合：兩筆並行請求只成立一筆，取消後可再預約", async t => {
  const server = createBookingServer(version);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  const origin = "http://127.0.0.1:" + server.address().port;
  const book = customer => fetch(origin + "/api/bookings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slotId: "SLOT-1000", customer })
  });
  const responses = await Promise.all([book("測試訪客 A"), book("測試訪客 B")]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const created = responses.find(response => response.status === 201);
  const conflict = responses.find(response => response.status === 409);
  const location = created.headers.get("location");
  assert.equal(location, "/api/bookings/BK-001");
  assert.equal((await conflict.json()).error, "SLOT_UNAVAILABLE");
  const cancelled = await fetch(origin + location, { method: "DELETE" });
  assert.equal(cancelled.status, 204);
  assert.equal(await cancelled.text(), "");
  const available = await fetch(origin + "/api/slots");
  assert.equal((await available.json()).slots[0].available, true);
  const rebooked = await book("測試訪客 C");
  assert.equal(rebooked.status, 201);
  assert.equal(rebooked.headers.get("location"), "/api/bookings/BK-002");
});
