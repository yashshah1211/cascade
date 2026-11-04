import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExecutionReceipt, RecoveryPlan, Scenario } from '../domain/types.js';
import { planHash, validatePlan, validateScenario } from '../domain/validate.js';
import { evaluatePlan } from './evaluate.js';
import { isVerifiedApproval, type VerifiedApproval } from '../switch/approval.js';

/**
 * Locally atomically publish a revision-bound group of generated artifacts.
 * Never send external messages or claim that a booking occurred.
 */
export async function applyPlan(input: {
  scenario: Scenario;
  plan: RecoveryPlan;
  trustedApprovals: readonly VerifiedApproval[];
  outputRoot: string;
}): Promise<{ receipt: ExecutionReceipt; alreadyApplied: boolean }> {
  const { scenario, plan, trustedApprovals } = input;
  validateScenario(scenario);
  validatePlan(plan, scenario);
  const report = evaluatePlan(scenario, plan, trustedApprovals);
  if (report.verdict !== 'PASS') throw new Error(`Cannot execute ${plan.id}: ${report.verdict}`);
  const hash = planHash(scenario, plan);
  const root = resolve(input.outputRoot);
  await mkdir(root, { recursive: true });
  const executionKey = `${scenario.id}-${hash.slice(0, 24)}`;
  const destination = join(root, executionKey);
  const receiptFile = join(destination, 'receipt.json');
  const existing = await readFile(receiptFile, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (existing) {
    const existingReceipt = JSON.parse(existing) as ExecutionReceipt;
    if (existingReceipt.planHash !== hash || existingReceipt.scenarioRevision !== scenario.revision || existingReceipt.scenarioId !== scenario.id) {
      throw new Error(`Existing execution receipt at ${executionKey} does not match plan hash or scenario revision`);
    }
    return { receipt: existingReceipt, alreadyApplied: true };
  }

  const approval = trustedApprovals.find(a => isVerifiedApproval(a) &&
    a.exceptionType === 'BUDGET_CAP' &&
    a.scenarioId === scenario.id && a.scenarioRevision === scenario.revision &&
    a.planHash === hash && a.verifiedHumanId === scenario.approvalAuthority.approverId &&
    a.switchRoomId === scenario.approvalAuthority.roomId && a.switchServerId === scenario.approvalAuthority.serverId &&
    a.maxExtraINR >= report.excessBudgetINR);

  if (report.excessBudgetINR > 0 && !approval) {
    throw new Error(`Cannot execute ${plan.id}: missing verified approval for excess budget INR ${report.excessBudgetINR}`);
  }

  const actions: ExecutionReceipt['actions'] = [
    { artifact: 'schedule.json', status: 'applied-locally' },
    { artifact: 'assignments.json', status: 'applied-locally' },
    { artifact: 'stakeholder-messages.md', status: 'drafted' },
  ];
  const receipt: ExecutionReceipt = {
    executionKey, scenarioId: scenario.id, scenarioRevision: scenario.revision, planId: plan.id,
    planHash: hash, state: 'APPLIED_LOCALLY', actions,
    humanApprovalEvidence: report.excessBudgetINR > 0 && approval ?
      { switchRoomId: approval.switchRoomId, approvalMessageId: approval.approvalMessageId } : null,
    note: 'Local artifacts only. No actual venue booking, supplier purchase, or stakeholder notification.',
  };
  const staging = await mkdtemp(join(root, '.staging-'));
  try {
    await writeFile(join(staging, 'schedule.json'), JSON.stringify({
      planId: plan.id, scenarioId: scenario.id, allocations: plan.allocations,
      sponsorShowcaseAt: plan.sponsorShowcaseAt, projectedCostINR: report.projectedCostINR,
    }, null, 2) + '\n');
    await writeFile(join(staging, 'assignments.json'), JSON.stringify({
      planId: plan.id, totalAttendees: scenario.attendees,
      hallAssignments: plan.allocations.map(a => ({
        hallId: a.hallId, attendeeRange: [a.attendeeFrom, a.attendeeTo],
        attendeeCount: a.attendeeTo - a.attendeeFrom + 1,
        start: a.start, end: a.end, avKitsRequired: a.avKits,
      })),
    }, null, 2) + '\n');
    await writeFile(join(staging, 'stakeholder-messages.md'), [
      '# Drafts only — NOT SENT', '',
      `Plan: ${plan.label}`, `Scenario: ${scenario.title}`, '',
      '## Attendee update draft',
      'The original auditorium is unavailable. We have prepared an alternative layout with assigned halls. Details are pending organizer confirmation.', '',
      '## Sponsor update draft',
      `The showcase remains scheduled for ${plan.sponsorShowcaseAt}. This message has not been sent.`, '',
      '## Safety note', 'Confirm accessibility, emergency exits, and local venue authorization independently before event use.', '',
    ].join('\n'));
    await writeFile(join(staging, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    await rename(staging, destination);
  } catch (e) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    const concurrent = await readFile(receiptFile, 'utf8').catch(() => null);
    if (concurrent) {
      const concurrentReceipt = JSON.parse(concurrent) as ExecutionReceipt;
      if (concurrentReceipt.planHash === hash && concurrentReceipt.scenarioRevision === scenario.revision && concurrentReceipt.scenarioId === scenario.id) {
        return { receipt: concurrentReceipt, alreadyApplied: true };
      }
    }
    throw e;
  }
  return { receipt, alreadyApplied: false };
}
