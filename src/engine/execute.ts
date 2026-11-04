import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExecutionReceipt, RecoveryPlan, Scenario } from '../domain/types.js';
import { planHash, validatePlan, validateScenario } from '../domain/validate.js';
import { evaluatePlan } from './evaluate.js';
import { isVerifiedApproval, type VerifiedApproval } from '../switch/approval.js';

export const EXPECTED_ACTIONS: ReadonlyArray<ExecutionReceipt['actions'][number]> = Object.freeze([
  { artifact: 'schedule.json', status: 'applied-locally' as const },
  { artifact: 'assignments.json', status: 'applied-locally' as const },
  { artifact: 'stakeholder-messages.md', status: 'drafted' as const },
]);

export const EXPECTED_RECEIPT_NOTE =
  'Local artifacts only. No actual venue booking, supplier purchase, or stakeholder notification.';

/**
 * Validates the structural, semantic, and disk integrity of an existing execution receipt.
 * Rejects modified states (e.g. SENT_AND_BOOKED), forged actions, tampered approval evidence,
 * or corrupted/missing local artifact files.
 */
async function validateReceiptIntegrity(params: {
  receiptRaw: string;
  destination: string;
  scenario: Scenario;
  plan: RecoveryPlan;
  hash: string;
  executionKey: string;
  excessBudgetINR: number;
  approval: VerifiedApproval | undefined;
}): Promise<ExecutionReceipt> {
  const { receiptRaw, destination, scenario, plan, hash, executionKey, excessBudgetINR, approval } = params;
  let receipt: ExecutionReceipt;
  try {
    receipt = JSON.parse(receiptRaw) as ExecutionReceipt;
  } catch {
    throw new Error(`Execution receipt at ${executionKey} contains malformed JSON`);
  }

  if (!receipt || typeof receipt !== 'object') {
    throw new Error(`Execution receipt at ${executionKey} is not a valid object`);
  }

  if (receipt.executionKey !== executionKey) {
    throw new Error(`Receipt executionKey mismatch: expected ${executionKey}, got ${receipt.executionKey}`);
  }
  if (receipt.scenarioId !== scenario.id) {
    throw new Error(`Receipt scenarioId mismatch: expected ${scenario.id}, got ${receipt.scenarioId}`);
  }
  if (receipt.scenarioRevision !== scenario.revision) {
    throw new Error(`Receipt scenarioRevision mismatch: expected ${scenario.revision}, got ${receipt.scenarioRevision}`);
  }
  if (receipt.planId !== plan.id) {
    throw new Error(`Receipt planId mismatch: expected ${plan.id}, got ${receipt.planId}`);
  }
  if (receipt.planHash !== hash) {
    throw new Error(`Receipt planHash mismatch: does not match plan hash (expected ${hash}, got ${receipt.planHash})`);
  }
  if (receipt.state !== 'APPLIED_LOCALLY') {
    throw new Error(`Receipt state is invalid or tampered: expected APPLIED_LOCALLY, got ${receipt.state}`);
  }
  if (receipt.note !== EXPECTED_RECEIPT_NOTE) {
    throw new Error(`Receipt note has been altered from standard local disclaimer`);
  }

  if (!Array.isArray(receipt.actions) || receipt.actions.length !== EXPECTED_ACTIONS.length) {
    throw new Error(`Receipt actions list has been altered or contains unauthorized actions`);
  }
  for (let i = 0; i < EXPECTED_ACTIONS.length; i++) {
    const expected = EXPECTED_ACTIONS[i]!;
    const actual = receipt.actions[i];
    if (!actual || actual.artifact !== expected.artifact || actual.status !== expected.status) {
      throw new Error(`Receipt action at index ${i} is unauthorized or altered: ${JSON.stringify(actual)}`);
    }
  }

  if (excessBudgetINR > 0) {
    if (!approval) {
      throw new Error(`Cannot validate receipt for ${plan.id}: required budget approval missing`);
    }
    const evidence = receipt.humanApprovalEvidence;
    if (!evidence || typeof evidence !== 'object') {
      throw new Error(`Receipt missing required humanApprovalEvidence for budget exception`);
    }
    if (evidence.switchRoomId !== approval.switchRoomId || evidence.approvalMessageId !== approval.approvalMessageId) {
      throw new Error(`Receipt humanApprovalEvidence is forged or does not match verified approval`);
    }
  } else {
    if (receipt.humanApprovalEvidence !== null) {
      throw new Error(`Receipt unexpectedly contains humanApprovalEvidence for a plan with zero excess budget`);
    }
  }

  const schedulePath = join(destination, 'schedule.json');
  const assignmentsPath = join(destination, 'assignments.json');
  const messagesPath = join(destination, 'stakeholder-messages.md');

  const [scheduleRaw, assignmentsRaw, messagesRaw] = await Promise.all([
    readFile(schedulePath, 'utf8').catch(() => null),
    readFile(assignmentsPath, 'utf8').catch(() => null),
    readFile(messagesPath, 'utf8').catch(() => null),
  ]);

  if (scheduleRaw === null || assignmentsRaw === null || messagesRaw === null) {
    throw new Error(`Execution destination ${destination} is missing required local artifact files`);
  }

  let schedule: { planId?: string; scenarioId?: string };
  let assignments: { planId?: string; totalAttendees?: number };
  try {
    schedule = JSON.parse(scheduleRaw);
    assignments = JSON.parse(assignmentsRaw);
  } catch {
    throw new Error(`Local artifacts in ${destination} contain malformed JSON`);
  }

  if (schedule.planId !== plan.id || schedule.scenarioId !== scenario.id) {
    throw new Error(`schedule.json in ${destination} does not match plan ${plan.id}`);
  }
  if (assignments.planId !== plan.id || assignments.totalAttendees !== scenario.attendees) {
    throw new Error(`assignments.json in ${destination} does not match attendees ${scenario.attendees}`);
  }
  if (!messagesRaw.includes('# Drafts only — NOT SENT')) {
    throw new Error(`stakeholder-messages.md in ${destination} is missing required draft disclaimer`);
  }

  return receipt;
}

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

  const approval = trustedApprovals.find(a => isVerifiedApproval(a) &&
    a.exceptionType === 'BUDGET_CAP' &&
    a.scenarioId === scenario.id && a.scenarioRevision === scenario.revision &&
    a.planHash === hash && a.verifiedHumanId === scenario.approvalAuthority.approverId &&
    a.switchRoomId === scenario.approvalAuthority.roomId && a.switchServerId === scenario.approvalAuthority.serverId &&
    a.maxExtraINR >= report.excessBudgetINR);

  if (report.excessBudgetINR > 0 && !approval) {
    throw new Error(`Cannot execute ${plan.id}: missing verified approval for excess budget INR ${report.excessBudgetINR}`);
  }

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
    const verifiedExisting = await validateReceiptIntegrity({
      receiptRaw: existing,
      destination,
      scenario,
      plan,
      hash,
      executionKey,
      excessBudgetINR: report.excessBudgetINR,
      approval,
    });
    return { receipt: verifiedExisting, alreadyApplied: true };
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
    note: EXPECTED_RECEIPT_NOTE,
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
      const verifiedConcurrent = await validateReceiptIntegrity({
        receiptRaw: concurrent,
        destination,
        scenario,
        plan,
        hash,
        executionKey,
        excessBudgetINR: report.excessBudgetINR,
        approval,
      });
      return { receipt: verifiedConcurrent, alreadyApplied: true };
    }
    throw e;
  }
  return { receipt, alreadyApplied: false };
}
