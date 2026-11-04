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

export interface MattermostVerifierConfig {
  /** Base URL of the Mattermost server, e.g. "http://localhost:59113" */
  readonly baseUrl: string;
  /** Personal Access Token or Bot Token for API access */
  readonly token: string;
  /** Logical serverId to match ref.serverId (defaults to baseUrl or configured serverId) */
  readonly serverId?: string;
  /** Map Mattermost userId or username to canonical humanId (e.g. "human:organizer-owner") */
  readonly userMap?: Readonly<Record<string, string>>;
  /** Map Mattermost channelId or name to canonical roomId (e.g. "room:cascade-operations") */
  readonly roomMap?: Readonly<Record<string, string>>;
  /** Optional custom fetch implementation for testing */
  readonly fetchFn?: typeof fetch;
}

/**
 * Production Switch / Mattermost message verifier that queries the live
 * authenticated REST API to verify message authenticity, human authorship,
 * correct room/channel, and creation timestamp.
 */
export class MattermostMessageVerifier implements SwitchMessageVerifier {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly serverId: string;
  private readonly userMap: Readonly<Record<string, string>>;
  private readonly roomMap: Readonly<Record<string, string>>;
  private readonly fetchFn: typeof fetch;

  constructor(config: MattermostVerifierConfig) {
    if (!config || typeof config !== 'object') throw new TypeError('Invalid MattermostVerifierConfig');
    if (typeof config.baseUrl !== 'string' || !config.baseUrl.trim())
      throw new TypeError('Mattermost baseUrl must be a nonempty string');
    if (typeof config.token !== 'string' || !config.token.trim())
      throw new TypeError('Mattermost token must be a nonempty string');

    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token.trim();
    this.serverId = config.serverId?.trim() || this.baseUrl;
    this.userMap = config.userMap ?? {};
    this.roomMap = config.roomMap ?? {};
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async fetchVerifiedMessage(ref: SwitchMessageReference): Promise<VerifiedSwitchMessage | null> {
    if (!ref || typeof ref !== 'object') return null;
    if (typeof ref.messageId !== 'string' || !ref.messageId.trim()) return null;
    if (typeof ref.serverId !== 'string' || !ref.serverId.trim()) return null;
    if (typeof ref.roomId !== 'string' || !ref.roomId.trim()) return null;

    // Server verification: must match configured serverId or baseUrl
    if (ref.serverId !== this.serverId && ref.serverId !== this.baseUrl) {
      return null;
    }

    try {
      // 1. Fetch Post from authenticated Mattermost endpoint
      const postUrl = `${this.baseUrl}/api/v4/posts/${encodeURIComponent(ref.messageId)}`;
      const postResp = await this.fetchFn(postUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
      });
      if (!postResp.ok) return null;

      const post = (await postResp.json()) as {
        id?: string;
        user_id?: string;
        channel_id?: string;
        message?: string;
        create_at?: number;
        props?: Record<string, unknown>;
      };

      if (!post || post.id !== ref.messageId || !post.user_id || !post.channel_id) {
        return null;
      }

      // 2. Room verification: channel must match ref.roomId (or via roomMap)
      const canonicalRoom = this.roomMap[post.channel_id] ?? post.channel_id;
      const targetRoom = this.roomMap[ref.roomId] ?? ref.roomId;
      if (post.channel_id !== ref.roomId && canonicalRoom !== ref.roomId && post.channel_id !== targetRoom) {
        return null;
      }

      // 3. User verification: fetch authenticated user details
      const userUrl = `${this.baseUrl}/api/v4/users/${encodeURIComponent(post.user_id)}`;
      const userResp = await this.fetchFn(userUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
      });
      if (!userResp.ok) return null;

      const user = (await userResp.json()) as {
        id?: string;
        username?: string;
        is_bot?: boolean;
        roles?: string;
      };

      if (!user || user.id !== post.user_id) return null;

      // Determine authorKind (enforce that bots, webhook overrides, and integrations are 'agent')
      const isBot =
        user.is_bot === true ||
        post.props?.from_bot === 'true' ||
        post.props?.from_webhook === 'true' ||
        Boolean(post.props?.override_username);

      const authorKind: 'human' | 'agent' = isBot ? 'agent' : 'human';

      // Map humanId if configured
      const humanId =
        this.userMap[user.id] ??
        (user.username ? this.userMap[user.username] : undefined) ??
        user.id;

      const createdAt = typeof post.create_at === 'number'
        ? new Date(post.create_at).toISOString()
        : '';

      return {
        serverId: ref.serverId,
        roomId: ref.roomId,
        messageId: ref.messageId,
        humanId,
        authorKind,
        content: typeof post.message === 'string' ? post.message : '',
        createdAt,
      };
    } catch {
      return null;
    }
  }
}

/** Create a production verifier from environment variables or custom config. */
export function createProductionSwitchVerifier(
  overrides?: Partial<MattermostVerifierConfig>
): SwitchMessageVerifier {
  const baseUrl =
    overrides?.baseUrl ??
    process.env.CASCADE_SWITCH_URL ??
    process.env.SWITCH_MATTERMOST_URL ??
    process.env.MATTERMOST_URL ??
    'http://localhost:59113';

  const token =
    overrides?.token ??
    process.env.CASCADE_SWITCH_TOKEN ??
    process.env.SWITCH_MATTERMOST_TOKEN ??
    process.env.MATTERMOST_TOKEN ??
    '';

  if (!token && !overrides?.fetchFn) {
    return unconfiguredSwitchVerifier;
  }

  return new MattermostMessageVerifier({
    baseUrl,
    token: token || 'unconfigured',
    serverId: overrides?.serverId ?? process.env.SWITCH_SERVER_ID,
    userMap: overrides?.userMap,
    roomMap: overrides?.roomMap,
    fetchFn: overrides?.fetchFn,
  });
}
