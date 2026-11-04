# CASCADE — 3-Minute Judge Demo Runbook

**Working title:** *When a plan breaks, the promises don't have to.*

**Goal:** make the human + Switch + Antigravity + deterministic engine + verified human approval + local receipt visible in one short story.

**Prize target:** Best Business Workflow · **Required submission video** · Recommended target length **2:45–3:00**. (The organizers ask for a short video; this timing is our production choice, not an official duration limit.)

> **Evidence integrity:** Record real on-screen outputs. Do not splice together fake interactions and describe them as one live session. If demonstrating an existing thread, say it is a recorded run. If showing a replay, label it **idempotent replay**, not first-time execution.

## The storyboard

| Time | Screen recording | Spoken narration / lower-third |
| --- | --- | --- |
| **0:00–0:12** | Bold opening title, then Mattermost incident channel | **“A venue cancels. Four hundred and thirty people are coming. Seven commitments are at risk. A chatbot can suggest ideas; CASCADE checks which promises they actually keep.”** |
| **0:12–0:34** | Original human-authored cancellation message; highlight the Switch-connected Antigravity agent name | **“The organizer reports the incident in a Switch team room. Antigravity joins as a teammate, not a separate chatbot tab.”** |
| **0:34–1:03** | Engine-verified Mattermost plan comparison; briefly show actual Switch tool-call evidence or the CLI verdicts | **“The agent calls our deterministic TypeScript engine. Plan A fails concurrent AV. Plan C breaks the shared kickoff. Plan B satisfies the hard constraints but exceeds the budget by three thousand rupees.”** |
| **1:03–1:28** | Show Plan B's exact approval request and the human-authored reply in the same thread | **“The AI can't approve its own spending exception. The human owner authorizes one exact plan hash and maximum amount in Switch.”** |
| **1:28–1:54** | Show the local approval verification / execution output and receipt in the Mattermost thread | **“CASCADE fetches the real message, checks the account, room, time, hash and amount, revalidates the plan, and applies it locally.”** |
| **1:54–2:19** | Open actual schedule.json, assignments.json, receipt.json and the draft-only message header | **“Here is the resulting schedule: 250 attendees in Hall A, 180 in Hall B, synchronized at ten. The receipt is APPLIED_LOCALLY. Stakeholder notices remain drafts—no external actions are implied.”** |
| **2:19–2:40** | Show Antigravity MCP execution trace (call + exit 0, Already Applied: true) and single retained receipt | **“A second agent-triggered run verifies the existing artifacts and refuses to duplicate the receipt. The shared room preserves who requested, who approved, and what actually happened.”** |
| **2:40–2:58** | Return to the full Mattermost conversation, show GitHub tests briefly, end on project name | **“CASCADE turns an incident from a vague AI recommendation into a bounded, auditable team decision. When a plan breaks, the promises don't have to.”** |

### What the video must visibly prove

- The original **human incident** and Antigravity agent operate inside **Mattermost connected by Switch**.
- The evaluation is **engine-backed**, not a model-improvised allocation.
- The exact **human-authored approval** occurs in the room. It is not posted using a bot script.
- The receipt shows **APPLIED_LOCALLY**, and generated messages are **DRAFTS ONLY — NOT SENT**.
- The model's **cascade_execute_recovery** call returned exit code 0 on replay with **Already Applied: true**.
- No screen falsely suggests that any physical venue, AV rental, or stakeholder message was executed.

## Reliable recording path (without repeating the human approval)

The existing successful run can be narrated by revisiting its real message history. **Do not forge a new approval**, clear old receipts, or edit earlier message contents just to make a clean recording.

1. Open Mattermost Desktop, team **switch**, channel **Town Square**.
2. Navigate to the agent's engine-verified evaluation post. The known local post ID is **g4aqigppjtgw9f4jqbajbu5xxa**.
3. Show the user's exact approval reply, post **w7gx4ku4ybdtirmhs36feexciw**.
4. Show the existing published execution receipt, post **d41a43t9rtnyid9ho3dhjyfy8o**.
5. Open the local artifacts in **artifacts/event-430-recovery-live/** and show the receipt, schedule, assignments, and draft disclaimer.
6. Display the ACP transcript excerpt for session **d84a1440-ffbc-464c-a1d6-0a4885de9a70** only after extracting a small **sanitized** evidence snippet: the call to **cascade_execute_recovery**, exit 0, and the **Already Applied: true** result. Do not expose the original full session transcript.
7. If the daemon is healthy, demonstrate the read-only dashboard separately and **label it as an offline engine explorer**. It is not the live Switch status panel.
8. Show CI passing in [GitHub Actions](https://github.com/yashshah1211/cascade/actions), ideally on the latest final commit.

**Do not use an approval created after the synthetic scenario's kickoff date:** 2026-11-06 10:00 IST. The verifier rejects messages authored after kickoff. The existing approved post predates kickoff and supports legitimate idempotent verification.

## Recording quality checklist

- Capture in **1920×1080** (or 1440p if crisp); keep UI zoom high enough to read.
- Disable desktop notifications; hide private chats, email addresses, browser tabs, Google login screens, password managers, and tokens.
- Use a **single readable window** at a time; zoom rather than panning frantically.
- Make sure the important text is onscreen for at least two seconds.
- Use **subtitles** for key technical terms (Switch tool, verified human, plan hash, APPLIED_LOCALLY).
- Keep cuts clean; do not imply a clip of an existing event is occurring live if it is historical.
- Avoid AI-generated voice impersonation or fake screenshots. An ordinary, natural narration is more convincing.
- Include a link to the public repository in the video description and submission entry.
- Watch the final MP4 once end-to-end and verify sound, legibility, duration, and that all claims match the actual evidence.

## Suggested opening and ending cards

**Opening (5 seconds):**

> CASCADE  
> When a plan breaks, the promises don't have to.  
> Human decisions. Deterministic recovery. Switch collaboration.

**Closing (5 seconds):**

> 7 commitments traced · 3 plans evaluated · 1 verified human exception  
> 430 attendees protected in a synthetic recovery plan  
> No external actions taken

## Evidence boundaries and judge Q&A

**Q: Why not simply ask ChatGPT or an agent for a new plan?**  
A: A model can propose ideas, but it can also invent allocations or ignore commitments. CASCADE's checks and approvals are deterministic and tied to real signed-in chat metadata.

**Q: What would stop without Switch?**  
A: Offline evaluation still works, but the completed team-owned workflow—agent receiving the incident, invoking its Switch tools, routing the owner decision, and posting the outcome in a shared room—would not.

**Q: Did the system really book a replacement venue or purchase an AV kit?**  
A: No. The system produces local schedules, assignments, draft messages and a receipt. The external execution boundary is intentionally not implemented.

**Q: How was the AI's role verified?**  
A: The local Antigravity ACP transcript records model-generated Switch MCP calls and their results. We can show sanitized excerpts, plus the messages the agent posted in Mattermost. Public GitHub CI validates the core behavior, but cannot replay a private local Switch room.

**Q: Is the integration portable?**  
A: The engine and tests are portable. The working live demonstration uses a specific Windows Switch installation and a bounded local operations patch; it is reproducible with compatible services and credentials, but not a turnkey hosted deployment.

## Final upload

Save your recording as **CASCADE_FlipTheSwitch_Demo.mp4**. Upload it to the submission platform or an accessible video host as required by the official form. Check that reviewers can actually open it in a logged-out/private browser session.

**Do not submit automatically through scripts or bots. The entrant submits manually.**
