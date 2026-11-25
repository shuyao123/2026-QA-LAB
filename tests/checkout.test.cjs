"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkout, runCases, runOrderActions, sampleCustomer } = require("../dist/checkout.js");

const version = process.env.QA_VERSION || "fixed";
if (!["legacy", "fixed"].includes(version)) throw new Error("QA_VERSION must be legacy or fixed.");

for (const testCase of runCases(version)) {
  test(testCase.id + " " + testCase.title + " [" + version + "]", () => {
    const mismatches = testCase.checks.filter(check => !check.passed);
    assert.deepEqual(mismatches, []);
  });
}

test("單品數量上限 5 件仍可結帳", () => {
  assert.equal(checkout({ main: 5, accessory: 0 }, version).total, 1750);
});

test("任一商品出現負數、小數或非數字時阻擋結帳", () => {
  for (const invalid of [-1, 1.5, NaN, "2"]) {
    assert.deepEqual(checkout({ main: 1, accessory: invalid }, version), {
      error: "QUANTITY_OUT_OF_RANGE"
    });
  }
});

if (version === "fixed") {
  test("付款遭拒後重試成功，只扣除一次庫存", () => {
    const result = runOrderActions({ main: 1, customer: sampleCustomer }, [
      { type: "submit", payment: "declined" },
      { type: "submit", payment: "approved" },
      { type: "submit", payment: "approved" }
    ]);
    assert.equal(result.orderStatus, "REUSED");
    assert.equal(result.ordersCreated, 1);
    assert.equal(result.remainingMain, 4);
  });

  test("重複取消不會重複回補庫存，也不會重新成立同一筆訂單", () => {
    const input = { main: 2, customer: sampleCustomer };
    const actions = [{ type: "submit" }, { type: "cancel" }, { type: "cancel" }];
    const cancelled = runOrderActions(input, actions);
    assert.equal(cancelled.orderError, "NO_ACTIVE_ORDER");
    assert.equal(cancelled.remainingMain, 5);
    const resubmitted = runOrderActions(input, [...actions, { type: "submit" }]);
    assert.equal(resubmitted.orderError, "ORDER_ALREADY_CANCELLED");
    assert.equal(resubmitted.ordersCreated, 1);
    assert.equal(resubmitted.activeOrders, 0);
    assert.equal(resubmitted.remainingMain, 5);
  });
}
