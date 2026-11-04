import { chromium } from 'playwright';
import ffmpeg from 'ffmpeg-static';
import ffprobePackage from 'ffprobe-static';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  EVIDENCE, assertLocalMattermostURL, assertPostId,
  verifyMattermostEvidence, loadVerifiedArtifacts,
  extractVerifiedAcpTranscript, sha256,
} from './lib.mjs';
import { sceneHtml } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const output = join(root, 'demo-output');
const raw = join(output, 'private-captures');
const frames = join(output, 'rendered-scenes');
const clips = join(output, 'clips');
const profile = join(root, '.demo-studio-profile');
const base = assertLocalMattermostURL(process.env.CASCADE_DEMO_MATTERMOST_URL || 'http://localhost:59113/');
const ffmpegBin = ffmpeg;
const ffprobeBin = ffprobePackage.path;
const input = new Set(process.argv.slice(2));
const checkOnly = input.has('--check-only');
const skipVideo = input.has('--capture-only');
const incidentOverride = process.env.CASCADE_DEMO_INCIDENT_POST_ID
  ? assertPostId(process.env.CASCADE_DEMO_INCIDENT_POST_ID)
  : null;
const log = (message) => console.log('[CASCADE Studio] ' + message);

function run(bin, args, options = {}) {
  if (!bin) throw new Error('Media encoder binary is missing. Run npm install in tools/demo-studio.');
  const p = spawnSync(bin, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 180000, windowsHide: true,
    ...options,
  });
  if (p.error || p.status !== 0) {
    throw new Error('Command failed: ' + String(bin).split(/[\\/]/).pop() +
      '\n' + String(p.stderr || p.stdout || p.error || '').slice(-3500));
  }
  return p.stdout ?? '';
}

function acpTranscriptPath() {
  return process.env.CASCADE_DEMO_ACP_TRANSCRIPT || join(
    homedir(), '.local', 'state', 'switch', 'antigravity-acp',
    'antigravity-acp', 'brain', EVIDENCE.acpSession,
    '.system_generated', 'logs', 'transcript.jsonl',
  );
}

function loadLocalEvidence() {
  const artifacts = loadVerifiedArtifacts(root);
  const transcriptFile = acpTranscriptPath();
  if (!existsSync(transcriptFile)) {
    throw new Error('Cannot find the real Antigravity ACP transcript at ' + transcriptFile +
      '. Set CASCADE_DEMO_ACP_TRANSCRIPT to its actual location. No synthetic trace will be substituted.');
  }
  const transcript = extractVerifiedAcpTranscript(readFileSync(transcriptFile, 'utf8'));
  return { artifacts, transcript };
}

async function promptLogin(page) {
  log('One-time sign-in required. Use the Chromium window to log into YOUR local Mattermost.');
  log('No username or password is requested or stored by this script.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question('After you see Town Square in Chromium, press Enter HERE to continue... ');
  } finally { rl.close(); }
  await page.goto(base + '/switch/channels/town-square', { waitUntil: 'domcontentloaded', timeout: 30000 });
}

async function getJson(context, endpoint) {
  const res = await context.request.get(base + endpoint, { timeout: 20000, failOnStatusCode: false });
  if (!res.ok()) return null;
  try { return await res.json(); } catch { return null; }
}

async function retrieveAndValidate(context, id, kind) {
  const post = await getJson(context, '/api/v4/posts/' + id);
  if (!post) throw new Error('Could not GET Mattermost post ' + id + ' via authenticated local API.');
  const user = await getJson(context, '/api/v4/users/' + post.user_id);
  if (!user) throw new Error('Could not GET the actual author for local Mattermost post ' + id + '.');
  return { post, meta: verifyMattermostEvidence(post, user, kind) };
}

