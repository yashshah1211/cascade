# CASCADE — The Commitment Recovery Engine

### When a plan breaks, the promises don't have to.

**[▶ Watch the final CASCADE demo (3:16)](https://youtu.be/Q33BVLvCgTA)** — A narrated walkthrough of the human approval, deterministic recovery and genuine Mattermost evidence. The event is synthetic; execution is local only.

**Flip the Switch Hackathon 2026 · Best Business Workflow · Built November 4–7, 2026**

A 430-person hackathon loses its auditorium. Seven commitments — capacity, AV coverage, kickoff, sponsor timing, accessibility, budget, and keynote delivery — may break with it.

**CASCADE** connects a human organizer and an **Antigravity ACP agent** through **Switch + Mattermost**. It traces the impact, runs deterministic checks on recovery plans, asks the right human to authorize an exact budget exception, and publishes an auditable **local** recovery receipt.

> **Demonstrated:** real human–agent Switch chat, Antigravity-initiated plan evaluation, human-authored budget approval, verified local execution and a receipt posted to the room. A later Antigravity tool call checked the same approved recovery and returned an idempotent replay. **The incident and venue data are synthetic. No real booking, payment, or attendee notification occurred.**

[**The 3-minute demo runbook**](docs/DEMO_RUNBOOK.md) · [**Architecture and Switch evidence**](docs/SWITCH_INTEGRATION.md) · [**Submission text**](docs/SUBMISSION.md)

---

## The problem CASCADE solves

When a crucial resource fails, the problem is not merely finding a replacement. Teams still have **promises to keep**, dependencies to evaluate, and exceptions that only authorized people can approve.

An unconstrained assistant may suggest plausible solutions — or invent allocations. CASCADE deliberately separates responsibilities:

- **Switch** provides the shared team room, agent execution, tool calls and visible decision trail.
- **Antigravity ACP** coordinates the recovery conversation and calls the engine rather than guessing results.
- **The deterministic TypeScript engine** evaluates real constraints against explicit scenario data.
- **The human owner** approves only a precise plan hash and maximum extra spend in the room.
- **The verifier** fetches the genuine Mattermost message; it does not accept agent-authored approval claims.
- **The executor** generates only local artifacts and an integrity-checked receipt.

## One incident. Three choices. One authorized recovery.

The synthetic event must start with **430 people at 10:00 AM**. Replacement Hall A seats 250 and Hall B seats 220. There is only one available AV kit. The existing budget is **₹80,000**.

| Plan | Engine verdict | What the engine finds |
| --- | --- | --- |
| **A — Two halls, existing AV** | **FAIL** | Both halls run concurrently, but only one AV kit is available. |
| **B — Rent a second AV kit** | **REQUIRES_APPROVAL** | Meets hard commitments, but total cost is **₹83,000**: a **₹3,000** exception. |
| **C — Sequential opening waves** | **FAIL** | Violates the synchronized 10:00 kickoff commitment. |

**Selected recovery:** Plan B allocates **250 people to Hall A** and **180 to Hall B**, both from **10:00–10:45**, subject to the owner's budget authorization. The plan is not silently approved by the AI.

### What actually happens in Switch

~~~mermaid
flowchart TD
    H["Human reports auditorium cancellation"] --> S["Switch room in Mattermost"]
    S --> A["Antigravity ACP agent"]
    A --> E["Switch tool: evaluate recovery"]
    E --> D["CASCADE deterministic engine"]
    D --> F["A: FAIL AV | C: FAIL kickoff"]
    D --> P["B: requires ₹3,000 approval"]
    P --> S
    S --> U["Owner posts exact plan-hash approval"]
    U --> V["Authenticated Mattermost verifier"]
    V --> Q{"Correct author, room, hash, amount and time?"}
    Q -->|No| X["Reject — nothing applied"]
    Q -->|Yes| T["Switch recovery execution tool"]
    T --> L["Local artifacts + APPLIED_LOCALLY receipt"]
    L --> S
~~~

**Why Switch is essential:** the offline engine can score plans without a chat service, but it **cannot complete the demonstrated human–agent workflow**: shared incident intake, agent tool execution, room-bound human approval, and a published outcome. Switch is the collaboration and authorization coordination layer, not a decorative chatbot wrapper.

### Recorded demonstration milestones

These are identifiers from the **local** environment, not publicly accessible hosted evidence:

| Milestone | Recorded evidence |
| --- | --- |
| Engine-verified plan comparison | Mattermost post **g4aqigppjtgw9f4jqbajbu5xxa** |
| Human's exact approval | Mattermost post **w7gx4ku4ybdtirmhs36feexciw** |
| First local execution receipt | Mattermost post **d41a43t9rtnyid9ho3dhjyfy8o** |
| Antigravity-initiated execution verification | ACP session steps **107–111**: model invoked **cascade_execute_recovery**, exit code **0**, **Already Applied: true**, no duplicate receipt |

The **first** local execution used the verified approval through the recovery CLI; the **later agent-initiated call** revalidated and reused the existing artifacts. We do not mislabel an idempotent replay as a fresh first-time execution.

## Run it yourself

### A. Offline engine and read-only dashboard

Requires **Node.js 20+ (22 recommended)** and npm. This path does not require Switch, Docker or cloud credentials.

~~~bash
git clone https://github.com/yashshah1211/cascade.git
cd cascade
npm install
npm test
npm run demo
npm run inspect
~~~

Run the optional local dashboard:

~~~bash
npm run dashboard
~~~

Open **http://127.0.0.1:4173**. The dashboard is a **read-only fixture explorer**, not the live Switch interface. Its API deliberately labels data **OFFLINE_SIMULATION / NOT_CONNECTED**; those flags describe its data source, not the status of the separately demonstrated Switch connection.

### B. Real collaboration through Switch

In addition to the engine, the live path needs **Switch Console**, its local **Mattermost** service, a working **Antigravity ACP runtime**, and an authenticated human and agent in the same Switch room.

The recorded installation used Windows x64 and Antigravity ACP with the model that the provider advertised as **gemini-3.8-flash**. Interactive Google OAuth was completed by the human.

**Important compatibility note:** CASCADE registers two operations in an installed Switch Core Python file. This is currently a reversible, local integration patch, **not** an upstream Switch extension. Other Switch versions may require adaptation.

1. Configure your real Switch + Mattermost services and authenticate Antigravity ACP. Do not copy another person's tokens, OAuth cache or session files.
2. Set a secure **CASCADE_SWITCH_TOKEN** or **MATTERMOST_TOKEN** for the bot/service API, plus **CASCADE_SWITCH_URL** and **CASCADE_SWITCH_CHANNEL_ID** if not using the local demo defaults.
3. Build the engine and dry-run the integration against the specific Switch operations file:

~~~powershell
npm install
npm run build
python scripts/setup-switch-operations.py --target "PATH\TO\SWITCH\definitions.py" --dry-run
python scripts/setup-switch-operations.py --target "PATH\TO\SWITCH\definitions.py"
~~~

The installer creates a backup, modifies only a bounded CASCADE block, rejects ambiguous legacy files, and supports **--rollback**. Restart the applicable Switch service and configure the room/agent tools. See [installation, environment, and rollback details](docs/SWITCH_INTEGRATION.md).

4. Have the designated human send the exact approval command in the correct Switch room.
5. For a genuinely posted, eligible message, run:

~~~powershell
npm run recover -- --approval-msg REAL_MATTERMOST_POST_ID --output-dir artifacts/event-430-recovery-live
~~~

The recovery CLI independently fetches the Mattermost post and checks account ID, room, server, human authorship, exact command, budget cap, scenario revision, and timestamp before applying anything. **Do not invent or programmatically impersonate a human approval.**

**Reproducibility boundary:** the offline app and test suite run from a clone. A live run additionally depends on a compatible local Switch installation, provider credentials and interactive authentication; GitHub CI cannot test your laptop's local Switch session.

## What successful local execution produces

| File | Meaning |
| --- | --- |
| **receipt.json** | **APPLIED_LOCALLY** state, plan hash, and verified human message reference |
| **schedule.json** | 250/180 hall allocations, kickoff timing, projected **₹83,000** |
| **assignments.json** | 430 assigned attendees, no duplicates or gaps |
| **stakeholder-messages.md** | Communications explicitly marked **DRAFTS ONLY — NOT SENT** |

The engine revalidates constraints before applying. On an idempotent replay, it verifies all existing artifacts and **does not post another receipt notification**.

### Engineering details

- **Dependency graph:** breadth-first propagation identifies seven affected commitments.
- **Deterministic policy engine:** validates capacity, attendee coverage, accessibility, AV concurrency, synchronized timing, sponsor deadline, scenario revision, and budget.
- **Authorization boundary:** the owner authorizes an exact SHA-256 plan hash and amount; Mattermost supplies authenticated message metadata.
- **Integrity:** atomic local artifact publication, full receipt/content validation, and repeat-execution safeguards.
- **Agent orchestration:** Switch-connected Antigravity ACP invokes actual engine CLI operations, not invented model calculations.
- **Automated validation:** **66 tests passed** on GitHub Actions in the reviewed feature branch (see [PR #2](https://github.com/yashshah1211/cascade/pull/2)).

**Limitations:** this is a fictional incident with fixture-generated candidate plans, not a real-world venue booking service or AI optimization solver. The dashboard is offline-only. The live integration depends on local Switch internals, and the local session transcript is not replicated by public CI. Those constraints are disclosed rather than presented as production deployment claims.

## For judges and builders

- **[Demo recording runbook](docs/DEMO_RUNBOOK.md):** exact flow, on-screen proof, pacing, and recording safety.
- **[Submission draft and checklist](docs/SUBMISSION.md):** ready-to-adapt entry copy, architecture, and required uploads.
- **[Switch integration evidence](docs/SWITCH_INTEGRATION.md):** approval verification, agent tool calls, receipts, setup, rollback.
- **[Build log](docs/BUILD_LOG.md):** engineering history and debugging notes.

**Event:** [Flip the Switch 2026](https://www.wemakedevs.org/hackathons/switch) · **Deadline:** November 7, 2026, 11:59 PM IST.

---

**CASCADE doesn't promise that the AI will handle everything. It ensures the AI cannot quietly override the promises that matter.**
