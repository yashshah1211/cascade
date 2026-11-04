#!/usr/bin/env python3
"""
CASCADE Switch Native Operations Setup Script
Registers / updates deterministic CASCADE recovery operations in Switch Core.

Finding 1: Correct executable: node dist/src/cli/recover.js
Finding 2: Input constraints (26-char alphanumeric post ID, approved artifact directory)
           Subprocess exit code check and error propagation via ValueError.
Finding 4: Reproducible, sanitized script within the CASCADE repository.
"""

import os
import re
import sys
import glob

OPERATIONS_CODE = '''

# ── CASCADE Deterministic Operations (Flip the Switch 2026) ──────────────────

@operation
async def cascade_evaluate_recovery(mode: str = "demo") -> dict[str, Any]:
    """Execute CASCADE's deterministic recovery evaluation CLI on fixtures/recovery-plans.json.

    Args:
        mode: Evaluation mode to run ('demo' for human-readable breakdown, 'inspect' for full JSON analysis). Defaults to 'demo'.

    Returns:
        Dict containing command, stdout, stderr, and exit_code from the deterministic recovery CLI.
    """
    import subprocess
    import os
    cascade_dir = os.environ.get(
        "CASCADE_REPO_DIR",
        r"C:\\Users\\yashs\\Downloads\\CASCADE_Day1_MVP_2026-11-04\\cascade"
    )
    arg = "inspect" if mode == "inspect" else "demo"
    cmd = ["node", "dist/src/cli/main.js", arg]
    proc = subprocess.run(
        cmd,
        cwd=cascade_dir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15
    )
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip()
        raise ValueError(f"CASCADE evaluation failed (exit code {proc.returncode}): {err}")

    return {
        "engine": "CASCADE Commitment Recovery Engine v0.1.0",
        "command": f"node dist/src/cli/main.js {arg}",
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "success": True,
    }


@operation
def cascade_execute_recovery(
    approval_message_id: str,
    output_dir: str = "artifacts/event-430-recovery-live"
) -> dict[str, Any]:
    """Execute CASCADE's deterministic recovery execution CLI on a verified human approval message.

    Args:
        approval_message_id: The 26-character Mattermost post ID containing the human approval command.
        output_dir: Approved artifact output directory. Must be 'artifacts/event-430-recovery-live'.

    Returns:
        Dict containing command, stdout, stderr, exit_code, and success status.
    """
    import os
    import re
    import subprocess

    # Finding 2: Constrain tool inputs to designated approval ID format and approved directory
    if not isinstance(approval_message_id, str) or not re.fullmatch(r"[a-z0-9]{26}", approval_message_id):
        raise ValueError(
            f"Invalid approval_message_id: {approval_message_id!r}. Expected 26-char alphanumeric post ID."
        )

    approved_dir = "artifacts/event-430-recovery-live"
    if not isinstance(output_dir, str):
        raise ValueError(f"Invalid output_dir type: {type(output_dir).__name__}.")
    norm_output = os.path.normpath(output_dir).replace("\\\\", "/")
    if norm_output != approved_dir and norm_output != "artifacts/event-430-recovery-live":
        raise ValueError(
            f"Invalid output_dir: {output_dir!r}. Must target approved artifact directory: {approved_dir}"
        )
    if ".." in norm_output:
        raise ValueError(f"Invalid output_dir: Directory traversal prohibited in {output_dir!r}.")

    cascade_dir = os.environ.get(
        "CASCADE_REPO_DIR",
        r"C:\\Users\\yashs\\Downloads\\CASCADE_Day1_MVP_2026-11-04\\cascade"
    )

    # Finding 1: Correct executable is dist/src/cli/recover.js
    executable = os.path.join(cascade_dir, "dist", "src", "cli", "recover.js")
    if not os.path.exists(executable):
        raise ValueError(f"Executable not found: {executable}. Run `npm run build` in cascade first.")

    # Locate bot environment credentials safely
    env = os.environ.copy()
    candidate_env_paths = [
        os.path.join(cascade_dir, ".env"),
        os.path.join(cascade_dir, "..", "scratch", "cascade_bot.env"),
        os.path.expanduser(r"~\\.gemini\\antigravity\\brain\\daa0fcbc-fb1c-49e9-be8f-d1318fd7eac4\\scratch\\cascade_bot.env"),
    ]
    for env_path in candidate_env_paths:
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip(\'"\').strip("\'")
            break

    cmd = ["node", "dist/src/cli/recover.js", "--approval-msg", approval_message_id, "--output-dir", norm_output]
    proc = subprocess.run(
        cmd,
        cwd=cascade_dir,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30
    )

    # Finding 1: Verify subprocess exit codes and propagate failures fail-closed
    if proc.returncode != 0:
        error_msg = proc.stderr.strip() or proc.stdout.strip() or f"Process exited with code {proc.returncode}"
        raise ValueError(f"CASCADE recovery execution failed (exit code {proc.returncode}): {error_msg}")

    return {
        "engine": "CASCADE Commitment Recovery Engine v0.1.0",
        "command": f"node dist/src/cli/recover.js --approval-msg {approval_message_id} --output-dir {norm_output}",
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "success": True,
    }
'''

