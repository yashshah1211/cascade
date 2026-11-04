# Live Switch integration status: BLOCKED (not yet verified)

**This is not a substitute for a real Switch room.** The dashboard is a read-only view backed by the deterministic engine. It cannot approve recovery plans or post messages. The `src/switch/approval.ts` verifier interface has no production implementation, and the unconfigured verifier rejects access.

## Minimum acceptance gate

- [ ] Start Switch Console and its connected local server; confirm the bundled Mattermost is available.
- [ ] Create a Mattermost **team channel** for CASCADE; explicitly join a real human and one Codex-powered agent through Switch.
- [ ] Send a message from the human that addresses the agent.
- [ ] See the agent post a response **in that channel**, not just in Switch's activity pane.
- [ ] Give the agent permission to invoke the local CASCADE CLI; have it report the program's actual checks for Plan A and Plan B.
- [ ] Implement a real SwitchMessageVerifier that fetches the event by message ID using authenticated Switch-provided APIs and checks actual author type and identity. Never use caller-provided author fields.
- [ ] Have the human post the exact plan-bound approval command in Switch. Fetch and verify it; reevaluate the plan with the trusted approval and only then execute.
- [ ] Capture the successful room message and artifact receipt for the demo.

## Trust contract

`verifyBudgetApproval` in `src/switch/approval.ts` accepts a verifier that must retrieve the real message. It checks the configured Switch server, room, author type, approver identity, exact plan hash, and exception amount. It returns an in-memory branded `VerifiedApproval`; arbitrary JSON does not carry this marker and cannot authorize the engine.

**Remaining limitation:** A production Switch API adapter and verified transport are not implemented. Automated tests use a **fake verifier** only to exercise downstream validation. They are not Switch acceptance tests.

## Known Windows installation issue

Switch Console v0.40.1 previously showed `switch.post_message` and `switch.read_context` failures from direct chats. The previously stale placement was removed but replies still failed. Do not repeat the broken direct-chat loop. Test a team channel and obtain the exact failure from the controller logs. If blocked, seek help in the official hackathon Discord. Never claim the Switch requirement is met while blocked.
