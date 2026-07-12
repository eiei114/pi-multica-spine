import assert from "node:assert/strict";
import test from "node:test";

const registerExtension = (await import("../extensions/index.ts")).default;

function createMockAPI() {
  /** @type {Map<string, Array<(event: unknown, ctx: unknown) => unknown>>} */
  const handlers = new Map();

  const api = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool() {},
  };

  async function emit(eventName, event, ctx) {
    for (const handler of handlers.get(eventName) ?? []) {
      await handler(event, ctx);
    }
  }

  return { api, handlers, emit };
}

function createMockUI() {
  /** @type {Array<{ id: string, text: string }>} */
  const statuses = [];

  const ui = {
    setStatus(id, text) {
      statuses.push({ id, text });
    },
  };

  return { ui, statuses };
}

function createMockContext({ ui, hasUI = true }) {
  return { ui, hasUI, cwd: process.cwd() };
}

test("session_start skips setStatus when hasUI is false", async () => {
  const { api, handlers, emit } = createMockAPI();
  registerExtension(api);

  const { ui, statuses } = createMockUI();
  const ctx = createMockContext({ ui, hasUI: false });

  assert.ok(handlers.has("session_start"));
  await emit("session_start", { type: "session_start" }, ctx);

  assert.equal(statuses.length, 0);
});

test("session_start sets status when hasUI is true", async () => {
  const { api, handlers, emit } = createMockAPI();
  registerExtension(api);

  const { ui, statuses } = createMockUI();
  const ctx = createMockContext({ ui, hasUI: true });

  assert.ok(handlers.has("session_start"));
  await emit("session_start", { type: "session_start" }, ctx);

  assert.deepEqual(statuses, [{ id: "multica-spine", text: "Multica spine ready" }]);
});

test("session_shutdown handler is registered", async () => {
  const { api, handlers, emit } = createMockAPI();
  registerExtension(api);

  assert.ok(handlers.has("session_shutdown"));
  await assert.doesNotReject(async () => {
    await emit("session_shutdown", { type: "session_shutdown" }, {});
  });
});
