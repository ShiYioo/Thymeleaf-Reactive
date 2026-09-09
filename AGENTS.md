# Agent / contributor guardrails

## Test execution safety (MANDATORY - read before running any test)

This runtime manipulates scheduling and flush queues. Experimental changes
in ref/flush/scheduler code have repeatedly produced infinite update loops
that grow node memory without limit (observed: a single node process
reaching 32 GB and freezing the developer machine).

Mandatory guards for ANY test run (`npm test`, `node --test`):

1. Per-test timeout: always pass `--test-timeout=10000` (a spinning test
   dies after 10 s instead of running for minutes).
2. Whole-run OS timeout: prefix the command with `timeout 120`
   (Git Bash / GNU coreutils `timeout`).
3. Memory cap: `node --max-old-space-size=1024 --test ...` (the npm
   `test` script already includes these flags - use `npm test`).
4. When working on scheduler / ref / flush / post-flush code: run ONLY the
   single relevant test first, with an OS-level hard timeout:
   `timeout 30 node --test --test-timeout=8000 -t "test name"`.
   Never iterate the full suite against a hanging build.
5. If a run hangs, times out, or exceeds the memory cap:
   `git checkout -- <changed files>` immediately and stop. Do not apply
   "one more fix" on top of a hanging build - revert first, rethink, then
   retry under the same guards.
6. After every test run: confirm no leftover processes
   (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` on Windows).
7. Long-running dev servers (example app) must be started and stopped
   within the same command; never leave detached servers behind.
