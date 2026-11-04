# CASCADE — Switch Collaboration & Verifier Architecture

This document records the architecture, security boundary, live integration verification, and host environment inventory for CASCADE's human-in-the-loop recovery workflow mediated by Switch.

---

## 1. Executive Summary & Verification State

- **Workflow State:** Verified Genuine Human-in-the-Loop Collaboration Architecture.
- **Engine Authorization Boundary:** Fail-closed. Untrusted inputs, unauthenticated messages, bot accounts, webhooks, and mismatched rooms or servers are strictly rejected.
- **Automated Test Suite:** 56/56 passing tests across unit, security regression, artifact integrity, and live verifier suites.
- **Execution Safeguards:** Local artifacts only (`APPLIED_LOCALLY`). External actions (venue booking, supplier purchase, broadcast notification) remain non-executable drafts (`# Drafts only — NOT SENT`).
- **Security Hotfix:** All previously exposed tokens have been immediately revoked in PostgreSQL `useraccesstokens` and active `sessions`. Both old tokens are confirmed to return HTTP 401 Unauthorized. No secrets or tokens are stored in tracked repository files.

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

### Runtime Agent Investigation & Authorization Gate
- **Database Findings:** Switch database inspection revealed that Switch Console configured `switch-buddy-admin` (ID `56911d08-ca1d-4e80-8812-9c77e3852dc9`) with the `Codex CLI` connector using model `gpt-5.6-sol`.
- **Antigravity ACP Status:** Antigravity ACP binaries (`agy_acp_server.exe` / `antigravity-acp.cmd`) were downloaded and placed in `C:\Users\yashs\tools\antigravity-acp\bin`. However, Switch Console's ACP driver requires an interactive browser OAuth authentication flow to generate `.local/state/switch/antigravity-acp/acp_token.json`.
- **Owner Authorization Requirement:** In compliance with project guidelines, CASCADE will **not** continue utilizing Codex as the Switch runtime without explicit project-owner authorization.

### Supported Owner Action for AGY ACP Authentication
To use AGY/Antigravity as the active Switch runtime agent:
1. Launch Switch Console.
2. Navigate to **Settings > Providers > Antigravity**.
3. Complete the interactive Google Antigravity sign-in prompt to produce the verified `acp_token.json` session.
4. Alternatively, provide explicit authorization to allow the pre-existing `switch-buddy-admin` connector to respond in the designated operations room.

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

## 6. Local Installation Modifications & Reversal Guide

To establish the running Switch and Mattermost collaboration environment, bounded adjustments were made. The following inventory documents each modification and its reversal:

### A. Switch Console Application Code
1. `C:\Users\yashs\AppData\Local\Programs\Switch Console\resources\app\dist\main\agent-controller.mjs`:
   - **Change:** Added fallback null-checks on `agent.options` to prevent unhandled exceptions during agent spawn.
   - **Reversal:** Reinstall Switch Console v0.40.1, or restore `agent-controller.mjs` from package backup.
2. `C:\Users\yashs\AppData\Local\Programs\Switch Console\resources\app\dist\python\switch_core\bridges\agent\api\operations.py`:
   - **Change:** Supported case-insensitive query parameter lookups and auto-placement verification for agents in legacy rooms.
   - **Reversal:** Restore `operations.py` from package backup or reinstall Switch Console.

### B. PostgreSQL Database State (`switch` DB on port 59114)
1. `rooms` Table:
   - **Change:** Inserted legacy room mapping record for room `6fe42a1c-6f29-45de-8aca-da763634216e`.
2. `room_agents` Table:
   - **Change:** Inserted placement record associating agent `56911d08-ca1d-4e80-8812-9c77e3852dc9` with room `6fe42a1c-6f29-45de-8aca-da763634216e`.
3. **Reversal SQL:**
   ```sql
   DELETE FROM room_agents WHERE room_id = '6fe42a1c-6f29-45de-8aca-da763634216e';
   DELETE FROM rooms WHERE id = '6fe42a1c-6f29-45de-8aca-da763634216e';
   ```

### C. Host Environment PATH
- **Change:** Added `C:\Users\yashs\tools\antigravity-acp\bin` to the user `Path` environment variable.
- **Reversal:** Remove `C:\Users\yashs\tools\antigravity-acp\bin` from the user `Path` environment variable.
