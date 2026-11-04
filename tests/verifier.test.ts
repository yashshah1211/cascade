import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  budgetApprovalCommand,
  createProductionSwitchVerifier,
  MattermostMessageVerifier,
  unconfiguredSwitchVerifier,
  verifyBudgetApproval,
  type SwitchMessageReference,
} from '../src/switch/approval.js';
import type { RecoveryPlan, Scenario } from '../src/domain/types.js';

const scenarioFixture: Scenario = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/event-cancellation.json'), 'utf8')
);

const plansFixture: RecoveryPlan[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/recovery-plans.json'), 'utf8')
);

const planB = plansFixture.find((p) => p.id === 'plan-b')!;

function createMockFetch(responses: {
  post?: {
    status?: number;
    body?: Record<string, unknown>;
  };
  user?: {
    status?: number;
    body?: Record<string, unknown>;
  };
}): typeof fetch {
  return (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('/api/v4/posts/')) {
      const cfg = responses.post ?? { status: 200, body: {} };
      return {
        ok: (cfg.status ?? 200) >= 200 && (cfg.status ?? 200) < 300,
        status: cfg.status ?? 200,
        json: async () => cfg.body ?? {},
      } as unknown as Response;
    }
    if (urlStr.includes('/api/v4/users/')) {
      const cfg = responses.user ?? { status: 200, body: {} };
      return {
        ok: (cfg.status ?? 200) >= 200 && (cfg.status ?? 200) < 300,
        status: cfg.status ?? 200,
        json: async () => cfg.body ?? {},
      } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;
}

test('MattermostMessageVerifier: constructor validation', () => {
  assert.throws(() => new MattermostMessageVerifier(null as any), TypeError);
  assert.throws(() => new MattermostMessageVerifier({ baseUrl: '', token: 'tok' }), TypeError);
  assert.throws(() => new MattermostMessageVerifier({ baseUrl: 'http://localhost', token: '' }), TypeError);
});

test('MattermostMessageVerifier: validates references and returns null on bad ref', async () => {
  const verifier = new MattermostMessageVerifier({
    baseUrl: 'http://localhost:59113',
    token: 'test-token',
  });

  assert.equal(await verifier.fetchVerifiedMessage(null as any), null);
  assert.equal(await verifier.fetchVerifiedMessage({ serverId: '', roomId: 'r', messageId: 'm' }), null);
  assert.equal(await verifier.fetchVerifiedMessage({ serverId: 'wrong-server', roomId: 'r', messageId: 'm' }), null);
});

test('MattermostMessageVerifier: successfully verifies genuine human message with user and room mapping', async () => {
  const expectedContent = budgetApprovalCommand(scenarioFixture, planB, 3000);
  const postId = 'post-12345';
  const userId = 'mm-user-999';
  const channelId = 'mm-channel-ops';

  const mockFetch = createMockFetch({
    post: {
      status: 200,
      body: {
        id: postId,
        user_id: userId,
        channel_id: channelId,
        message: expectedContent,
        create_at: new Date('2026-11-05T15:00:00.000Z').getTime(),
        props: {},
      },
    },
    user: {
      status: 200,
      body: {
        id: userId,
        username: 'organizer',
        is_bot: false,
        roles: 'system_user',
      },
    },
  });

  const verifier = new MattermostMessageVerifier({
    baseUrl: 'http://localhost:59113',
    token: 'test-token',
    serverId: scenarioFixture.approvalAuthority.serverId,
    userMap: {
      [userId]: scenarioFixture.approvalAuthority.approverId,
      organizer: scenarioFixture.approvalAuthority.approverId,
    },
    roomMap: {
      [channelId]: scenarioFixture.approvalAuthority.roomId,
    },
    fetchFn: mockFetch,
  });

  const ref: SwitchMessageReference = {
    serverId: scenarioFixture.approvalAuthority.serverId,
    roomId: scenarioFixture.approvalAuthority.roomId,
    messageId: postId,
  };

  const verified = await verifier.fetchVerifiedMessage(ref);
  assert.ok(verified);
  assert.equal(verified.serverId, scenarioFixture.approvalAuthority.serverId);
  assert.equal(verified.roomId, scenarioFixture.approvalAuthority.roomId);
  assert.equal(verified.messageId, postId);
  assert.equal(verified.humanId, scenarioFixture.approvalAuthority.approverId);
  assert.equal(verified.authorKind, 'human');
  assert.equal(verified.content, expectedContent);
  assert.equal(verified.createdAt, '2026-11-05T15:00:00.000Z');

  // Verify full approval integration
  const approval = await verifyBudgetApproval({
    scenario: scenarioFixture,
    plan: planB,
    maxExtraINR: 3000,
    ref,
    verifier,
  });

  assert.ok(approval);
  assert.equal(approval.approvalMessageId, postId);
  assert.equal(approval.verifiedHumanId, scenarioFixture.approvalAuthority.approverId);
  assert.equal(approval.maxExtraINR, 3000);
});

test('MattermostMessageVerifier: rejects bot users (is_bot: true)', async () => {
  const postId = 'bot-post-1';
  const botUserId = 'bot-user-id';
  const channelId = scenarioFixture.approvalAuthority.roomId;

  const mockFetch = createMockFetch({
    post: {
      status: 200,
      body: {
        id: postId,
        user_id: botUserId,
        channel_id: channelId,
        message: budgetApprovalCommand(scenarioFixture, planB, 3000),
        create_at: new Date('2026-11-05T15:00:00.000Z').getTime(),
        props: {},
      },
    },
    user: {
      status: 200,
      body: {
        id: botUserId,
        username: 'switch-buddy-admin',
        is_bot: true,
      },
    },
  });

  const verifier = new MattermostMessageVerifier({
    baseUrl: 'http://localhost:59113',
    token: 'test-token',
    serverId: scenarioFixture.approvalAuthority.serverId,
    fetchFn: mockFetch,
  });

  const ref: SwitchMessageReference = {
    serverId: scenarioFixture.approvalAuthority.serverId,
    roomId: scenarioFixture.approvalAuthority.roomId,
    messageId: postId,
  };

  const verified = await verifier.fetchVerifiedMessage(ref);
  assert.ok(verified);
  assert.equal(verified.authorKind, 'agent');

  // verifyBudgetApproval must reject agent authorKind
  await assert.rejects(
    () => verifyBudgetApproval({
      scenario: scenarioFixture,
      plan: planB,
      maxExtraINR: 3000,
      ref,
      verifier,
    }),
    /Only the designated human owner can authorize a recovery exception/
  );
});

test('MattermostMessageVerifier: rejects bot messages by props (from_bot: "true")', async () => {
  const postId = 'bot-post-2';
  const botUserId = 'user-spoofing-as-human';
  const channelId = scenarioFixture.approvalAuthority.roomId;

  const mockFetch = createMockFetch({
    post: {
      status: 200,
      body: {
        id: postId,
        user_id: botUserId,
        channel_id: channelId,
        message: budgetApprovalCommand(scenarioFixture, planB, 3000),
        create_at: new Date('2026-11-05T15:00:00.000Z').getTime(),
        props: { from_bot: 'true' },
      },
    },
    user: {
      status: 200,
      body: {
        id: botUserId,
        username: 'regular-looking-name',
        is_bot: false,
      },
    },
  });

  const verifier = new MattermostMessageVerifier({
    baseUrl: 'http://localhost:59113',
    token: 'test-token',
    serverId: scenarioFixture.approvalAuthority.serverId,
    fetchFn: mockFetch,
  });

  const ref: SwitchMessageReference = {
    serverId: scenarioFixture.approvalAuthority.serverId,
    roomId: scenarioFixture.approvalAuthority.roomId,
    messageId: postId,
  };

  const verified = await verifier.fetchVerifiedMessage(ref);
  assert.ok(verified);
  assert.equal(verified.authorKind, 'agent');

  await assert.rejects(
    () => verifyBudgetApproval({
      scenario: scenarioFixture,
      plan: planB,
      maxExtraINR: 3000,
      ref,
      verifier,
    }),
    /Only the designated human owner can authorize a recovery exception/
  );
});

test('MattermostMessageVerifier: rejects wrong room and 404 posts', async () => {
  const mockFetch = createMockFetch({
    post: {
      status: 404,
      body: { message: 'Post not found' },
    },
  });

  const verifier = new MattermostMessageVerifier({
    baseUrl: 'http://localhost:59113',
    token: 'test-token',
    serverId: scenarioFixture.approvalAuthority.serverId,
    fetchFn: mockFetch,
  });

  const ref: SwitchMessageReference = {
    serverId: scenarioFixture.approvalAuthority.serverId,
    roomId: scenarioFixture.approvalAuthority.roomId,
    messageId: 'nonexistent-post',
  };

  assert.equal(await verifier.fetchVerifiedMessage(ref), null);

  await assert.rejects(
    () => verifyBudgetApproval({
      scenario: scenarioFixture,
      plan: planB,
      maxExtraINR: 3000,
      ref,
      verifier,
    }),
    /Switch could not verify the referenced message/
  );
});

test('createProductionSwitchVerifier: unconfigured vs configured behavior', async () => {
  const unconf = createProductionSwitchVerifier({ token: '' });
  await assert.rejects(() => unconf.fetchVerifiedMessage({ serverId: 's', roomId: 'r', messageId: 'm' }), /Switch API verifier not configured/);

  const conf = createProductionSwitchVerifier({
    baseUrl: 'http://localhost:59113',
    token: 'valid-test-token',
    fetchFn: createMockFetch({ post: { status: 404 } }),
  });
  assert.ok(conf instanceof MattermostMessageVerifier);
});
