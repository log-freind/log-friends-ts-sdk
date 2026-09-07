import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import { describe, expect, it } from "vitest";
import { BoundedEventQueue } from "../../src/core/bounded-event-queue.js";
import { estimateByteSize } from "../../src/core/event-sanitizer.js";
import type { ClientEvent } from "../../src/core/types.js";

describe("Node V8 heap diagnostic", () => {
  it("writes before and after snapshots with discoverable Log Friends queue entries", () => {
    if (process.env.LOGFRIENDS_HEAP_DIAGNOSTIC !== "true") return;

    const directory = mkdtempSync(join(tmpdir(), "logfriends-heap-"));
    const queue = new BoundedEventQueue({ maxSize: 10, maxBytes: 1024 * 1024 });
    const beforeHeap = getHeapStatistics().used_heap_size;
    const beforePath = writeHeapSnapshot(join(directory, "before.heapsnapshot"));

    const event = makeDiagnosticEvent();
    const estimatedPayloadBytes = estimateByteSize(event);
    queue.push(event);

    const afterHeap = getHeapStatistics().used_heap_size;
    const afterPath = writeHeapSnapshot(join(directory, "after.heapsnapshot"));
    const queueEntry = inspectNamedNodes(afterPath, "LogFriendsQueueEntry");

    expect(queueEntry.entryCount).toBe(1);
    expect(queueEntry.entryShallowBytes).toBeGreaterThan(0);
    expect(queueEntry.reachableShallowBytes).toBeGreaterThan(queueEntry.entryShallowBytes);
    const estimateDifferenceBytes = estimatedPayloadBytes - queueEntry.reachableShallowBytes;
    const estimateDifferencePercent = (estimateDifferenceBytes / queueEntry.reachableShallowBytes) * 100;
    console.log(
      `[Log Friends V8 Heap] beforeUsed=${beforeHeap}, afterUsed=${afterHeap}, ` +
        `queueEntryCount=${queueEntry.entryCount}, queueEntryShallowBytes=${queueEntry.entryShallowBytes}, ` +
        `queueReachableNodes=${queueEntry.reachableNodeCount}, ` +
        `queueReachableShallowBytes=${queueEntry.reachableShallowBytes}, ` +
        `estimatedPayloadBytes=${estimatedPayloadBytes}, ` +
        `estimateDifferenceBytes=${estimateDifferenceBytes}, ` +
        `estimateDifferencePercent=${estimateDifferencePercent.toFixed(2)}, ` +
        `beforeSnapshot=${beforePath}, afterSnapshot=${afterPath}`,
    );
  });
});

function makeDiagnosticEvent(): ClientEvent {
  return {
    type: "LOG_EVENT",
    timestamp: new Date().toISOString(),
    eventName: "cartItemAdded",
    eventId: "heap-diagnostic-event",
    payload: { message: "서울 여행 일정 생성 실패: ".repeat(512) },
  };
}

function inspectNamedNodes(
  snapshotPath: string,
  expectedName: string,
): {
  entryCount: number;
  entryShallowBytes: number;
  reachableNodeCount: number;
  reachableShallowBytes: number;
} {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    snapshot: {
      meta: {
        node_fields: string[];
        node_types: Array<string[] | string>;
        edge_fields: string[];
        edge_types: Array<string[] | string>;
      };
    };
    nodes: number[];
    edges: number[];
    strings: string[];
  };
  const fields = snapshot.snapshot.meta.node_fields;
  const nodeWidth = fields.length;
  const typeOffset = fields.indexOf("type");
  const nameOffset = fields.indexOf("name");
  const shallowSizeOffset = fields.indexOf("self_size");
  const nodeTypes = snapshot.snapshot.meta.node_types[typeOffset] as string[];
  const objectTypeIndex = nodeTypes.indexOf("object");
  expect(typeOffset).toBeGreaterThanOrEqual(0);
  expect(nameOffset).toBeGreaterThanOrEqual(0);
  expect(shallowSizeOffset).toBeGreaterThanOrEqual(0);

  const edgeFields = snapshot.snapshot.meta.edge_fields;
  const edgeWidth = edgeFields.length;
  const edgeTypeOffset = edgeFields.indexOf("type");
  const edgeNameOffset = edgeFields.indexOf("name_or_index");
  const edgeTargetOffset = edgeFields.indexOf("to_node");
  const edgeTypes = snapshot.snapshot.meta.edge_types[edgeTypeOffset] as string[];
  const edgeCountOffset = fields.indexOf("edge_count");
  const nodeCount = snapshot.nodes.length / nodeWidth;
  const edgeStarts = new Int32Array(nodeCount);
  let edgeCursor = 0;
  const entryNodes: number[] = [];

  for (let node = 0; node < nodeCount; node++) {
    const offset = node * nodeWidth;
    edgeStarts[node] = edgeCursor;
    edgeCursor += snapshot.nodes[offset + edgeCountOffset];
    if (snapshot.nodes[offset + typeOffset] !== objectTypeIndex) continue;
    if (snapshot.strings[snapshot.nodes[offset + nameOffset]] === expectedName) {
      entryNodes.push(node);
    }
  }

  const visited = new Set(entryNodes);
  const pending = [...entryNodes];
  let reachableShallowBytes = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    const offset = node * nodeWidth;
    const nodeType = nodeTypes[snapshot.nodes[offset + typeOffset]];
    reachableShallowBytes += snapshot.nodes[offset + shallowSizeOffset];
    const edgeCount = snapshot.nodes[offset + edgeCountOffset];

    for (let edge = 0; edge < edgeCount; edge++) {
      const edgeOffset = (edgeStarts[node] + edge) * edgeWidth;
      const edgeType = edgeTypes[snapshot.edges[edgeOffset + edgeTypeOffset]];
      const edgeName = snapshot.strings[snapshot.edges[edgeOffset + edgeNameOffset]];
      const isOwnReference =
        (edgeType === "property" && edgeName !== "__proto__") ||
        edgeType === "element" ||
        // V8 represents rope/sliced String contents through internal edges.
        (edgeType === "internal" && isStringNode(nodeType));
      if (!isOwnReference) continue;

      const target = snapshot.edges[edgeOffset + edgeTargetOffset] / nodeWidth;
      if (!visited.has(target)) {
        visited.add(target);
        pending.push(target);
      }
    }
  }

  const entryShallowBytes = entryNodes.reduce(
    (sum, node) => sum + snapshot.nodes[node * nodeWidth + shallowSizeOffset],
    0,
  );
  return {
    entryCount: entryNodes.length,
    entryShallowBytes,
    reachableNodeCount: visited.size,
    reachableShallowBytes,
  };
}

function isStringNode(nodeType: string): boolean {
  return nodeType === "string" || nodeType === "concatenated string" || nodeType === "sliced string";
}
