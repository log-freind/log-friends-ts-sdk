import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseLogFriendsClient } from "../../src/core/base-client.js";
import { registerAgent } from "../../src/discovery/agent-registration.js";
import type { IngestRequest, IngestResponse, TransportSender } from "../../src/core/types.js";

class TestClient extends BaseLogFriendsClient {
  constructor() {
    const sender: TransportSender = {
      send: async (_url: string, body: IngestRequest): Promise<IngestResponse> => ({
        received: body.events.length,
        stored: body.events.length,
        failed: 0,
      }),
    };
    super({ ingestUrl: "https://console.example/ingest", workerId: "michi-backend", sourceType: "NODE", flushIntervalMs: 0 }, sender);
  }
  protected override resolveSessionId(): string | undefined { return undefined; }
  protected override resolveAppInstanceId(): string | undefined { return undefined; }
}

describe("registerAgent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registers the worker and returns the Console-issued agent ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: async () => ({ agentId: 37 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerAgent(new TestClient(), {
      appName: "michi",
      appVersion: "2.4.0",
      sourceType: "NODE",
    });

    expect(result).toEqual({ success: true, agentId: 37 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.example/api/agents",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      workerId: "michi-backend",
      appName: "michi",
      sourceType: "NODE",
      sdkVersion: "1.0.12",
      metadata: { appVersion: "2.4.0" },
    });
  });
});
