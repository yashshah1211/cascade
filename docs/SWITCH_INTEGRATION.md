# CASCADE — Switch Collaboration & Verifier Architecture

This document records the architecture, security boundary, live integration verification, and host environment inventory for CASCADE's human-in-the-loop recovery workflow mediated by Switch.

---

## 1. Executive Summary & Verification State

- **Workflow State:** Verified Genuine Human-in-the-Loop Collaboration Architecture (Mission 02E Completed).
- **Engine Authorization Boundary:** Fail-closed. Untrusted inputs, unauthenticated messages, bot accounts, webhooks, and mismatched rooms or servers are strictly rejected.
- **Human Approval Verification:** Real human approval personally submitted by the authorized event owner (`oh47xmfeafyapbjyhhri6bucae`) in Mattermost Town Square (Post ID: `w7gx4ku4ybdtirmhs36feexciw`).
- **Deterministic Execution:** Real recovery execution performed by `executeVerifiedRecovery` with receipt state `APPLIED_LOCALLY`.
- **Receipt Notification:** Execution receipt posted to Mattermost Town Square thread (Post ID: `d41a43t9rtnyid9ho3dhjyfy8o`). Replay execution verifies existing artifacts, returns `alreadyApplied: true`, and suppresses duplicate receipt notifications.
- **Automated Test Suite:** 56/56 passing tests across unit, security regression, artifact integrity, live verifier, and idempotent collaboration suites.
- **Execution Safeguards:** Local artifacts only (`APPLIED_LOCALLY`). External actions (venue booking, supplier purchase, broadcast notification) remain non-executable drafts (`# Drafts only — NOT SENT`).
- **Security Hotfix:** All previously exposed tokens have been revoked in PostgreSQL `useraccesstokens` and active `sessions`. Both old tokens are confirmed to return HTTP 401 Unauthorized. No secrets or tokens are stored in tracked repository files.

---

## 2. Genuine Human Approval Protocol & Safeguards

### The Requirement
To prevent automated self-authorization, CASCADE requires that any recovery plan exceeding baseline budget caps (`REQUIRES_APPROVAL`) must receive explicit human authorization personally submitted by the authorized event owner through Switch/Mattermost. Programmatic postings via scripts or personal access tokens (PATs) do not satisfy this requirement.

### Verification Flow
```
[CASCADE Engine] ──(postApprovalRequest)──> [Mattermost: Town Square]
                                                    │
                                           (Owner reads prompt)
                                                    │
                                           (Owner manually posts command)
                                                    ▼
[CASCADE Verifier] <──(fetchVerifiedMessage)── [Mattermost REST API]
       │
   1. Validates Server ID (strictly matches configured serverId)
   2. Validates Channel ID (strictly mapped to canonical roomId)
   3. Validates Author Identity (exact account ID: oh47xmfeafyapbjyhhri6bucae)
   4. Enforces Human Author (is_bot: false, no webhook/bot flags)
   5. Enforces Pre-Kickoff Timestamp (createdAt <= scenario.kickoffAt)
   6. Validates Exact Plan Hash & Approved INR Cap
       │
[CASCADE Engine] ──(applyPlan)──> [Fresh Artifacts: artifacts/event-430-recovery-live/]
       │
[CASCADE Engine] ──(postExecutionReceipt)──> [Mattermost: Town Square Thread]
                                             (Suppressed on idempotent re-runs)
```

### Authorization Command Syntax
```text
CASCADE APPROVE 1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da MAX_EXTRA_INR 3000
```

---

## 3. Credential Revocation & Token Rotation

### Revocation Status
During earlier manual testing, a temporary Personal Access Token (`human-token`, ID `juhtrz77ybg5zff5r38wu68bsc`) and a bot token were referenced. Both credentials were treated as compromised:

1. **Immediate Revocation:** The records were deleted from PostgreSQL `useraccesstokens` and active session records were purged from `sessions`.
2. **Container Cache Flush:** The Mattermost service was restarted to clear in-memory token/session caches.
3. **Invalidation Verification:** Pre-flight HTTP tests confirmed that both old tokens now fail authentication with **HTTP 401 Unauthorized**.

