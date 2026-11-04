import type { ExecutionReceipt, PlanEvaluation, RecoveryPlan, Scenario } from '../domain/types.js';
import { planHash } from '../domain/validate.js';
import { budgetApprovalCommand, type MattermostVerifierConfig, type SwitchMessageReference, type VerifiedApproval, verifyBudgetApproval, MattermostMessageVerifier } from './approval.js';
import { applyPlan } from '../engine/execute.js';
import { evaluatePlan } from '../engine/evaluate.js';

export interface CollaborationPostResult {
  postId: string;
  channelId: string;
  createAt: number;
}

/**
 * Posts a structured message into a Mattermost channel using the configured token.
 */
export async function postToMattermost(
  config: MattermostVerifierConfig,
  channelId: string,
  message: string,
  rootId?: string
): Promise<CollaborationPostResult> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/api/v4/posts`;
  const fetchFn = config.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    channel_id: channelId,
    message,
  };
  if (rootId) {
    let threadRoot = rootId;
    try {
      const checkUrl = `${config.baseUrl.replace(/\/+$/, '')}/api/v4/posts/${encodeURIComponent(rootId)}`;
      const checkResp = await fetchFn(checkUrl, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (checkResp.ok) {
        const postData = (await checkResp.json()) as { root_id?: string };
        if (postData.root_id) {
          threadRoot = postData.root_id;
        }
      }
    } catch {
      // fallback to original rootId
    }
    body.root_id = threadRoot;
  }

  let resp = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok && body.root_id) {
    delete body.root_id;
    resp = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to post message to Mattermost (HTTP ${resp.status}): ${errText}`);
  }

  const post = (await resp.json()) as { id: string; channel_id: string; create_at: number };
  return {
    postId: post.id,
    channelId: post.channel_id,
    createAt: post.create_at,
  };
}

/**
 * Format and post a structured human approval request to Switch/Mattermost for a conditional plan.
 */
export async function postApprovalRequest(params: {
  scenario: Scenario;
  plan: RecoveryPlan;
  evaluation: PlanEvaluation;
  channelId: string;
  config: MattermostVerifierConfig;
  rootId?: string;
}): Promise<CollaborationPostResult> {
  const { scenario, plan, evaluation, channelId, config, rootId } = params;
  const hash = planHash(scenario, plan);
  const command = budgetApprovalCommand(scenario, plan, evaluation.excessBudgetINR);

  const text = [
    `### ⚠️ CASCADE COMMITMENT RECOVERY — HUMAN APPROVAL REQUIRED`,
    `**Scenario:** \`${scenario.id}\` — ${scenario.title}`,
    `**Selected Recovery Plan:** \`${plan.id}\` (${plan.label})`,
    `**Projected Cost:** INR ${evaluation.projectedCostINR} (Baseline: INR ${scenario.baselineBudgetINR})`,
    `**Budget Exception:** INR ${evaluation.excessBudgetINR} above baseline budget`,
    '',
    `**Operational Status:**`,
    `- Hard commitments (capacity, accessibility, AV concurrency, kickoff): SATISFIED`,
    `- Budget commitment: CONDITIONAL on human budget authority approval`,
    '',
    `To authorize this recovery plan, the designated owner must reply with the exact authorization command:`,
    '```',
    command,
    '```',
  ].join('\n');

  return postToMattermost(config, channelId, text, rootId);
}

/**
 * Format and post an execution receipt to Switch/Mattermost after verified plan application.
 */
export async function postExecutionReceipt(params: {
  receipt: ExecutionReceipt;
  channelId: string;
  config: MattermostVerifierConfig;
  rootId?: string;
}): Promise<CollaborationPostResult> {
  const { receipt, channelId, config, rootId } = params;

  const actionsList = receipt.actions
    .map(a => `- \`${a.artifact}\`: **${a.status}**`)
    .join('\n');

  const text = [
    `### ✅ CASCADE RECOVERY PLAN EXECUTED LOCALLY`,
    `**Plan:** \`${receipt.planId}\` (Scenario: \`${receipt.scenarioId}\` rev ${receipt.scenarioRevision})`,
    `**Plan Hash:** \`${receipt.planHash}\``,
    `**Execution State:** \`${receipt.state}\``,
    `**Approval Evidence:** Switch Room \`${receipt.humanApprovalEvidence?.switchRoomId}\`, Message \`${receipt.humanApprovalEvidence?.approvalMessageId}\``,
    '',
    `**Generated Artifacts:**`,
    actionsList,
    '',
    `> ${receipt.note}`,
  ].join('\n');

  return postToMattermost(config, channelId, text, rootId);
}

/**
 * Orchestrates the full end-to-end recovery:
 * 1. Evaluates scenario and plan.
 * 2. Verifies the approval message via MattermostMessageVerifier.
 * 3. Applies the plan locally and writes deterministic artifacts.
 * 4. Posts the execution receipt back to Mattermost.
 */
export async function executeVerifiedRecovery(params: {
  scenario: Scenario;
  plan: RecoveryPlan;
  approvalRef: SwitchMessageReference;
  verifier: MattermostMessageVerifier;
  config: MattermostVerifierConfig;
  channelId: string;
  outputRoot: string;
  postReceiptToChannel?: boolean;
}): Promise<{
  evaluation: PlanEvaluation;
  approval: VerifiedApproval;
  receipt: ExecutionReceipt;
  alreadyApplied: boolean;
  receiptPost?: CollaborationPostResult;
}> {
  const { scenario, plan, approvalRef, verifier, config, channelId, outputRoot, postReceiptToChannel } = params;

  // 1. Evaluate plan
  const evaluation = evaluatePlan(scenario, plan);
  if (evaluation.verdict !== 'REQUIRES_APPROVAL' && evaluation.verdict !== 'PASS') {
    throw new Error(`Plan cannot be executed: verdict is ${evaluation.verdict}`);
  }

  // 2. Verify human approval
  const approval = await verifyBudgetApproval({
    scenario,
    plan,
    maxExtraINR: evaluation.excessBudgetINR,
    ref: approvalRef,
    verifier,
  });

  // 3. Apply plan locally
  const { receipt, alreadyApplied } = await applyPlan({
    scenario,
    plan,
    trustedApprovals: [approval],
    outputRoot,
  });

  // 4. Post receipt back to channel if requested
  let receiptPost: CollaborationPostResult | undefined;
  if (postReceiptToChannel) {
    receiptPost = await postExecutionReceipt({
      receipt,
      channelId,
      config,
      rootId: approvalRef.messageId,
    });
  }

  return {
    evaluation,
    approval,
    receipt,
    alreadyApplied,
    receiptPost,
  };
}
