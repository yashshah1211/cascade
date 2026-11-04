# CASCADE — Switch Collaboration & Verifier Architecture

This document records the architecture, security boundary, live integration verification, and host environment inventory for CASCADE's human-in-the-loop recovery workflow mediated by Switch.

---

## 1. Executive Summary & Verification State

- **Workflow State:** Verified Genuine Human-in-the-Loop Collaboration Architecture (Mission 02D Completed).
- **Engine Authorization Boundary:** Fail-closed. Untrusted inputs, unauthenticated messages, bot accounts, webhooks, and mismatched rooms or servers are strictly rejected.
- **Human Approval Verification:** Real human approval personally submitted by the authorized event owner (`oh47xmfeafyapbjyhhri6bucae`) in Mattermost Town Square (Post ID: `w7gx4ku4ybdtirmhs36feexciw`).
- **Deterministic Execution:** Real recovery execution performed by `executeVerifiedRecovery` with receipt state `APPLIED_LOCALLY`.
- **Receipt Notification:** Execution receipt posted to Mattermost Town Square thread (Post ID: `d41a43t9rtnyid9ho3dhjyfy8o`).
- **Automated Test Suite:** 56/56 passing tests across unit, security regression, artifact integrity, and live verifier suites.
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
- **Agent Instructions**: Configured with strict operational bounds for CASCADE event-430 evaluation and recovery execution. Broad filesystem searches and premature status declarations are explicitly forbidden.

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

## 6. Mission 02D — Human-Approved Execution Recovery & Turn Failure Analysis

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

### B. Engineering Corrections

1. **Native Switch Operation Integration:**
   Registered `@operation cascade_execute_recovery(approval_message_id: str, output_dir: str = "artifacts/event-430-recovery-live")` in `switch_core` and exposed its MCP schema to the agent:
   - Target binary: `node dist/src/cli/main.js recover --approval-msg <id> --output-dir <dir>`
   - Working directory: `C:\Users\yashs\Downloads\CASCADE_Day1_MVP_2026-11-04\cascade`
   - Executes with fail-closed verification of the human message.
2. **Hardened Prompt & Operational Constraints (Revision 9):**
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

### D. Recovery Execution & Artifact Evidence

The deterministic recovery engine executed against the verified approval message:
- **CLI Command:**
  ```powershell
  npm run recover -- --approval-msg w7gx4ku4ybdtirmhs36feexciw --output-dir artifacts/event-430-recovery-live
  ```
- **Generated Artifact Directory:**
  `artifacts/event-430-recovery-live/event-430-1ddfdd0f2ccda8d1f9891627/`
- **Generated Artifacts:**
  1. `receipt.json`:
     - `planHash`: `1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da`
     - `state`: `APPLIED_LOCALLY`
     - `approvalMessageId`: `switch:switch:local-demo:room:cascade-operations:w7gx4ku4ybdtirmhs36feexciw`
     - `projectedCostINR`: `83000` (baseline ₹80,000 + ₹3,000 approved exception)
     - `note`: `Local artifacts written. No external venue booking, supplier purchase, or stakeholder notification performed.`
  2. `schedule.json`:
     - Hall A: 250 attendees (0–249), 10:00–10:45, 1 AV kit.
     - Hall B: 180 attendees (250–429), 10:00–10:45, 1 AV kit.
  3. `assignments.json`:
     - 430 total attendees assigned without duplicates or gaps.
  4. `stakeholder-messages.md`:
     - Marked `# Drafts only — NOT SENT` across all draft communications.
- **Mattermost Receipt Notification:**
  - Real execution receipt posted to Town Square: Post ID `d41a43t9rtnyid9ho3dhjyfy8o` (reply under root thread `g4aqigppjtgw9f4jqbajbu5xxa`).

---

## 7. Local Installation Modifications & Reversal Guide

To establish the running Switch and Mattermost collaboration environment, bounded adjustments were made. The following inventory documents each modification and its reversal:

### A. Switch Console Application Code
1. `C:\Users\yashs\AppData\Local\Programs\Switch Console\resources\app\dist\main\agent-controller.mjs`:
   - **Change:** Added fallback null-checks on `agent.options` to prevent unhandled exceptions during agent spawn.
   - **Reversal:** Reinstall Switch Console v0.40.1, or restore `agent-controller.mjs` from package backup.
2. `C:\Users\yashs\AppData\Local\Programs\Switch Console\resources\app\dist\python\switch_core\bridges\agent\api\operations.py`:
   - **Change:** Supported case-insensitive query parameter lookups and auto-placement verification for agents in legacy rooms.
   - **Reversal:** Restore `operations.py` from package backup or reinstall Switch Console.
3. `C:\Users\yashs\AppData\Local\Programs\Switch Console\resources\app\dist\python\switch_core\definitions.py`:
   - **Change:** Registered `@operation cascade_evaluate_recovery` and `@operation cascade_execute_recovery`.
   - **Reversal:** Revert `definitions.py` to backup without CASCADE operations.

### B. PostgreSQL Database State (`switch` DB on port 59114)
1. `rooms` Table:
   - **Change:** Inserted legacy room mapping record for room `6fe42a1c-6f29-45de-8aca-da763634216e`.
2. `room_agents` Table:
   - **Change:** Inserted placement record associating agent `56911d08-ca1d-4e80-8812-9c77e3852dc9` with room `6fe42a1c-6f29-45de-8aca-da763634216e`.
3. `agents` Table:
   - **Change:** Updated definition for agent `56911d08-ca1d-4e80-8812-9c77e3852dc9` to Revision 9 (Antigravity provider, `gemini-3.8-flash` model, bounded CASCADE instructions).
4. **Reversal SQL:**
   ```sql
   DELETE FROM room_agents WHERE room_id = '6fe42a1c-6f29-45de-8aca-da763634216e';
   DELETE FROM rooms WHERE id = '6fe42a1c-6f29-45de-8aca-da763634216e';
   ```

### C. Host Environment PATH
- **Change:** Added `C:\Users\yashs\tools\antigravity-acp\bin` to the user `Path` environment variable.
- **Reversal:** Remove `C:\Users\yashs\tools\antigravity-acp\bin` from the user `Path` environment variable.
