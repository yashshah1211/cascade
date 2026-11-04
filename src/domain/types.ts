/** CASCADE's public domain model. Times must be ISO 8601 with an explicit UTC offset. */
export type Verdict = 'PASS' | 'REQUIRES_APPROVAL' | 'FAIL' | 'UNKNOWN';
export type CheckStatus = 'PASS' | 'REQUIRES_APPROVAL' | 'FAIL' | 'UNKNOWN';
export type DependencyKind = 'requires' | 'enables' | 'scheduled-at';

export interface Dependency {
  /** The prerequisite's stable node ID, e.g. venue:main. */
  prerequisiteId: string;
  kind: DependencyKind;
}

export interface Commitment {
  id: string;
  description: string;
  beneficiary: string;
  owner: string;
  approver: string;
  dueAt: string;
  classification: 'hard' | 'negotiable';
  dependencies: Dependency[];
  provenance: string;
}

export interface Hall {
  id: string;
  label: string;
  capacity: number;
  /** null means not independently verified, and MUST block a plan. */
  accessible: boolean | null;
}

export interface Scenario {
  id: string;
  revision: number;
  title: string;
  attendees: number;
  originalVenueId: string;
  kickoffAt: string;
  sponsorShowcaseBefore: string;
  baselineBudgetINR: number;
  baselineCommittedCostINR: number;
  avKitsAvailable: number;
  avKitRentalCostINR: number;
  halls: Hall[];
  commitments: Commitment[];
  approvalAuthority: { approverId: string; serverId: string; roomId: string };
  factsProvenance: string;
}

export interface Allocation {
  hallId: string;
  /** Zero-indexed inclusive attendee range, no overlap across allocations. */
  attendeeFrom: number;
  attendeeTo: number;
  start: string;
  end: string;
  avKits: number;
}

export interface RecoveryPlan {
  id: string;
  label: string;
  scenarioId: string;
  /** The scenario revision this plan was generated against. */
  scenarioRevision: number;
  allocations: Allocation[];
  rentedAvKits: number;
  sponsorShowcaseAt: string;
  note: string;
}

export interface Disruption {
  id: string;
  disabledNodeId: string;
  reportedAt: string;
  description: string;
  source: string;
}

export interface Impact {
  commitmentId: string;
  description: string;
  /** The graph path from the changed prerequisite to this commitment, inclusive. */
  path: string[];
}

export interface ConstraintCheck {
  id: string;
  status: CheckStatus;
  message: string;
  evidence: Record<string, unknown>;
}

/**
 * TrustedSwitchApproval is produced ONLY after an external verifier looks up
 * the actual Switch message and verifies its author. The JSON CLI doesn't
 * import approvals. Offline tests use an explicitly named fake verifier.
 */
export interface TrustedSwitchApproval {
  id: string;
  approvalMessageId: string;
  switchRoomId: string;
  switchServerId: string;
  verifiedHumanId: string;
  planHash: string;
  scenarioId: string;
  scenarioRevision: number;
  exceptionType: 'BUDGET_CAP';
  maxExtraINR: number;
  verifiedAt: string;
}

export interface PlanEvaluation {
  scenarioId: string;
  planId: string;
  planHash: string;
  scenarioRevision: number;
  verdict: Verdict;
  projectedCostINR: number;
  excessBudgetINR: number;
  checks: ConstraintCheck[];
  requiredApprovals: string[];
  evaluatedAt: string;
}

export interface ExecutionReceipt {
  executionKey: string;
  scenarioId: string;
  scenarioRevision: number;
  planId: string;
  planHash: string;
  state: 'APPLIED_LOCALLY';
  /** Avoid implying a real message was sent or a venue was booked. */
  actions: { artifact: string; status: 'applied-locally' | 'drafted' }[];
  humanApprovalEvidence: { switchRoomId: string; approvalMessageId: string } | null;
  note: string;
}
