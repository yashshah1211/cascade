import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EVIDENCE, APPROVAL_COMMAND, assertLocalMattermostURL, assertPostId,
  verifyMattermostEvidence, loadVerifiedArtifacts,
  extractVerifiedAcpTranscript, safeHtml, assertWithin,
} from './lib.mjs';
import { sceneHtml } from './render.mjs';

function post(kind) {
  const id = EVIDENCE[kind + 'Post'];
  const message = kind === 'approval'
    ? APPROVAL_COMMAND
    : kind === 'evaluation'
      ? 'Disruption Evaluation Report AV_CONCURRENCY REQUIRES_APPROVAL ' + EVIDENCE.planHash
      : 'CASCADE RECOVERY PLAN EXECUTED LOCALLY APPLIED_LOCALLY ' + EVIDENCE.planHash;
  return {
    id, channel_id: EVIDENCE.channelId, user_id: kind === 'approval' ? EVIDENCE.humanId : 'bot-account',
    message, create_at: 1793812404513, props: {},
  };
}
const human = { id: EVIDENCE.humanId, is_bot: false, roles: 'system_user' };
const bot = { id: 'bot-account', is_bot: true, roles: 'system_user system_bot' };

test('Demo: accepts only localhost Mattermost origins', () => {
  assert.equal(assertLocalMattermostURL('http://localhost:59113/'), 'http://localhost:59113');
  assert.equal(assertLocalMattermostURL('http://127.0.0.1:59113/'), 'http://127.0.0.1:59113');
  assert.throws(() => assertLocalMattermostURL('https://public.example/'));
  assert.throws(() => assertLocalMattermostURL('http://localhost.example:59113/'));
  assert.throws(() => assertLocalMattermostURL('http://example.com/'));
  assert.throws(() => assertLocalMattermostURL('http://localhost:59113/path'));
});

test('Demo: validates Mattermost post IDs before use', () => {
  assert.equal(assertPostId(EVIDENCE.approvalPost), EVIDENCE.approvalPost);
  assert.throws(() => assertPostId('../api/v4/posts'));
  assert.throws(() => assertPostId('POST'));
});

test('Demo: validates authenticated engine evaluation', () => {
  assert.equal(verifyMattermostEvidence(post('evaluation'), bot, 'evaluation').kind, 'evaluation');
  assert.throws(() => verifyMattermostEvidence(post('evaluation'), human, 'evaluation'));
  assert.throws(() => verifyMattermostEvidence({
    ...post('evaluation'), message: 'Plan B definitely works!'
  }, bot, 'evaluation'));
});

test('Demo: refuses forged, altered or bot-authored human approvals', () => {
  assert.equal(verifyMattermostEvidence(post('approval'), human, 'approval').kind, 'approval');
  assert.throws(() => verifyMattermostEvidence(post('approval'), { ...human, is_bot: true }, 'approval'));
  assert.throws(() => verifyMattermostEvidence(post('approval'), { ...human, id: 'another-user' }, 'approval'));
  assert.throws(() => verifyMattermostEvidence({
    ...post('approval'), message: APPROVAL_COMMAND.replace('3000', '6000')
  }, human, 'approval'));
  assert.throws(() => verifyMattermostEvidence({ ...post('approval'), channel_id: 'wrong-room' }, human, 'approval'));
});

test('Demo: validates published APPLIED_LOCALLY receipt post', () => {
  assert.equal(verifyMattermostEvidence(post('receipt'), bot, 'receipt').kind, 'receipt');
  assert.throws(() => verifyMattermostEvidence({
    ...post('receipt'), message: 'execution succeeded, no receipt'
  }, bot, 'receipt'));
});

