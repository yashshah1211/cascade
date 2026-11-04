# Live Switch integration status: BLOCKED (not yet verified)

**This is not a substitute for a real Switch room.** The dashboard is a read-only view backed by the deterministic engine. It cannot approve recovery plans or post messages. The `src/switch/approval.ts` verifier interface has no production implementation, and the unconfigured verifier rejects access.

## Current status summary

- **Live Switch collaboration:** NOT IMPLEMENTED / BLOCKED.
- **Engine authorization state:** Fail-closed. Untrusted inputs and unconfigured verifiers throw immediately.
- **Offline unit tests:** Use an explicitly declared `fakeVerifier` for testing downstream engine behavior; these do NOT constitute proof of Switch integration.
- **Local execution:** Strictly writes local artifacts and draft messages marked `# Drafts only — NOT SENT`. No external booking, payment, or notification is ever triggered.

---

## Smallest viable real Switch integration boundary (Mission 02 target)

To transition from offline simulation to genuine Switch collaboration in Mission 02 without compromising safety, the integration boundary must be restricted to four minimal, strictly authenticated primitives:

### 1. Authenticated message context (Ingress)
- **Problem:** Agents and users can forge arbitrary JSON payloads or pretend to be someone else in chat text.
- **Boundary specification:**
  - The integration must NEVER accept author claims, room IDs, or message contents supplied by the client caller.
  - An authenticated adapter (`SwitchMessageVerifier`) must query the local Switch/Mattermost REST API using a validated server token.
  - The API response must provide:
    - `messageId`: Verified server-assigned post ID.
    - `serverId`: Verified Switch instance identifier (must match `scenario.approvalAuthority.serverId`).
    - `roomId`: Verified channel/team room identifier (must match `scenario.approvalAuthority.roomId`).
    - `humanId`: Verified user identity from the server authentication record (must match `scenario.approvalAuthority.approverId`).
    - `authorKind`: Verified account type (`human` vs `agent`). Bot/agent-authored messages must be rejected immediately to prevent autonomous self-authorization loops.
    - `createdAt`: ISO 8601 server timestamp, verified against event kickoff.
    - `content`: Exact raw post body.

### 2. Human authorization protocol (Syntax & Intent)
- **Problem:** Ambiguous conversational approvals ("looks good", "go ahead", "approved") cannot be reliably validated against specific budget limits or plan versions.
- **Boundary specification:**
  - The human must post an exact deterministic command:
    ```text
    CASCADE APPROVE <planHash> MAX_EXTRA_INR <amount>
    ```
  - Example:
    ```text
    CASCADE APPROVE 1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da MAX_EXTRA_INR 3000
    ```
  - The verifier validates exact string equality (whitespace trimmed). Any modification, typo, missing hash, or mismatched amount fails closed with an informative rejection message in the room.

### 3. Approval binding & Integrity checks (Revalidation)
- **Problem:** Replaying old approvals against modified plans, bumped scenarios, or past events.
- **Boundary specification:**
  - **Plan hash binding:** The SHA-256 hash covers the canonical JSON of the entire `Scenario` object and candidate `RecoveryPlan`. If any hall capacity, cost parameter, scenario revision, or allocation is altered, the hash changes and the approval is void.
  - **Timestamp staleness check:** Approvals with `createdAt` occurring after the scheduled event kickoff (`scenario.kickoffAt`) are rejected as stale.
  - **Runtime brand protection:** Verified approvals are stamped in-memory with a module-private Symbol (`VERIFIED`). Raw JSON objects cannot obtain or fake this marker.
  - **Revalidation before apply:** Immediately before local artifacts are written, `applyPlan` re-executes `evaluatePlan` with the verified approval to guarantee zero drift between verification and execution.

### 4. Result posting (Egress)
- **Problem:** Claiming external actions succeeded when only local drafts were created.
- **Boundary specification:**
  - The agent responds to the Switch room with:
    - Candidate plan evaluations (`PASS`, `FAIL`, `REQUIRES_APPROVAL`).
    - Reason breakdown for hard constraint failures (e.g., AV kit shortage, capacity breach).
    - If executed: The exact execution receipt key (`APPLIED_LOCALLY`) and local artifact paths.
    - Prominent notice that all communications remain **DRAFT** and no actual external venue bookings or payments were initiated.

---

## Known Windows installation issue & Mitigations

- **Observed failure:** Switch Console v0.40.1 on Windows previously exhibited recurring tool failures (`switch.post_message` and `switch.read_context` failing or timing out) when used in direct 1:1 agent chats.
- **Mitigation strategy for Mission 02:**
  - Run all Switch collaboration within a dedicated **team channel** rather than direct messages.
  - Capture controller stdout/stderr logs if any tool invocation fails.
  - Never fabricate a successful Switch conversation if tools fail; report the exact error code and network failure trace to the reviewer.

---

## Minimum acceptance checklist for Mission 02

- [ ] Start Switch Console and confirm Mattermost is reachable at its local port.
- [ ] Create a Mattermost **team channel** for CASCADE; join a real human and one agent.
- [ ] Send a human message addressing the agent; verify the agent responds in that channel.
- [ ] Agent runs `node dist/src/cli/main.js demo` locally and reports genuine computed results into the channel.
- [ ] Human sends the exact plan-bound approval command in Switch.
- [ ] Production `SwitchMessageVerifier` fetches and authenticates the post.
- [ ] Local execution completes with verified approval receipt.
- [ ] Capture end-to-end evidence (chat logs, console logs, artifact receipt) for independent review.