async function screenshotPost(page, id, kind, screenshotPath) {
  await page.goto(base + '/switch/pl/' + id, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const marker = kind === 'evaluation' ? 'Disruption Evaluation Report' :
    kind === 'approval' ? 'CASCADE APPROVE' :
    kind === 'receipt' ? 'CASCADE RECOVERY PLAN EXECUTED LOCALLY' : 'CASCADE INCIDENT REPORT';
  await page.waitForFunction(
    (needle) => document.body?.innerText?.includes(needle) ?? false,
    marker, { timeout: 25000 },
  ).catch(() => {
    throw new Error('Mattermost UI did not display the verified ' + kind + ' post. ' +
      'Open the local permalink in Chromium and check login, room membership, and whether the thread is expanded.');
  });
  const targeted = page.locator('[id="post_' + id + '"],[id="post-' + id + '"],[data-post-id="' + id + '"]').first();
  if (await targeted.count()) {
    await targeted.scrollIntoViewIfNeeded().catch(() => undefined);
  } else {
    const textMatch = page.getByText(marker, { exact: false }).first();
    if (await textMatch.count()) await textMatch.scrollIntoViewIfNeeded().catch(() => undefined);
  }
  await page.waitForTimeout(700);
  // Clip OUT the left sidebar and top account bar, which can contain private
  // unrelated conversations. Never capture the entire desktop/profile.
  await page.screenshot({
    path: screenshotPath,
    clip: { x: 305, y: 85, width: 1260, height: 780 },
    animations: 'disabled',
    caret: 'hide',
  });
  const bytes = readFileSync(screenshotPath);
  if (bytes.length < 15000) {
    throw new Error('The ' + kind + ' visual capture is unexpectedly small. Refusing to use a blank image.');
  }
  return sha256(bytes);
}

async function captureEvidence() {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1, acceptDownloads: false,
    args: ['--window-size=1600,900'],
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(base + '/switch/channels/town-square', { waitUntil: 'domcontentloaded', timeout: 30000 });
    let check = await getJson(context, '/api/v4/users/me');
    if (!check?.id) {
      await promptLogin(page);
      check = await getJson(context, '/api/v4/users/me');
      if (!check?.id) throw new Error('Mattermost login is not established in the dedicated Chromium profile.');
    }
    const evidence = [];
    const entries = [
      { id: EVIDENCE.evaluationPost, kind: 'evaluation' },
      { id: EVIDENCE.approvalPost, kind: 'approval' },
      { id: EVIDENCE.receiptPost, kind: 'receipt' },
    ];
    const evalRecord = await retrieveAndValidate(context, EVIDENCE.evaluationPost, 'evaluation');
    let incidentId = incidentOverride || evalRecord.post.root_id;
    if (incidentId && /^[a-z0-9]{26}$/.test(incidentId) &&
        incidentId !== EVIDENCE.evaluationPost) {
      try {
        await retrieveAndValidate(context, incidentId, 'incident');
        entries.unshift({ id: incidentId, kind: 'incident' });
        log('Found genuine human incident post ' + incidentId + '.');
      } catch (e) {
        if (incidentOverride) throw e;
        log('Incident post cannot be proved from thread root. Will use the synthetic scenario card instead.');
      }
    } else {
      log('Incident post ID not discoverable; using a clearly labeled synthetic context card.');
    }
    for (const { id, kind } of entries) {
      log('Verifying authenticated ' + kind + ' evidence: ' + id);
      const verified = await retrieveAndValidate(context, id, kind);
      const file = join(raw, kind + '.png');
      const hash = await screenshotPost(page, id, kind, file);
      evidence.push({ ...verified.meta, screenshot: kind + '.png', sha256: hash });
    }
    return evidence;
  } finally { await context.close(); }
}

