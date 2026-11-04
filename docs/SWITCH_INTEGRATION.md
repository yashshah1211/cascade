# Live Switch integration status: BLOCKED AT PHASE 1 INTEGRATION GATE

**This is not a substitute for a real Switch room.** The dashboard is a read-only view backed by the deterministic engine. It cannot approve recovery plans or post messages. The `src/switch/approval.ts` verifier interface has no production implementation, and the unconfigured verifier rejects access.

---

## Current status summary

- **Live Switch collaboration:** NOT IMPLEMENTED / BLOCKED (Phase 1 Integration Gate).
- **Engine authorization state:** Fail-closed. Untrusted inputs and unconfigured verifiers throw immediately.
- **Offline unit tests:** 41/41 passing; explicitly declared `fakeVerifier` is used solely for testing downstream engine behavior; these do NOT constitute proof of Switch integration.
- **Local execution:** Strictly writes local artifacts and draft messages marked `# Drafts only — NOT SENT`. No external booking, payment, or notification is ever triggered.

---

## Mission 02 — Phase 1 Integration Gate Diagnostic Report

In accordance with Mission 02 instructions:
> *"Do not proceed to the remaining phases unless this gate works. If Windows Switch integration fails, perform one bounded diagnostic pass, collect sanitized errors and report the blocker. Do not spend hours repeatedly restarting or changing unrelated services."*

A thorough bounded diagnostic pass was conducted on the Windows host and local Switch installation:

### 1. Host Installation Analysis
- **Binary:** Switch Console v0.31.0 (`win32-x64`) installed at:
  `C:\Users\yashs\AppData\Local\Programs\Switch Console\Switch Console.exe`
- **Configuration Directory:** `C:\Users\yashs\AppData\Roaming\switchdash`
- **Internal Server Ports (`ports.json`):**
  - Gateway: 59111
  - API: 59112
  - Mattermost: 59113
  - Postgres: 59114
- **Current Runtime Status:** Offline. None of the ports (59111-59114) are listening.

### 2. Agent Provider Compatibility & Antigravity ACP Barrier
- **User Directive:** *"Prefer using AGY/Antigravity as the agent if supported by the installed Switch version. Do not substitute Codex without authorization."*
- **Inspection of `provider-precheck.json`:**
  ```json
  {
    "status": {
      "provider": "antigravity",
      "installed": false,
      "version": null,
      "auth": "unknown",
      "auth_source": null,
      "checked_at": "2026-11-03T13:35:52.467Z",
      "reason": "provider_not_installed"
    },
    "path": null
  }
  ```
- **Controller Implementation Analysis (`agent-controller.mjs`, line 71305-79845):**
  - Switch Console's provider integration requires the **Antigravity ACP (`antigravity-acp`)** session host communicating over Agent Client Protocol, with credential token file `acp_token.json` in `.local/state/switch/antigravity-acp/`.
  - The standard Antigravity CLI (`agy` / `antigravity-ide`) is explicitly blocked by Switch Console (`agent-controller.mjs:71325`):
    > *"The selected executable is the old Antigravity CLI. Install and select antigravity-acp in provider setup."*
  - Switch Console's internal installer commands only contain curl scripts for macOS and Linux (`ANTIGRAVITY_INSTALL_COMMAND`). There is no Windows distribution or binary available for `antigravity-acp`.
  - Codex substitution is strictly prohibited without explicit user authorization.

### 3. Service Transport & Docker Container Boundary
- **Mattermost Infrastructure:** Defined in `local-switch-server/native/mattermost-compose.yml`:
  `image: mattermost/mattermost-team-edition:11.9.0`
- **Docker Daemon Status:** Inactive (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`).
- **Constraint Compliance:** The user prompt mandates: *"Do not start or change Docker, Switch Console, Supabase, or unrelated services."* Therefore, starting Docker Desktop or spinning up external containers is prohibited.

### 4. Historical Session Error Analysis
Historical session logs (`switch-console.log` and `.local/state/switch/sdk-sessions/`) confirm the recurring failures previously observed:
- `Shared SDK host failed with exit code 1.`
- `The session host failed: HOST_FAULTED: Provider execution failed.`
- `Switch did not take this agent's session placements: agent ... is not a member of room ...`
- Model 400 errors during agent turn execution (`The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account`).

### 5. Gate Determination
The Phase 1 Integration Gate has **FAILED CLOSED**.
Per project rules:
1. Downstream phases (Phase 2: production verifier implementation against offline APIs, Phase 3: live room workflow simulation) remain blocked.
2. CASCADE will not simulate, mock, or fabricate a live Switch conversation, synthetic room ID, or fake human post ID as genuine Switch collaboration.
3. The deterministic engine remains fully verified and hardened offline (41/41 passing tests).

---

## Smallest viable real Switch integration boundary (Reference)

When an authorized and compatible Switch transport is provided in the future, the boundary requires:

### 1. Authenticated message context (Ingress)
- The integration must NEVER accept author claims, room IDs, or message contents supplied by the client caller.
- An authenticated adapter (`SwitchMessageVerifier`) must query the local Switch/Mattermost REST API using a validated server token.
- The API response must provide:
  - `messageId`: Verified server-assigned post ID.
  - `serverId`: Verified Switch instance identifier (`scenario.approvalAuthority.serverId`).
  - `roomId`: Verified channel/team room identifier (`scenario.approvalAuthority.roomId`).
  - `humanId`: Verified user identity from the server authentication record (`scenario.approvalAuthority.approverId`).
  - `authorKind`: Verified account type (`human` vs `agent`). Bot/agent-authored messages must be rejected immediately to prevent autonomous self-authorization loops.
  - `createdAt`: ISO 8601 server timestamp, verified against event kickoff.
  - `content`: Exact raw post body.

### 2. Human authorization protocol (Syntax & Intent)
- The human must post an exact deterministic command:
  ```text
  CASCADE APPROVE <planHash> MAX_EXTRA_INR <amount>
  ```
- Example:
  ```text
  CASCADE APPROVE 1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da MAX_EXTRA_INR 3000
  ```

### 3. Approval binding & Integrity checks (Revalidation)
- **Plan hash binding:** SHA-256 hash covers canonical JSON of `Scenario` and `RecoveryPlan`.
- **Timestamp staleness check:** Approvals with `createdAt` occurring after kickoff are rejected.
- **Runtime brand protection:** Verified approvals are stamped in-memory with a module-private Symbol (`VERIFIED`).
- **Revalidation before apply:** Re-executes `evaluatePlan` immediately before local artifacts are written.

### 4. Result posting (Egress)
- Post evaluated plan verdicts, failure breakdowns, execution receipt keys, and draft notices to the channel.
