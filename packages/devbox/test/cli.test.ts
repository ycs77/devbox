import { describe, expect, it, vi } from "vitest";

import { present, runCli } from "../src/cli.js";
import { failure, success } from "../src/result.js";

describe("runCli", () => {
  it("adapts init through Citty and presents successful registration", async () => {
    const initializeProject = vi.fn(async () =>
      success({
        root: "/workspace/non-git-project",
        stateDirectory: "/home/user/.devbox/projects/workspace/non-git-project",
        created: true,
      }),
    );

    const result = await runCli(["init"], { initializeProject });
    const output = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    expect(initializeProject).toHaveBeenCalledOnce();
    expect(present(result, output)).toBe(0);
    expect(output.stdout.write).toHaveBeenCalledWith(
      "Registered Project: /workspace/non-git-project\n",
    );
    expect(output.stderr.write).not.toHaveBeenCalled();
  });

  it("rejects invalid command usage before invoking operations", async () => {
    const initializeProject = vi.fn();
    const result = await runCli(["init", "unexpected"], { initializeProject });
    const output = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    expect(initializeProject).not.toHaveBeenCalled();
    expect(present(result, output)).toBe(2);
    expect(output.stderr.write).toHaveBeenCalledWith(
      "devbox init does not accept arguments.\nRun devbox init without arguments.\n",
    );
  });

  it("renders validation failures with the public failure status", async () => {
    const result = await runCli(["init"], {
      initializeProject: async () =>
        failure({
          kind: "validation",
          code: "unsupported-host",
          observed: "Devbox supports only WSL2 linux/amd64.",
          nextAction: "Run Devbox from WSL2.",
        }),
    });
    const output = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    expect(present(result, output)).toBe(1);
    expect(output.stderr.write).toHaveBeenCalledWith(
      "Devbox supports only WSL2 linux/amd64.\nRun Devbox from WSL2.\n",
    );
  });
});
