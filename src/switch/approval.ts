import type { RecoveryPlan, Scenario, TrustedSwitchApproval } from '../domain/types.js';
import { isoMillis, planHash, validatePlan, validateScenario } from '../domain/validate.js';

/** Private in-process brand. Arbitrary JSON cannot impersonate a verified Switch event. */
const VERIFIED = Symbol('verified-by-Switch-message-verifier');
export type VerifiedApproval = Readonly<TrustedSwitchApproval> & { readonly [VERIFIED]: true };
export function isVerifiedApproval(value: unknown): value is VerifiedApproval {
  return !!value && typeof value === 'object' && (value as Record<symbol, unknown>)[VERIFIED] === true;
}

export interface SwitchMessageReference {
  serverId: string;
  roomId: string;
  messageId: string;
}

/** Data must be fetched from an authenticated Switch API, never from agent text. */
export interface VerifiedSwitchMessage {
  serverId: string;
  roomId: string;
  messageId: string;
  humanId: string;
  authorKind: 'human' | 'agent';
  content: string;
  createdAt: string;
}

export interface SwitchMessageVerifier {
  /** Caller must fetch and authenticate the event against Switch, including author identity. */
  fetchVerifiedMessage(ref: SwitchMessageReference): Promise<VerifiedSwitchMessage | null>;
}

export function budgetApprovalCommand(scenario: Scenario, plan: RecoveryPlan, maxExtraINR: number): string {
  if (!Number.isSafeInteger(maxExtraINR) || maxExtraINR < 0) throw new TypeError('Invalid exception amount');
  return `CASCADE APPROVE ${planHash(scenario, plan)} MAX_EXTRA_INR ${maxExtraINR}`;
}

/**
 * Trusted ingress boundary. No CLI/API endpoint accepts an arbitrary approval
 * object. Offline tests inject a clearly marked fake verifier.
 */
export async function verifyBudgetApproval(input: {
  scenario: Scenario;
  plan: RecoveryPlan;
  maxExtraINR: number;
  ref: SwitchMessageReference;
  verifier: SwitchMessageVerifier;
}): Promise<VerifiedApproval> {
  const { scenario, plan, ref, verifier, maxExtraINR } = input;
  validateScenario(scenario);
  validatePlan(plan, scenario);
  const authority = scenario.approvalAuthority;
  if (!ref || typeof ref !== 'object') throw new TypeError('Invalid SwitchMessageReference');
  if (typeof ref.serverId !== 'string' || !ref.serverId.trim())
    throw new TypeError('Approval reference must have a nonempty serverId');
  if (typeof ref.roomId !== 'string' || !ref.roomId.trim())
    throw new TypeError('Approval reference must have a nonempty roomId');
  if (typeof ref.messageId !== 'string' || !ref.messageId.trim())
    throw new TypeError('Approval reference must have a nonempty messageId');

  if (ref.serverId !== authority.serverId || ref.roomId !== authority.roomId)
    throw new Error('Approval reference is not in the designated Switch operations room');
  if (plan.scenarioId !== scenario.id || plan.scenarioRevision !== scenario.revision)
    throw new Error('Cannot authorize a plan based on an old or different scenario');
  if (!Number.isSafeInteger(maxExtraINR) || maxExtraINR < 0)
    throw new TypeError('Invalid exception amount');

  const message = await verifier.fetchVerifiedMessage(ref);
  if (!message || message.serverId !== ref.serverId || message.roomId !== ref.roomId || message.messageId !== ref.messageId)
    throw new Error('Switch could not verify the referenced message');
  if (message.authorKind !== 'human' || message.humanId !== authority.approverId)
    throw new Error('Only the designated human owner can authorize a recovery exception');
  if (message.content.trim() !== budgetApprovalCommand(scenario, plan, maxExtraINR))
    throw new Error('The Switch approval message must exactly match the plan hash and exception');

  const msgTime = isoMillis(message.createdAt);
  if (msgTime === null)
    throw new Error('Switch approval message createdAt must be a valid offset ISO timestamp');
  const kickoffTime = isoMillis(scenario.kickoffAt)!;
  if (msgTime > kickoffTime)
    throw new Error('Approval is stale: authorization was posted after event kickoff');

  const approval: VerifiedApproval = Object.freeze({
    id: `switch:${ref.serverId}:${ref.roomId}:${ref.messageId}`,
    approvalMessageId: ref.messageId,
    switchRoomId: ref.roomId,
    switchServerId: ref.serverId,
    verifiedHumanId: message.humanId,
    planHash: planHash(scenario, plan),
    scenarioId: scenario.id,
    scenarioRevision: scenario.revision,
    exceptionType: 'BUDGET_CAP',
    maxExtraINR,
    verifiedAt: message.createdAt,
    [VERIFIED]: true as const,
  });
  return approval;
}

/** An intentionally unconfigured adapter refuses authorization rather than pretending success. */
export const unconfiguredSwitchVerifier: SwitchMessageVerifier = {
  async fetchVerifiedMessage(): Promise<null> {
    throw new Error('Switch API verifier not configured; live approval is BLOCKED');
  },
};
