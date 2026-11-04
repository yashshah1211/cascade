import type { Allocation, ConstraintCheck, PlanEvaluation, RecoveryPlan, Scenario, Verdict } from '../domain/types.js';
import { isoMillis, planHash, validatePlan, validateScenario } from '../domain/validate.js';
import { isVerifiedApproval, type VerifiedApproval } from '../switch/approval.js';

function check(id: string, status: ConstraintCheck['status'], message: string, evidence: Record<string, unknown>): ConstraintCheck {
  return { id, status, message, evidence };
}

/** Maximum concurrent AV demand over all start/end events. End-before-start on equal timestamps. */
function avPeak(allocations: Allocation[]): { time: string; count: number; halls: string[] } {
  const checkpoints = [...new Set(allocations.flatMap(a => [a.start, a.end]))]
    .sort((a, b) => isoMillis(a)! - isoMillis(b)!);
  let peak = { time: checkpoints[0] ?? '', count: 0, halls: [] as string[] };
  for (const time of checkpoints) {
    const t = isoMillis(time)!;
    const active = allocations.filter(a => isoMillis(a.start)! <= t && t < isoMillis(a.end)!);
    const count = active.reduce((n, a) => n + a.avKits, 0);
    if (count > peak.count) peak = { time, count, halls: [...new Set(active.map(a => a.hallId))] };
  }
  return peak;
}

function capacityChecks(scenario: Scenario, plan: RecoveryPlan): ConstraintCheck[] {
  const halls = new Map(scenario.halls.map(h => [h.id, h]));
  const problems: { hallId: string; at: string; allocated: number; capacity: number }[] = [];
  for (const hall of scenario.halls) {
    const usage = plan.allocations.filter(a => a.hallId === hall.id);
    const checkpoints = [...new Set(usage.map(a => a.start))].sort();
    for (const at of checkpoints) {
      const t = isoMillis(at)!;
      const allocated = usage
        .filter(a => isoMillis(a.start)! <= t && t < isoMillis(a.end)!)
        .reduce((n, a) => n + a.attendeeTo - a.attendeeFrom + 1, 0);
      if (allocated > hall.capacity) problems.push({ hallId: hall.id, at, allocated, capacity: hall.capacity });
    }
  }
  return [problems.length
    ? check('CAPACITY', 'FAIL', 'At least one hall exceeds its occupancy limit', { problems })
    : check('CAPACITY', 'PASS', 'Every hall fits its assigned attendees at every active time', {
      hallCapacities: Object.fromEntries([...halls].map(([id,h]) => [id,h.capacity])),
    })];
}

