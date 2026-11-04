import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const EVIDENCE = Object.freeze({
  channelId: '1q83ogqo37gfxjrthkm6hwgqxc',
  humanId: 'oh47xmfeafyapbjyhhri6bucae',
  planHash: '1ddfdd0f2ccda8d1f9891627f5e51e8d86a946d54460a9cd18a1e16bc22ad0da',
  evaluationPost: 'g4aqigppjtgw9f4jqbajbu5xxa',
  approvalPost: 'w7gx4ku4ybdtirmhs36feexciw',
  receiptPost: 'd41a43t9rtnyid9ho3dhjyfy8o',
  executionKey: 'event-430-1ddfdd0f2ccda8d1f9891627',
  acpSession: 'd84a1440-ffbc-464c-a1d6-0a4885de9a70',
});

export const APPROVAL_COMMAND =
  'CASCADE APPROVE ' + EVIDENCE.planHash + ' MAX_EXTRA_INR 3000';

export function assertLocalMattermostURL(raw) {
  const value = new URL(raw);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) ||
      value.protocol !== 'http:' || value.username || value.password ||
      value.search || value.hash || value.pathname !== '/') {
    throw new Error('Demo Studio only connects to an HTTP localhost Mattermost server, e.g. http://localhost:59113/');
  }
  return value.origin;
}

export function assertPostId(value) {
  if (!/^[a-z0-9]{26}$/.test(value ?? '')) {
    throw new Error('Expected a 26-character lowercase Mattermost post ID.');
  }
  return value;
}

export function verifyMattermostEvidence(post, user, kind) {
  if (!post || !user || post.id !== assertPostId(post.id) ||
      post.user_id !== user.id || post.channel_id !== EVIDENCE.channelId ||
      typeof post.message !== 'string' || !Number.isSafeInteger(post.create_at)) {
    throw new Error('Mattermost post/channel/author metadata does not match the recorded evidence.');
  }
  const isBot = Boolean(user.is_bot === true || user.is_bot === 'true' ||
    user.is_bot === 1 || user.roles?.split?.(/\s+/).includes('system_bot') ||
    post.props?.from_bot || post.props?.from_webhook ||
    post.props?.override_username || post.props?.webhook_display_name);
  if (kind === 'evaluation') {
    if (post.id !== EVIDENCE.evaluationPost || !isBot ||
        !post.message.includes('AV_CONCURRENCY') ||
        !post.message.includes('REQUIRES_APPROVAL') ||
        !post.message.includes(EVIDENCE.planHash)) {
      throw new Error('The evaluation post is missing expected engine-verified evidence.');
    }
  } else if (kind === 'approval') {
    if (post.id !== EVIDENCE.approvalPost || isBot ||
        post.user_id !== EVIDENCE.humanId ||
        post.message.trim() !== APPROVAL_COMMAND) {
      throw new Error('The human-authorized budget approval could not be verified.');
    }
  } else if (kind === 'receipt') {
    if (post.id !== EVIDENCE.receiptPost ||
        !post.message.includes('APPLIED_LOCALLY') ||
        !post.message.includes(EVIDENCE.planHash)) {
      throw new Error('The published local-execution receipt does not match the evidence.');
    }
  } else if (kind === 'incident') {
    if (isBot || post.user_id !== EVIDENCE.humanId ||
        !post.message.includes('CASCADE INCIDENT REPORT')) {
      throw new Error('The optional incident post is not the genuine human incident.');
    }
  } else {
    throw new Error('Unknown evidence kind.');
  }
  return Object.freeze({
    id: post.id, channelId: post.channel_id, authorId: post.user_id,
    source: 'authenticated Mattermost API (read only)',
    createdAt: new Date(post.create_at).toISOString(), kind,
  });
}

export function safeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(path) {
  const data = readFileSync(path, 'utf8');
  try {
    return JSON.parse(data);
  } catch {
    // Report filename only, never its contents (files may contain private data).
    throw new Error('Recovery artifact is not valid JSON: ' + path.split(/[\\/]/).pop() +
      '. No source file was changed.');
  }
}

export function loadVerifiedArtifacts(root) {
  const dir = join(root, 'artifacts', 'event-430-recovery-live', EVIDENCE.executionKey);
  const receipt = json(join(dir, 'receipt.json'));
  const schedule = json(join(dir, 'schedule.json'));
  const assignments = json(join(dir, 'assignments.json'));
  const drafts = readFileSync(join(dir, 'stakeholder-messages.md'), 'utf8');
  if (receipt.state !== 'APPLIED_LOCALLY' || receipt.planId !== 'plan-b' ||
      receipt.planHash !== EVIDENCE.planHash ||
      receipt.humanApprovalEvidence?.approvalMessageId !== EVIDENCE.approvalPost ||
      receipt.humanApprovalEvidence?.switchRoomId !== 'room:cascade-operations') {
    throw new Error('The local receipt does not match the verified Plan B approval.');
  }
  if (receipt.actions?.some(a => !['applied-locally', 'drafted'].includes(a.status)) ||
      schedule.projectedCostINR !== 83000 || schedule.planId !== 'plan-b' ||
      assignments.totalAttendees !== 430 ||
      !drafts.startsWith('# Drafts only — NOT SENT') ||
      !drafts.includes('This message has not been sent.')) {
    throw new Error('Generated schedule, assignments, or draft-only communication has unexpected content.');
  }
  const counts = (schedule.allocations ?? []).map(a => a.attendeeTo - a.attendeeFrom + 1);
  if (counts.length !== 2 || counts[0] !== 250 || counts[1] !== 180 ||
      schedule.allocations[0].start !== '2026-11-06T10:00:00+05:30' ||
      schedule.allocations[1].start !== '2026-11-06T10:00:00+05:30') {
    throw new Error('The local plan allocations do not match the expected 250/180 synchronized kickoff.');
  }
  const allRanges = assignments.hallAssignments ?? [];
  if (allRanges.length !== 2 ||
      allRanges.reduce((sum, a) => sum + a.attendeeCount, 0) !== 430 ||
      allRanges[0].attendeeRange[0] !== 0 || allRanges[0].attendeeRange[1] !== 249 ||
      allRanges[1].attendeeRange[0] !== 250 || allRanges[1].attendeeRange[1] !== 429) {
    throw new Error('The published assignment ranges are incomplete or inconsistent.');
  }
  return {
    dir,
    receipt: {
      executionKey: receipt.executionKey,
      state: receipt.state,
      planHash: receipt.planHash,
      approvalMessageId: receipt.humanApprovalEvidence.approvalMessageId,
    },
    schedule: {
      projectedCostINR: schedule.projectedCostINR,
      kickoff: schedule.allocations[0].start,
      hallA: counts[0], hallB: counts[1],
    },
    assignments: { totalAttendees: assignments.totalAttendees },
    stakeholderDraft: '# Drafts only — NOT SENT',
    checksums: Object.fromEntries(['receipt.json','schedule.json','assignments.json','stakeholder-messages.md']
      .map(name => [name, sha256(readFileSync(join(dir, name)))])),
  };
}

