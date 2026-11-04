import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFixtures } from '../src/cli/load.js';
import { evaluatePlan } from '../src/engine/evaluate.js';
import { traceImpact } from '../src/engine/impact.js';
import { applyPlan } from '../src/engine/execute.js';
import { budgetApprovalCommand, verifyBudgetApproval, type SwitchMessageVerifier } from '../src/switch/approval.js';
import { planHash, validatePlan } from '../src/domain/validate.js';
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
