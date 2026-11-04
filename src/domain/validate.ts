import { createHash } from 'node:crypto';
import type { Allocation, Disruption, RecoveryPlan, Scenario } from './types.js';

/** Stable canonical JSON so plan identities are independent of object key ordering. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    throw new TypeError('Values must be JSON-serializable');
  return JSON.stringify(value);
}

export function planHash(scenario: Scenario, plan: RecoveryPlan): string {
  return createHash('sha256').update(canonical({ scenario, plan })).digest('hex');
}

export function isoMillis(time: string): number | null {
  if (typeof time !== 'string' || !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time)) return null;
  const value = Date.parse(time);
  return Number.isFinite(value) ? value : null;
}

function requiredString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label}: expected nonempty string`);
}
function nonnegativeInt(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label}: expected nonnegative integer`);
}

/** Known valid operational resource nodes for scenario commitments. */
export const KNOWN_RESOURCE_NODES: ReadonlySet<string> = new Set(['resource:av']);

export function validateDisruption(input: unknown): asserts input is Disruption {
  if (!input || typeof input !== 'object') throw new TypeError('Disruption must be an object');
  const d = input as Record<string, unknown>;
  for (const k of ['id', 'disabledNodeId', 'reportedAt', 'description', 'source']) requiredString(d[k], `disruption.${k}`);
  if (isoMillis(d.reportedAt as string) === null) throw new TypeError('disruption.reportedAt: ISO offset required');
}

