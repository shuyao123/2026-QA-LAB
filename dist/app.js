"use strict";

const { checkout, runOrderActions, runCases, products, sampleCustomer } = window.QALab;
const get = id => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const moneyFormatter = new Intl.NumberFormat("zh-TW");
const money = value => "NT$" + moneyFormatter.format(value);
const versionNames = { legacy: "修正前", fixed: "修正後" };
const fieldNames = {
  subtotal: "商品小計", discount: "優惠折抵", discountedSubtotal: "折扣後小計",
  couponStatus: "優惠碼狀態", delivery: "配送方式", shipping: "運費", total: "應付金額",
  error: "結帳驗證", orderStatus: "訂單狀態", orderError: "訂單驗證", orderTotal: "訂單金額",
  ordersCreated: "成立訂單", activeOrders: "有效訂單", remainingMain: "帆布包剩餘",
  remainingAccessory: "收納袋剩餘", remainingBottle: "隨行瓶剩餘"
};
const couponNames = { NONE: "未使用優惠碼", INVALID: "優惠碼無效", MINIMUM_NOT_MET: "未達折抵門檻", EXPIRED: "優惠活動已過期", APPLIED: "優惠碼已套用" };
const deliveryNames = { home: "宅配到府", pickup: "超商取貨", island: "離島宅配" };
const orderNames = { BLOCKED: "訂單遭阻擋", ACCEPTED: "模擬訂單已建立", REUSED: "沿用原有訂單", CANCELLED: "模擬訂單已取消" };
const paymentNames = { approved: "付款成功", declined: "付款遭拒" };
const orderCounts = ["ordersCreated", "activeOrders", "remainingMain", "remainingAccessory", "remainingBottle"];
const errorNames = {
  EMPTY_CART: "購物車沒有商品", QUANTITY_OUT_OF_RANGE: "各商品數量須為 0 到 5 的整數",
  OUT_OF_STOCK: "購買數量超過可售庫存", NAME_REQUIRED: "請輸入收件人姓名",
  INVALID_PHONE: "請輸入以 09 開頭的十碼手機號碼",
  CART_LIMIT_EXCEEDED: "單筆訂單最多購買 8 件",
  PAYMENT_DECLINED: "付款遭拒，請重試",
  NO_ACTIVE_ORDER: "沒有可取消的訂單",
  ORDER_ALREADY_CANCELLED: "這次結帳的訂單已取消，請重設情境"
};