def find_target_definitions():
    targets = []
    # Explicit custom path
    if "SWITCH_DEFINITIONS_PATH" in os.environ:
        p = os.environ["SWITCH_DEFINITIONS_PATH"]
        if os.path.exists(p):
            targets.append(p)

    # Known Switch server locations on Windows
    appdata = os.environ.get("APPDATA", "")
    localappdata = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(appdata, r"switchdash\local-switch-server\native\switch-core\0.31.0\src\core\switch_core\bridges\agent\operations\definitions.py"),
        os.path.join(localappdata, r"Programs\Switch Console\resources\local-server\switch\src\core\switch_core\bridges\agent\operations\definitions.py"),
    ]
    # Wildcard search under switchdash
    if appdata:
        pattern = os.path.join(appdata, "switchdash", "**", "operations", "definitions.py")
        for match in glob.glob(pattern, recursive=True):
            if match not in candidates:
                candidates.append(match)

    for c in candidates:
        if os.path.exists(c) and c not in targets:
            targets.append(c)

    return targets

def update_definitions_file(path: str) -> bool:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # If already contains CASCADE operations, replace from the marker or first operation
    marker = "# ── CASCADE Deterministic Operations"
    if marker in content:
        idx = content.find(marker)
        base = content[:idx].rstrip()
    elif "@operation\nasync def cascade_evaluate_recovery" in content or "@operation\ndef cascade_execute_recovery" in content:
        # Find earliest cascade operation
        idx1 = content.find("cascade_evaluate_recovery")
        idx2 = content.find("cascade_execute_recovery")
        earliest = min(i for i in (idx1, idx2) if i != -1)
        # backtrack to @operation
        op_idx = content.rfind("@operation", 0, earliest)
        base = content[:op_idx].rstrip()
    else:
        base = content.rstrip()

    new_content = base + "\n" + OPERATIONS_CODE + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"[OK] Successfully updated: {path}")
    return True

def update_acp_schemas():
    """Ensure Antigravity ACP brain schemas match the operations."""
    userprofile = os.path.expanduser("~")
    brain_root = os.path.join(userprofile, ".local", "state", "switch", "antigravity-acp", "antigravity-acp", "brain")
    if not os.path.exists(brain_root):
        print(f"[INFO] ACP state brain root not found at {brain_root}; skipping schema sync.")
        return

    import json
    execute_schema = {
        "name": "cascade_execute_recovery",
        "description": "Execute CASCADE's deterministic recovery execution CLI on a verified human approval message.",
        "parameters": {
            "properties": {
                "approval_message_id": {
                    "title": "Approval Message Id",
                    "type": "string"
                },
                "output_dir": {
                    "default": "artifacts/event-430-recovery-live",
                    "title": "Output Dir",
                    "type": "string"
                }
            },
            "required": ["approval_message_id"],
            "type": "object"
        }
    }
    evaluate_schema = {
        "name": "cascade_evaluate_recovery",
        "description": "Execute CASCADE's deterministic recovery evaluation CLI on fixtures/recovery-plans.json.",
        "parameters": {
            "properties": {
                "mode": {
                    "default": "demo",
                    "title": "Mode",
                    "type": "string"
                }
            },
            "type": "object"
        }
    }

    count = 0
    for entry in os.listdir(brain_root):
        switch_mcp_dir = os.path.join(brain_root, entry, "mcp", "switch")
        if os.path.exists(switch_mcp_dir):
            with open(os.path.join(switch_mcp_dir, "cascade_execute_recovery.json"), "w", encoding="utf-8") as f:
                json.dump(execute_schema, f, indent=2)
            with open(os.path.join(switch_mcp_dir, "cascade_evaluate_recovery.json"), "w", encoding="utf-8") as f:
                json.dump(evaluate_schema, f, indent=2)
            count += 1
    if count:
        print(f"[OK] Synced ACP tool schemas across {count} brain profile(s).")

def main():
    print("CASCADE -- Switch Native Operations Setup")
    targets = find_target_definitions()
    if not targets:
        print("[ERROR] No Switch Core definitions.py files found. Set SWITCH_DEFINITIONS_PATH environment variable.")
        sys.exit(1)

    for target in targets:
        update_definitions_file(target)

    update_acp_schemas()
    print("Setup completed successfully.")

if __name__ == "__main__":
    main()