function findJsonObjectInText(text) {
  // Some ACP releases prefix MCP result JSON with printable metadata such as
  // "Created At: ...". Inspect the tool-owned payload without logging any text.
  if (typeof text !== 'string' || text.length > 2_000_000) return null;
  const matches = text.match(/```(?:json)?\s*([\s\S]*?)```/gi);
  const candidates = [text];
  if (matches) {
    for (const block of matches) candidates.push(block.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim());
  }
  for (const candidate of candidates) {
    try { return JSON.parse(candidate.trim()); } catch { /* prefix or suffix present */ }
    for (let start = 0, tries = 0; start < candidate.length && tries < 16; start++) {
      if (candidate[start] !== '{') continue;
      tries++;
      let depth = 0, quoted = false, escaped = false;
      for (let end = start; end < candidate.length; end++) {
        const ch = candidate[end];
        if (quoted) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try { return JSON.parse(candidate.slice(start, end + 1)); }
          catch { break; }
        }
      }
    }
  }
  return null;
}

function recoverStructuredToolResult(content, depth = 0) {
  if (depth > 5 || content == null) return null;
  if (typeof content === 'string') {
    const parsed = findJsonObjectInText(content);
    return parsed === null ? null : recoverStructuredToolResult(parsed, depth + 1);
  }
  if (Array.isArray(content)) {
    for (const value of content) {
      const found = recoverStructuredToolResult(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof content !== 'object') return null;
  if (typeof content.exit_code === 'number' && typeof content.success === 'boolean' &&
      typeof content.stdout === 'string') return content;
  // ACP/MCP wrappers can wrap the result as text blocks or under a data/result key.
  for (const key of ['content', 'result', 'data', 'output', 'tool_result', 'text']) {
    if (content[key] != null) {
      const found = recoverStructuredToolResult(content[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function extractVerifiedAcpTranscript(text) {
  // Extract only known model/tool steps. No raw transcript data is emitted or logged.
  const lines = text.split(/\r?\n/).filter(Boolean);
  let invocation = null, result = null;
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed?.step_index === 107) invocation = parsed;
    if (parsed?.step_index === 108) result = parsed;
  }
  if (!invocation || !result) {
    throw new Error('ACP transcript is missing recorded steps 107 and 108.');
  }
  if (invocation.source !== 'MODEL' || result.source !== 'TOOL' ||
      invocation.type !== 'PLANNER_RESPONSE' || result.type !== 'MCP_TOOL') {
    throw new Error('ACP steps 107–108 are not a model tool invocation and tool-owned result.');
  }
  const calls = invocation.tool_calls ?? [];
  const call = calls.find(x => x.name === 'call_mcp_tool' &&
    String(x.args?.ToolName).includes('cascade_execute_recovery'));
  if (!call || !String(call.args?.Arguments ?? '').includes(EVIDENCE.approvalPost)) {
    throw new Error('ACP step 107 is missing the real Switch recovery call and approval post ID.');
  }
  const output = recoverStructuredToolResult(result.content ?? result.result ?? result.output);
  if (!output) {
    const kind = Array.isArray(result.content) ? 'array' : typeof result.content;
    throw new Error(
      'ACP step 108 has no structured recovery tool result (content type: ' + kind +
      '). It may contain human-readable metadata such as Created At. ' +
      'The recorder will not treat unstructured text as proof of execution. ' +
      'Keep the raw transcript private; inspect its step 108 format locally.'
    );
  }
  if (output.exit_code !== 0 || output.success !== true ||
      !output.stdout.includes('Already Applied: true') ||
      !output.stdout.includes('State: APPLIED_LOCALLY') ||
      !output.stdout.includes(EVIDENCE.planHash)) {
    throw new Error('ACP step 108 does not prove a successful idempotent recovery execution.');
  }
  return Object.freeze({
    sessionId: EVIDENCE.acpSession,
    modelToolStep: 107, toolResultStep: 108,
    tool: 'cascade_execute_recovery',
    exitCode: 0, state: 'APPLIED_LOCALLY', alreadyApplied: true,
    evidenceType: 'verified, sanitized fields from local Antigravity ACP tool result',
  });
}

export function assertWithin(root, candidate) {
  const base = resolve(root);
  const target = resolve(candidate);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('Refusing access outside the expected local project directory.');
  }
  return target;
}