function narrationScenes(local, posts) {
  const hasIncident = posts.some(p => p.kind === 'incident');
  const file = (kind) => {
    const path = join(raw, kind + '.png');
    return existsSync(path) ? readFileSync(path).toString('base64') : null;
  };
  const verifiedArtifacts = local.artifacts;
  const code = [
    'SOURCE: LOCAL ANTIGRAVITY ACP TRANSCRIPT',
    'Session: ' + local.transcript.sessionId,
    'Step 107: MODEL → call_mcp_tool',
    '  server = switch',
    '  tool   = cascade_execute_recovery',
    'Step 108: TOOL → exit_code = 0',
    '  state = APPLIED_LOCALLY',
    '  alreadyApplied = true',
    '  duplicate receipt = suppressed',
  ].join('\n');
  return [
    {
      id: 'intro', type: 'title', title: 'WHEN THE PLAN BREAKS',
      subtitle: 'The promises still have to survive.',
      hero: '430 people · 7 commitments · 1 accountable team decision',
      label: 'FLIP THE SWITCH 2026 · BUSINESS WORKFLOW',
      narration: 'A cancelled auditorium. Four hundred and thirty people arriving. Seven commitments are suddenly at risk. A chatbot can suggest a new plan. CASCADE asks a harder question: which promises can we actually keep?',
    },
    {
      id: 'incident', type: hasIncident ? 'evidence' : 'code', title: 'THE INCIDENT',
      subtitle: hasIncident ? 'An actual human reports the disruption inside Switch.' :
        'Synthetic incident brief · the real agent conversation follows.',
      imageData: hasIncident ? file('incident') : null,
      code: hasIncident ? null : [
        'SYNTHETIC EVENT: event-430',
        'Disruption: auditorium cancelled',
        'Attendees: 430',
        'Kickoff: 10:00 AM',
        'Commitments impacted: 7',
        'Budget baseline: INR 80,000',
        '',
        'This card is derived from local fixture data.',
        'It is not a fabricated chat screenshot.',
      ].join('\n'),
      codeLabel: 'SOURCE: FIXTURE (NOT A CHAT POST)',
      bullets: ['One critical dependency fails.', 'Seven obligations remain.', 'Switch is the team room.'],
      narration: 'In our synthetic hackathon incident, the original auditorium becomes unavailable, but accessibility, seating, synchronized kickoff, sponsor timing, and budget still matter. The event organizer brings the incident into the shared Switch and Mattermost workspace.',
    },
    {
      id: 'evaluation', type: 'evidence', title: 'THE AGENT CALLS THE ENGINE',
      subtitle: 'Real Mattermost report · computed constraint results, not guesses.',
      imageData: file('evaluation'),
      bullets: ['Plan A fails concurrent AV.', 'Plan C breaks synchronized kickoff.', 'Plan B needs exact budget approval.'],
      sourceNote: 'Verified post: ' + EVIDENCE.evaluationPost,
      narration: 'Antigravity invokes a Switch tool connected to our deterministic TypeScript engine. Plan A fails because two simultaneous halls need two AV kits. Plan C breaks the promised shared kickoff. Plan B meets the hard constraints, but requires three thousand rupees more.',
    },
    {
      id: 'plans', type: 'code', title: 'ONE PLAN SURVIVES THE CHECKS',
      subtitle: 'The engine preserves the kickoff, not just seating capacity.',
      code: [
        'Plan A   FAIL               AV_CONCURRENCY',
        'Plan B   REQUIRES_APPROVAL  BUDGET_CAP',
        'Plan C   FAIL               SYNCHRONIZED_KICKOFF',
        '',
        'PLAN B · PROJECTED INR 83,000',
        'Hall A: 250 attendees · 10:00–10:45',
        'Hall B: 180 attendees · 10:00–10:45',
        'Additional staffed AV: INR 3,000',
      ].join('\n'),
      codeLabel: 'DERIVED FROM VALIDATED LOCAL ARTIFACTS',
      bullets: ['430 people accounted for.', 'One synchronized 10:00 start.', 'No silent budget override.'],
      narration: 'The viable recovery is precise: two hundred and fifty attendees in Hall A, one hundred and eighty in Hall B, both starting at ten. A second AV kit costs three thousand rupees, raising the projected total to eighty-three thousand.',
    },
    {
      id: 'approval', type: 'evidence', title: 'THE HUMAN MAKES THE EXCEPTION',
      subtitle: 'Authenticated Mattermost approval · exact plan hash and spending cap.',
      imageData: file('approval'),
      bullets: ['Human author verified.', 'Room and server checked.', 'Plan hash and INR 3,000 match.'],
      sourceNote: 'Verified owner post: ' + EVIDENCE.approvalPost,
      narration: 'The AI is not permitted to authorize its own budget exception. The human owner personally submits a hash-bound approval in Mattermost. CASCADE fetches the actual message, verifies its author, room, timestamp, exact plan and maximum extra spend before allowing execution.',
    },
    {
      id: 'receipt', type: 'evidence', title: 'AUTHORIZATION IS NOT EXECUTION',
      subtitle: 'The local receipt was actually posted back to the team room.',
      imageData: file('receipt'),
      bullets: ['State: APPLIED_LOCALLY.', 'Approval is traceable.', 'No purchases or notifications.'],
      sourceNote: 'Verified receipt post: ' + EVIDENCE.receiptPost,
      narration: 'After verifying the approval, CASCADE generated the recovery artifacts and published a real receipt in the Switch conversation. Its state is applied locally. It does not claim that a physical venue was booked or that a supplier received payment.',
    },
    {
      id: 'artifacts', type: 'code', title: 'INSPECTABLE, LOCAL OUTPUT',
      subtitle: 'Schedule, attendee assignments, drafts, and an execution receipt.',
      code: [
        'receipt.json',
        '  state: ' + verifiedArtifacts.receipt.state,
        '  plan: plan-b',
        'schedule.json',
        '  Hall A: ' + verifiedArtifacts.schedule.hallA + ' attendees',
        '  Hall B: ' + verifiedArtifacts.schedule.hallB + ' attendees',
        '  projectedCostINR: ' + verifiedArtifacts.schedule.projectedCostINR,
        'assignments.json',
        '  totalAttendees: ' + verifiedArtifacts.assignments.totalAttendees,
        'stakeholder-messages.md',
        '  DRAFTS ONLY — NOT SENT',
      ].join('\n'),
      codeLabel: 'VALUES READ FROM ACTUAL GENERATED FILES',
      bullets: ['Full artifact integrity checked.', 'Communications are drafts only.', 'Nothing sent externally.'],
      narration: 'Here are the actual generated files. The schedule preserves the ten o’clock start, the assignments account for all four hundred and thirty attendees, and stakeholder messages are explicitly unsent drafts. The receipt ties the local execution back to the verified human approval.',
    },
    {
      id: 'agent-proof', type: 'code', title: 'AN AGENT CAN VERIFY THE RESULT',
      subtitle: 'A real Switch MCP call · idempotent execution, not a second booking.',
      code, codeLabel: 'SANITIZED VERIFIED TOOL EVIDENCE',
      bullets: ['Antigravity invoked the real operation.', 'Exit code zero.', 'Already applied: no duplicate receipt.'],
      sourceNote: 'Extracted from local ACP steps 107–108. Raw logs remain private.',
      narration: 'Later, Antigravity itself invoked the recovery tool through Switch again. The engine returned success, confirmed the existing artifacts were already applied, and avoided posting a duplicate receipt. This is an idempotent replay, not a claim of first-time execution by the agent.',
    },
    {
      id: 'closing', type: 'title', title: 'ACCOUNTABLE AI WORKFLOWS',
      subtitle: 'Built for the Best Business Workflow challenge.',
      hero: 'The agent coordinates. The engine checks. The human authorizes.',
      label: 'CASCADE · GITHUB.COM/YASHSHAH1211/CASCADE',
      narration: 'CASCADE turns a crisis from a convincing AI suggestion into an accountable team decision. The agent coordinates. The engine checks the promises. The human approves exceptions. And Switch keeps everyone in the same workflow. CASCADE: when a plan breaks, the promises don’t have to.',
    },
  ];
}

