# Working instructions for Codex and other AI coding agents

Project: CASCADE — Commitment Recovery Engine, Flip the Switch 2026.

Read `README.md`, `docs/SWITCH_INTEGRATION.md`, and `fixtures/` before making changes. Work in small, independently tested commits. Avoid lengthy autonomous loops and preserve the user's Codex allowance.

**Hard requirements**

- Never claim Switch integration works unless a human→Switch room→agent→room response was personally verified.
- No approval bypass. A local UI button, test fixture, or plain JSON may not impersonate human authorization.
- Preserve exact plan- and scenario-bound verification. Re-run checks immediately before applying.
- A status of `UNKNOWN` is not a pass; do not convert it to a fail or success without evidence.
- Do not send actual messages, charge payments, book venues, or modify real operations.
- Synthetic fixtures must be labeled synthetic. A fake verifier in tests is not production integration.
- Run `npm test` after engine changes and add tests for any new rule.
- Do not add Docker, Supabase, Vercel, paid model APIs or external dependencies without explicit authorization.
- Windows compatibility matters. Prefer Node built-ins and deterministic fixtures.

**Immediate next priority:** Real Switch/Mattermost one-human-one-agent round trip. If blocked, collect a concise reproducible report and avoid unrelated configuration changes.
