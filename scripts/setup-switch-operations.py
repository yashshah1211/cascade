#!/usr/bin/env python3
"""
CASCADE Switch Native Operations Setup Script
Registers and manages deterministic CASCADE recovery operations in Switch Core.

Safety Features (Mission 02F):
- Requires an explicitly selected target Switch installation (--target <path> or SWITCH_DEFINITIONS_PATH).
- Backs up the original definitions.py before modification (.bak).
- Replaces only the marked CASCADE block without deleting unrelated code after it.
- Supports repeated setup without duplicate registrations.
- Supports dry run (--dry-run) and safe rollback (--rollback).
- No hardcoded machine-specific credential paths; uses dynamic path resolution and environment variables.
- Never prints authentication secrets or tokens.
"""

import argparse
import glob
import os
import re
import shutil
import sys

START_MARKER = "# ── CASCADE Deterministic Operations (Flip the Switch 2026) ──"
END_MARKER = "# ── END CASCADE Deterministic Operations ──"

OPERATIONS_TEMPLATE = f"""{START_MARKER}

@operation
async def cascade_evaluate_recovery(mode: str = "demo") -> dict[str, Any]:
    \"\"\"Execute CASCADE's deterministic recovery evaluation CLI on fixtures/recovery-plans.json.

    Args:
        mode: Evaluation mode to run ('demo' for human-readable breakdown, 'inspect' for full JSON analysis). Defaults to 'demo'.

    Returns:
        Dict containing command, stdout, stderr, and exit_code from the deterministic recovery CLI.
    \"\"\"
    import os
    import subprocess

    cascade_dir = os.environ.get("CASCADE_REPO_DIR")
    if not cascade_dir:
        candidate_paths = [
            os.path.abspath(os.getcwd()),
            os.path.join(os.path.abspath(os.getcwd()), "cascade"),
            os.path.expanduser(r"~/Downloads/CASCADE_Day1_MVP_2026-11-04/cascade"),
        ]
        for c in candidate_paths:
            if os.path.exists(os.path.join(c, "dist", "src", "cli", "main.js")):
                cascade_dir = c
                break
        if not cascade_dir:
            cascade_dir = candidate_paths[0]

    arg = "inspect" if mode == "inspect" else "demo"
    cmd = ["node", "dist/src/cli/main.js", arg]
    proc = subprocess.run(
        cmd,
        cwd=cascade_dir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15,
    )
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip()
        raise ValueError(f"CASCADE evaluation failed (exit code {{proc.returncode}}): {{err}}")

    return {{
        "engine": "CASCADE Commitment Recovery Engine v0.1.0",
        "command": f"node dist/src/cli/main.js {{arg}}",
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "success": True,
    }}


@operation
def cascade_execute_recovery(
    approval_message_id: str,
    output_dir: str = "artifacts/event-430-recovery-live"
) -> dict[str, Any]:
    \"\"\"Execute CASCADE's deterministic recovery execution CLI on a verified human approval message.

    Args:
        approval_message_id: The 26-character Mattermost post ID containing the human approval command.
        output_dir: Approved artifact output directory. Must be 'artifacts/event-430-recovery-live'.

    Returns:
        Dict containing command, stdout, stderr, exit_code, and success status.
    \"\"\"
    import os
    import re
    import subprocess

    # Constrain tool inputs to designated approval ID format and approved directory
    if not isinstance(approval_message_id, str) or not re.fullmatch(r"[a-z0-9]{{26}}", approval_message_id):
        raise ValueError(
            f"Invalid approval_message_id: {{approval_message_id!r}}. Expected 26-char alphanumeric post ID."
        )

    approved_dir = "artifacts/event-430-recovery-live"
    if not isinstance(output_dir, str):
        raise ValueError(f"Invalid output_dir type: {{type(output_dir).__name__}}.")
    norm_output = os.path.normpath(output_dir).replace("\\\\", "/")
    if norm_output != approved_dir and norm_output != "artifacts/event-430-recovery-live":
        raise ValueError(
            f"Invalid output_dir: {{output_dir!r}}. Must target approved artifact directory: {{approved_dir}}"
        )
    if ".." in norm_output:
        raise ValueError(f"Invalid output_dir: Directory traversal prohibited in {{output_dir!r}}.")

    cascade_dir = os.environ.get("CASCADE_REPO_DIR")
    if not cascade_dir:
        candidate_paths = [
            os.path.abspath(os.getcwd()),
            os.path.join(os.path.abspath(os.getcwd()), "cascade"),
            os.path.expanduser(r"~/Downloads/CASCADE_Day1_MVP_2026-11-04/cascade"),
        ]
        for c in candidate_paths:
            if os.path.exists(os.path.join(c, "dist", "src", "cli", "recover.js")):
                cascade_dir = c
                break
        if not cascade_dir:
            cascade_dir = candidate_paths[0]

    executable = os.path.join(cascade_dir, "dist", "src", "cli", "recover.js")
    if not os.path.exists(executable):
        raise ValueError(f"Executable not found: {{executable}}. Run `npm run build` in cascade first.")

    # Locate bot environment credentials safely without hardcoding machine secrets
    env = os.environ.copy()
    candidate_env_paths = [
        os.environ.get("CASCADE_BOT_ENV", ""),
        os.environ.get("MATTERMOST_ENV_FILE", ""),
        os.path.join(cascade_dir, ".env"),
        os.path.join(cascade_dir, "config", "bot.env"),
        os.path.join(cascade_dir, "..", "scratch", "cascade_bot.env"),
    ]
    for env_path in candidate_env_paths:
        if env_path and os.path.exists(env_path):
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

    if proc.returncode != 0:
        error_msg = proc.stderr.strip() or proc.stdout.strip() or f"Process exited with code {{proc.returncode}}"
        raise ValueError(f"CASCADE recovery execution failed (exit code {{proc.returncode}}): {{error_msg}}")

    return {{
        "engine": "CASCADE Commitment Recovery Engine v0.1.0",
        "command": f"node dist/src/cli/recover.js --approval-msg {{approval_message_id}} --output-dir {{norm_output}}",
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "success": True,
    }}
{END_MARKER}"""