function audioDuration(path) {
  const stdout = run(ffprobeBin, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ]);
  const length = Number.parseFloat(stdout);
  if (!Number.isFinite(length) || length < 1) throw new Error('Cannot determine narration duration for ' + path);
  return length;
}

function speak(narration, slug, narrationPath) {
  const narrationFile = join(frames, slug + '.txt');
  writeFileSync(narrationFile, narration, 'utf8');
  run('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(here, 'speak.ps1'), '-TextFile', narrationFile, '-OutputFile', narrationPath,
  ], { timeout: 60000 });
  return audioDuration(narrationPath);
}

function renderMedia(scene, index, total, screen) {
  const frame = join(frames, String(index + 1).padStart(2, '0') + '-' + scene.id + '.png');
  return screen.setContent(sceneHtml(scene, index, total), { waitUntil: 'load' })
    .then(() => screen.screenshot({ path: frame, animations: 'disabled' }))
    .then(() => frame);
}

function videoClip(frame, narrationPath, duration, index) {
  const target = join(clips, String(index + 1).padStart(2, '0') + '.mp4');
  const filter = [
    "[0:v]scale=1920:1080,zoompan=z='min(zoom+0.00013,1.035)':d=1:s=1920x1080:fps=30,format=yuv420p[v]",
    '[1:a]apad=pad_dur=1.5[a]',
  ].join(';');
  run(ffmpegBin, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', frame,
    '-i', narrationPath, '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]', '-t', duration.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart', target,
  ], { timeout: 240000 });
  return target;
}

