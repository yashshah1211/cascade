import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFixtures } from '../src/cli/load.js';
import { evaluatePlan, MIN_AV_KITS_PER_ACTIVE_HALL } from '../src/engine/evaluate.js';
import { traceImpact } from '../src/engine/impact.js';
import { applyPlan } from '../src/engine/execute.js';
import { budgetApprovalCommand, verifyBudgetApproval, type SwitchMessageVerifier } from '../src/switch/approval.js';
import { planHash, validatePlan, validateScenario, validateDisruption, KNOWN_RESOURCE_NODES } from '../src/domain/validate.js';
import type { RecoveryPlan, Scenario } from '../src/domain/types.js';

const FIX = await loadFixtures();
const byId = (id: string): RecoveryPlan => structuredClone(FIX.plans.find(p => p.id === id)!);
const sc = (): Scenario => structuredClone(FIX.scenario);
function fakeVerifier(message: {
  authorKind?: 'human'|'agent'; humanId?: string; content?: string;
} = {}): SwitchMessageVerifier {
  return {
    fetchVerifiedMessage: async () => ({
      serverId: FIX.scenario.approvalAuthority.serverId,
      roomId: FIX.scenario.approvalAuthority.roomId,
      messageId: 'test-message-123',
      humanId: message.humanId ?? FIX.scenario.approvalAuthority.approverId,
      authorKind: message.authorKind ?? 'human',
      content: message.content ?? budgetApprovalCommand(FIX.scenario, byId('plan-b'), 3000),
      createdAt: '2026-11-06T09:00:00+05:30',
    }),
  };
}
async function approveB(amount = 3000, verifier: SwitchMessageVerifier = fakeVerifier()) {
  const scenario = sc(); const plan = byId('plan-b');
  return verifyBudgetApproval({
    scenario, plan, maxExtraINR: amount, verifier,
    ref: { serverId: scenario.approvalAuthority.serverId, roomId: scenario.approvalAuthority.roomId, messageId: 'test-message-123' },
  });
}

test('T1 — 430 people fit across 250+220, but capacity 170 for Hall B fails', () => {
  const pass = evaluatePlan(sc(), byId('plan-b'));
  assert.equal(pass.checks.find(c => c.id === 'CAPACITY')?.status, 'PASS');
  const mutated = sc(); mutated.halls[1]!.capacity = 170;
  const fail = evaluatePlan(mutated, byId('plan-b'));
  assert.equal(fail.verdict, 'FAIL');
  assert.equal(fail.checks.find(c => c.id === 'CAPACITY')?.status, 'FAIL');
});

test('T2 — plan A fails AV concurrency; plan B passes with a second kit', () => {
  const a = evaluatePlan(sc(), byId('plan-a'));
  assert.equal(a.verdict, 'FAIL');
  assert.equal(a.checks.find(c => c.id === 'AV_CONCURRENCY')?.status, 'FAIL');
  assert.deepEqual(a.checks.find(c => c.id === 'AV_CONCURRENCY')?.evidence.peakDemand, 2);
  const b = evaluatePlan(sc(), byId('plan-b'));
  assert.equal(b.checks.find(c => c.id === 'AV_CONCURRENCY')?.status, 'PASS');
});

test('T3 — budget requires exact human approval; insufficient INR 2000 stays conditional', async () => {
  const before = evaluatePlan(sc(), byId('plan-b'));
  assert.equal(before.verdict, 'REQUIRES_APPROVAL');
  assert.equal(before.excessBudgetINR, 3000);
  const strong = await approveB();
  const after = evaluatePlan(sc(), byId('plan-b'), [strong]);
  assert.equal(after.verdict, 'PASS');
  const amount = 2000;
  const weakVerifier = fakeVerifier({ content: budgetApprovalCommand(sc(), byId('plan-b'), amount) });
  const weak = await approveB(amount, weakVerifier);
  assert.equal(evaluatePlan(sc(), byId('plan-b'), [weak]).verdict, 'REQUIRES_APPROVAL');
});

