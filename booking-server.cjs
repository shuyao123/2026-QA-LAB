"use strict";

const { createServer } = require("node:http");
const { Readable } = require("node:stream");
const { createBookingApi } = require("./dist/booking.js");

function createBookingServer(version = "fixed") {
  const handleRequest = createBookingApi(version);
  return createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method;
      const options = { method, headers: incoming.headers };
      if (method === "POST") {
        options.body = Readable.toWeb(incoming);
        options.duplex = "half";
      }
      const request = new Request("http://127.0.0.1" + incoming.url, options);
      const response = await handleRequest(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
    }
  });
}

if (require.main === module) {
  const version = process.env.BOOKING_VERSION || "fixed";
  if (!["legacy", "fixed"].includes(version)) throw new Error("BOOKING_VERSION must be legacy or fixed.");
  createBookingServer(version).listen(8780, "127.0.0.1", () => {
    console.log("Mock booking API [" + version + "] http://127.0.0.1:8780/api/slots");
  });
}

module.exports = { createBookingServer };