### Safe Owner Verification Steps in Mattermost UI
To independently verify that no active unauthorized tokens remain on the account:
1. Open the Mattermost Web UI at **http://localhost:59113**.
2. Log in with the human owner account (`user`).
3. Click your profile avatar (top-left) and select **Profile > Security > Personal Access Tokens**.
4. Confirm that the token list is empty (or delete any unneeded personal access tokens).

---

## 4. Agent Architecture: Implementation Agent vs Switch Runtime Agent

### Clear Separation of Roles

| Role | Agent / System | Responsibility |
| :--- | :--- | :--- |
| **Implementation Engineer** | **AGY / Antigravity** (Google DeepMind) | Implements CASCADE codebase, determinism, test suites, verifier hardening, and artifact integrity. |
| **Switch Workspace Agent** | **`switch-buddy-admin`** (Switch Console) | The agent installed within Switch Console to interact with users inside Mattermost channels. |

### Runtime Agent Configuration
- **Runtime Agent**: Google Antigravity ACP (`agy_acp_server.exe` / `gemini-3.8-flash`) connected via Switch Console ACP driver.
- **Agent Instructions (Revision 9)**: Configured with strict operational bounds for CASCADE event-430 evaluation and recovery execution. Broad filesystem searches and premature status declarations are explicitly forbidden.

---

## 5. Security Boundary & Verifier Hardening (Mission 02B)

In response to independent review findings, `src/switch/approval.ts` was hardened with the following defenses:

1. **Multi-Format Bot & Webhook Rejection:**
   - Detects boolean, string, and numeric flags for `is_bot` (`true`, `"true"`, `"1"`, `1`).
   - Detects `props.from_bot` and `props.from_webhook` in boolean, string, or numeric forms.
   - Flags any post containing `props.override_username` or `props.webhook_display_name`.
   - Inspects `user.roles` for the `system_bot` role.
   - Any match marks the message as `authorKind: 'agent'`, which fails authorization closed.
2. **Prohibition of Generic Username Fallback:**
   - Completely eliminated `user.username` fallback lookups in `MattermostMessageVerifier`.
   - User identity mapping requires exact verified Mattermost account IDs (`user.id`).
   - Prohibits generic usernames (`user`, `admin`, `root`, `owner`, `guest`, `system`) as keys in `userMap`, throwing a `TypeError` at construction time.
3. **Strict Room & Server Binding:**
   - `ref.serverId` must strictly match the configured `serverId`. Base URL fallbacks are prohibited.
   - `ref.roomId` must strictly match the resolved canonical room mapped from `post.channel_id`.
   - Cross-room and unmapped channel posts are strictly rejected.

---

## 6. Mission 02D & 02E — Execution Recovery, Turn Failure RCA, and Switch Integration

### A. Forensic Analysis of the Failed Switch Turn

Following the owner's submission of the genuine approval command, the Switch agent turn entered a failure state reported as *"9 tool calls, 8 done, 1 failed"* and *"The agent could not complete this request."*

#### Root Cause:
1. **Missing Recovery Execution Operation:** While `cascade_evaluate_recovery` had been registered as a native Switch `@operation`, no corresponding execution operation existed in Switch Core's operation catalog.
2. **Unconstrained Filesystem Search:** Lacking a dedicated recovery tool, the Antigravity ACP agent fell back to command-line execution, running a broad recursive PowerShell search:
   ```powershell
   Get-ChildItem -Path C:\Users\yashs -Filter "*cascade*" -Recurse
   ```
   This recursive crawl across `C:\Users\yashs` timed out and was aborted, registering as the single failed tool call.
3. **Premature Status Declaration:** Before the recovery engine was executed, the agent hallucinated a status response declaring *"Status: ACTIVE / COMMITTED"*. This violated the core security premise that human authorization is a prerequisite for execution, not execution itself.

### B. Engineering Corrections (Mission 02E)