def discover_candidate_installations():
    """Discover potential Switch definitions.py paths on the current system."""
    candidates = []
    appdata = os.environ.get("APPDATA", "")
    localappdata = os.environ.get("LOCALAPPDATA", "")

    if appdata:
        candidates.append(
            os.path.join(appdata, r"switchdash\local-switch-server\native\switch-core\0.31.0\src\core\switch_core\bridges\agent\operations\definitions.py")
        )
        pattern = os.path.join(appdata, "switchdash", "**", "operations", "definitions.py")
        for match in glob.glob(pattern, recursive=True):
            if match not in candidates:
                candidates.append(match)

    if localappdata:
        candidates.append(
            os.path.join(localappdata, r"Programs\Switch Console\resources\local-server\switch\src\core\switch_core\bridges\agent\operations\definitions.py")
        )

    return [c for c in candidates if os.path.exists(c)]


def _find_bounded_cascade_block(content: str) -> tuple[int, int] | None:
    """Return exact CASCADE marker bounds; reject unsafe legacy or malformed blocks."""
    start_count = content.count(START_MARKER)
    end_count = content.count(END_MARKER)
    if start_count == 1 and end_count == 1:
        start = content.find(START_MARKER)
        end = content.find(END_MARKER)
        if end < start:
            raise ValueError("CASCADE end marker precedes its start marker; refusing to edit.")
        return start, end + len(END_MARKER)

    if start_count or end_count:
        raise ValueError(
            "Unbounded or duplicated CASCADE markers; refusing to edit. "
            "Migrate the legacy installation manually after inspecting surrounding code."
        )

    legacy_marker = "# ── CASCADE Deterministic Operations"
    legacy_functions = re.search(
        r"(?m)^[ \t]*(?:async[ \t]+)?def[ \t]+cascade_(?:evaluate|execute)_recovery[ \t]*\(",
        content,
    )
    if legacy_marker in content or legacy_functions:
        raise ValueError(
            "Legacy CASCADE operations have no complete markers; refusing to edit. "
            "Migrate the legacy installation manually to preserve unrelated code."
        )

    return None


def replace_marked_block(content: str, new_block: str) -> tuple[str, bool]:
    """Replace only a fully bounded block, preserving every unrelated character."""
    bounds = _find_bounded_cascade_block(content)
    if bounds is not None:
        start, end = bounds
        return content[:start] + new_block.strip() + content[end:], True
    return content.rstrip() + "\n\n" + new_block.strip() + "\n", False


