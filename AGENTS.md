<!-- opencode-native-tools:start -->
Use the `opencode_native_tools` MCP server for `read`, `glob`, and `grep` when inspecting the project.
Use Codex native file-editing tools for `write`, `edit`, and `apply_patch` so Codex can display the file modification diff.
Use the MCP `bash`, `webfetch`, `websearch`, `skill`, and `todowrite` tools when appropriate.

For every file modification, call the native `apply_patch` tool directly. Do not invoke `apply_patch` through `bash`, PowerShell, Node.js, Python, scripts, subprocesses, or `codex.exe`; those paths do not provide the required visible file-change record.
If direct native `apply_patch` is unavailable or fails, do not write or edit files by any alternative path. Stop, report the missing capability to the user, and wait for the native visible editing path to be restored.
<!-- opencode-native-tools:end -->
