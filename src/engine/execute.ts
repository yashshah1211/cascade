import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExecutionReceipt, PlanEvaluation, RecoveryPlan, Scenario } from '../domain/types.js';
import { canonical, planHash, validatePlan, validateScenario } from '../domain/validate.js';
import { evaluatePlan } from './evaluate.js';
import { isVerifiedApproval, type VerifiedApproval } from '../switch/approval.js';

export const EXPECTED_ACTIONS: ReadonlyArray<ExecutionReceipt['actions'][number]> = Object.freeze([
  { artifact: 'schedule.json', status: 'applied-locally' as const },
  { artifact: 'assignments.json', status: 'applied-locally' as const },
  { artifact: 'stakeholder-messages.md', status: 'drafted' as const },
]);

export const EXPECTED_RECEIPT_NOTE =
  'Local artifacts only. No actual venue booking, supplier purchase, or stakeholder notification.';

const ALLOWED_RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'executionKey',
  'scenarioId',
  'scenarioRevision',
  'planId',
  'planHash',
  'state',
  'actions',
  'humanApprovalEvidence',
  'note',
]);

const ALLOWED_SCHEDULE_KEYS: ReadonlySet<string> = new Set([
  'planId',
  'scenarioId',
  'allocations',
  'sponsorShowcaseAt',
  'projectedCostINR',
]);

const ALLOWED_ASSIGNMENTS_KEYS: ReadonlySet<string> = new Set([
  'planId',
  'totalAttendees',
  'hallAssignments',
]);

export interface ExpectedArtifacts {
  receipt: ExecutionReceipt;
  schedule: {
    planId: string;
    scenarioId: string;
    allocations: RecoveryPlan['allocations'];
    sponsorShowcaseAt: string;
    projectedCostINR: number;
  };
  assignments: {
    planId: string;
    totalAttendees: number;
    hallAssignments: Array<{
      hallId: string;
      attendeeRange: [number, number];
      attendeeCount: number;
      start: string;
      end: string;
      avKitsRequired: number;
    }>;
  };
  messages: string;
}

/**
 * Deterministically constructs the complete expected artifact model for a verified plan execution.
 * Shared between initial artifact publication and subsequent integrity validation so formatting
 * and business rules are never duplicated.
 */
export function buildExpectedArtifacts(params: {
  scenario: Scenario;
  plan: RecoveryPlan;
  report: PlanEvaluation;
  hash: string;
  executionKey: string;
  approval: VerifiedApproval | undefined;
}): ExpectedArtifacts {
  const { scenario, plan, report, hash, executionKey, approval } = params;

  const actions: ExecutionReceipt['actions'] = [
    { artifact: 'schedule.json', status: 'applied-locally' },
    { artifact: 'assignments.json', status: 'applied-locally' },
    { artifact: 'stakeholder-messages.md', status: 'drafted' },
  ];

  const receipt: ExecutionReceipt = {
    executionKey,
    scenarioId: scenario.id,
    scenarioRevision: scenario.revision,
    planId: plan.id,
    planHash: hash,
    state: 'APPLIED_LOCALLY',
    actions,
    humanApprovalEvidence: report.excessBudgetINR > 0 && approval ?
      { switchRoomId: approval.switchRoomId, approvalMessageId: approval.approvalMessageId } : null,
    note: EXPECTED_RECEIPT_NOTE,
  };

  const schedule = {
    planId: plan.id,
    scenarioId: scenario.id,
    allocations: plan.allocations,
    sponsorShowcaseAt: plan.sponsorShowcaseAt,
    projectedCostINR: report.projectedCostINR,
  };

  const assignments = {
    planId: plan.id,
    totalAttendees: scenario.attendees,
    hallAssignments: plan.allocations.map(a => ({
      hallId: a.hallId,
      attendeeRange: [a.attendeeFrom, a.attendeeTo] as [number, number],
      attendeeCount: a.attendeeTo - a.attendeeFrom + 1,
      start: a.start,
      end: a.end,
      avKitsRequired: a.avKits,
    })),
  };

  const messages = [
    '# Drafts only — NOT SENT', '',
    `Plan: ${plan.label}`, `Scenario: ${scenario.title}`, '',
    '## Attendee update draft',
    'The original auditorium is unavailable. We have prepared an alternative layout with assigned halls. Details are pending organizer confirmation.', '',
    '## Sponsor update draft',
    `The showcase remains scheduled for ${plan.sponsorShowcaseAt}. This message has not been sent.`, '',
    '## Safety note', 'Confirm accessibility, emergency exits, and local venue authorization independently before event use.', '',
  ].join('\n') + '\n';

  return { receipt, schedule, assignments, messages };
}

/**
 * Validates the full structural, semantic, and disk integrity of an existing execution receipt
 * and its associated local artifacts. Rejects modified states, unauthorized actions, extra fields,
 * forged approval evidence, or altered schedule/assignment/message contents.
 */
