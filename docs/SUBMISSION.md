# CASCADE — Flip the Switch 2026 Submission Kit

**Status: prepared draft, NOT SUBMITTED.** The entrant must review the entry, record/upload the real video, and submit manually using the official registration/submission flow.

**Target:** Best Business Workflow  
**Official challenge:** https://www.wemakedevs.org/hackathons/switch  
**Deadline:** November 7, 2026, 11:59 PM IST  
**Project repository:** https://github.com/yashshah1211/cascade  
**Video URL:** ADD AFTER RECORDING — do not submit with this placeholder.

---

## Ready-to-paste entry

### Title

**CASCADE — The Commitment Recovery Engine**

### One-line pitch

**When a plan breaks, the promises don't have to.** CASCADE turns a team-chat crisis into a deterministic, human-approved recovery with an auditable local receipt, coordinated through Switch.

### Short description (approximately 100 words)

A single cancelled auditorium puts seven promises to 430 hackathon attendees at risk. CASCADE brings a Google Antigravity ACP agent into Mattermost through Switch. When an organizer reports the incident, the agent invokes a deterministic TypeScript engine to trace affected commitments and evaluate alternative recovery plans. Two fail hard constraints; a third requires an exact ₹3,000 budget exception. The authorized human posts a hash-bound approval in the same Switch room. CASCADE validates the real message, rechecks constraints, produces local schedules and assignments, and publishes an auditable receipt. No fake autonomy, no silent approvals, and no external bookings.

### The problem

When an event, operations team, or project loses a critical resource, the impact travels through a dependency chain. Replanning can accidentally violate capacity, accessibility, synchronized schedules, sponsor deadlines, AV requirements, or spending authority.

An AI-generated suggestion alone does not prove these commitments will survive. Nor should an agent be allowed to authorize its own budget exception.

### What we built

CASCADE has five connected parts:

1. **Commitment impact graph.** A disabled resource triggers breadth-first dependency tracing across seven synthetic organizational commitments.
2. **Deterministic plan evaluator.** Checks attendee coverage and overlaps, capacity, accessible halls, concurrent AV demand, synchronized kickoff, sponsor deadline, budget cap, and scenario revision.
3. **Switch-connected Antigravity agent.** Receives a human incident in the shared Mattermost room; invokes CASCADE's real evaluation and execution tools through the Switch MCP interface; posts results back to the room.
4. **Human approval boundary.** An authenticated Mattermost post must come from the designated person, in the correct room, before kickoff, with the exact plan hash and extra-spend cap. Bot and webhook claims are rejected.
5. **Local receipt and replay protection.** On approval, CASCADE publishes schedule, attendee assignments, stakeholder *drafts*, and an APPLIED_LOCALLY receipt. Replaying verifies existing artifacts without posting a duplicate receipt.

### The demonstrated story

A fictional event for 430 people loses its auditorium.

- **Plan A:** Two halls with existing AV — FAIL (two simultaneous AV kits are required; only one is available).
- **Plan B:** Two halls plus an extra rented AV kit — REQUIRES_APPROVAL (₹83,000 projected vs. ₹80,000 baseline).
- **Plan C:** Sequential kickoff waves — FAIL (violates the synchronized 10:00 start).

The organizer personally approved the **₹3,000** synthetic exception via Mattermost. CASCADE verified that real post, produced the local recovery artifacts, and posted a receipt. A later model-generated Antigravity call re-executed the Switch recovery tool, returned **Already Applied: true**, and preserved the original receipt with no duplicate notice.

**All prices, halls, people and commitments are synthetic test data. No external supplier, attendee or venue was contacted.**

### Why Switch matters

Switch is the shared execution and decision context—not simply a place where an AI replies. Through Switch, the agent receives the incident, runs registered deterministic tools, presents a precise approval request, observes the authorized human decision, and posts the resulting verified status in the same team room. An offline engine can score a fixture, but cannot deliver this collaborative human-agent approval workflow on its own.

### Technical implementation

