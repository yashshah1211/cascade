import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RecoveryPlan, Scenario } from '../src/domain/types.js';
import { evaluatePlan } from '../src/engine/evaluate.js';
import { budgetApprovalCommand, MattermostMessageVerifier, type SwitchMessageReference } from '../src/switch/approval.js';
import { executeVerifiedRecovery, postApprovalRequest, postExecutionReceipt } from '../src/switch/collaboration.js';

const scenarioFixture: Scenario = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/event-cancellation.json'), 'utf8')
);

const plansFixture: RecoveryPlan[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/recovery-plans.json'), 'utf8')
);

const planB = plansFixture.find((p) => p.id === 'plan-b')!;
const evaluation = evaluatePlan(scenarioFixture, planB);

test('Collaboration: postApprovalRequest sends expected payload to Mattermost endpoint', async () => {
  let capturedBody: any;
  const mockFetch: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'post-req-1', channel_id: 'chan-1', create_at: 1000 }),
    } as unknown as Response;
  }) as typeof fetch;

  const result = await postApprovalRequest({
    scenario: scenarioFixture,
    plan: planB,
    evaluation,
    channelId: 'chan-1',
    config: {
      baseUrl: 'http://localhost:59113',
      token: 'test-tok',
      fetchFn: mockFetch,
    },
  });

  assert.equal(result.postId, 'post-req-1');
  assert.equal(capturedBody.channel_id, 'chan-1');
  assert.match(capturedBody.message, /CASCADE COMMITMENT RECOVERY — HUMAN APPROVAL REQUIRED/);
  assert.match(capturedBody.message, /CASCADE APPROVE 1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da MAX_EXTRA_INR 3000/);
});

test('Collaboration: postExecutionReceipt formats and posts receipt to Mattermost', async () => {
  let capturedBody: any;
  const mockFetch: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'receipt-post-1', channel_id: 'chan-1', create_at: 2000 }),
    } as unknown as Response;
  }) as typeof fetch;

  const result = await postExecutionReceipt({
    receipt: {
      executionKey: 'key-123',
      scenarioId: 'event-430',
      scenarioRevision: 1,
      planId: 'plan-b',
      planHash: 'hash-abc',
      state: 'APPLIED_LOCALLY',
      actions: [
        { artifact: 'schedule.json', status: 'applied-locally' },
        { artifact: 'assignments.json', status: 'applied-locally' },
        { artifact: 'stakeholder-messages.md', status: 'drafted' },
      ],
      humanApprovalEvidence: { switchRoomId: 'room:cascade-operations', approvalMessageId: 'msg-999' },
      note: 'Note',
    },
    channelId: 'chan-1',
    config: {
      baseUrl: 'http://localhost:59113',
      token: 'test-tok',
      fetchFn: mockFetch,
    },
  });

  assert.equal(result.postId, 'receipt-post-1');
  assert.match(capturedBody.message, /CASCADE RECOVERY PLAN EXECUTED LOCALLY/);
  assert.match(capturedBody.message, /msg-999/);
});

test('Collaboration: executeVerifiedRecovery executes full pipeline end-to-end', async () => {
  const approvalMsgId = 'appr-msg-777';
  const approvalText = budgetApprovalCommand(scenarioFixture, planB, 3000);
  const tempDir = await mkdtemp(join(tmpdir(), 'cascade-collab-test-'));

  try {
    const mockFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/v4/posts/' + approvalMsgId)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: approvalMsgId,
            user_id: 'user-real-human',
            channel_id: 'chan-ops',
            message: approvalText,
            create_at: new Date('2026-11-05T12:00:00.000Z').getTime(),
            props: {},
          }),
        } as unknown as Response;
      }
      if (urlStr.includes('/api/v4/users/user-real-human')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'user-real-human',
            username: 'human_owner',
            is_bot: false,
          }),
        } as unknown as Response;
      }
      if (urlStr.endsWith('/api/v4/posts') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'post-receipt-out',
            channel_id: 'chan-ops',
            create_at: Date.now(),
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => 'Not found' } as unknown as Response;
    }) as typeof fetch;

    const config = {
      baseUrl: 'http://localhost:59113',
      token: 'test-tok',
      serverId: scenarioFixture.approvalAuthority.serverId,
      userMap: {
        'user-real-human': scenarioFixture.approvalAuthority.approverId,
      },
      roomMap: {
        'chan-ops': scenarioFixture.approvalAuthority.roomId,
      },
      fetchFn: mockFetch,
    };

    const verifier = new MattermostMessageVerifier(config);

    const ref: SwitchMessageReference = {
      serverId: scenarioFixture.approvalAuthority.serverId,
      roomId: scenarioFixture.approvalAuthority.roomId,
      messageId: approvalMsgId,
    };

    const result = await executeVerifiedRecovery({
      scenario: scenarioFixture,
      plan: planB,
      approvalRef: ref,
      verifier,
      config,
      channelId: 'chan-ops',
      outputRoot: tempDir,
      postReceiptToChannel: true,
    });

    assert.equal(result.approval.approvalMessageId, approvalMsgId);
    assert.equal(result.approval.verifiedHumanId, scenarioFixture.approvalAuthority.approverId);
    assert.equal(result.receipt.planId, 'plan-b');
    assert.equal(result.receipt.state, 'APPLIED_LOCALLY');
    assert.equal(result.alreadyApplied, false);
    assert.ok(result.receiptPost);
    assert.equal(result.receiptPost.postId, 'post-receipt-out');

    // Repeated execution test (Finding 2): verify idempotence and no duplicate receipt post
    let secondPostAttempted = false;
    const trackingMockFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/api/v4/posts') && init?.method === 'POST') {
        secondPostAttempted = true;
      }
      return mockFetch(url, init);
    }) as typeof fetch;

    const trackingVerifier = new MattermostMessageVerifier({
      ...config,
      fetchFn: trackingMockFetch,
    });

    const result2 = await executeVerifiedRecovery({
      scenario: scenarioFixture,
      plan: planB,
      approvalRef: ref,
      verifier: trackingVerifier,
      config: { ...config, fetchFn: trackingMockFetch },
      channelId: 'chan-ops',
      outputRoot: tempDir,
      postReceiptToChannel: true,
    });

    assert.equal(result2.alreadyApplied, true);
    assert.equal(result2.receiptPost, undefined);
    assert.equal(secondPostAttempted, false, 'Expected no duplicate receipt post to Mattermost on replay');
    assert.equal(result2.receipt.planHash, result.receipt.planHash);
    assert.equal(result2.receipt.executionKey, result.receipt.executionKey);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