async function validateReceiptIntegrity(params: {
  receiptRaw: string;
  destination: string;
  scenario: Scenario;
  plan: RecoveryPlan;
  report: PlanEvaluation;
  hash: string;
  executionKey: string;
  approval: VerifiedApproval | undefined;
}): Promise<ExecutionReceipt> {
  const { receiptRaw, destination, scenario, plan, report, hash, executionKey, approval } = params;
  let receipt: ExecutionReceipt;
  try {
    receipt = JSON.parse(receiptRaw) as ExecutionReceipt;
  } catch {
    throw new Error(`Execution receipt at ${executionKey} contains malformed JSON`);
  }

  if (!receipt || typeof receipt !== 'object') {
    throw new Error(`Execution receipt at ${executionKey} is not a valid object`);
  }

  // Reject unexpected or missing receipt fields
  const actualReceiptKeys = Object.keys(receipt);
  for (const k of actualReceiptKeys) {
    if (!ALLOWED_RECEIPT_KEYS.has(k)) {
      throw new Error(`Receipt contains unexpected field: ${k}`);
    }
  }
  for (const k of ALLOWED_RECEIPT_KEYS) {
    if (!(k in receipt)) {
      throw new Error(`Receipt missing required field: ${k}`);
    }
  }

  const expected = buildExpectedArtifacts({ scenario, plan, report, hash, executionKey, approval });

  if (receipt.executionKey !== expected.receipt.executionKey) {
    throw new Error(`Receipt executionKey mismatch: expected ${expected.receipt.executionKey}, got ${receipt.executionKey}`);
  }
  if (receipt.scenarioId !== expected.receipt.scenarioId) {
    throw new Error(`Receipt scenarioId mismatch: expected ${expected.receipt.scenarioId}, got ${receipt.scenarioId}`);
  }
  if (receipt.scenarioRevision !== expected.receipt.scenarioRevision) {
    throw new Error(`Receipt scenarioRevision mismatch: expected ${expected.receipt.scenarioRevision}, got ${receipt.scenarioRevision}`);
  }
  if (receipt.planId !== expected.receipt.planId) {
    throw new Error(`Receipt planId mismatch: expected ${expected.receipt.planId}, got ${receipt.planId}`);
  }
  if (receipt.planHash !== expected.receipt.planHash) {
    throw new Error(`Receipt planHash mismatch: does not match plan hash (expected ${expected.receipt.planHash}, got ${receipt.planHash})`);
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
    const expAction = EXPECTED_ACTIONS[i]!;
    const actAction = receipt.actions[i];
    if (!actAction || actAction.artifact !== expAction.artifact || actAction.status !== expAction.status) {
      throw new Error(`Receipt action at index ${i} is unauthorized or altered: ${JSON.stringify(actAction)}`);
    }
  }

  if (report.excessBudgetINR > 0) {
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

  // Canonical receipt verification
  if (canonical(receipt) !== canonical(expected.receipt)) {
    throw new Error(`Receipt content mismatch: receipt does not match expected execution receipt`);
  }

  // Verify on-disk local artifacts
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

  let schedule: Record<string, unknown>;
  let assignments: Record<string, unknown>;
  try {
    schedule = JSON.parse(scheduleRaw);
    assignments = JSON.parse(assignmentsRaw);
  } catch {
    throw new Error(`Local artifacts in ${destination} contain malformed JSON`);
  }

  // Schedule verification
  const actualScheduleKeys = Object.keys(schedule);
  for (const k of actualScheduleKeys) {
    if (!ALLOWED_SCHEDULE_KEYS.has(k)) {
      throw new Error(`schedule.json contains unexpected field: ${k}`);
    }
  }
  for (const k of ALLOWED_SCHEDULE_KEYS) {
    if (!(k in schedule)) {
      throw new Error(`schedule.json missing required field: ${k}`);
    }
  }
  if (schedule.projectedCostINR !== expected.schedule.projectedCostINR) {
    throw new Error(`schedule.json projectedCostINR mismatch: expected ${expected.schedule.projectedCostINR}, got ${schedule.projectedCostINR}`);
  }
  if (canonical(schedule) !== canonical(expected.schedule)) {
    throw new Error(`schedule.json content mismatch: schedule does not match expected plan schedule`);
  }

  // Assignments verification
  const actualAssignmentsKeys = Object.keys(assignments);
  for (const k of actualAssignmentsKeys) {
    if (!ALLOWED_ASSIGNMENTS_KEYS.has(k)) {
      throw new Error(`assignments.json contains unexpected field: ${k}`);
    }
  }
  for (const k of ALLOWED_ASSIGNMENTS_KEYS) {
    if (!(k in assignments)) {
      throw new Error(`assignments.json missing required field: ${k}`);
    }
  }
  if (canonical(assignments) !== canonical(expected.assignments)) {
    throw new Error(`assignments.json content mismatch: assignments do not match expected hall assignments`);
  }

  // Stakeholder messages verification (normalize line endings for Windows/POSIX compatibility)
  const normActualMessages = messagesRaw.replace(/\r\n/g, '\n').trim();
  const normExpectedMessages = expected.messages.replace(/\r\n/g, '\n').trim();
  if (normActualMessages !== normExpectedMessages) {
    throw new Error(`stakeholder-messages.md content mismatch: draft messages do not match expected draft text`);
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
      report,
      hash,
      executionKey,
      approval,
    });
    return { receipt: verifiedExisting, alreadyApplied: true };
  }

  const expected = buildExpectedArtifacts({ scenario, plan, report, hash, executionKey, approval });
  const staging = await mkdtemp(join(root, '.staging-'));
  try {
    await writeFile(join(staging, 'schedule.json'), JSON.stringify(expected.schedule, null, 2) + '\n');
    await writeFile(join(staging, 'assignments.json'), JSON.stringify(expected.assignments, null, 2) + '\n');
    await writeFile(join(staging, 'stakeholder-messages.md'), expected.messages);
    await writeFile(join(staging, 'receipt.json'), JSON.stringify(expected.receipt, null, 2) + '\n');
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
        report,
        hash,
        executionKey,
        approval,
      });
      return { receipt: verifiedConcurrent, alreadyApplied: true };
    }
    throw e;
  }
  return { receipt: expected.receipt, alreadyApplied: false };
}
