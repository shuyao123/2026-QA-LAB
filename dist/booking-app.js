"use strict";

const { cases, runRequests, runCase } = window.BookingQA;
const get = id => document.getElementById(id);
const names = { legacy: "修正前", fixed: "修正後" };
const httpNames = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict" };
const json = value => value === undefined ? "未回傳" : JSON.stringify(value, null, 2);
const statusText = status => status + " " + (httpNames[status] ?? "");
const labVersion = () => document.querySelector('input[name="api-lab-version"]:checked').value;
const caseVersion = () => document.querySelector('input[name="api-case-version"]:checked').value;

const defectReports = [
  { id: "API-BUG-01", caseId: "API-03", observe: 1, title: "同一時段可建立兩筆預約", detail: "同一時段送出兩次。第二筆應回傳 409，修正前卻回傳 201。另以兩筆並行請求驗證衝突處理。", impact: "P1" },
  { id: "API-BUG-02", caseId: "API-05", observe: 2, title: "取消後，時段仍顯示被占用", detail: "取消預約後重查時段。修正前回傳 available: false，顧客在列表會看到時段不可預約。", impact: "P1" },
  { id: "API-BUG-03", caseId: "API-08", observe: 0, title: "空白姓名仍能建立預約", detail: "提交只有空白的姓名。應回傳 400 並保留時段，修正前會建立預約並占用時段。", impact: "P2" }
];

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function pill(passed) {
  return element("span", passed ? "pill pass" : "pill fail", passed ? "通過" : "失敗");
}

const presets = {
  list: { method: "GET", path: "/api/slots" },
  create: { method: "POST", path: "/api/bookings", body: { slotId: "SLOT-1000", customer: "測試訪客" } },
  read: { method: "GET", path: "/api/bookings/BK-001" },
  cancel: { method: "DELETE", path: "/api/bookings/BK-001" }
};
let replaySteps = [presets.list];
let replayRevision = 0;
let selectedResponse = 0;
const reports = {};

function fillRequest(request) {
  get("request-method").value = request.method;
  get("request-path").value = request.path;
  get("request-body").value = typeof request.body === "string" ? request.body : request.body ? json(request.body) : "";
  updateBodyField();
}

function updateBodyField() {
  get("request-body-field").hidden = get("request-method").value !== "POST";
}

function showResponse(trace, selected, updateEditor = false) {
  const response = trace[selected];
  if (!response) return;
  selectedResponse = selected;
  get("response-status").textContent = statusText(response.status);
  get("response-status").className = "http-badge " + (response.status < 400 ? "ok" : "error");
  get("response-headers").replaceChildren(...Object.entries(response.headers)
    .map(([key, value]) => element("div", "", key + ": " + value)));
  get("response-body").textContent = response.body === null ? "（無回應本文）" : json(response.body);
  get("request-trace").querySelectorAll("button").forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index === selected));
  });
  if (updateEditor) fillRequest(response.request);
}

async function replay(updateEditor = false, focusResponse) {
  const revision = ++replayRevision;
  get("request-message").textContent = "";
  try {
    const trace = await runRequests(replaySteps, labVersion());
    if (revision !== replayRevision) return;
    const list = get("request-trace");
    list.replaceChildren();
    trace.forEach((response, index) => {
      const row = element("li");
      const button = element("button", "trace-button");
      button.type = "button";
      const route = response.request.method + " " + response.request.path + (response.parallel ? " · 同時送出" : "");
      button.append(element("span", "trace-route", route),
        element("span", "http-badge " + (response.status < 400 ? "ok" : "error"), String(response.status)));
      button.addEventListener("click", () => showResponse(trace, index, true));
      row.append(button);
      list.append(row);
    });
    get("trace-count").textContent = trace.length + " 筆回應";
    showResponse(trace, Math.min(focusResponse ?? trace.length - 1, trace.length - 1), updateEditor);
  } catch (error) {
    if (revision === replayRevision) get("request-message").textContent = error.message;
  }
}

function loadCase(testCase, version) {
  replaySteps = testCase.steps.slice();
  get("api-scenario-name").textContent = (testCase.bug ?? testCase.id) + " · " + testCase.title;
  document.querySelector('input[name="api-lab-version"][value="' + version + '"]').checked = true;
  get("api-lab-title").focus({ preventScroll: true });
  get("api-lab").scrollIntoView();
  replay(true, defectReports.find(defect => defect.caseId === testCase.id)?.observe);
}

for (const defect of defectReports) {
  const card = element("article", "strategy-card");
  const meta = element("span", "case-id", defect.id + " · " + defect.impact);
  const button = element("button", "button button-outline", "載入缺陷情境");
  button.type = "button";
  button.addEventListener("click", () => loadCase(cases.find(item => item.id === defect.caseId), "legacy"));
  card.append(meta, element("h3", "", defect.title), element("p", "", defect.detail), button);
  get("api-defect-list").append(card);
}

