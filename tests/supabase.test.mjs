import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";

test("Supabase-backed API contracts with an isolated mock HTTP transport", async (t) => {
  const csvPaths = ["data/seed-requests.csv"];
  const csvBefore = await Promise.all(csvPaths.map((file) => readFile(file)));
  const records = Array.from({ length: 23 }, (_, index) => ({
    id: index + 1,
    created_at: index === 22 ? "2026-11-16T18:36:20.501Z" : "2026-08-10T15:47:00Z",
    requester_name: `Fixture ${index + 1}`,
    location: "Denver",
    description: 'Test comma, quote "here"\nsecond line',
    priority: [6, 11, 15, 22, 23].includes(index + 1) ? "Urgent" : "High",
    status: index < 13 ? "Complete" : index < 19 ? "In Progress" : "New",
  }));
  let fail = false;
  let calls = 0;
  let inserts = 0;
  const transport = async (input, init) => {
    calls += 1;
    assert.equal(init.cache, "no-store");
    const url = new URL(input);
    assert.equal(url.origin, "https://fixture.supabase.co");
    assert.equal(url.pathname, "/rest/v1/requests");
    assert.equal(url.searchParams.get("select"),
      "id,created_at,requester_name,location,description,priority,status");
    if (fail) return Response.json({ message: "private database failure" }, { status: 500 });
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.id, undefined);
      assert.equal(body.created_at, undefined);
      assert.equal(body.status, "New");
      const row = { ...body, id: 24 + inserts++, created_at: "2026-11-17T10:00:00Z" };
      records.push(row);
      return Response.json(row, { status: 201 });
    }
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ["status"]);
      const row = records.find((record) => `eq.${record.id}` === url.searchParams.get("id"));
      if (row) row.status = body.status;
      return Response.json(row ? [row] : []);
    }
    assert.equal(url.searchParams.get("order"), "id.asc");
    assert.equal(url.searchParams.get("limit"), "500");
    const after = Number((url.searchParams.get("id") || "gt.0").slice(3));
    // Deliberately return fewer records than requested to exercise server caps.
    return Response.json(records.filter((row) => row.id > after).sort((a, b) => a.id - b.id).slice(0, 7));
  };
  const context = vm.createContext({
    Response,
    fetch: transport,
    process: { env: { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SECRET_KEY: "fixture-only" } },
  });
  const empty = new vm.SyntheticModule([], function () {}, { context });
  const sdk = new vm.SyntheticModule(["createClient"], function () {
    this.setExport("createClient", (url, key, options) => {
      assert.equal(url, "https://fixture.supabase.co");
      assert.equal(key, "fixture-only");
      assert.equal(options.db.schema, "public");
      assert.equal(options.auth.persistSession, false);
      assert.equal(options.auth.autoRefreshToken, false);
      assert.equal(options.auth.detectSessionInUrl, false);
      return createClient(url, key, options);
    });
  }, { context });
  const modules = new Map();
  async function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = new vm.SourceTextModule(await readFile(file, "utf8"), { context });
    modules.set(file, module);
    await module.link((specifier) => {
      if (specifier === "server-only") return empty;
      if (specifier === "@supabase/supabase-js") return sdk;
      if (specifier.endsWith("supabase")) return load("lib/supabase.js");
      if (specifier.endsWith("requests")) return load("lib/requests.js");
      throw new Error(`Unexpected import: ${specifier}`);
    });
    await module.evaluate();
    return module;
  }
  const requests = (await load("app/api/requests/route.js")).namespace;
  const patch = (await load("app/api/requests/[id]/route.js")).namespace.PATCH;
  const summary = (await load("app/api/summary/route.js")).namespace.GET;
  const exportCsv = (await load("app/api/export/route.js")).namespace.GET;
  const request = (body) => new Request("http://localhost/api/requests", {
    method: "POST", body: JSON.stringify(body),
  });
  const params = (id) => ({ params: Promise.resolve({ id }) });

  await t.test("missing server configuration fails before any database call", async () => {
    delete context.process.env.SUPABASE_SECRET_KEY;
    const response = await requests.GET();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Could not load requests." });
    assert.equal(calls, 0);
    context.process.env.SUPABASE_SECRET_KEY = "fixture-only";
  });

  await t.test("all pages, stable IDs, newest-first sorting and UTC summary", async () => {
    const response = await requests.GET();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.requests.length, 23);
    assert.deepEqual(data.requests.map((row) => row.id), Array.from({ length: 23 }, (_, i) => 23 - i));
    assert.ok(calls >= 5);
    assert.deepEqual(await (await summary()).json(), {
      open_requests: 10, urgent_open: 3, completed_this_month: 0,
    });
  });
  await t.test("invalid POST and PATCH input never reaches the database", async () => {
    const before = calls;
    const valid = { requester_name: "Test", location: "Denver", description: "Repair lights", priority: "High" };
    for (const field of Object.keys(valid)) {
      for (const value of [undefined, null, 42, " \t\n "]) {
        assert.equal((await requests.POST(request({ ...valid, [field]: value }))).status, 400);
      }
    }
    for (const invalid of [{ location: "Boston" }, { priority: "high" }, { description: "x".repeat(501) }]) {
      assert.equal((await requests.POST(request({ ...valid, ...invalid }))).status, 400);
    }
    assert.equal((await requests.POST(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
    for (const id of [undefined, "abc", "0", "-1", "1.5", "9007199254740992"]) {
      assert.equal((await patch(request({ status: "New" }), params(id))).status, 400);
    }
    for (const status of [undefined, null, "complete", " New ", 42]) {
      assert.equal((await patch(request({ status }), params("23"))).status, 400);
    }
    assert.equal((await requests.PATCH()).status, 400);
    assert.equal(calls, before);
  });
  await t.test("PATCH preserves other fields and refreshes summary; absent ID is 404", async () => {
    const before = structuredClone(records);
    const response = await patch(request({ status: "Complete", priority: "Low" }), params("23"));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).request, { ...before[22], status: "Complete" });
    assert.deepEqual(records, before.map((row) => row.id === 23 ? { ...row, status: "Complete" } : row));
    assert.deepEqual(await (await summary()).json(), {
      open_requests: 9, urgent_open: 2, completed_this_month: 1,
    });
    assert.equal((await patch(request({ status: "New" }), params("99999"))).status, 404);
  });
  await t.test("POST trims fields and uses database defaults and returned ID", async () => {
    const response = await requests.POST(request({
      requester_name: " Test ", location: " Austin ", description: "x".repeat(500), priority: " Medium ",
      id: 999, status: "Complete", created_at: "2000-01-01",
    }));
    assert.equal(response.status, 201);
    const { request: saved } = await response.json();
    assert.equal(saved.id, 24);
    assert.equal(saved.requester_name, "Test");
    assert.equal(saved.location, "Austin");
    assert.equal(saved.priority, "Medium");
    assert.equal(saved.status, "New");
    assert.equal(saved.created_at, "2026-11-17T10:00:00Z");
  });
  await t.test("export preserves six-column CSV format, escaping and download headers", async () => {
    const response = await exportCsv();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
    assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="morrowlane-requests.csv"');
    const csv = await response.text();
    assert.ok(csv.startsWith("created_at,requester_name,location,description,priority,status\r\n"));
    assert.ok(csv.includes('"Test comma, quote ""here""\nsecond line"'));
  });
  await t.test("database failures return sanitized JSON from all five operations", async () => {
    fail = true;
    for (const operation of [requests.GET, summary, exportCsv,
      () => requests.POST(request({ requester_name: "Test", location: "Denver", description: "Repair", priority: "High" })),
      () => patch(request({ status: "New" }), params("23"))]) {
      const response = await operation();
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
      assert.ok(!body.error.includes("private database failure"));
      assert.ok(!body.error.includes("fixture-only"));
    }
    fail = false;
    records.length = 0;
    assert.deepEqual(await (await requests.GET()).json(), { requests: [] });
    assert.deepEqual(await (await summary()).json(), {
      open_requests: 0, urgent_open: 0, completed_this_month: 0,
    });
  });
  for (let i = 0; i < csvPaths.length; i++) {
    assert.deepEqual(await readFile(csvPaths[i]), csvBefore[i]);
  }
});