test('Demo: only whitelisted ACP tool evidence is extracted', () => {
  const steps = [
    {
      step_index: 107, source: 'MODEL', type: 'PLANNER_RESPONSE',
      tool_calls: [{
        name: 'call_mcp_tool',
        args: { ToolName: '"cascade_execute_recovery"', Arguments: '{"approval_message_id":"' + EVIDENCE.approvalPost + '"}' },
      }],
      secret: 'do not print this',
    },
    {
      step_index: 108, source: 'TOOL', type: 'MCP_TOOL',
      content: {
        exit_code: 0, success: true,
        stdout: 'Plan Hash: ' + EVIDENCE.planHash + '\nState: APPLIED_LOCALLY\nAlready Applied: true\n',
        credential: 'never put this in the video',
      },
    },
  ];
  const result = extractVerifiedAcpTranscript(steps.map(s => JSON.stringify(s)).join('\n'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.alreadyApplied, true);
  assert.equal(result.tool, 'cascade_execute_recovery');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes('credential'));
});

test('Demo: rejects ACP claim if tool failed or was not model-initiated', () => {
  const one = { step_index:107, tool_calls:[] };
  const two = { step_index:108, content: { exit_code: 1, success:false, stdout:'' } };
  assert.throws(() => extractVerifiedAcpTranscript(JSON.stringify(one) + '\n' + JSON.stringify(two)));
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cascade-demo-test-'));
  const path = join(root,'artifacts','event-430-recovery-live',EVIDENCE.executionKey);
  mkdirSync(path, {recursive:true});
  writeFileSync(join(path,'receipt.json'), JSON.stringify({
    state:'APPLIED_LOCALLY', planId:'plan-b', planHash:EVIDENCE.planHash,
    executionKey:EVIDENCE.executionKey,
    humanApprovalEvidence: { approvalMessageId:EVIDENCE.approvalPost, switchRoomId:'room:cascade-operations' },
    actions:[{ artifact:'schedule.json',status:'applied-locally' }]
  }));
  writeFileSync(join(path,'schedule.json'), JSON.stringify({
    planId:'plan-b', projectedCostINR:83000, allocations:[
      {attendeeFrom:0,attendeeTo:249,start:'2026-11-06T10:00:00+05:30'},
      {attendeeFrom:250,attendeeTo:429,start:'2026-11-06T10:00:00+05:30'}
    ]
  }));
  writeFileSync(join(path,'assignments.json'), JSON.stringify({
    totalAttendees:430, hallAssignments:[
      {attendeeCount:250,attendeeRange:[0,249]},
      {attendeeCount:180,attendeeRange:[250,429]}
    ]
  }));
  writeFileSync(join(path,'stakeholder-messages.md'),
    '# Drafts only — NOT SENT\nThis message has not been sent.\n');
  return {root,path};
}

test('Demo: accepts matching real local artifact schema and extracts source checksums', () => {
  const {root}=fixtureRoot();
  try {
    const result=loadVerifiedArtifacts(root);
    assert.equal(result.schedule.hallA,250);
    assert.equal(result.assignments.totalAttendees,430);
    assert.match(result.checksums['receipt.json'],/^[a-f0-9]{64}$/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('Demo: refuses synthetic artifact tampering', () => {
  const {root,path}=fixtureRoot();
  try {
    writeFileSync(join(path,'stakeholder-messages.md'),'An attendee notification was sent.');
    assert.throws(() => loadVerifiedArtifacts(root),/unexpected content/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('Demo: HTML scene renderer escapes untrusted text', () => {
  const output=sceneHtml({
    type:'title', title:'<script>alert(1)</script>',
    subtitle:'The scene is safe',
    hero:'No fake evidence'
  },0,1);
  assert.ok(output.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!output.includes('<script>alert(1)</script>'));
  assert.ok(output.includes('width:100%'));
});

test('Demo: does not allow output path traversal outside project', () => {
  assert.equal(assertWithin('/repo','/repo/artifacts'),'/repo/artifacts');
  assert.throws(() => assertWithin('/repo','/repo-evil/foo'));
});

test('Demo: HTML sanitization is deterministic', () => {
  assert.equal(safeHtml('A&B <"test">'), 'A&amp;B &lt;&quot;test&quot;&gt;');
});


test('Demo: accepts metadata-prefixed structured MCP output without copying the prefix', () => {
  const structured = {
    exit_code: 0,
    success: true,
    stdout: 'Plan Hash: ' + EVIDENCE.planHash +
      '\nState: APPLIED_LOCALLY\nAlready Applied: true\n',
    stderr: '',
    private_token: 'should-not-appear',
  };
  const entries = [
    {
      step_index: 107, source: 'MODEL', type: 'PLANNER_RESPONSE',
      tool_calls: [{
        name: 'call_mcp_tool',
        args: { ToolName: 'cascade_execute_recovery', Arguments: '{"approval_message_id":"' + EVIDENCE.approvalPost + '"}' },
      }],
    },
    {
      step_index: 108, source: 'TOOL', type: 'MCP_TOOL',
      content: 'Created At: 2026-11-04T18:30:00Z\nTool response:\n' + JSON.stringify(structured) + '\n',
    },
  ];
  const result = extractVerifiedAcpTranscript(entries.map(JSON.stringify).join('\n'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.alreadyApplied, true);
  assert.ok(!JSON.stringify(result).includes('private_token'));
});

test('Demo: accepts nested MCP content text blocks with a real structured result', () => {
  const entries = [
    {
      step_index: 107, source: 'MODEL', type: 'PLANNER_RESPONSE',
      tool_calls: [{
        name: 'call_mcp_tool',
        args: { ToolName: 'cascade_execute_recovery', Arguments: EVIDENCE.approvalPost },
      }],
    },
    {
      step_index: 108, source: 'TOOL', type: 'MCP_TOOL',
      content: [{ type: 'text', text: 'Created At:\n' + JSON.stringify({
        exit_code: 0, success: true,
        stdout: 'Plan Hash: ' + EVIDENCE.planHash + '\nState: APPLIED_LOCALLY\nAlready Applied: true',
      }) }],
    },
  ];
  assert.equal(extractVerifiedAcpTranscript(entries.map(JSON.stringify).join('\n')).exitCode, 0);
});

test('Demo: rejects plain ACP metadata that contains no actual structured execution proof', () => {
  const entries = [
    {
      step_index: 107, source: 'MODEL', type: 'PLANNER_RESPONSE',
      tool_calls: [{
        name: 'call_mcp_tool',
        args: { ToolName: 'cascade_execute_recovery', Arguments: EVIDENCE.approvalPost },
      }],
    },
    {
      step_index: 108, source: 'TOOL', type: 'MCP_TOOL',
      content: 'Created At: 2026-11-04 20:00\nThe agent said success.',
    },
  ];
  assert.throws(() => extractVerifiedAcpTranscript(entries.map(JSON.stringify).join('\n')),
    /no structured recovery tool result/i);
});

test('Demo: rejects a MODEL-authored fake tool result even when it contains a success JSON', () => {
  const entries = [
    {
      step_index: 107, source: 'MODEL', type: 'PLANNER_RESPONSE',
      tool_calls: [{
        name: 'call_mcp_tool',
        args: { ToolName: 'cascade_execute_recovery', Arguments: EVIDENCE.approvalPost },
      }],
    },
    {
      step_index: 108, source: 'MODEL', type: 'MCP_TOOL',
      content: {
        exit_code: 0, success: true,
        stdout: 'Plan Hash: ' + EVIDENCE.planHash + '\nState: APPLIED_LOCALLY\nAlready Applied: true',
      },
    },
  ];
  assert.throws(() => extractVerifiedAcpTranscript(entries.map(JSON.stringify).join('\n')),
    /not a model tool invocation and tool-owned result/);
});

test('Demo: rejects bad local JSON with filename-only error instead of leaking contents', () => {
  const {root,path} = fixtureRoot();
  try {
    writeFileSync(join(path, 'receipt.json'), 'Created At: not a JSON document. SECRET_TOKEN=hidden');
    assert.throws(() => loadVerifiedArtifacts(root), (error) => {
      assert.match(error.message, /receipt\.json/);
      assert.ok(!error.message.includes('SECRET_TOKEN'));
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
