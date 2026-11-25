(function (root) {
  "use strict";

  const products = [
    { key: "main", name: "日常帆布包", price: 350, stock: 5 },
    { key: "accessory", name: "拉鍊收納袋", price: 220, stock: 3 },
    { key: "bottle", name: "霧面隨行瓶", price: 500, stock: 2 }
  ];
  const couponCode = "DEMO100";
  const expiredCoupon = "EXPIRED100";
  const cartLimit = 8;
  const sampleCustomer = { name: "測試使用者", phone: "0900000000" };
  const initialStock = Object.fromEntries(products.map(product => [product.key, product.stock]));

  function checkout(input, version = "fixed", stock = initialStock) {
    const legacy = version === "legacy";
    const quantities = products.map(product => input[product.key] === undefined ? 0 : input[product.key]);
    if (quantities.some(quantity => !Number.isInteger(quantity) || quantity < 0 || quantity > 5)) {
      return { error: "QUANTITY_OUT_OF_RANGE" };
    }
    const itemCount = quantities.reduce((total, quantity) => total + quantity, 0);
    if (itemCount === 0) return { error: "EMPTY_CART" };
    if (!legacy && products.some((product, index) => quantities[index] > stock[product.key])) {
      return { error: "OUT_OF_STOCK" };
    }
    if (!legacy && itemCount > cartLimit) return { error: "CART_LIMIT_EXCEEDED" };
    const subtotal = products.reduce((amount, product, index) => {
      const quantity = legacy && product.key === "bottle" ? Math.min(quantities[index], 1) : quantities[index];
      return amount + product.price * quantity;
    }, 0);

    const coupon = (input.coupon ?? "").trim();
    const preferredCode = legacy ? coupon : coupon.toUpperCase();
    let couponStatus = "NONE";
    let discount = 0;
    if (preferredCode === expiredCoupon && !legacy) {
      couponStatus = "EXPIRED";
    } else if (preferredCode === couponCode || preferredCode === expiredCoupon) {
      const meetsMinimum = legacy ? subtotal > 500 : subtotal >= 500;
      couponStatus = meetsMinimum ? "APPLIED" : "MINIMUM_NOT_MET";
      discount = meetsMinimum ? 100 : 0;
    } else if (coupon) {
      couponStatus = "INVALID";
    }

    const discountedSubtotal = subtotal - discount;
    const delivery = ["pickup", "island"].includes(input.delivery) ? input.delivery : "home";
    // The legacy build passes the pre-discount amount to the home delivery rule.
    const shippingBase = legacy ? subtotal : discountedSubtotal;
    let shipping = shippingBase >= 700 ? 0 : 80;
    if (delivery === "pickup") shipping = legacy ? 80 : 60;
    if (delivery === "island" && !legacy) shipping = 140;
    return { subtotal, discount, discountedSubtotal, couponStatus, delivery, shipping, total: discountedSubtotal + shipping };
  }

  function placeOrder(input, version = "fixed", stock = initialStock) {
    const quote = checkout(input, version, stock);
    if (quote.error) return { orderStatus: "BLOCKED", orderError: quote.error };
    const { name = "", phone = "" } = input.customer ?? {};
    if (!name.trim()) return { orderStatus: "BLOCKED", orderError: "NAME_REQUIRED" };
    if (version !== "legacy" && !/^09\d{8}$/.test(phone.trim())) {
      return { orderStatus: "BLOCKED", orderError: "INVALID_PHONE" };
    }
    if (version !== "legacy" && input.payment === "declined") {
      return { orderStatus: "BLOCKED", orderError: "PAYMENT_DECLINED" };
    }
    return { orderStatus: "ACCEPTED", orderTotal: quote.total };
  }

  function runOrderActions(input, actions, version = "fixed") {
    const legacy = version === "legacy";
    const stock = { ...initialStock };
    const orders = [];
    const quantities = products.map(product => [product.key, input[product.key] ?? 0]);
    let result;
    for (const action of actions) {
      if (action.type === "cancel") {
        const order = orders.slice().reverse().find(candidate => !candidate.cancelled);
        if (!order) {
          result = { orderStatus: "BLOCKED", orderError: "NO_ACTIVE_ORDER" };
          continue;
        }
        order.cancelled = true;
        if (!legacy) {
          for (const [key, quantity] of quantities) stock[key] += quantity;
        }
        result = { orderStatus: "CANCELLED" };
        continue;
      }
      // Every submit action in this replay belongs to the same checkout attempt.
      if (!legacy && orders.length) {
        result = orders[0].cancelled
          ? { orderStatus: "BLOCKED", orderError: "ORDER_ALREADY_CANCELLED" }
          : { orderStatus: "REUSED", orderTotal: orders[0].total };
        continue;
      }
      result = placeOrder({ ...input, payment: action.payment ?? input.payment }, version, stock);
      if (result.orderStatus === "ACCEPTED") {
        orders.push({ total: result.orderTotal, cancelled: false });
        for (const [key, quantity] of quantities) stock[key] -= quantity;
      }
    }
    return {
      ...result,
      ordersCreated: orders.length,
      activeOrders: orders.filter(order => !order.cancelled).length,
      remainingMain: stock.main,
      remainingAccessory: stock.accessory,
      remainingBottle: stock.bottle
    };
  }

  const cases = [
    {
      id: "TC-01", title: "原價 NT$700 剛好達免運門檻", group: "運費", priority: "P1",
      rule: "宅配的折扣後小計滿 NT$700 即免運。",
      input: { main: 2 }, expected: { shipping: 0, total: 700 }
    },
    {
      id: "TC-02", title: "小計低於 NT$700，收取宅配運費", group: "運費", priority: "P1",
      rule: "宅配的折扣後小計不足 NT$700 時，運費為 NT$80。",
      input: { main: 1, accessory: 1 }, expected: { shipping: 80, total: 650 }
    },
    {
      id: "TC-03", title: "折扣後跌破門檻，重新計算運費", group: "運費", priority: "P1",
      rule: "折扣後的小計為 NT$600，宅配應加收 NT$80。",
      input: { main: 2, coupon: couponCode }, expected: { discount: 100, discountedSubtotal: 600, shipping: 80, total: 680 },
      bug: "BUG-01"
    },
    {
      id: "TC-04", title: "折扣後仍達門檻，維持免運", group: "運費", priority: "P1",
      rule: "原價 NT$920 折抵後為 NT$820，宅配仍免運。",
      input: { main: 2, accessory: 1, coupon: couponCode }, expected: { discount: 100, shipping: 0, total: 820 }
    },
    {
      id: "TC-05", title: "未達優惠門檻，拒絕折抵", group: "優惠券", priority: "P2",
      rule: "商品小計低於 NT$500 時，DEMO100 不生效。",
      input: { main: 1, coupon: couponCode }, expected: { couponStatus: "MINIMUM_NOT_MET", discount: 0, total: 430 }
    },
    {
      id: "TC-06", title: "輸入無效優惠碼，維持原價", group: "優惠券", priority: "P2",
      rule: "無效優惠碼應顯示提示，折扣為 NT$0。",
      input: { main: 2, coupon: "INVALID" }, expected: { couponStatus: "INVALID", discount: 0, total: 700 }
    },
    {
      id: "TC-07", title: "空購物車無法結帳", group: "購物車", priority: "P1",
      rule: "購物車至少需要一件商品才能計算結帳金額。",
      input: {}, expected: { error: "EMPTY_CART" }
    },
    {
      id: "TC-08", title: "單品超過共通購買上限", group: "購物車", priority: "P2",
      rule: "每款商品最多購買五件，並須符合其個別庫存。",
      input: { main: 6 }, expected: { error: "QUANTITY_OUT_OF_RANGE" }
    },
    {
      id: "TC-09", title: "收納袋超過可售庫存，阻擋結帳", group: "購物車", priority: "P1",
      rule: "收納袋只剩 3 件，選購 4 件時應拒絕結帳。",
      input: { accessory: 4 }, expected: { error: "OUT_OF_STOCK" }, bug: "BUG-02"
    },
    {
      id: "TC-10", title: "購買數量剛好等於可售庫存", group: "購物車", priority: "P1",
      rule: "收納袋有 3 件可售庫存，選購 3 件可以結帳。",
      input: { accessory: 3 }, expected: { subtotal: 660, total: 740 }
    },
    {
      id: "TC-11", title: "小寫優惠碼可正常折抵", group: "優惠券", priority: "P2",
      rule: "DEMO100 的英文字母不區分大小寫。",
      input: { main: 2, accessory: 1, coupon: "demo100" }, expected: { couponStatus: "APPLIED", discount: 100, total: 820 },
      bug: "BUG-03"
    },
    {
      id: "TC-12", title: "小計剛好達到優惠門檻", group: "優惠券", priority: "P2",
      rule: "小計正好 NT$500 時，可使用 DEMO100 折 NT$100。",
      input: { bottle: 1, coupon: couponCode }, expected: { couponStatus: "APPLIED", discount: 100, total: 480 },
      bug: "BUG-06"
    },
    {
      id: "TC-13", title: "超商取貨套用專屬固定運費", group: "配送", priority: "P1",
      rule: "超商取貨固定收 NT$60。",
      input: { main: 1, delivery: "pickup" }, expected: { delivery: "pickup", shipping: 60, total: 410 }, bug: "BUG-04"
    },
    {
      id: "TC-14", title: "未指定配送時，預設宅配", group: "配送", priority: "P2",
      rule: "未傳配送方式時使用宅配規則。兩個帆布包與一個收納袋符合宅配免運。",
      input: { main: 2, accessory: 1 }, expected: { delivery: "home", shipping: 0, total: 920 }
    },
    {
      id: "TC-15", title: "下單時缺少手機號碼，阻擋出單", group: "訂單", priority: "P1", action: "order",
      rule: "須提供以 09 開頭的十碼手機號碼才能送出訂單。",
      input: { main: 1, customer: { name: sampleCustomer.name, phone: "" } },
      expected: { orderStatus: "BLOCKED", orderError: "INVALID_PHONE" }, bug: "BUG-05"
    },
    {
      id: "TC-16", title: "收件資料完整，建立模擬訂單", group: "訂單", priority: "P1", action: "order",
      rule: "有效收件資料可建立模擬訂單，訂單金額採用結帳明細。",
      input: { main: 1, customer: sampleCustomer }, expected: { orderStatus: "ACCEPTED", orderTotal: 430 }
    },
    {
      id: "TC-17", title: "收件人僅填空白，阻擋出單", group: "訂單", priority: "P1", action: "order",
      rule: "收件人姓名去除前後空白後不可為空。",
      input: { main: 1, customer: { name: "  ", phone: sampleCustomer.phone } },
      expected: { orderStatus: "BLOCKED", orderError: "NAME_REQUIRED" }
    },
    {
      id: "TC-18", title: "購物車為空時，不能直接送出訂單", group: "訂單", priority: "P1", action: "order",
      rule: "送出訂單前需重新執行結帳驗證，即使收件資料完整也要阻擋。",
      input: { customer: sampleCustomer }, expected: { orderStatus: "BLOCKED", orderError: "EMPTY_CART" }
    },
    {
      id: "TC-19", title: "過期優惠碼不可折抵", group: "優惠券", priority: "P2",
      rule: "已結束的 EXPIRED100 活動應顯示優惠已過期。",
      input: { main: 2, accessory: 1, coupon: expiredCoupon },
      expected: { couponStatus: "EXPIRED", discount: 0, total: 920 }, bug: "BUG-07"
    },
    {
      id: "TC-20", title: "購物車超過總件數上限", group: "購物車", priority: "P1",
      rule: "即使每款商品都未超出可售庫存，單筆訂單最多仍只能購買 8 件。",
      input: { main: 5, accessory: 3, bottle: 1 }, expected: { error: "CART_LIMIT_EXCEEDED" }, bug: "BUG-08"
    },
    {
      id: "TC-21", title: "離島宅配不適用本島免運", group: "配送", priority: "P1",
      rule: "離島宅配固定收 NT$140，即使商品小計滿 NT$700。",
      input: { main: 2, delivery: "island" }, expected: { delivery: "island", shipping: 140, total: 840 }, bug: "BUG-09"
    },
    {
      id: "TC-22", title: "付款遭拒時不建立訂單或扣庫存", group: "付款", priority: "P1",
      rule: "付款回覆為拒絕時，訂單與庫存不得異動。",
      input: { main: 1, payment: "declined", customer: sampleCustomer }, actions: [{ type: "submit" }],
      expected: { orderStatus: "BLOCKED", orderError: "PAYMENT_DECLINED", ordersCreated: 0, remainingMain: 5 }, bug: "BUG-10"
    },
    {
      id: "TC-23", title: "同一次結帳重送只成立一張訂單", group: "訂單", priority: "P1",
      rule: "同一個結帳識別重複送出時，系統應回傳既有訂單且只扣一次庫存。",
      input: { main: 1, customer: sampleCustomer }, actions: [{ type: "submit" }, { type: "submit" }],
      expected: { orderStatus: "REUSED", ordersCreated: 1, activeOrders: 1, remainingMain: 4 }, bug: "BUG-11"
    },
    {
      id: "TC-24", title: "取消訂單後回補商品庫存", group: "訂單", priority: "P1",
      rule: "取消訂單應將訂單內的所有商品數量加回可售庫存。",
      input: { main: 1, accessory: 1, customer: sampleCustomer }, actions: [{ type: "submit" }, { type: "cancel" }],
      expected: { orderStatus: "CANCELLED", activeOrders: 0, remainingMain: 5, remainingAccessory: 3 }, bug: "BUG-12"
    },
    {
      id: "TC-25", title: "隨行瓶兩件應計入兩件的價格", group: "購物車", priority: "P1",
      rule: "單價 NT$500 的隨行瓶購買兩件，商品小計應為 NT$1,000。",
      input: { bottle: 2 }, expected: { subtotal: 1000, shipping: 0, total: 1000 }, bug: "BUG-13"
    },
    {
      id: "TC-26", title: "購物車正好 8 件可以結帳", group: "購物車", priority: "P2",
      rule: "總件數上限包含 8 件，且各品項庫存均足夠。",
      input: { main: 5, accessory: 3 }, expected: { subtotal: 2410, total: 2410 }
    },
    {
      id: "TC-27", title: "沒有成立的訂單時無法取消", group: "訂單", priority: "P2",
      rule: "取消動作須有一張已成立且尚未取消的訂單。",
      input: { main: 1, customer: sampleCustomer }, actions: [{ type: "cancel" }],
      expected: { orderStatus: "BLOCKED", orderError: "NO_ACTIVE_ORDER", ordersCreated: 0, remainingMain: 5 }
    },
    {
      id: "TC-28", title: "三款商品各一件，正確合計", group: "購物車", priority: "P2",
      rule: "混合商品購物車應將各品項的價格納入小計。",
      input: { main: 1, accessory: 1, bottle: 1 }, expected: { subtotal: 1070, total: 1070 }
    },
    {
      id: "TC-29", title: "付款成功後建立訂單並扣庫存", group: "付款", priority: "P1",
      rule: "付款成功後，訂單金額與結帳明細一致，並扣除所購買的件數。",
      input: { main: 2, customer: sampleCustomer }, actions: [{ type: "submit" }],
      expected: { orderStatus: "ACCEPTED", orderTotal: 700, ordersCreated: 1, activeOrders: 1, remainingMain: 3 }
    }
  ];

  function runCases(version) {
    return cases.map(testCase => {
      const execute = testCase.action === "order" ? placeOrder : checkout;
      const actual = testCase.actions
        ? runOrderActions(testCase.input, testCase.actions, version)
        : execute(testCase.input, version);
      const checks = Object.entries(testCase.expected).map(([field, expected]) => ({
        field, expected, actual: actual[field], passed: expected === actual[field]
      }));
      return { ...testCase, actual, checks, passed: checks.every(check => check.passed) };
    });
  }

  const api = { checkout, placeOrder, runOrderActions, runCases, products, couponCode, sampleCustomer };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QALab = api;
})(typeof window === "object" ? window : null);
