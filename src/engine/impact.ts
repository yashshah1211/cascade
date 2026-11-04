import type { Commitment, Disruption, Impact, Scenario } from '../domain/types.js';

/** Builds a directed prerequisite → dependent graph, and returns explainable BFS paths. */
export function traceImpact(scenario: Scenario, disruption: Disruption): Impact[] {
  const outgoing = new Map<string, string[]>();
  const commitments = new Map<string, Commitment>();
  for (const c of scenario.commitments) {
    commitments.set(c.id, c);
    for (const d of c.dependencies) {
      const list = outgoing.get(d.prerequisiteId) ?? [];
      list.push(c.id);
      outgoing.set(d.prerequisiteId, list);
    }
  }
  const queue: string[][] = [[disruption.disabledNodeId]];
  const seen = new Set([disruption.disabledNodeId]);
  const impacted: Impact[] = [];
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!;
    const current = path[path.length - 1]!;
    for (const next of (outgoing.get(current) ?? []).sort()) {
      if (seen.has(next)) continue;
      seen.add(next);
      const nextPath = [...path, next];
      const c = commitments.get(next);
      if (c) impacted.push({ commitmentId: next, description: c.description, path: nextPath });
      queue.push(nextPath);
    }
  }
  return impacted.sort((a, b) => a.commitmentId.localeCompare(b.commitmentId));
}