test('T4 — a changed plan invalidates previously verified Switch approval', async () => {
  const approval = await approveB();
  const changed = byId('plan-b'); changed.note = 'Changed after approval';
  assert.notEqual(planHash(sc(), changed), planHash(sc(), byId('plan-b')));
  assert.equal(evaluatePlan(sc(), changed, [approval]).verdict, 'REQUIRES_APPROVAL');
  const staleScenario = sc(); staleScenario.revision++;
  assert.equal(evaluatePlan(staleScenario, byId('plan-b'), [approval]).verdict, 'FAIL');
  const changedFacts = sc(); changedFacts.avKitRentalCostINR = 3500;
  assert.notEqual(planHash(changedFacts, byId('plan-b')), planHash(sc(), byId('plan-b')));
  assert.equal(evaluatePlan(changedFacts, byId('plan-b'), [approval]).verdict, 'REQUIRES_APPROVAL');
});

test('T5 — sequential plan violates synchronized kickoff but satisfies AV concurrency', () => {
  const result = evaluatePlan(sc(), byId('plan-c'));
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'SYNCHRONIZED_KICKOFF')?.status, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'AV_CONCURRENCY')?.status, 'PASS');
});

test('T6 — unknown accessibility is BLOCKED/UNKNOWN instead of PASS', () => {
  const scenario = sc(); scenario.halls[0]!.accessible = null;
  const result = evaluatePlan(scenario, byId('plan-b'));
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.checks.find(c => c.id === 'ACCESSIBILITY')?.status, 'UNKNOWN');
});

test('T7 — loss of original venue propagates to linked commitments with actual paths', () => {
  const result = traceImpact(sc(), FIX.disruption);
  assert.equal(result.length, 7);
  assert.ok(result.every(p => p.path[0] === 'venue:main'));
  assert.ok(result.some(p => p.commitmentId === 'commitment:keynote'));
  assert.ok(result.some(p => p.path.length > 2));
});

