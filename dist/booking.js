(function (root) {
  "use strict";

  const slots = [
    { id: "SLOT-1000", time: "10:00" },
    { id: "SLOT-1030", time: "10:30" },
    { id: "SLOT-1100", time: "11:00" }
  ];
  const origin = "http://booking.example";

  function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
    });
  }

  function problem(status, code) {
    return json({ error: code }, status);
  }

  function methodNotAllowed(allow) {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: allow });
  }

  function createBookingApi(version = "fixed") {
    const bookings = new Map();
    const legacy = version === "legacy";
    const isReserved = slotId => [...bookings.values()].some(booking =>
      booking.slotId === slotId && (legacy || booking.status === "confirmed")
    );

    return async function handleRequest(request) {
      const { pathname } = new URL(request.url);
      const method = request.method;
      if (pathname === "/api/slots") {
        if (method !== "GET") return methodNotAllowed("GET");
        return json({ slots: slots.map(slot => ({ ...slot, available: !isReserved(slot.id) })) });
      }

      if (pathname === "/api/bookings") {
        if (method !== "POST") return methodNotAllowed("POST");
        let payload;
        try {
          payload = await request.json();
        } catch {
          return problem(400, "INVALID_JSON");
        }
        if (!payload || typeof payload !== "object" || typeof payload.slotId !== "string" ||
            (!legacy && (typeof payload.customer !== "string" || !payload.customer.trim()))) {
          return problem(400, "VALIDATION_ERROR");
        }
        if (!slots.some(slot => slot.id === payload.slotId)) return problem(404, "SLOT_NOT_FOUND");
        // Validation and the reservation write run in the same JavaScript turn.
        if (!legacy && isReserved(payload.slotId)) return problem(409, "SLOT_UNAVAILABLE");
        const booking = {
          id: "BK-" + String(bookings.size + 1).padStart(3, "0"), slotId: payload.slotId,
          customer: typeof payload.customer === "string" ? payload.customer.trim() : "",
          status: "confirmed"
        };
        bookings.set(booking.id, booking);
        return json(booking, 201, { Location: "/api/bookings/" + booking.id });
      }

      const record = pathname.match(/^\/api\/bookings\/([^/]+)$/);
      if (!record) return problem(404, "ROUTE_NOT_FOUND");
      if (method !== "GET" && method !== "DELETE") return methodNotAllowed("GET, DELETE");
      const booking = bookings.get(record[1]);
      if (!booking) return problem(404, "BOOKING_NOT_FOUND");
      if (method === "GET") return json(booking);
      booking.status = "cancelled";
      return new Response(null, { status: 204 });
    };
  }

  async function sendRequest(handleRequest, input) {
    const { method, path, body } = input;
    if (!path.startsWith("/api/") || path.includes("\\")) throw new Error("請輸入以 /api/ 開頭的路徑。");
    const options = { method };
    if (method === "POST" && body !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const response = await handleRequest(new Request(origin + path, options));
    const text = await response.text();
    return {
      request: input, status: response.status, headers: Object.fromEntries(response.headers),
      body: text ? JSON.parse(text) : null
    };
  }

  async function runRequests(steps, version) {
    const handleRequest = createBookingApi(version);
    const trace = [];
    for (const step of steps) {
      if (Array.isArray(step)) {
        const responses = await Promise.all(step.map(request => sendRequest(handleRequest, request)));
        trace.push(...responses.map(response => ({ ...response, parallel: true })));
      } else {
        trace.push(await sendRequest(handleRequest, step));
      }
    }
    return trace;
  }

  const list = { method: "GET", path: "/api/slots" };
  const bookingPath = "/api/bookings/BK-001";
  const read = { method: "GET", path: bookingPath };
  const cancel = { method: "DELETE", path: bookingPath };
  const book = { method: "POST", path: "/api/bookings", body: { slotId: "SLOT-1000", customer: "測試訪客 A" } };
  const bookAgain = { ...book, body: { ...book.body, customer: "測試訪客 B" } };
  const statusList = steps => steps.map(step => step.status);

  const cases = [
    {
      id: "API-01", title: "列出三個可預約時段", group: "合約", steps: [list],
      assertions: [
        ["HTTP 狀態", [200], statusList],
        ["Content-Type", "application/json; charset=utf-8", trace => trace[0].headers["content-type"]],
        ["可用時段 ID", slots.map(slot => slot.id), trace => trace[0].body.slots.filter(slot => slot.available).map(slot => slot.id)]
      ]
    },
    {
      id: "API-02", title: "成功建立並查詢預約", group: "合約", steps: [book, read],
      assertions: [
        ["HTTP 狀態", [201, 200], statusList],
        ["Location", bookingPath, trace => trace[0].headers.location],
        ["查詢的預約狀態", "confirmed", trace => trace[1].body.status],
        ["查詢的時段", "SLOT-1000", trace => trace[1].body.slotId]
      ]
    },
    {
      id: "API-03", title: "同一時段重複預約回傳 409", group: "衝突", bug: "API-BUG-01", steps: [book, bookAgain],
      assertions: [
        ["HTTP 狀態", [201, 409], statusList],
        ["衝突錯誤代碼", "SLOT_UNAVAILABLE", trace => trace[1].body.error]
      ]
    },
    {
      id: "API-04", title: "同時送出兩筆，只接受一筆", group: "衝突", bug: "API-BUG-01", steps: [[book, bookAgain]],
      assertions: [
        ["HTTP 狀態（排序後）", [201, 409], trace => statusList(trace).sort()],
        ["建立筆數", 1, trace => trace.filter(step => step.status === 201).length]
      ]
    },
    {
      id: "API-05", title: "取消後釋出時段並可重新預約", group: "狀態", bug: "API-BUG-02", steps: [book, cancel, list, bookAgain],
      assertions: [
        ["HTTP 狀態", [201, 204, 200, 201], statusList],
        ["取消回應本文", null, trace => trace[1].body],
        ["取消後時段可用", true, trace => trace[2].body.slots[0].available]
      ]
    },
    {
      id: "API-06", title: "取消後查詢保留已取消狀態", group: "狀態", steps: [book, cancel, read],
      assertions: [
        ["HTTP 狀態", [201, 204, 200], statusList],
        ["查詢的預約狀態", "cancelled", trace => trace[2].body.status]
      ]
    },
    {
      id: "API-07", title: "重複取消維持 204", group: "狀態", steps: [book, cancel, cancel, read],
      assertions: [
        ["HTTP 狀態", [201, 204, 204, 200], statusList],
        ["查詢的預約狀態", "cancelled", trace => trace[3].body.status]
      ]
    },
    {
      id: "API-08", title: "空白姓名回傳 400，時段保持可用", group: "驗證", bug: "API-BUG-03",
      steps: [{ ...book, body: { ...book.body, customer: "  " } }, list],
      assertions: [
        ["HTTP 狀態", [400, 200], statusList],
        ["驗證錯誤代碼", "VALIDATION_ERROR", trace => trace[0].body.error],
        ["時段仍可用", true, trace => trace[1].body.slots[0].available]
      ]
    },
    {
      id: "API-09", title: "格式錯誤的 JSON 回傳 400", group: "驗證",
      steps: [{ ...book, body: '{"slotId":' }],
      assertions: [
        ["HTTP 狀態", [400], statusList],
        ["錯誤代碼", "INVALID_JSON", trace => trace[0].body.error]
      ]
    },
    {
      id: "API-10", title: "不存在的時段回傳 404", group: "驗證",
      steps: [{ ...book, body: { ...book.body, slotId: "SLOT-UNKNOWN" } }],
      assertions: [
        ["HTTP 狀態", [404], statusList],
        ["錯誤代碼", "SLOT_NOT_FOUND", trace => trace[0].body.error]
      ]
    },
    {
      id: "API-11", title: "查詢不存在的預約回傳 404", group: "合約",
      steps: [read],
      assertions: [
        ["HTTP 狀態", [404], statusList],
        ["錯誤代碼", "BOOKING_NOT_FOUND", trace => trace[0].body.error]
      ]
    },
    {
      id: "API-12", title: "錯誤的方法回傳 405 與 Allow", group: "合約",
      steps: [{ method: "DELETE", path: "/api/slots" }],
      assertions: [
        ["HTTP 狀態", [405], statusList],
        ["Allow", "GET", trace => trace[0].headers.allow]
      ]
    }
  ];

  async function runCase(testCase, version) {
    const trace = await runRequests(testCase.steps, version);
    const checks = testCase.assertions.map(([label, expected, readValue]) => {
      const actual = readValue(trace);
      return { label, expected, actual, passed: JSON.stringify(expected) === JSON.stringify(actual) };
    });
    return {
      id: testCase.id, title: testCase.title, group: testCase.group, bug: testCase.bug, trace, checks,
      passed: checks.every(check => check.passed)
    };
  }

  const api = { cases, createBookingApi, sendRequest, runRequests, runCase };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BookingQA = api;
})(typeof window === "object" ? window : null);