- **TypeScript / Node.js 22** for the impact graph, constraint evaluator, approval verification, and atomic local artifact engine.
- **Switch Console + Mattermost** for room-based collaboration, message records and agent tool invocation.
- **Google Antigravity ACP** as the runtime agent (model advertised on the demonstrated account: gemini-3.8-flash).
- **Python integration utility** to register the two CASCADE operations in a specific local Switch Core installation, with dry-run, backup, bounded updates, rollback, and fail-closed handling of legacy markers.
- **GitHub Actions** for TypeScript build and automated validation; **66/66 tests passing** at the reviewed build.

### What was challenging

The agent initially generated plausible but incorrect attendee allocations. Comparing its response with fixture data exposed the problem: it had **not invoked the engine**. We then connected a real Switch tool to the deterministic CLI and captured the model-generated call.

A second failure occurred after human approval: the agent lacked an execution tool and fell back to a broad filesystem search. We added a constrained recovery operation, verified an owner-authored Mattermost post, corrected the CLI target, and made repeat runs idempotent.

We also remediated previously exposed local testing tokens and added a safer operations-registration utility. The experience reinforced why claims of agent success need executable evidence, not merely confident chat messages.

### What we're proud of

**The boundary between recommendation, authorization, and execution is explicit.** The engine does not invent feasibility. The agent cannot simply say the owner approved. A successful plan generates an inspectable receipt and local artifacts, while stakeholder communications remain clearly labeled as unsent drafts.

### What we'd build next

- Generalize from one synthetic incident to editable commitment graphs and multiple recovery scenarios.
- Package the Switch integration as a supported extension rather than modifying local Switch operations.
- Add multi-owner approval policies, scenario change notifications, and audit timelines.
- Integrate real operational systems **only with explicit per-action human authorization** and appropriate safety checks.
- Measure time saved and constraint violations in real pilot deployments before making ROI claims.

### Repository

https://github.com/yashshah1211/cascade

### Demo video

**ADD THE ACTUAL VIEWABLE VIDEO URL BEFORE SUBMISSION.**

---

## Judging alignment

The official DevTools Academy rubric lists these criteria. This is a **presentation checklist**, not a claim of judge-assigned scores.

| Criterion | Weight | What we must show |
| --- | ---: | --- |
| Use of Switch | **30%** | Human message → Antigravity Switch tool call → exact room approval → agent status returned to Mattermost |
| Technical execution | **25%** | Deterministic CLI, authenticated verifier, original local receipt, idempotence, passing CI, reproducible setup and limitations |
| Creativity and impact | **25%** | Commitment recovery rather than generic task automation; explainable conflicts and human-controlled exceptions |
| Presentation/documentation | **20%** | Clear story, 3-minute demo, exact README, accessible evidence, no misleading claims |

## Final submission checklist (manual)

- [ ] Registration and eligibility are completed under the entrant's **own real identity**.
- [ ] Public GitHub repository contains the finalized, merged code and up-to-date README.
- [ ] Feature PR #2 has been reviewed and merged **only after owner approval**.
- [ ] Final GitHub Actions build is passing on the submitted commit.
- [ ] Screen recording shows genuine Switch/Mattermost interactions; no synthetic chat presented as real.
- [ ] Video shows the verified Plan B approval and the local APPLIED_LOCALLY receipt.
- [ ] Video clearly distinguishes **first execution** from **idempotent replay**.
- [ ] Video includes a brief actual Switch MCP tool invocation or its authenticated transcript evidence.
- [ ] No screenshots, logs, documentation or captions reveal credentials, personal email, tokens, OAuth artifacts or unrelated private chats.
- [ ] Demo video is uploaded and accessible to judges without special account access.
- [ ] Video URL is inserted into the submission form and optionally the README.
- [ ] Official submission form is completed and **submitted manually** by the entrant before November 7 at 11:59 PM IST.
- [ ] Submitted entry is opened once from the public/judge perspective to verify links and assets.
- [ ] Save a confirmation screenshot or receipt after manual submission.

## Final narrative to remember

**“CASCADE doesn't ask the AI to promise everything will be fine. It asks the engine which commitments survive, asks the human which exception is acceptable, and records exactly what happened—in one Switch room.”**

### Sources

- Official hackathon overview and track: https://www.wemakedevs.org/hackathons/switch
- Judging criteria and submission requirements: https://www.devtoolsacademy.com/hackathons/flip-the-switch
- Official schedule and deadline: https://www.wemakedevs.org/hackathons/switch/schedule