get("request-method").addEventListener("change", updateBodyField);
get("api-lab-versions").addEventListener("change", () => replay(false, selectedResponse));
get("api-reset").addEventListener("click", () => {
  replaySteps = [presets.list];
  get("api-scenario-name").textContent = "查詢可預約時段";
  replay(true);
});
document.querySelectorAll("[data-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = presets[button.dataset.preset];
    fillRequest(preset);
    if (button.dataset.preset === "list") {
      replaySteps = [...replaySteps, preset];
      get("api-scenario-name").textContent = "查詢可預約時段";
      replay();
    } else {
      get("request-path").focus();
      get("request-message").textContent = "已填入請求，送出後可查看回應。";
    }
  });
});
get("request-form").addEventListener("submit", event => {
  event.preventDefault();
  const request = { method: get("request-method").value, path: get("request-path").value.trim() };
  if (!request.path.startsWith("/api/") || request.path.includes("\\")) {
    get("request-message").textContent = "請輸入以 /api/ 開頭的路徑。";
    return;
  }
  if (request.method === "POST") request.body = get("request-body").value;
  replaySteps = [...replaySteps, request];
  get("api-scenario-name").textContent = "自訂 API 請求";
  replay();
});

function openCase(result, version) {
  const content = get("api-case-content");
  const title = element("h3", "", result.title);
  title.id = "api-case-title";
  const checks = element("div", "assertions");
  for (const check of result.checks) {
    const row = element("div", "assertion");
    const heading = element("div", "assertion-heading");
    heading.append(element("strong", "", check.label), pill(check.passed));
    row.append(heading, element("div", "api-check-values", "預期　" + json(check.expected)),
      element("div", "api-check-values", "實際　" + json(check.actual)));
    checks.append(row);
  }
  const trace = element("p", "dialog-input", result.trace.map(response =>
    response.request.method + " " + response.request.path + " → " + response.status
  ).join(" · "));
  const launch = element("button", "button button-violet", "在實驗室重跑請求");
  launch.type = "button";
  launch.addEventListener("click", () => {
    get("api-case-dialog").close();
    loadCase(cases.find(testCase => testCase.id === result.id), version);
  });
  content.replaceChildren(element("p", "case-id", result.id + " · " + names[version]), title, trace, checks, launch);
  get("api-case-dialog").showModal();
}

function renderReports() {
  for (const [version, report] of Object.entries(reports)) {
    const metric = get("api-" + version);
    metric.textContent = report.passed + " / " + report.results.length;
    metric.parentElement.style.setProperty("--pass-rate", report.passed / report.results.length);
  }
  const version = caseVersion();
  const report = reports[version];
  if (!report) return;
  const filter = get("api-filter").value;
  const shown = report.results.filter(result => filter === "all" || result.passed === (filter === "passed"));
  const table = get("api-case-rows");
  table.replaceChildren();
  for (const result of shown) {
    const row = element("tr");
    const subject = element("th", "case-title-cell");
    subject.scope = "row";
    const button = element("button", "case-open");
    button.type = "button";
    button.append(element("span", "case-id", result.id), element("span", "case-name", result.title));
    button.addEventListener("click", () => openCase(result, version));
    subject.append(button);
    const outcome = element("td");
    outcome.append(pill(result.passed));
    row.append(subject, element("td", "category-col", result.group), outcome);
    table.append(row);
  }
  if (!shown.length) {
    const row = element("tr");
    const empty = element("td", "empty", "目前沒有符合的案例。");
    empty.colSpan = 3;
    row.append(empty);
    table.append(row);
  }
  get("api-run-summary").textContent = report.passed + " 通過 · " + (report.results.length - report.passed) + " 失敗 · "
    + shown.length + " 筆顯示 · " + new Date(report.executedAt).toLocaleTimeString("zh-TW", { hour12: false }) + " 執行";
}

async function runVersion(version) {
  const results = await Promise.all(cases.map(testCase => runCase(testCase, version)));
  reports[version] = { executedAt: new Date().toISOString(), passed: results.filter(item => item.passed).length, results };
  renderReports();
}

get("api-case-versions").addEventListener("change", renderReports);
get("api-filter").addEventListener("change", renderReports);
get("api-run").addEventListener("click", async () => {
  const button = get("api-run");
  button.disabled = true;
  try {
    await runVersion(caseVersion());
  } finally {
    button.disabled = false;
  }
});

get("api-export").addEventListener("click", () => {
  const version = caseVersion();
  const report = reports[version];
  if (!report) return;
  const output = JSON.stringify({ project: "QA Lab Booking API", version, ...report }, (_, value) => value === undefined ? null : value, 2);
  const url = URL.createObjectURL(new Blob([output + "\n"], { type: "application/json" }));
  const link = element("a");
  link.href = url;
  link.download = "qa-lab-booking-" + version + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

replay();
Promise.all([runVersion("legacy"), runVersion("fixed")]).catch(error => {
  get("api-run-summary").textContent = "無法執行測試：" + error.message;
});