const defects = {
  "BUG-01": {
    title: "折扣後低於免運門檻，仍顯示免運",
    impact: "每筆符合情境的訂單少收 NT$80。",
    steps: ["選擇宅配到府，加入日常帆布包 2 件。", "套用優惠碼 DEMO100。", "查看折扣後小計、運費與實付金額。"],
    fields: ["shipping", "total"],
    cause: "運費規則收到原始商品小計。修正後以折扣後小計判斷宅配免運。"
  },
  "BUG-02": {
    title: "庫存只剩 3 件，仍能結帳 4 件",
    impact: "可售數量不足時仍可出單，可能造成超賣。",
    steps: ["將購物車清空，再加入拉鍊收納袋。", "把收納袋數量調為 4 件。", "確認結帳明細是否阻擋此數量。"],
    fields: ["error"],
    cause: "舊版只比對共通購買上限 5 件。新版依商品逐一檢查其可售庫存。"
  },
  "BUG-03": {
    title: "小寫優惠碼被判為無效",
    impact: "符合資格的購物車無法折抵 NT$100。",
    steps: ["加入日常帆布包 2 件與拉鍊收納袋 1 件。", "輸入小寫 demo100 並套用。", "核對優惠狀態與折抵金額。"],
    fields: ["couponStatus", "discount"],
    cause: "舊版用區分大小寫的方式比對。新版先將輸入轉成大寫，再驗證優惠資格。"
  },
  "BUG-04": {
    title: "超商取貨收取錯誤運費",
    impact: "每筆超商取貨訂單多收 NT$20。",
    steps: ["加入日常帆布包 1 件。", "將配送方式改為超商取貨。", "查看運費與應付總金額。"],
    fields: ["shipping", "total"],
    cause: "超商取貨誤用了 NT$80 費率。修正後套用超商專屬的 NT$60 固定費率。"
  },
  "BUG-05": {
    title: "未填手機號碼仍可成立訂單",
    impact: "配送時缺少必要的聯絡資料。",
    steps: ["加入日常帆布包 1 件。", "填入測試收件人，保留手機號碼空白。", "送出模擬訂單，查看驗證結果。"],
    fields: ["orderStatus"],
    cause: "舊版只檢查收件人姓名。新版另驗證手機號碼格式，不符合規則時阻擋出單。"
  },
  "BUG-06": {
    title: "小計正好 NT$500，無法使用滿額優惠",
    impact: "剛好達門檻的購物車少折抵 NT$100。",
    steps: ["加入霧面隨行瓶 1 件。", "套用 DEMO100。", "核對優惠狀態、折抵與總金額。"],
    fields: ["couponStatus", "total"],
    cause: "優惠門檻誤用大於 NT$500。修正後，小計等於 NT$500 也符合資格。"
  },
  "BUG-07": {
    title: "已過期的優惠碼仍可折抵",
    impact: "已結束的活動使每筆符合情境的訂單少收 NT$100。",
    steps: ["加入日常帆布包 2 件和拉鍊收納袋 1 件。", "套用已過期的 EXPIRED100。", "檢查折抵金額與優惠狀態。"],
    fields: ["couponStatus", "discount"],
    cause: "舊版辨識到活動代碼就進行折抵。修正後，會先確認活動狀態。"
  },
  "BUG-08": {
    title: "同一筆購物車超過 8 件仍能結帳",
    impact: "單筆限購條件失效，即使每個品項的數量都在庫存內。",
    steps: ["加入帆布包 5 件、收納袋 3 件、隨行瓶 1 件。", "確認購物車共 9 件。", "檢查結帳明細是否阻擋。"],
    fields: ["error"],
    cause: "舊版只檢查單款數量。修正後，也會驗證整台購物車的總件數。"
  },
  "BUG-09": {
    title: "離島訂單誤套用本島免運",
    impact: "每筆符合情境的離島訂單少收 NT$140。",
    steps: ["加入日常帆布包 2 件。", "選擇離島宅配。", "核對運費與應付金額。"],
    fields: ["shipping", "total"],
    cause: "離島宅配誤用本島運費規則。修正後，離島一律收 NT$140。"
  },
  "BUG-10": {
    title: "付款遭拒後仍成立訂單並扣庫存",
    impact: "未付款的訂單占用可售庫存。",
    steps: ["加入帆布包 1 件並填入示範資料。", "將模擬付款設為拒絕。", "送出模擬訂單，檢查訂單與剩餘庫存。"],
    fields: ["orderStatus", "ordersCreated", "remainingMain"],
    cause: "舊版將付款請求送出視為交易完成。修正後，只在付款成功時建立訂單與扣庫存。"
  },
  "BUG-11": {
    title: "重複送出同一筆結帳，產生兩張訂單",
    impact: "同一筆結帳被重複記錄並多扣庫存。",
    steps: ["加入帆布包 1 件，填入有效示範資料。", "連續送出兩次同一筆模擬結帳。", "比對成立的訂單數和剩餘庫存。"],
    fields: ["ordersCreated", "remainingMain"],
    cause: "舊版每次送出都會建立訂單。修正後，以同一筆結帳識別沿用原訂單。"
  },
  "BUG-12": {
    title: "取消訂單後，商品庫存沒有回補",
    impact: "可售庫存偏低，之後的顧客可能無法購買仍有庫存的商品。",
    steps: ["加入帆布包與收納袋各 1 件並下單。", "取消該筆模擬訂單。", "比對有效訂單數與兩款商品的剩餘庫存。"],
    fields: ["remainingMain", "remainingAccessory"],
    cause: "舊版只改訂單狀態。修正後，取消時會同時回補訂單內的商品庫存。"
  },
  "BUG-13": {
    title: "兩件隨行瓶只計入一件的價格",
    impact: "商品小計少算 NT$500，連帶影響免運判斷。",
    steps: ["購物車只保留隨行瓶 2 件。", "使用宅配到府，優惠碼留空。", "核對商品小計及應付金額。"],
    fields: ["subtotal", "total"],
    cause: "舊版將隨行瓶數量壓成一件進行計價。修正後，小計採實際購買數量乘以單價。"
  }
};

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function highlightUpdate(target) {
  if (reducedMotion.matches || typeof target.animate !== "function") return;
  for (const animation of target.getAnimations()) {
    if (animation.id === "result-highlight") animation.cancel();
  }
  const animation = target.animate(
    [{ backgroundColor: "#e6d9fa", transform: "translateY(3px)" },
      { backgroundColor: "transparent", transform: "translateY(0)" }],
    { duration: 460, easing: "cubic-bezier(.2, .65, .3, 1)" }
  );
  animation.id = "result-highlight";
}

