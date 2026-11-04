import { resolve } from 'node:path';
import { loadFixtures } from './load.js';
import { evaluatePlan } from '../engine/evaluate.js';
import { budgetApprovalCommand, MattermostMessageVerifier } from '../switch/approval.js';
import { executeVerifiedRecovery, postApprovalRequest } from '../switch/collaboration.js';

async function main() {
  const { scenario, plans } = await loadFixtures();
  const planB = plans.find(p => p.id === 'plan-b')!;
  const evaluation = evaluatePlan(scenario, planB);

  const baseUrl = process.env.CASCADE_SWITCH_URL ?? process.env.MATTERMOST_URL ?? 'http://localhost:59113';
  const token = process.env.CASCADE_SWITCH_TOKEN ?? process.env.MATTERMOST_TOKEN;
  if (!token) {
    console.error('Error: Please set CASCADE_SWITCH_TOKEN or MATTERMOST_TOKEN environment variable.');
    process.exitCode = 1;
    return;
  }
  const channelId = process.env.CASCADE_SWITCH_CHANNEL_ID ?? process.env.MATTERMOST_CHANNEL_ID ?? '1q83ogqo37gfxjrthkm6hwgqxc';
  const humanApproverId = scenario.approvalAuthority.approverId;
  const serverId = scenario.approvalAuthority.serverId;
  const roomId = scenario.approvalAuthority.roomId;

  const verifierConfig = {
    baseUrl,
    token,
    serverId,
    userMap: {
      'oh47xmfeafyapbjyhhri6bucae': humanApproverId,
    },
    roomMap: {
      [channelId]: roomId,
    },
  };

  const verifier = new MattermostMessageVerifier(verifierConfig);
  const hash = budgetApprovalCommand(scenario, planB, evaluation.excessBudgetINR);

  console.log(`CASCADE REAL SWITCH COLLABORATION RECOVERY`);
  console.log(`Scenario: ${scenario.id} (${scenario.title})`);
  console.log(`Plan: ${planB.id} (${planB.label})`);
  console.log(`Verdict: ${evaluation.verdict} (INR ${evaluation.projectedCostINR}, excess: INR ${evaluation.excessBudgetINR})`);
  console.log(`Required command:\n  ${hash}`);

  // Check if an approval message ID was passed as CLI argument or environment variable
  const args = process.argv.slice(2);
  let approvalMsgId = process.env.CASCADE_APPROVAL_MSG_ID;
  const msgArgIdx = args.indexOf('--approval-msg');
  if (msgArgIdx !== -1 && args[msgArgIdx + 1]) {
    approvalMsgId = args[msgArgIdx + 1];
  }

  if (args.includes('--post-request')) {
    console.log(`\nPosting approval request to Mattermost channel ${channelId}...`);
    const postRes = await postApprovalRequest({
      scenario,
      plan: planB,
      evaluation,
      channelId,
      config: verifierConfig,
    });
    console.log(`✅ Approval request posted! Post ID: ${postRes.postId}`);
  }

  if (approvalMsgId) {
    if (!/^[a-z0-9]{26}$/.test(approvalMsgId)) {
      console.error(`Error: Invalid approval message ID "${approvalMsgId}". Must be a 26-character lowercase alphanumeric post ID.`);
      process.exitCode = 1;
      return;
    }
    const outDirArgIdx = args.indexOf('--output-dir');
    const outDirArg = outDirArgIdx !== -1 ? args[outDirArgIdx + 1] : undefined;
    if (outDirArg) {
      const normalized = outDirArg.replace(/\\/g, '/');
      if (normalized.includes('..') || !normalized.startsWith('artifacts/')) {
        console.error(`Error: Invalid output directory "${outDirArg}". Must target an approved path under "artifacts/".`);
        process.exitCode = 1;
        return;
      }
    }
    const outputRoot = outDirArg
      ? resolve(process.cwd(), outDirArg)
      : resolve(process.cwd(), process.env.CASCADE_OUTPUT_DIR ?? 'artifacts/event-430-recovery-live');

    const result = await executeVerifiedRecovery({
      scenario,
      plan: planB,
      approvalRef: {
        serverId,
        roomId,
        messageId: approvalMsgId,
      },
      verifier,
      config: verifierConfig,
      channelId,
      outputRoot,
      postReceiptToChannel: true,
    });

    console.log(`✅ APPROVAL VERIFIED!`);
    console.log(`  Approval ID: ${result.approval.id}`);
    console.log(`  Verified Human: ${result.approval.verifiedHumanId}`);
    console.log(`  Verified At: ${result.approval.verifiedAt}`);
    console.log(`✅ PLAN EXECUTED LOCALLY!`);
    console.log(`  Execution Key: ${result.receipt.executionKey}`);
    console.log(`  Plan Hash: ${result.receipt.planHash}`);
    console.log(`  State: ${result.receipt.state}`);
    console.log(`  Already Applied: ${result.alreadyApplied}`);
    if (result.alreadyApplied) {
      console.log(`ℹ️ Plan already applied locally (idempotent replay). No duplicate receipt posted.`);
    } else if (result.receiptPost) {
      console.log(`✅ EXECUTION RECEIPT POSTED TO SWITCH!`);
      console.log(`  Receipt Post ID: ${result.receiptPost.postId}`);
    }
  } else if (!args.includes('--post-request')) {
    console.log('\nRun with --post-request to post the approval request to Switch.');
    console.log('Run with --approval-msg <id> to verify a posted human approval and execute Plan B.');
  }
}

main().catch(err => {
  console.error('Recovery failed:', err);
  process.exitCode = 1;
});