1. **Correct Executable Target:**
   The registered `cascade_execute_recovery` operation invokes the standalone recovery entrypoint:
   ```text
   node dist/src/cli/recover.js --approval-msg <id> --output-dir <dir>
   ```
   (`main.js` only handles `demo` and `inspect`; `recover.js` is the designated recovery CLI).
2. **Subprocess Exit Code Check & Failure Propagation:**
   `cascade_execute_recovery` checks `proc.returncode`. If non-zero, it raises `ValueError`, which FastAPI translates to `HTTP 400 Bad Request` with exact stderr/stdout details, ensuring failures propagate fail-closed to Switch and ACP callers even when the HTTP gateway remains healthy.
3. **Tool Input Constraints:**
   - `approval_message_id`: Constrained strictly via regex `^[a-z0-9]{26}$` (Mattermost 26-char lowercase alphanumeric post ID).
   - `output_dir`: Constrained to approved directory `artifacts/event-430-recovery-live`. Path traversal (`..`) is strictly prohibited.
4. **Idempotence & Duplicate Notification Suppression:**
   - In `src/switch/collaboration.ts`, `executeVerifiedRecovery` checks `postReceiptToChannel && !alreadyApplied`.
   - On replay, `applyPlan` verifies on-disk artifact integrity and returns `alreadyApplied: true`.
   - The CLI logs the idempotent replay and **does not publish duplicate receipt notifications** to Mattermost.
5. **Hardened Prompt & Operational Constraints (Revision 9):**
   Updated `switch-buddy-admin` instructions to:
   - Forbid recursive and broad directory scans; repository location is strictly fixed.
   - Forbid declaring any plan "ACTIVE / COMMITTED" prior to engine receipt generation.
   - Mandate calling `cascade_execute_recovery` upon receiving `CASCADE APPROVE`.

### C. Human Approval Evidence

The approval was verified through the authenticated Mattermost API by `MattermostMessageVerifier`:
- **Post ID:** `w7gx4ku4ybdtirmhs36feexciw`
- **Channel ID:** `1q83ogqo37gfxjrthkm6hwgqxc` (Town Square, mapped to `room:cascade-operations`)
- **Author ID:** `oh47xmfeafyapbjyhhri6bucae` (username: `user`, email: `user@localhost.local`)
- **Author Classification:** `authorKind: 'human'` (`is_bot: false`, no webhook props, real owner session)
- **Message Content:**
  ```text
  CASCADE APPROVE 1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da MAX_EXTRA_INR 3000
  ```
- **Post Timestamp:** `1793812404513` (`2026-11-04T17:13:24.513Z`), preceding synthetic event kickoff (`2026-11-06T10:00:00+05:30`).

### D. Distinct Execution Milestones

#### Milestone 1: Direct Engine Local Execution
The deterministic recovery CLI executed against the verified approval:
- **CLI Command:**
  ```powershell
  npm run recover -- --approval-msg w7gx4ku4ybdtirmhs36feexciw --output-dir artifacts/event-430-recovery-live
  ```
- **Initial Execution Receipt:** Posted to Mattermost Town Square: Post ID `d41a43t9rtnyid9ho3dhjyfy8o` (reply under thread `g4aqigppjtgw9f4jqbajbu5xxa`).

#### Milestone 2: Antigravity ACP Switch Tool Execution
The Antigravity ACP agent executes the recovery via Switch tool `cascade_execute_recovery`:
- **API Call:** `POST /agents/56911d08-ca1d-4e80-8812-9c77e3852dc9/ops/cascade_execute_recovery`
- **Payload:** `{"approval_message_id": "w7gx4ku4ybdtirmhs36feexciw", "output_dir": "artifacts/event-430-recovery-live"}`
- **Subprocess Exit Code:** `0` (`success: true`)
- **Replay State:** `Already Applied: true` (intact artifact validation passed).
- **Duplicate Suppression:** Zero duplicate messages published to Mattermost.

### E. Execution Receipt & Artifact Schema Verification

**Generated Artifact Directory:**
`artifacts/event-430-recovery-live/event-430-1ddfdd0f2ccda8d1f9891627/`