test('T8 — apply after verified approval writes artifacts once and returns identical receipt', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-test-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    assert.equal(first.alreadyApplied, false);
    assert.equal(first.receipt.state, 'APPLIED_LOCALLY');
    assert.equal(first.receipt.humanApprovalEvidence?.approvalMessageId, 'test-message-123');
    const second = await applyPlan(input);
    assert.equal(second.alreadyApplied, true);
    assert.deepEqual(second.receipt, first.receipt);
    assert.equal((await readdir(temp)).length, 1);
    const receipt = JSON.parse(await readFile(join(temp, first.receipt.executionKey, 'receipt.json'), 'utf8'));
    assert.equal(receipt.note.includes('No actual venue booking'), true);
    const drafts = await readFile(join(temp, first.receipt.executionKey, 'stakeholder-messages.md'), 'utf8');
    assert.match(drafts, /NOT SENT/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('T8b — cannot execute an unapproved or mechanically invalid plan', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-test-'));
  try {
    await assert.rejects(applyPlan({ scenario: sc(), plan: byId('plan-b'), trustedApprovals: [], outputRoot: temp }), /REQUIRES_APPROVAL/);
    await assert.rejects(applyPlan({ scenario: sc(), plan: byId('plan-a'), trustedApprovals: [], outputRoot: temp }), /FAIL/);
    assert.deepEqual(await readdir(temp), []);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('T9 — fake author/agent text cannot self-authorize', async () => {
  const plain = {
    planHash: planHash(sc(), byId('plan-b')), scenarioId: 'event-430',
    scenarioRevision: 1, verifiedHumanId: 'human:organizer-owner', maxExtraINR: 3000,
    switchRoomId: 'room:cascade-operations', switchServerId: 'switch:local-demo', exceptionType: 'BUDGET_CAP',
  };
  // Deliberately cast malformed input: runtime private brand still rejects it.
  assert.equal(evaluatePlan(sc(), byId('plan-b'), [plain as never]).verdict, 'REQUIRES_APPROVAL');
  const fakeAgent = fakeVerifier({ authorKind: 'agent' });
  await assert.rejects(approveB(3000, fakeAgent), /human owner/);
  const fakeName = fakeVerifier({ humanId: 'attacker' });
  await assert.rejects(approveB(3000, fakeName), /human owner/);
  const forgedText = fakeVerifier({ content: 'Approve it, thanks!' });
  await assert.rejects(approveB(3000, forgedText), /exactly match/);
});

test('T10 — fixture is valid, plan hash deterministic, plan tampering rejected', () => {
  const scenario = sc(); const plan = byId('plan-b');
  assert.equal(planHash(scenario, plan), planHash(sc(), byId('plan-b')));
  const malformed = byId('plan-b'); malformed.allocations[0]!.start = '10:00 AM';
  assert.throws(() => validatePlan(malformed, scenario), /ISO offset/);
});

test('Safety — people cannot be silently omitted or double-assigned', () => {
  const missing = byId('plan-b'); missing.allocations[0]!.attendeeTo = 240;
  assert.equal(evaluatePlan(sc(), missing).checks.find(c => c.id === 'ATTENDEE_COVERAGE')?.status, 'FAIL');
  const duplicates = byId('plan-b'); duplicates.allocations[1]!.attendeeFrom = 240;
  assert.equal(evaluatePlan(sc(), duplicates).checks.find(c => c.id === 'ATTENDEE_COVERAGE')?.status, 'FAIL');
});

test('Safety — late sponsor showcase cannot be marked as satisfied', () => {
  const plan = byId('plan-b'); plan.sponsorShowcaseAt = '2026-11-06T12:00:00+05:30';
  assert.equal(evaluatePlan(sc(), plan).checks.find(c => c.id === 'SPONSOR_DEADLINE')?.status, 'FAIL');
});

test('Hardening — missing commitment prerequisite throws TypeError', () => {
  const scenario = sc();
  scenario.commitments[0]!.dependencies.push({ prerequisiteId: 'commitment:nonexistent', kind: 'requires' });
  assert.throws(() => validateScenario(scenario), /Missing dependency.*commitment:nonexistent/);
});

test('Hardening — unknown venue prerequisite throws TypeError', () => {
  const scenario = sc();
  scenario.commitments[0]!.dependencies = [{ prerequisiteId: 'venue:phantom', kind: 'requires' }];
  assert.throws(() => validateScenario(scenario), /unknown venue/);
});

test('Hardening — duplicate prerequisite in single commitment throws TypeError', () => {
  const scenario = sc();
  scenario.commitments[0]!.dependencies = [
    { prerequisiteId: 'venue:main', kind: 'requires' },
    { prerequisiteId: 'venue:main', kind: 'requires' },
  ];
  assert.throws(() => validateScenario(scenario), /Duplicate dependency/);
});

test('Hardening — self-dependency in commitment throws TypeError', () => {
  const scenario = sc();
  scenario.commitments[0]!.dependencies = [{ prerequisiteId: scenario.commitments[0]!.id, kind: 'requires' }];
  assert.throws(() => validateScenario(scenario), /Self-dependency/);
});

test('Hardening — cyclic dependency across commitments throws TypeError', () => {
  const scenario = sc();
  // Create cycle: commitment:capacity -> commitment:kickoff and commitment:kickoff -> commitment:capacity
  scenario.commitments.find(c => c.id === 'commitment:capacity')!.dependencies.push({
    prerequisiteId: 'commitment:kickoff',
    kind: 'requires',
  });
  assert.throws(() => validateScenario(scenario), /Cyclic dependency/);
});

test('Hardening — post-kickoff approval is rejected as stale', async () => {
  const staleVerifier = fakeVerifier({
    // Kickoff is 2026-11-06T10:00:00+05:30; post at 10:30
    content: budgetApprovalCommand(sc(), byId('plan-b'), 3000),
  });
  // Override createdAt with post-kickoff time
  staleVerifier.fetchVerifiedMessage = async (ref) => ({
    serverId: ref.serverId,
    roomId: ref.roomId,
    messageId: ref.messageId,
    humanId: sc().approvalAuthority.approverId,
    authorKind: 'human',
    content: budgetApprovalCommand(sc(), byId('plan-b'), 3000),
    createdAt: '2026-11-06T10:30:00+05:30',
  });

  await assert.rejects(approveB(3000, staleVerifier), /Approval is stale/);
});

test('Hardening — invalid ISO createdAt in Switch approval is rejected', async () => {
  const invalidTimeVerifier = fakeVerifier();
  invalidTimeVerifier.fetchVerifiedMessage = async (ref) => ({
    serverId: ref.serverId,
    roomId: ref.roomId,
    messageId: ref.messageId,
    humanId: sc().approvalAuthority.approverId,
    authorKind: 'human',
    content: budgetApprovalCommand(sc(), byId('plan-b'), 3000),
    createdAt: 'not-a-timestamp',
  });

  await assert.rejects(approveB(3000, invalidTimeVerifier), /valid offset ISO/);
});

test('Hardening — sponsor showcase before kickoff fails SPONSOR_DEADLINE', () => {
  const plan = byId('plan-b');
  // Kickoff is 10:00:00+05:30; set showcase to 09:30
  plan.sponsorShowcaseAt = '2026-11-06T09:30:00+05:30';
  const result = evaluatePlan(sc(), plan);
  assert.equal(result.checks.find(c => c.id === 'SPONSOR_DEADLINE')?.status, 'FAIL');
  assert.match(result.checks.find(c => c.id === 'SPONSOR_DEADLINE')?.message ?? '', /before event kickoff/);
});

test('Hardening — malformed SwitchMessageReference throws TypeError', async () => {
  const scenario = sc(); const plan = byId('plan-b');
  await assert.rejects(
    verifyBudgetApproval({
      scenario, plan, maxExtraINR: 3000, verifier: fakeVerifier(),
      ref: { serverId: '', roomId: 'room:cascade-operations', messageId: '123' },
    }),
    /nonempty serverId/
  );
  await assert.rejects(
    verifyBudgetApproval({
      scenario, plan, maxExtraINR: 3000, verifier: fakeVerifier(),
      ref: { serverId: 'switch:local-demo', roomId: '', messageId: '123' },
    }),
    /nonempty roomId/
  );
  await assert.rejects(
    verifyBudgetApproval({
      scenario, plan, maxExtraINR: 3000, verifier: fakeVerifier(),
      ref: { serverId: 'switch:local-demo', roomId: 'room:cascade-operations', messageId: '' },
    }),
    /nonempty messageId/
  );
});

test('Hardening — tampered existing receipt on disk is detected and rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-tamper-test-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const receiptPath = join(temp, first.receipt.executionKey, 'receipt.json');

    // Tamper with the receipt on disk (change planHash)
    const receiptData = JSON.parse(await readFile(receiptPath, 'utf8'));
    receiptData.planHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const { writeFile: fsWriteFile } = await import('node:fs/promises');
    await fsWriteFile(receiptPath, JSON.stringify(receiptData, null, 2) + '\n');

    // Repeated execution must detect the tampering and reject
    await assert.rejects(applyPlan(input), /does not match plan hash/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Hardening — traceImpact validates scenario and disruption', () => {
  assert.throws(() => traceImpact(sc(), { id: '', disabledNodeId: '', reportedAt: '', description: '', source: '' }), /disruption\.id/);
  assert.throws(() => traceImpact(sc(), null as never), /Disruption must be an object/);
  const badScenario = sc();
  badScenario.attendees = 0;
  assert.throws(() => traceImpact(badScenario, FIX.disruption), /Scenario needs attendees/);
});

// --- Mission 01B: Independent Review Findings Regression Tests ---

test('Reviewer Finding 1 — zero AV equipment bypass is rejected (fails AV_CONCURRENCY)', () => {
  const plan = byId('plan-b');
  plan.rentedAvKits = 0;
  plan.allocations[0]!.avKits = 0;
  plan.allocations[1]!.avKits = 0;

  const result = evaluatePlan(sc(), plan);
  assert.equal(result.verdict, 'FAIL');
  const avCheck = result.checks.find(c => c.id === 'AV_CONCURRENCY');
  assert.equal(avCheck?.status, 'FAIL');
  assert.match(avCheck?.message ?? '', /0 AV equipment|only 1 supplied/);
});

test('Reviewer Finding 1 — active hall with zero AV equipment fails even if rentedAvKits > 0', () => {
  const plan = byId('plan-b');
  plan.rentedAvKits = 1;
  plan.allocations[0]!.avKits = 0;
  plan.allocations[1]!.avKits = 0;

  const result = evaluatePlan(sc(), plan);
  assert.equal(result.verdict, 'FAIL');
  const avCheck = result.checks.find(c => c.id === 'AV_CONCURRENCY');
  assert.equal(avCheck?.status, 'FAIL');
  assert.match(avCheck?.message ?? '', /0 AV equipment/);
});

test('Reviewer Finding 1 — allocations sharing hall do not double-count equipment', () => {
  const scenario = sc();
  scenario.halls[0]!.capacity = 500;
  const plan = byId('plan-c');
  // Both allocations run concurrently in hall:a at 10:00
  plan.allocations[0]!.start = '2026-11-06T10:00:00+05:30';
  plan.allocations[0]!.end = '2026-11-06T10:45:00+05:30';
  plan.allocations[0]!.avKits = 1;
  plan.allocations[1]!.start = '2026-11-06T10:00:00+05:30';
  plan.allocations[1]!.end = '2026-11-06T10:45:00+05:30';
  plan.allocations[1]!.avKits = 0; // shares hall:a equipment

  const result = evaluatePlan(scenario, plan);
  const avCheck = result.checks.find(c => c.id === 'AV_CONCURRENCY');
  assert.equal(avCheck?.status, 'PASS');
  assert.equal(avCheck?.evidence.peakDemand, 1);
});

test('Reviewer Finding 2 — receipt tampering on state (SENT_AND_BOOKED) is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-state-tamper-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const receiptPath = join(temp, first.receipt.executionKey, 'receipt.json');

    const receiptData = JSON.parse(await readFile(receiptPath, 'utf8'));
    receiptData.state = 'SENT_AND_BOOKED';
    await writeFile(receiptPath, JSON.stringify(receiptData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /state is invalid or tampered/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Reviewer Finding 2 — receipt tampering on actions (fake payment) is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-action-tamper-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const receiptPath = join(temp, first.receipt.executionKey, 'receipt.json');

    const receiptData = JSON.parse(await readFile(receiptPath, 'utf8'));
    receiptData.actions.push({ artifact: 'fake-payment-voucher.json', status: 'booked' });
    await writeFile(receiptPath, JSON.stringify(receiptData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /actions list has been altered/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Reviewer Finding 2 — receipt tampering on approval evidence is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-evidence-tamper-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const receiptPath = join(temp, first.receipt.executionKey, 'receipt.json');

    const receiptData = JSON.parse(await readFile(receiptPath, 'utf8'));
    receiptData.humanApprovalEvidence.approvalMessageId = 'forged-message-id-999';
    await writeFile(receiptPath, JSON.stringify(receiptData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /humanApprovalEvidence is forged/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Reviewer Finding 2 — missing local artifact files on disk causes receipt rejection', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-artifact-missing-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const schedulePath = join(temp, first.receipt.executionKey, 'schedule.json');

    await unlink(schedulePath);
    await assert.rejects(applyPlan(input), /missing required local artifact files/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Reviewer Finding 2 — concurrent execution recovery path validates receipt integrity', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-concurrent-test-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };

    // Run parallel applyPlan calls to trigger concurrent recovery path
    const [res1, res2] = await Promise.all([applyPlan(input), applyPlan(input)]);
    assert.ok(res1.receipt);
    assert.ok(res2.receipt);
    assert.equal(res1.receipt.planHash, res2.receipt.planHash);
    assert.equal(res1.receipt.state, 'APPLIED_LOCALLY');
    assert.equal(res2.receipt.state, 'APPLIED_LOCALLY');
    assert.ok(res1.alreadyApplied || res2.alreadyApplied);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Reviewer Finding 3 — unknown resource dependency is rejected', () => {
  const scenario = sc();
  scenario.commitments[0]!.dependencies.push({
    prerequisiteId: 'resource:missing-supplier',
    kind: 'requires',
  });
  assert.throws(
    () => validateScenario(scenario),
    /Missing dependency: commitment commitment:capacity references unknown resource resource:missing-supplier/
  );
});

test('Reviewer Finding 3 — unresolvable prerequisite prefix is rejected fail-closed', () => {
  const scenario = sc();
  scenario.commitments[0]!.dependencies = [
    { prerequisiteId: 'vendor:external-audio', kind: 'requires' },
  ];
  assert.throws(
    () => validateScenario(scenario),
    /Missing dependency: commitment commitment:capacity references unresolvable prerequisite vendor:external-audio/
  );
});

test('Reviewer Finding 3 — KNOWN_RESOURCE_NODES contains resource:av and fixture validates', () => {
  assert.ok(KNOWN_RESOURCE_NODES.has('resource:av'));
  assert.doesNotThrow(() => validateScenario(sc()));
});

// --- Mission 01C: Final Artifact Integrity Regression Tests ---

test('Mission 01C — normal unchanged repeat execution returns existing receipt with alreadyApplied: true', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-01c-normal-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    assert.equal(first.alreadyApplied, false);

    const second = await applyPlan(input);
    assert.equal(second.alreadyApplied, true);
    assert.deepEqual(second.receipt, first.receipt);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mission 01C — schedule.json: changed projectedCostINR to 0 is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-01c-cost-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const schedulePath = join(temp, first.receipt.executionKey, 'schedule.json');

    const scheduleData = JSON.parse(await readFile(schedulePath, 'utf8'));
    scheduleData.projectedCostINR = 0;
    await writeFile(schedulePath, JSON.stringify(scheduleData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /schedule\.json projectedCostINR mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mission 01C — schedule.json: changed allocation attendeeTo to 0 is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-01c-alloc-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const schedulePath = join(temp, first.receipt.executionKey, 'schedule.json');

    const scheduleData = JSON.parse(await readFile(schedulePath, 'utf8'));
    scheduleData.allocations[0].attendeeTo = 0;
    await writeFile(schedulePath, JSON.stringify(scheduleData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /schedule\.json content mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mission 01C — assignments.json: altered attendee ranges and counts is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-01c-assign-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const assignmentsPath = join(temp, first.receipt.executionKey, 'assignments.json');

    const assignmentsData = JSON.parse(await readFile(assignmentsPath, 'utf8'));
    // Alter attendee range and count while keeping totalAttendees intact
    assignmentsData.hallAssignments[0].attendeeRange = [0, 50];
    assignmentsData.hallAssignments[0].attendeeCount = 51;
    await writeFile(assignmentsPath, JSON.stringify(assignmentsData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /assignments\.json content mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mission 01C — receipt.json: unexpected externalActionCompleted field is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-01c-receipt-extra-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const receiptPath = join(temp, first.receipt.executionKey, 'receipt.json');

    const receiptData = JSON.parse(await readFile(receiptPath, 'utf8'));
    receiptData.externalActionCompleted = true;
    await writeFile(receiptPath, JSON.stringify(receiptData, null, 2) + '\n');

    await assert.rejects(applyPlan(input), /Receipt contains unexpected field: externalActionCompleted/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mission 01C — stakeholder-messages.md: replaced content with preserved disclaimer is rejected', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cascade-01c-messages-'));
  try {
    const approval = await approveB();
    const input = { scenario: sc(), plan: byId('plan-b'), trustedApprovals: [approval], outputRoot: temp };
    const first = await applyPlan(input);
    const messagesPath = join(temp, first.receipt.executionKey, 'stakeholder-messages.md');

    // Replace body while keeping the disclaimer line
    const tamperedContent = '# Drafts only — NOT SENT\n\nAll venues booked and payments wired to external vendors.\n';
    await writeFile(messagesPath, tamperedContent);

    await assert.rejects(applyPlan(input), /stakeholder-messages\.md content mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