def remove_marked_block(content: str) -> tuple[str, bool]:
    """Rollback only the current CASCADE block, retaining later vendor edits."""
    bounds = _find_bounded_cascade_block(content)
    if bounds is None:
        return content, False
    start, end = bounds
    return content[:start] + content[end:], True


def update_acp_schemas(dry_run: bool = False):
    """Sync tool schemas to local Antigravity ACP brain directory if present."""
    import json
    userprofile = os.path.expanduser("~")
    brain_root = os.path.join(userprofile, ".local", "state", "switch", "antigravity-acp", "antigravity-acp", "brain")
    if not os.path.exists(brain_root):
        return 0

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
            if not dry_run:
                with open(os.path.join(switch_mcp_dir, "cascade_execute_recovery.json"), "w", encoding="utf-8") as f:
                    json.dump(execute_schema, f, indent=2)
                with open(os.path.join(switch_mcp_dir, "cascade_evaluate_recovery.json"), "w", encoding="utf-8") as f:
                    json.dump(evaluate_schema, f, indent=2)
            count += 1
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Safe CASCADE Switch Native Operations Setup and Rollback Utility"
    )
    parser.add_argument(
        "-t", "--target", "--definitions-path",
        dest="target",
        help="Explicit path to the target definitions.py file to configure or rollback.",
        default=os.environ.get("SWITCH_DEFINITIONS_PATH")
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate the setup or rollback without modifying any files on disk."
    )
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="Roll back previous CASCADE operations from the target file or restore from .bak."
    )

    args = parser.parse_args(argv)

    target_path = args.target
    if not target_path:
        discovered = discover_candidate_installations()
        print("[ERROR] No target Switch definitions.py file explicitly selected.")
        if discovered:
            print("Discovered candidate installations on this machine:")
            for idx, c in enumerate(discovered, 1):
                print(f"  {idx}. {c}")
            print("\nPlease re-run specifying one target using --target <path> (or set SWITCH_DEFINITIONS_PATH).")
        else:
            print("No candidate Switch installations were automatically discovered.")
            print("Please specify the exact path using --target <path>.")
        return 1

    if not os.path.exists(target_path):
        print(f"[ERROR] Target definitions.py file not found: {target_path}")
        return 1

    backup_path = target_path + ".bak"

    with open(target_path, "r", encoding="utf-8") as f:
        original_content = f.read()

    if args.rollback:
        try:
            cleaned_content, removed = remove_marked_block(original_content)
        except ValueError as exc:
            print(f"[ERROR] {exc}")
            return 1

        if args.dry_run:
            if removed:
                print(f"[DRY-RUN] Would remove only the bounded CASCADE block from: {target_path}")
            else:
                print(f"[DRY-RUN] No bounded CASCADE block found in: {target_path}")
            return 0

        if not removed:
            print(f"[INFO] No CASCADE operations block found in: {target_path}")
            return 0

        # Never restore an old .bak over newer, unrelated vendor modifications.
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(cleaned_content)
        print(f"[ROLLBACK] Removed only the bounded CASCADE block from: {target_path}")
        print(f"[INFO] Existing backup, if any, preserved at: {backup_path}")
        return 0

    # Normal setup / update
    try:
        updated_content, was_replaced = replace_marked_block(original_content, OPERATIONS_TEMPLATE)
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1

    if args.dry_run:
        action = "update existing marked block in" if was_replaced else "append marked block to"
        print(f"[DRY-RUN] Would {action}: {target_path}")
        print(f"[DRY-RUN] Backup would be written to: {backup_path}")
        schema_count = update_acp_schemas(dry_run=True)
        if schema_count:
            print(f"[DRY-RUN] Would sync ACP tool schemas across {schema_count} brain profile(s).")
        return 0

    # Create backup before modification
    if not os.path.exists(backup_path):
        shutil.copy2(target_path, backup_path)
        print(f"[BACKUP] Created backup: {backup_path}")
    else:
        print(f"[INFO] Existing backup preserved: {backup_path}")

    with open(target_path, "w", encoding="utf-8") as f:
        f.write(updated_content)

    action_label = "Updated" if was_replaced else "Added"
    print(f"[OK] {action_label} CASCADE operations in: {target_path}")

    schema_count = update_acp_schemas(dry_run=False)
    if schema_count:
        print(f"[OK] Synced ACP tool schemas across {schema_count} brain profile(s).")

    print("[SUCCESS] Setup completed safely.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