export function evaluatePlan(scenario: Scenario, plan: RecoveryPlan, approvals: readonly VerifiedApproval[] = []): PlanEvaluation {
  validateScenario(scenario);
  validatePlan(plan, scenario);
  const hash = planHash(scenario, plan);
  const checks: ConstraintCheck[] = [];
  const invalidRevision = plan.scenarioRevision !== scenario.revision;
  checks.push(check('REVISION', invalidRevision ? 'FAIL' : 'PASS',
    invalidRevision ? 'Plan was made against a different scenario revision' : 'Scenario revision matches plan',
    { planRevision: plan.scenarioRevision, scenarioRevision: scenario.revision }));

  const attendeeHits = new Uint16Array(scenario.attendees);
  const outOfRange: string[] = [];
  for (const [index, a] of plan.allocations.entries()) {
    if (a.attendeeFrom >= scenario.attendees || a.attendeeTo >= scenario.attendees) {
      outOfRange.push(`allocation-${index}`);
      continue;
    }
    for (let n = a.attendeeFrom; n <= a.attendeeTo; n++) attendeeHits[n]!++;
  }
  const missing = [] as number[];
  const repeated = [] as number[];
  attendeeHits.forEach((hits, i) => { if (hits === 0) missing.push(i); if (hits > 1) repeated.push(i); });
  const coverageOk = !missing.length && !repeated.length && !outOfRange.length;
  checks.push(check('ATTENDEE_COVERAGE', coverageOk ? 'PASS' : 'FAIL',
    coverageOk ? 'All attendees are assigned exactly once' : 'Attendees are missing, duplicated or outside range',
    { expected: scenario.attendees, assigned: scenario.attendees - missing.length, missingCount: missing.length, repeatedCount: repeated.length, outOfRange }));

  checks.push(...capacityChecks(scenario, plan));

  const halls = new Map(scenario.halls.map(h => [h.id,h]));
  const selected = [...new Set(plan.allocations.map(a => a.hallId))].map(id => halls.get(id)!);
  const inaccessible = selected.filter(h => h.accessible === false).map(h => h.id);
  const unknown = selected.filter(h => h.accessible === null).map(h => h.id);
  checks.push(check('ACCESSIBILITY', inaccessible.length ? 'FAIL' : unknown.length ? 'UNKNOWN' : 'PASS',
    inaccessible.length ? 'At least one selected hall is inaccessible' : unknown.length ? 'Accessibility has not been verified' : 'All selected halls are reported accessible',
    { inaccessible, unknown, provenance: scenario.factsProvenance }));

  const kickoff = isoMillis(scenario.kickoffAt)!;
  const unsynchronized = plan.allocations.filter(a => isoMillis(a.start) !== kickoff);
  checks.push(check('SYNCHRONIZED_KICKOFF', unsynchronized.length ? 'FAIL' : 'PASS',
    unsynchronized.length ? 'Not all participants start the shared kickoff at the promised time' : 'All assigned attendees start simultaneously at the promised time',
    { promised: scenario.kickoffAt, nonmatching: unsynchronized.map(a => ({ hallId: a.hallId, start: a.start })) }));

  const av = avPeak(plan.allocations);
  const avSupply = scenario.avKitsAvailable + plan.rentedAvKits;
  checks.push(check('AV_CONCURRENCY', av.count > avSupply ? 'FAIL' : 'PASS',
    av.count > avSupply ? `Peak demand requires ${av.count} AV kits, only ${avSupply} supplied` : 'AV supply covers peak simultaneous demand',
    { peakDemand: av.count, availableSupply: avSupply, peakAt: av.time, simultaneousHalls: av.halls }));

  const sponsor = isoMillis(plan.sponsorShowcaseAt)!;
  checks.push(check('SPONSOR_DEADLINE', sponsor >= isoMillis(scenario.sponsorShowcaseBefore)! ? 'FAIL' : 'PASS',
    sponsor >= isoMillis(scenario.sponsorShowcaseBefore)! ? 'Sponsor showcase occurs after the committed cutoff' : 'Sponsor showcase is scheduled before cutoff',
    { showcaseAt: plan.sponsorShowcaseAt, deadline: scenario.sponsorShowcaseBefore }));

  const projectedCostINR = scenario.baselineCommittedCostINR + plan.rentedAvKits * scenario.avKitRentalCostINR;
  const excessBudgetINR = Math.max(0, projectedCostINR - scenario.baselineBudgetINR);
  const validApproval = approvals.find(a => isVerifiedApproval(a) &&
    a.exceptionType === 'BUDGET_CAP' && a.planHash === hash && a.scenarioId === scenario.id &&
    a.scenarioRevision === scenario.revision && a.switchServerId === scenario.approvalAuthority.serverId &&
    a.switchRoomId === scenario.approvalAuthority.roomId && a.verifiedHumanId === scenario.approvalAuthority.approverId &&
    a.maxExtraINR >= excessBudgetINR);
  const status = excessBudgetINR === 0 || validApproval ? 'PASS' : 'REQUIRES_APPROVAL';
  checks.push(check('BUDGET_CAP', status, status === 'PASS' ? 'Budget authorization satisfied' : `INR ${excessBudgetINR} exception requires verified human approval in Switch`,
    { projectedCostINR, baselineCapINR: scenario.baselineBudgetINR, excessBudgetINR, approvalMessageId: validApproval?.approvalMessageId ?? null }));

  let verdict: Verdict = 'PASS';
  if (checks.some(c => c.status === 'FAIL')) verdict = 'FAIL';
  else if (checks.some(c => c.status === 'UNKNOWN')) verdict = 'UNKNOWN';
  else if (checks.some(c => c.status === 'REQUIRES_APPROVAL')) verdict = 'REQUIRES_APPROVAL';
  return {
    scenarioId: scenario.id, planId: plan.id, planHash: hash, scenarioRevision: scenario.revision,
    verdict, projectedCostINR, excessBudgetINR, checks,
    requiredApprovals: checks.filter(c => c.status === 'REQUIRES_APPROVAL').map(c => c.id),
    evaluatedAt: new Date().toISOString(),
  };
}