export function validateScenario(input: unknown): asserts input is Scenario {
  if (!input || typeof input !== 'object') throw new TypeError('Scenario must be an object');
  const s = input as Record<string, unknown>;
  for (const k of ['id', 'title', 'originalVenueId', 'kickoffAt', 'sponsorShowcaseBefore', 'factsProvenance']) requiredString(s[k], `scenario.${k}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,64}$/.test(s.id as string)) throw new TypeError('scenario.id contains unsafe characters');
  for (const k of ['revision', 'attendees', 'baselineBudgetINR', 'baselineCommittedCostINR', 'avKitsAvailable', 'avKitRentalCostINR']) nonnegativeInt(s[k], `scenario.${k}`);
  if ((s.attendees as number) === 0) throw new TypeError('Scenario needs attendees');
  for (const k of ['kickoffAt', 'sponsorShowcaseBefore']) if (isoMillis(s[k] as string) === null) throw new TypeError(`scenario.${k}: ISO offset required`);
  if (!Array.isArray(s.halls) || !s.halls.length) throw new TypeError('scenario.halls empty');
  const hallIds = new Set<string>();
  for (const item of s.halls as unknown[]) {
    if (!item || typeof item !== 'object') throw new TypeError('hall invalid');
    const h = item as Record<string, unknown>;
    requiredString(h.id, 'hall.id'); requiredString(h.label, 'hall.label'); nonnegativeInt(h.capacity, 'hall.capacity');
    if (hallIds.has(h.id)) throw new TypeError('duplicate hall');
    hallIds.add(h.id);
    if (h.accessible !== true && h.accessible !== false && h.accessible !== null) throw new TypeError('hall.accessible must be true, false or null');
  }
  if (!Array.isArray(s.commitments) || s.commitments.length < 7) throw new TypeError('At least 7 commitments required');
  const ids = new Set<string>();
  const commitmentMap = new Map<string, Record<string, unknown>>();
  for (const item of s.commitments as unknown[]) {
    if (!item || typeof item !== 'object') throw new TypeError('commitment invalid');
    const c = item as Record<string, unknown>;
    for (const k of ['id','description','beneficiary','owner','approver','dueAt','provenance']) requiredString(c[k], `commitment.${k}`);
    if (ids.has(c.id as string)) throw new TypeError(`duplicate commitment ${c.id}`);
    ids.add(c.id as string);
    commitmentMap.set(c.id as string, c);
    if (c.classification !== 'hard' && c.classification !== 'negotiable') throw new TypeError('invalid classification');
    if (isoMillis(c.dueAt as string) === null) throw new TypeError('invalid commitment dueAt');
    if (!Array.isArray(c.dependencies)) throw new TypeError('missing dependencies');
  }

  const validVenues = new Set<string>([s.originalVenueId as string, ...hallIds]);
  for (const [id, c] of commitmentMap.entries()) {
    const seenPrereqs = new Set<string>();
    for (const d of c.dependencies as unknown[]) {
      if (!d || typeof d !== 'object') throw new TypeError('dependency invalid');
      const prereqId = (d as Record<string, unknown>).prerequisiteId;
      requiredString(prereqId, 'dependency.prerequisiteId');
      if (!['requires', 'enables', 'scheduled-at'].includes(String((d as Record<string, unknown>).kind))) {
        throw new TypeError('invalid dependency kind');
      }
      if (prereqId === id) {
        throw new TypeError(`Self-dependency detected: commitment ${id} cannot depend on itself`);
      }
      if (seenPrereqs.has(prereqId)) {
        throw new TypeError(`Duplicate dependency detected in commitment ${id} for prerequisite ${prereqId}`);
      }
      seenPrereqs.add(prereqId);

      if (prereqId.startsWith('commitment:')) {
        if (!ids.has(prereqId)) {
          throw new TypeError(`Missing dependency: commitment ${id} references nonexistent commitment ${prereqId}`);
        }
      } else if (prereqId.startsWith('venue:')) {
        if (!validVenues.has(prereqId)) {
          throw new TypeError(`Missing dependency: commitment ${id} references unknown venue ${prereqId}`);
        }
      } else if (prereqId.startsWith('resource:')) {
        if (!KNOWN_RESOURCE_NODES.has(prereqId)) {
          throw new TypeError(`Missing dependency: commitment ${id} references unknown resource ${prereqId}`);
        }
      } else {
        throw new TypeError(`Missing dependency: commitment ${id} references unresolvable prerequisite ${prereqId}`);
      }
    }
  }

  // Cyclic dependency check across commitments using DFS
  const visitState = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  function detectCycle(nodeId: string, stack: string[]): void {
    visitState.set(nodeId, 1);
    const comm = commitmentMap.get(nodeId);
    if (comm) {
      for (const d of (comm.dependencies as Array<{ prerequisiteId: string }>)) {
        const prereq = d.prerequisiteId;
        if (!ids.has(prereq)) continue;
        const state = visitState.get(prereq) ?? 0;
        if (state === 1) {
          const cyclePath = [...stack, prereq].join(' -> ');
          throw new TypeError(`Cyclic dependency detected among commitments: ${cyclePath}`);
        }
        if (state === 0) {
          detectCycle(prereq, [...stack, prereq]);
        }
      }
    }
    visitState.set(nodeId, 2);
  }

  for (const id of ids) {
    if ((visitState.get(id) ?? 0) === 0) {
      detectCycle(id, [id]);
    }
  }

  if (!s.approvalAuthority || typeof s.approvalAuthority !== 'object') throw new TypeError('missing approvalAuthority');
  for (const k of ['approverId','serverId','roomId']) requiredString((s.approvalAuthority as Record<string, unknown>)[k], `approvalAuthority.${k}`);
}

export function validatePlan(input: unknown, scenario: Scenario): asserts input is RecoveryPlan {
  if (!input || typeof input !== 'object') throw new TypeError('Plan must be an object');
  const p = input as Record<string, unknown>;
  for (const k of ['id', 'label', 'scenarioId', 'sponsorShowcaseAt','note']) requiredString(p[k], `plan.${k}`);
  if (p.scenarioId !== scenario.id) throw new TypeError('Plan scenario mismatch');
  nonnegativeInt(p.scenarioRevision, 'plan.scenarioRevision');
  nonnegativeInt(p.rentedAvKits, 'plan.rentedAvKits');
  if (isoMillis(p.sponsorShowcaseAt as string) === null) throw new TypeError('Sponsor time must be offset ISO');
  if (!Array.isArray(p.allocations) || p.allocations.length === 0) throw new TypeError('Plan must have allocations');
  const halls = new Set(scenario.halls.map(h => h.id));
  for (const a of p.allocations as Allocation[]) {
    if (!halls.has(a.hallId)) throw new TypeError(`Unknown hall ${String(a.hallId)}`);
    for (const k of ['attendeeFrom','attendeeTo','avKits'] as const) nonnegativeInt(a[k], `allocation.${k}`);
    requiredString(a.start, 'allocation.start'); requiredString(a.end, 'allocation.end');
    if (isoMillis(a.start) === null || isoMillis(a.end) === null) throw new TypeError('Allocation ISO offset required');
    if (isoMillis(a.start)! >= isoMillis(a.end)!) throw new TypeError('Allocation start must precede end');
    if (a.attendeeFrom > a.attendeeTo) throw new TypeError('Invalid attendee range');
  }
}
