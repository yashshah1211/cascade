# CASCADE Auto Demo Studio — Windows

This is a **one-click, read-only evidence video generator** for the existing CASCADE event-430 demonstration.

**Output:** `demo-output/CASCADE_FlipTheSwitch_Demo_V2.mp4` (1920 × 1080, 30 fps; H.264/AAC).

It **does not** create a new event, post new Mattermost messages, impersonate a human, repeat approval, or book anything. It creates a narrated, branded **montage from authenticated real screenshots**, actual local artifacts and a *sanitized* Antigravity execution trace. This is **not** continuous footage of a brand-new live workflow. Narration explicitly distinguishes the original local execution from the later agent-triggered idempotent replay.

## Exactly what you do

### First-time setup

1. Use your **original Windows CASCADE checkout** that still contains `artifacts/event-430-recovery-live/`. Do not download a new ZIP: a clean ZIP does not contain your real, gitignored local receipt.
2. In that checkout open PowerShell and run:

~~~powershell
git status
git fetch origin
git switch demo-studio
git pull --ff-only origin demo-studio
~~~

If `git switch` complains about local modifications, **stop** and preserve your local work before changing branches. The script will not force-reset files.

3. Make sure **Switch Console and Mattermost** are running and the old event-430 Town Square conversation is visible at `http://localhost:59113`.
4. **Double-click `record-demo.cmd`** in the repository root.

The launcher installs isolated Playwright, Chromium, FFmpeg and FFprobe packages as needed, builds the TypeScript engine, verifies the existing receipt, **optionally** verifies the ACP transcript, and opens a dedicated Chromium window to read the Mattermost posts. If the historical ACP transcript uses an unknown format, the recorder omits that optional scene, labels the omission, and continues with verified artifacts and authenticated Mattermost posts.

**Only on the first run**, Chromium may ask you to sign into Mattermost. **Sign in inside the NEW Chromium window opened by the recorder**, not normal Chrome or Mattermost Desktop. The recorder detects your authenticated session automatically; **do not press Enter in PowerShell**. Credentials are never requested by CASCADE Studio or placed in repository files.

After that, the recorder should run without further interaction and open the resulting MP4 when done.

### Later runs

Double-click **`record-demo.cmd`** again. The separate Chromium profile retains your Mattermost login until that session expires. If it expires, sign in again.

### What gets recorded

- A stylish opening and synthetic scenario context.
- An authenticated screenshot of the actual engine-verified Mattermost post.
- Engine verdicts and numerical allocation derived from the verified local recovery.
- A screenshot of the **real human-authored** hash-bound approval.
- A screenshot of the **real local receipt** posted to Mattermost.
- Read-only summaries of the actual files: `receipt.json`, `schedule.json`, `assignments.json`, and `stakeholder-messages.md`.
- The model-generated `cascade_execute_recovery` call and exit-0, already-applied evidence, extracted using a **fixed-field allowlist**. The original transcript is never displayed.
- A closing card with the project name and GitHub URL.

Each scene has locally synthesized Windows narration, branded captions and subtle motion. No cloud voice API, paid subscription, OBS, manually edited video, or external media service is required for the default flow.

**What it will not show:** a fake incident post if the original cannot be authenticated. In that case it uses an explicitly labeled synthetic fixture context card instead. You can optionally supply a real incident post ID using `CASCADE_DEMO_INCIDENT_POST_ID`.

## Mandatory evidence preconditions

This particular one-click preset is deliberately fixed to the **actual previously verified local run**. The script stops rather than inventing outputs if any **mandatory** check fails. The historical ACP tool-call scene is optional: it is included only if strict transcript verification succeeds.

| Source | Requirement |
| --- | --- |
| Mattermost | `http://localhost:59113`, accessible to your authenticated account |
| Engine report | Post `g4aqigppjtgw9f4jqbajbu5xxa`, with real AV and budget evaluations |
| Human authorization | Post `w7gx4ku4ybdtirmhs36feexciw`, authored by the configured human owner |
| Execution receipt | Post `d41a43t9rtnyid9ho3dhjyfy8o`, containing `APPLIED_LOCALLY` |
| Artifacts | `artifacts/event-430-recovery-live/event-430-1ddfdd0f2ccda8d1f9891627/` |
| Antigravity transcript | Recorded session `d84a1440-ffbc-464c-a1d6-0a4885de9a70`, steps 107–108 |

The local transcript default path is under your Windows user profile:

~~~text
%USERPROFILE%\.local\state\switch\antigravity-acp\antigravity-acp\brain\d84a1440-ffbc-464c-a1d6-0a4885de9a70\.system_generated\logs\transcript.jsonl
~~~

If you moved the transcript, set the **local file path**:

~~~powershell
$env:CASCADE_DEMO_ACP_TRANSCRIPT="C:\path\to\real\transcript.jsonl"
~~~