function observeSections() {
  if (reducedMotion.matches || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("motion-enter");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -24px" });
  document.querySelectorAll(".section-head, .strategy-grid").forEach(section => observer.observe(section));
}

function format(field, value) {
  if (value === undefined) return "未回傳";
  if (field === "couponStatus") return couponNames[value];
  if (field === "delivery") return deliveryNames[value];
  if (field === "orderStatus") return orderNames[value];
  if (field === "error" || field === "orderError") return errorNames[value];
  if (orderCounts.includes(field)) return value + (field.endsWith("Orders") || field === "ordersCreated" ? " 筆" : " 件");
  return money(value);
}

function resultPill(passed) {
  return element("span", passed ? "pill pass" : "pill fail", passed ? "通過" : "失敗");
}

function stateOf(version) {
  const results = runCases(version);
  return { results, passed: results.filter(test => test.passed).length, at: new Date().toISOString() };
}

const runs = { legacy: stateOf("legacy"), fixed: stateOf("fixed") };
const caseVersion = () => document.querySelector('input[name="case-version"]:checked').value;
const labVersion = () => document.querySelector('input[name="lab-version"]:checked').value;

function showCase(testCase, version) {
  const title = element("h3", "", testCase.title);
  title.id = "dialog-title";
  const meta = element("p", "case-id", testCase.id + " · " + versionNames[version] + " · " + testCase.priority);
  const input = testCase.input;
  const quantities = products.map(product => product.name + " " + (input[product.key] ?? 0) + " 件").join("、");
  const details = [quantities, "優惠碼 " + (input.coupon || "留空"), deliveryNames[input.delivery || "home"]];
  if (testCase.action === "order" || testCase.actions) {
    details.push("收件人 " + (input.customer?.name?.trim() || "留空"), "手機 " + (input.customer?.phone || "留空"));
  }
  if (testCase.actions) {
    details.push(testCase.actions.map(action => action.type === "cancel"
      ? "取消訂單" : "送出訂單（" + paymentNames[action.payment ?? input.payment ?? "approved"] + "）").join(" → "));
  }

  const assertions = element("div", "assertions");
  testCase.checks.forEach(check => {
    const row = element("div", "assertion");
    const heading = element("div", "assertion-heading");
    heading.append(element("strong", "", fieldNames[check.field]), resultPill(check.passed));
    row.append(heading, element("div", "", "預期　" + format(check.field, check.expected)),
      element("div", "", "實際　" + format(check.field, check.actual)));
    assertions.append(row);
  });
  const load = element("button", "button button-violet", "在實驗室重現");
  load.type = "button";
  load.addEventListener("click", () => {
    get("case-dialog").close();
    loadScenario(testCase, version, true);
  });
  get("dialog-content").replaceChildren(meta, title, element("p", "", testCase.rule),
    element("p", "dialog-input", "輸入　" + details.join(" · ")), assertions, load);
  get("case-dialog").showModal();
}

function renderCases() {
  const version = caseVersion();
  const { results, passed, at } = runs[version];
  const filter = get("filter").value;
  const module = get("module-filter").value;
  const visible = results.filter(test => (module === "all" || module === test.group)
    && (filter === "all" || test.passed === (filter === "passed")));
  const rows = get("case-rows");
  rows.replaceChildren();
  for (const testCase of visible) {
    const row = element("tr");
    const title = element("th", "case-title-cell");
    title.scope = "row";
    const open = element("button", "case-open");
    open.type = "button";
    open.append(element("span", "case-id", testCase.id), element("span", "case-name", testCase.title));
    open.addEventListener("click", () => showCase(testCase, version));
    title.append(open);
    const result = element("td");
    result.append(resultPill(testCase.passed));
    row.append(title, element("td", "category-col", testCase.group),
      element("td", "priority-col", testCase.priority), result);
    rows.append(row);
  }
  if (!visible.length) {
    const row = element("tr");
    const empty = element("td", "empty", "目前沒有符合條件的案例。");
    empty.colSpan = 4;
    row.append(empty);
    rows.append(row);
  }
  const time = new Date(at).toLocaleTimeString("zh-TW", { hour12: false });
  get("run-summary").textContent = passed + " 通過 · " + (results.length - passed) + " 失敗 · " + visible.length + " 筆顯示 · " + time + " 執行";
  Object.entries(runs).forEach(([key, run]) => {
    const metric = get("hero-" + key);
    metric.textContent = run.passed + " / " + run.results.length;
    metric.parentElement.style.setProperty("--pass-rate", run.passed / run.results.length);
  });
}

function renderDefects() {
  const list = get("defect-list");
  const cases = runs.legacy.results.filter(test => test.bug).sort((a, b) => a.bug.localeCompare(b.bug));
  const category = get("defect-filter").value;
  const visible = cases.filter(test => category === "all" || test.group === category);
  list.replaceChildren();
  for (const testCase of visible) {
    const defect = defects[testCase.bug];
    const card = element("details", "defect");
    card.open = testCase === visible[0];
    const summary = element("summary", "bug-summary");
    const label = element("span", "bug-label");
    label.append(element("span", "case-id", testCase.bug), element("span", "bug-title", defect.title));
    const meta = element("span", "bug-meta");
    meta.append(element("span", "pill " + (testCase.priority === "P1" ? "fail" : "neutral"), testCase.priority),
      element("span", "chevron"));
    summary.append(label, meta);

    const steps = element("ol");
    defect.steps.forEach(step => steps.append(element("li", "", step)));
    const repro = element("div", "defect-steps");
    repro.append(element("h3", "", "重現步驟"), steps, element("p", "impact", defect.impact));
    const comparison = element("div", "comparison");
    for (const side of ["expected", "actual"]) {
      const panel = element("div", "comparison-" + side);
      panel.append(element("h3", "", side === "expected" ? "預期結果" : "修正前實際結果"));
      for (const field of defect.fields) {
        const value = testCase[side][field];
        const description = field === "error" && value === undefined ? "允許結帳，應付 " + money(testCase.actual.total) : format(field, value);
        const line = element("div", "compare-line");
        line.append(element("span", "", fieldNames[field]), element("strong", "", description));
        panel.append(line);
      }
      comparison.append(panel);
    }
    const body = element("div", "bug-body");
    body.append(repro, comparison);

    const foot = element("div", "bug-foot");
    const actions = element("div", "defect-actions");
    const details = element("button", "button button-outline", testCase.id + " 驗證明細");
    details.type = "button";
    details.addEventListener("click", () => showCase(runs.legacy.results.find(test => test.id === testCase.id), "legacy"));
    const load = element("button", "button button-violet", "載入缺陷情境");
    load.type = "button";
    load.addEventListener("click", () => loadScenario(testCase, "legacy", true));
    actions.append(details, load);
    foot.append(element("p", "cause", defect.cause), actions);
    card.append(summary, body, foot);
    list.append(card);
  }
  get("hero-defects").textContent = cases.length;
  get("defect-summary").textContent = "顯示 " + visible.length + "／" + cases.length + " 個缺陷";
}

const moduleFilter = get("module-filter");
const defectFilter = get("defect-filter");
for (const group of new Set(runs.legacy.results.map(test => test.group))) {
  moduleFilter.append(new Option(group, group));
}
for (const group of new Set(runs.legacy.results.filter(test => test.bug).map(test => test.group))) {
  defectFilter.append(new Option(group, group));
}
defectFilter.addEventListener("change", renderDefects);
get("case-versions").addEventListener("change", () => {
  renderCases();
  highlightUpdate(get("run-summary"));
});
get("filter").addEventListener("change", renderCases);
moduleFilter.addEventListener("change", renderCases);
get("run").addEventListener("click", () => {
  const version = caseVersion();
  runs[version] = stateOf(version);
  renderCases();
  highlightUpdate(get("run-summary"));
});
get("export").addEventListener("click", () => {
  const version = caseVersion();
  const run = runs[version];
  const report = {
    project: "QA Lab checkout", version, executedAt: run.at,
    totals: { cases: run.results.length, passed: run.passed, failed: run.results.length - run.passed },
    results: run.results
  };
  const output = JSON.stringify(report, (_, value) => value === undefined ? null : value, 2) + "\n";
  const url = URL.createObjectURL(new Blob([output], { type: "application/json" }));
  const link = element("a");
  link.href = url;
  link.download = "qa-lab-" + version + "-report.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

let appliedCoupon = "";
let orderActions = [];
const quantityInputs = new Map();

function checkoutInput() {
  return {
    ...Object.fromEntries(Array.from(quantityInputs, ([key, input]) => [key, input.valueAsNumber])),
    coupon: appliedCoupon,
    delivery: get("delivery").value,
    payment: get("payment").value,
    customer: { name: get("customer-name").value, phone: get("customer-phone").value }
  };
}

function renderReceipt() {
  const version = labVersion();
  const input = checkoutInput();
  const result = checkout(input, version);
  const receipt = get("receipt");
  const heading = element("div", "lab-head");
  heading.append(element("h3", "", "結帳明細"), element("span", "receipt-version", versionNames[version]));
  receipt.replaceChildren(heading);

  const count = products.reduce((total, product) => {
    const quantity = input[product.key];
    return Number.isInteger(quantity) && quantity > 0 ? total + quantity : total;
  }, 0);
  get("item-count").textContent = count + " 件商品";
  if (result.error) {
    receipt.append(element("p", "receipt-error", errorNames[result.error]));
    return;
  }
  const lines = element("dl", "receipt-lines");
  const entries = [
    ["商品小計", money(result.subtotal)],
    ["優惠折抵", result.discount ? "−" + money(result.discount) : money(0)],
    ["折扣後小計", money(result.discountedSubtotal)],
    [deliveryNames[result.delivery] + "運費", money(result.shipping)],
    ["應付金額", money(result.total)]
  ];
  entries.forEach(([label, value], index) => {
    const line = element("div", index === entries.length - 1 ? "receipt-total" : "");
    line.append(element("dt", "", label), element("dd", "", value));
    lines.append(line);
  });
  receipt.append(lines, element("p", "receipt-coupon", couponNames[result.couponStatus]));
}

function renderOrder() {
  const output = get("order-result");
  const cancel = get("cancel-order");
  output.replaceChildren();
  cancel.disabled = true;
  if (!orderActions.length) return;
  const order = runOrderActions(checkoutInput(), orderActions, labVersion());
  cancel.disabled = order.activeOrders === 0;
  const blocked = order.orderStatus === "BLOCKED";
  const panel = element("div", blocked ? "order-feedback fail" : "order-feedback pass");
  panel.append(element("strong", "", orderNames[order.orderStatus]));
  if (blocked) panel.append(element("span", "", errorNames[order.orderError]));
  if (order.orderTotal !== undefined) panel.append(element("span", "", "訂單金額 " + money(order.orderTotal)));
  const totals = element("dl", "order-totals");
  for (const field of orderCounts) {
    const line = element("div");
    line.append(element("dt", "", fieldNames[field]), element("dd", "", format(field, order[field])));
    totals.append(line);
  }
  output.append(panel, totals);
}

function setCustomer(customer = {}) {
  get("customer-name").value = customer.name ?? "";
  get("customer-phone").value = customer.phone ?? "";
}

function editScenario() {
  orderActions = [];
  get("active-scenario").textContent = "自訂購物車";
  renderReceipt();
  renderOrder();
}

function loadScenario(testCase, version, focusHeading = false) {
  const input = testCase.input;
  for (const [key, field] of quantityInputs) field.value = input[key] ?? 0;
  appliedCoupon = input.coupon ?? "";
  get("coupon").value = appliedCoupon;
  get("delivery").value = input.delivery ?? "home";
  get("payment").value = input.payment ?? "approved";
  setCustomer(input.customer);
  document.querySelector('input[name="lab-version"][value="' + version + '"]').checked = true;
  get("active-scenario").textContent = testCase.bug ? testCase.bug + " · " + defects[testCase.bug].title
    : testCase.id ? testCase.id + " · " + testCase.title : "自訂購物車";
  const actions = testCase.actions ?? (testCase.action === "order" ? [{ type: "submit" }] : []);
  orderActions = actions.map(action => action.type === "submit"
    ? { ...action, payment: action.payment ?? input.payment ?? "approved" } : action);
  renderReceipt();
  renderOrder();
  if (focusHeading) {
    get("lab-title").focus({ preventScroll: true });
    get("lab").scrollIntoView();
    highlightUpdate(get("receipt"));
  }
}

for (const [index, product] of products.entries()) {
  const row = element("div", "product");
  const marker = element("span", "product-marker product-" + index, product.name.slice(-1));
  marker.setAttribute("aria-hidden", "true");
  const field = element("input", "quantity");
  field.type = "number";
  field.step = "1";
  field.inputMode = "numeric";
  field.id = "quantity-" + product.key;
  field.setAttribute("aria-label", product.name + "數量");
  const label = element("label", "", product.name);
  label.htmlFor = field.id;
  const copy = element("div", "product-copy");
  copy.append(label, element("span", "", money(product.price) + " · 起始庫存 " + product.stock + " 件"));
  const controls = element("div", "quantity-controls");
  const minus = element("button", "quantity-button", "−");
  const plus = element("button", "quantity-button", "+");
  for (const [button, step, action] of [[minus, -1, "減少"], [plus, 1, "增加"]]) {
    button.type = "button";
    button.setAttribute("aria-label", action + product.name + "數量");
    button.addEventListener("click", () => {
      const quantity = Number.isFinite(field.valueAsNumber) ? Math.trunc(field.valueAsNumber) : 0;
      field.value = Math.max(0, quantity + step);
      editScenario();
    });
  }
  field.addEventListener("input", editScenario);
  controls.append(minus, field, plus);
  row.append(marker, copy, controls);
  get("products").append(row);
  quantityInputs.set(product.key, field);
}

function applyCoupon() {
  appliedCoupon = get("coupon").value.trim();
  editScenario();
}
get("apply-coupon").addEventListener("click", applyCoupon);
get("coupon").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyCoupon();
  }
});
get("delivery").addEventListener("change", editScenario);
for (const id of ["customer-name", "customer-phone"]) {
  get(id).addEventListener("input", editScenario);
}
get("fill-customer").addEventListener("click", () => {
  setCustomer(sampleCustomer);
  editScenario();
});
get("checkout-form").addEventListener("submit", event => {
  event.preventDefault();
  orderActions.push({ type: "submit", payment: get("payment").value });
  renderOrder();
  highlightUpdate(get("order-result"));
});
get("cancel-order").addEventListener("click", () => {
  orderActions.push({ type: "cancel" });
  renderOrder();
  highlightUpdate(get("order-result"));
});
get("lab-versions").addEventListener("change", () => {
  renderReceipt();
  renderOrder();
  highlightUpdate(get("receipt"));
  if (orderActions.length) highlightUpdate(get("order-result"));
});
const defaultScenario = { input: { main: 1, accessory: 1 } };
get("reset-lab").addEventListener("click", () => loadScenario(defaultScenario, "fixed"));

renderDefects();
renderCases();
loadScenario(defaultScenario, "fixed");
observeSections();