1. **`receipt.json` Schema:**
   ```json
   {
     "executionKey": "event-430-1ddfdd0f2ccda8d1f9891627",
     "scenarioId": "event-430",
     "scenarioRevision": 1,
     "planId": "plan-b",
     "planHash": "1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da",
     "state": "APPLIED_LOCALLY",
     "actions": [
       { "artifact": "schedule.json", "status": "applied-locally" },
       { "artifact": "assignments.json", "status": "applied-locally" },
       { "artifact": "stakeholder-messages.md", "status": "drafted" }
     ],
     "humanApprovalEvidence": {
       "switchRoomId": "room:cascade-operations",
       "approvalMessageId": "w7gx4ku4ybdtirmhs36feexciw"
     },
     "note": "Local artifacts only. No actual venue booking, supplier purchase, or stakeholder notification."
   }
   ```
   *Note: `humanApprovalEvidence.approvalMessageId` strictly contains the raw Mattermost post ID (`w7gx4ku4ybdtirmhs36feexciw`).*

2. **`schedule.json` Schema:**
   - Hall A: 250 attendees (0–249), 10:00–10:45, 1 AV kit.
   - Hall B: 180 attendees (250–429), 10:00–10:45, 1 AV kit.
   - `sponsorShowcaseAt`: `2026-11-06T11:00:00+05:30`
   - `projectedCostINR`: `83000` (baseline ₹80,000 + ₹3,000 approved exception).
3. **`assignments.json` Schema:**
   - 430 total attendees assigned across Hall A and Hall B with zero gaps or overlaps.
4. **`stakeholder-messages.md` Schema:**
   - Marked `# Drafts only — NOT SENT` across all draft communications.
   - Explicit disclaimer: `This message has not been sent.`

---

## 7. Reproducible Integration Setup & Reversal Guide

To ensure reproducibility across environments without manual vendor file tampering, CASCADE provides a dedicated setup script: [`scripts/setup-switch-operations.py`](file:///C:/Users/yashs/Downloads/CASCADE_Day1_MVP_2026-11-04/cascade/scripts/setup-switch-operations.py).

### A. Reproducible Setup Procedure
```powershell
# 1. Build CASCADE TypeScript CLI
npm run build

# 2. Run Switch native operations registration script
python scripts/setup-switch-operations.py

# 3. Restart Switch Core service to load updated operations
```

The script automatically:
- Discovers active `definitions.py` paths in standard Switch installation directories.
- Injects or updates `@operation cascade_evaluate_recovery` and `@operation cascade_execute_recovery`.
- Enforces strict input validation, correct executable path (`dist/src/cli/recover.js`), and exit code failure propagation.
- Syncs ACP tool schemas to the local Antigravity ACP brain directory.

### B. Local Installation Modifications & Reversal Inventory

| Component | Path | Modification | Reversal Procedure |
| :--- | :--- | :--- | :--- |
| **Switch Core Operations** | `definitions.py` in `switch_core/bridges/agent/operations/` | Added `@operation cascade_evaluate_recovery` and `cascade_execute_recovery` | Remove the `# ── CASCADE Deterministic Operations` block from `definitions.py` |
| **ACP Tool Schemas** | `.local/state/switch/antigravity-acp/.../mcp/switch/` | Registered `cascade_evaluate_recovery.json` and `cascade_execute_recovery.json` | Delete `cascade_*.json` from the brain MCP directory |
| **PostgreSQL Database** | `rooms` and `room_agents` tables (`switch` DB on port 59114) | Added room mapping `6fe42a1c-6f29-45de-8aca-da763634216e` and assigned agent | `DELETE FROM room_agents WHERE room_id = '6fe42a1c-6f29-45de-8aca-da763634216e'; DELETE FROM rooms WHERE id = '6fe42a1c-6f29-45de-8aca-da763634216e';` |
| **Host PATH** | Windows User `Path` | Added `C:\Users\yashs\tools\antigravity-acp\bin` | Remove directory from User `Path` |