This is a private local setting. **Never commit the raw transcript or copy it into a public issue/PR.**

## Optional settings

~~~powershell
# A real incident post you personally authored, if known:
$env:CASCADE_DEMO_INCIDENT_POST_ID="26characterpostidhere"

# If Mattermost listens on a different local port:
$env:CASCADE_DEMO_MATTERMOST_URL="http://localhost:59113/"

# Optional installed Windows voice name (leave blank for default):
$env:CASCADE_DEMO_VOICE="Microsoft David Desktop"

# Validate real local files and transcript, without a video:
.\record-demo.cmd --check-only

# Capture authenticated screenshots and scene frames, without TTS/MP4:
.\record-demo.cmd --capture-only
~~~

To choose a Windows voice, run:

~~~powershell
Add-Type -AssemblyName System.Speech
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() |
  ForEach-Object { $_.VoiceInfo.Name }
~~~

This tool is Windows-specific for built-in text-to-speech. The core CASCADE engine and its tests remain cross-platform.

## Privacy and security

- The recorder performs **GET requests only** to the local Mattermost API and navigates to existing post permalinks. It will never POST or edit approval messages.
- It uses a **separate persistent browser profile** at `.demo-studio-profile/`, rather than reading cookies or passwords out of your everyday Chrome profile.
- It captures only a clipped region of Mattermost, excluding the left conversation sidebar and top account bar. However, **other messages in the center pane can still appear**. Review every rendered frame and the final video before publishing.
- The allowlisted ACP visual is generated from verified tool name, exit code, state and replay status; **no raw session content or OAuth details appear**.
- Raw screenshots, narration WAVs, manifest, and browser session profile are local and **gitignored**. Never upload the contents of `demo-output/private-captures/` to the public repository.
- An `evidence-manifest.json` records the authenticated source post IDs, timestamps, screenshot SHA-256 values, and artifact checksums; it is **not a cryptographic attestation of the Mattermost server**.
- Tool packages are downloaded from the npm / Playwright distribution ecosystem on setup. Only localhost content is used for the actual Mattermost demo recording.

## Troubleshooting

**Mattermost login required:** Sign in using the dedicated Chromium window opened by the script. Your existing Chrome/Mattermost Desktop login is not shared with this separate profile. The script detects login automatically. If it cannot detect login, verify the page shows Town Square in that exact window and rerun; later runs reuse the profile until the session expires.

**Missing or unfamiliar ACP transcript:** No need to rerun AGY or fabricate an agent tool call. The recorder can proceed with verified Mattermost posts and local execution artifacts, omitting the optional agent-replay scene. To share a **safe metadata-only** diagnostic, run `record-demo.cmd --inspect-acp` and share only the printed field-type summary (no raw transcript). The studio never displays unverified execution trace content.

**Missing transcript:** Do not run AGY or manufacture a tool result. Check the default ACP file path or set `CASCADE_DEMO_ACP_TRANSCRIPT` to the real file.

**Missing artifacts:** You may be using a new clone. Switch to the original local checkout that generated the receipt; `artifacts/` is intentionally not committed.

**Missing or inaccessible post:** Make sure the local Mattermost server is running and that the authenticated account belongs to team `switch`. The script checks the actual post content and author, not just the URL.

**Mattermost UI changed:** After authenticating the post through the API, the recorder attempts to screenshot the exact DOM post. If the installed version uses different markup, it automatically switches to an **explicitly labeled authenticated-API summary card**, not a fabricated screenshot. Confirm the final video labels are accurate.

**Windows voice unavailable:** Install an English Windows speech voice under Settings → Time & language → Speech. The `speak.ps1` script relies on the built-in `System.Speech` voices.

**Chromium/FFmpeg installation blocked:** Check Internet connectivity for one-time package setup. The offline core CASCADE engine does not require these video dependencies.

## Test and acceptance scope

Run `npm test` from the repository root. This includes evidence-validation, HTML sanitization, artifact-schema, and transcript allowlist tests that do **not** require Windows or localhost.

**Important limitation:** GitHub Actions can test the parsing and scripts but cannot run your authenticated local Mattermost browser or Windows speech synthesizer. After checking the video on your machine, inspect all scenes for legibility, correct source evidence, narration accuracy, and private information before submitting.

**Do not claim the video depicts a single uninterrupted live recovery.** It is a documented, faithfully labeled narrated montage of authentic historical Switch evidence and real local outputs.


## V2 presentation upgrades

The V2 output preserves the first-render MP4 under its original filename. V2 uses larger typography for the verified human approval and local receipt, a diagram demonstrating why Switch is central, an extra genuine archived Mattermost screenshot when available, read-only discovery of the original human incident, optional authentic bot-status evidence, and normalized narration with peak headroom. It still stops on missing mandatory local artifacts and never invents the unverified ACP tool trace. Review docs/VIDEO_ACCEPTANCE.md before uploading.
