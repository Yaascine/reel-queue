const test = require("node:test");
const assert = require("node:assert/strict");
const { AutomationManager } = require("../src/automation-manager");

function managerFixture() {
  const workspaces = [
    { id: "mma", name: "MMA", settings: {} },
    { id: "football", name: "Football", settings: {} }
  ];
  const runners = new Map();
  const store = {
    listWorkspaces: async () => workspaces,
    getWorkspace: async (id) => workspaces.find((workspace) => workspace.id === id) || null,
    saveWorkspaceSettings: async (_id, settings) => settings,
    removeWorkspace: async () => true
  };
  const manager = new AutomationManager({
    store,
    chrome: {},
    emit: () => {},
    runnerFactory: ({ workspaceId }) => {
      const runner = {
        workspaceId,
        profileId: "",
        running: false,
        start: async (settings) => {
          runner.profileId = settings.profileId;
          runner.running = true;
          return runner.getStatus();
        },
        stop: async () => {
          runner.running = false;
          return runner.getStatus();
        },
        getStatus: () => ({ workspaceId, running: runner.running, mode: runner.running ? "running" : "idle" })
      };
      runners.set(workspaceId, runner);
      return runner;
    }
  });
  return { manager, runners };
}

test("runs different Instagram profiles concurrently", async () => {
  const { manager, runners } = managerFixture();
  await manager.start("mma", { profileId: "account-mma" });
  await manager.start("football", { profileId: "account-football" });
  assert.equal(runners.get("mma").running, true);
  assert.equal(runners.get("football").running, true);
});

test("prevents two queues from controlling the same Instagram profile", async () => {
  const { manager } = managerFixture();
  await manager.start("mma", { profileId: "same-account" });
  await assert.rejects(
    () => manager.start("football", { profileId: "same-account" }),
    /already running in another queue tab/i
  );
});
