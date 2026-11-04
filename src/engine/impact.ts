import type { Commitment, Disruption, Impact, Scenario } from '../domain/types.js';
import { validateDisruption, validateScenario } from '../domain/validate.js';

/** Builds a directed prerequisite → dependent graph, and returns explainable BFS paths. */
export function traceImpact(scenario: Scenario, disruption: Disruption): Impact[] {
  validateScenario(scenario);
  validateDisruption(disruption);

  const outgoing = new Map<string, Set<string>>();
  const commitments = new Map<string, Commitment>();
  for (const c of scenario.commitments) {
    commitments.set(c.id, c);
    for (const d of c.dependencies) {
      const set = outgoing.get(d.prerequisiteId) ?? new Set<string>();
      set.add(c.id);
      outgoing.set(d.prerequisiteId, set);
    }
  }
  const queue: string[][] = [[disruption.disabledNodeId]];
  const seen = new Set([disruption.disabledNodeId]);
  const impacted: Impact[] = [];
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!;
    const current = path[path.length - 1]!;
    const neighbors = [...(outgoing.get(current) ?? [])].sort();
    for (const next of neighbors) {
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
