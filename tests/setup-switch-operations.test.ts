import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SAMPLE_DEFINITIONS_ORIGINAL = `\"\"\"Switch core operation definitions fixture.\"\"\"

from typing import Any

def existing_unrelated_op_1() -> str:
    return "alpha"

@operation
def list_rooms() -> list[dict[str, Any]]:
    return []

def existing_unrelated_op_2() -> str:
    return "omega"
`;

test('Switch Setup Script: fails when no target is explicitly specified', async () => {
  const result = spawnSync('python', ['scripts/setup-switch-operations.py'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: { ...process.env, SWITCH_DEFINITIONS_PATH: '' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /No target Switch definitions\.py file explicitly selected/);
});

test('Switch Setup Script: dry run does not modify target file or create backup', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-setup-test-'));
  const testFile = join(tempDir, 'definitions.py');
  await writeFile(testFile, SAMPLE_DEFINITIONS_ORIGINAL, 'utf-8');

  try {
    const result = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile, '--dry-run'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[DRY-RUN\]/);

    const contentAfter = await readFile(testFile, 'utf-8');
    assert.equal(contentAfter, SAMPLE_DEFINITIONS_ORIGINAL);

    const bakExists = await readFile(testFile + '.bak', 'utf-8').catch(() => null);
    assert.equal(bakExists, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: applies setup, creates backup, and preserves surrounding code', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-setup-test-'));
  const testFile = join(tempDir, 'definitions.py');
  await writeFile(testFile, SAMPLE_DEFINITIONS_ORIGINAL, 'utf-8');

  try {
    const result = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[BACKUP\] Created backup/);
    assert.match(result.stdout, /\[OK\] Added CASCADE operations/);

    const contentAfter = await readFile(testFile, 'utf-8');
    assert.match(contentAfter, /START_MARKER|CASCADE Deterministic Operations/);
    assert.match(contentAfter, /cascade_execute_recovery/);
    assert.match(contentAfter, /cascade_evaluate_recovery/);
    assert.match(contentAfter, /END CASCADE Deterministic Operations/);

    // Verify surrounding original code is completely preserved
    assert.match(contentAfter, /existing_unrelated_op_1/);
    assert.match(contentAfter, /existing_unrelated_op_2/);

    // Verify backup matches original
    const bakContent = await readFile(testFile + '.bak', 'utf-8');
    assert.equal(bakContent, SAMPLE_DEFINITIONS_ORIGINAL);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: repeated execution cleanly updates without duplicates', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-setup-test-'));
  const testFile = join(tempDir, 'definitions.py');
  await writeFile(testFile, SAMPLE_DEFINITIONS_ORIGINAL, 'utf-8');

  try {
    // Run 1
    spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    // Run 2 (repeated)
    const result2 = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    assert.equal(result2.status, 0);
    assert.match(result2.stdout, /\[OK\] Updated CASCADE operations/);

    const contentAfter = await readFile(testFile, 'utf-8');
    const executeOccurrences = (contentAfter.match(/def cascade_execute_recovery/g) || []).length;
    const evaluateOccurrences = (contentAfter.match(/def cascade_evaluate_recovery/g) || []).length;

    assert.equal(executeOccurrences, 1, 'Expected exactly 1 cascade_execute_recovery definition');
    assert.equal(evaluateOccurrences, 1, 'Expected exactly 1 cascade_evaluate_recovery definition');
    assert.match(contentAfter, /existing_unrelated_op_2/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: rollback restores original file from backup', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-setup-test-'));
  const testFile = join(tempDir, 'definitions.py');
  await writeFile(testFile, SAMPLE_DEFINITIONS_ORIGINAL, 'utf-8');

  try {
    // Run setup to create backup and modify file
    spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    // Run rollback
    const rollbackResult = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile, '--rollback'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    assert.equal(rollbackResult.status, 0);
    assert.match(rollbackResult.stdout, /\[ROLLBACK\] Removed only the bounded CASCADE block/);

    const contentAfter = await readFile(testFile, 'utf-8');
    assert.equal(contentAfter.trimEnd(), SAMPLE_DEFINITIONS_ORIGINAL.trimEnd());
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: contains no hardcoded machine-specific credential paths', async () => {
  const scriptContent = await readFile('scripts/setup-switch-operations.py', 'utf-8');

  // Verify no hardcoded absolute user profiles
  assert.doesNotMatch(scriptContent, /C:\\Users\\[a-zA-Z0-9_.-]+/i);
  // Verify no hardcoded token or password assignments
  assert.doesNotMatch(scriptContent, /(?:TOKEN|SECRET|PASSWORD)\s*=\s*['"][a-zA-Z0-9_.-]{8,}['"]/i);
  assert.doesNotMatch(scriptContent, /['"]Bearer\s+[a-zA-Z0-9_-]{10,}['"]/i);
});


test('Switch Setup Script: legacy start marker without end fails closed on setup and rollback', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-legacy-test-'));
  const testFile = join(tempDir, 'definitions.py');
  const legacy = SAMPLE_DEFINITIONS_ORIGINAL +
    '\n# ── CASCADE Deterministic Operations (Flip the Switch 2026) ──\n' +
    '@operation\nasync def cascade_evaluate_recovery(mode="demo"):\n    return {}\n' +
    '\ndef unrelated_vendor_function_after_cascade():\n    return "must-survive"\n';
  await writeFile(testFile, legacy, 'utf-8');

  try {
    for (const extraArgs of [[], ['--dry-run'], ['--rollback'], ['--rollback', '--dry-run']]) {
      const result = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile, ...extraArgs], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      assert.equal(result.status, 1, 'Legacy unbounded marker must be refused');
      assert.match(result.stdout, /refusing to edit/i);
      assert.equal(await readFile(testFile, 'utf-8'), legacy, 'Unrelated vendor function must survive');
      assert.equal(await readFile(testFile + '.bak', 'utf-8').catch(() => null), null);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: unmarked legacy operations are rejected without truncating trailing code', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-legacy-test-'));
  const testFile = join(tempDir, 'definitions.py');
  const legacy = SAMPLE_DEFINITIONS_ORIGINAL +
    '\n@operation\ndef cascade_execute_recovery(approval_message_id):\n    return {}\n' +
    '\ndef another_vendor_operation():\n    return "preserved"\n';
  await writeFile(testFile, legacy, 'utf-8');

  try {
    for (const extraArgs of [[], ['--rollback']]) {
      const result = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile, ...extraArgs], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Legacy CASCADE operations have no complete markers/);
      assert.equal(await readFile(testFile, 'utf-8'), legacy);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: rollback preserves vendor changes made after the backup', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-rollback-test-'));
  const testFile = join(tempDir, 'definitions.py');
  await writeFile(testFile, SAMPLE_DEFINITIONS_ORIGINAL, 'utf-8');

  try {
    const setup = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    assert.equal(setup.status, 0);
    const newerVendorChange = '\n\ndef vendor_change_added_after_install():\n    return "keep me"\n';
    await writeFile(testFile, (await readFile(testFile, 'utf-8')) + newerVendorChange, 'utf-8');
    const rollback = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile, '--rollback'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    assert.equal(rollback.status, 0);
    const result = await readFile(testFile, 'utf-8');
    assert.match(result, /vendor_change_added_after_install/);
    assert.match(result, /existing_unrelated_op_1/);
    assert.match(result, /existing_unrelated_op_2/);
    assert.doesNotMatch(result, /# ── CASCADE Deterministic Operations/);
    assert.equal(await readFile(testFile + '.bak', 'utf-8'), SAMPLE_DEFINITIONS_ORIGINAL);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Switch Setup Script: malformed or reversed markers fail closed', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'switch-bad-markers-test-'));
  const testFile = join(tempDir, 'definitions.py');
  const corrupted = SAMPLE_DEFINITIONS_ORIGINAL +
    '\n# ── END CASCADE Deterministic Operations ──\n' +
    '# ── CASCADE Deterministic Operations (Flip the Switch 2026) ──\n' +
    'def vendor_code():\n    return True\n';
  await writeFile(testFile, corrupted, 'utf-8');

  try {
    for (const extraArgs of [[], ['--rollback']]) {
      const result = spawnSync('python', ['scripts/setup-switch-operations.py', '--target', testFile, ...extraArgs], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /refusing to edit/);
      assert.equal(await readFile(testFile, 'utf-8'), corrupted);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