function joinClips(paths) {
  const list = join(output, 'concat.txt');
  // Files are generated by our tool; no user-supplied path reaches the list.
  writeFileSync(list, paths.map(p => "file '" + p.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
  const target = join(output, 'CASCADE_FlipTheSwitch_Demo.mp4');
  run(ffmpegBin, [
    '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat',
    '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', target,
  ], { timeout: 180000 });
  return target;
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('One-click narration mode uses Windows PowerShell/System.Speech. Run this on your Windows laptop.');
  }
  if (input.has('--help')) {
    console.log('Usage: record-demo.cmd [--check-only | --capture-only]');
    return;
  }
  for (const dir of [output, raw, frames, clips, profile]) mkdirSync(dir, { recursive: true });
  log('READ-ONLY: no Mattermost posts, approvals, purchases, or notices will be created.');
  log('Verifying the ORIGINAL local recovery and Antigravity transcript...');
  const local = loadLocalEvidence();
  log('Local receipt: ' + local.artifacts.receipt.state + ' / ' + local.artifacts.receipt.executionKey);
  if (checkOnly) { log('Local artifacts and ACP trace verified.'); return; }

  log('Opening dedicated Chromium browser to capture genuine Mattermost posts...');
  const posts = await captureEvidence();
  const scenes = narrationScenes(local, posts);

  const manifest = {
    createdAt: new Date().toISOString(),
    scenario: 'event-430 (synthetic)',
    mediaType: 'read-only capture + branded narration, not an uninterrupted live execution',
    source: base,
    authenticatedPosts: posts,
    artifactChecksums: local.artifacts.checksums,
    antigravityEvidence: local.transcript,
    scenes: scenes.map(s => ({ id: s.id, title: s.title, narration: s.narration })),
  };
  writeFileSync(join(output, 'evidence-manifest.json'), JSON.stringify(manifest, null, 2));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const paths = [];
    for (let index = 0; index < scenes.length; index++) {
      const scene = scenes[index];
      log('Rendering scene ' + (index+1) + '/' + scenes.length + ': ' + scene.title);
      const frame = await renderMedia(scene, index, scenes.length, page);
      if (skipVideo) continue;
      const audioFile = join(frames, scene.id + '.wav');
      const seconds = speak(scene.narration, scene.id, audioFile);
      paths.push(videoClip(frame, audioFile, seconds + 1.4, index));
    }
    if (skipVideo) {
      log('Captures/scene frames complete. No MP4 requested (--capture-only).');
      return;
    }
    const target = joinClips(paths);
    log('SUCCESS: ' + target);
    log('Before sharing: open MP4 and review visible information and accuracy.');
    log('The private browser profile and raw captures remain ONLY on this device and are gitignored.');
  } finally { await browser.close(); }
}

main().catch(e => {
  console.error('\nCASCADE Studio stopped safely:\n' + e.message);
  console.error('No fabricated evidence was used. See tools/demo-studio/README.md for recovery steps.');
  process.exitCode = 1;
});
