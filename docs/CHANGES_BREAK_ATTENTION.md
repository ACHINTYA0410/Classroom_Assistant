# Break and attention update: audit and verification

## Baseline audit (reproduced before implementation)

Command: `npm.cmd run test:browser -- --grep 'baseline break defect'`.
Result: 1 passed. This reproduction asserted the broken behavior: after Break Mode, the question input remained visible and Next remained enabled; after refresh, Break Mode was enabled rather than an open-break screen.

Root causes verified in source:
- SessionContext pauses only its local timer, never blocks lesson controls. Break IDs/start exist only in refs and are not reloaded.
- sessionService creates and closes breaks using client time; no allowance, deadline, server-clock sync, lazy expiry or uniqueness rule exists.
- Direct owned progress writes and practice/start RPCs have no open-break guard.
- Attention is an unrecorded full-screen page triggered every 480 active seconds, even away from section boundaries.
- Every section advance and break resume renders LearningTransition.
- Practice attempts are supplied by the client; reveal metadata is absent.
- Quiz summary links to the removed gamification destination rather than its own report.

## Implementation plan

1. Add forward migration: server-owned break lifecycle/locks, authoritative practice attempts/reveal, attention recording, flagged test completion and analytics exclusions.
2. Extend the existing orchestrator/Teaching Agent for deterministic support decisions and audited learning operations.
3. Replace transient break refs with restored server state, an accessible calm screen and local activities.
4. Replace per-step animation/full-screen attention with a configurable deterministic boundary modal.
5. Add practice reveal, quiz celebration/report targeting and server-flagged calendar completion; remove obsolete gamification.
6. Run SQL, backend, policy, browser, build and security checks; record real results and explicit gaps.

Reuse: existing stack, Supabase RLS, lesson content, authenticated API client, graph audit, SQL quiz timer and report grounding. No adaptive quiz timer change. No new external animation asset; shapes are authored directly in React/Framer Motion.

## Implemented design and exact rules

Reuse: existing authenticated client, Supabase/RLS, curriculum, LangGraph, Teaching/Quiz/Report agents, Framer Motion, quiz gating/scoring/timer and deterministic report grounding. No LLM computes a time, answer, score or eligibility rule.

### Break allowance: single SQL source of truth

`break_allowance(signals)` starts at 300 seconds. Add the following, then clamp to 600; every contribution is a multiple of 30.

| Recorded signal | Added seconds |
|---|---|
| Wrong attempts in the current real session | 30 each, capped at four attempts (+120) |
| Reveals in that session | 30 each, capped at two (+60) |
| Accuracy over last ten real practice responses | Below 60%: +60; 60% to below 85%: +30; otherwise/unknown: +0 |
| Wrong/skipped attention prompts in the current session | 30 each, capped at three (+90) |
| Active time since the latest break in this session (or start) | At least 600s: +30; at least 1200s: +60 |
| Total active session time | At least 1800s: +30 |
| Breaks already started today | 30 each, capped at three (+90); database UTC day |

The Teaching Agent requests the owned service-only RPC. SQL reads recorded signals, stores the input/allowance/reasoning decision atomically, links it to the break and increments break_count exactly once. Bounds are database constraints. The graph audits the request/action as well. Server locks and the partial unique index serialize break/progress operations.

Server time + break_start controls elapsed/deadline; the browser projects it using a monotonic clock. Early closure records resumed_early; a foreground deadline closure records timeout; a returning student is lazily closed exactly at the deadline with expired_while_away. Active progress uses a server elapsed budget, resets on restoration/resume and rejects writes during an open break.

Local activities: gentle breathing, keyboard/pointer doodling, calm bubble taps, stretch cards and curated riddles/facts. There is no external activity content or autoplay sound. User-selected activity durations are bounded by server break duration, not inferred as clinical wellbeing evidence.

### Attention, practice, quiz and analytics

The live frequency policy is owned by the Teaching Agent in `backend/app/services/attention.py`. `src/hooks/useAttentionSupport.ts` sends section observations every 15 seconds without waiting for Next. Timing combines a personal median of comparable completed sections (or a cold-start reading allowance), meaningful inactivity, recent practice difficulty, continuous visible learning and previous check-in responses. Time alone never triggers a prompt. The database caps observed elapsed time, excludes testing provenance, deduplicates pending offers, and enforces two-minute answer/four-minute skip cooldowns, three prompts per session and eight per rolling day. Typing, narration, provider waiting, hidden tabs, breaks and other popups suppress interruption; timed quizzes do not run the hook.

Current activities use lesson-related deterministic build-a-ten, place-value, addition and subtraction templates, plus an optional reset offer. Stored answers are checked in SQL; client payloads cannot supply the grading answer. The Quick number adventure dialog supports Answer, Keep learning, Take a break and Escape, traps focus, preserves the section and respects reduced motion. There are no points, rewards, LLM calls or automatic sound. Settings lets each student disable check-ins on the device.

Practice attempts are counted in SQL; reveal appears after two saved wrong responses. The stored explanation or actual addition operands produce worked steps. Reveal persists across reload and never counts as independently correct. Reveals/repeated wrong attempts weaken topic mastery and feed quiz support_topics; the existing adaptive timer formula is unchanged.

fullMarks comes from saved server grading. The local celebration lasts 2.5 seconds, is skippable and becomes static under either reduce-motion preference. Every result links its exact attempt to Reports. Pending generation has polling (2s intervals, 60s timeout) and Retry, with no unrelated report substituted.

Calendar completion is a service-only, backend-flagged action. completed_via distinguishes test shortcuts; real practice/active/break/attention/mastery inputs exclude shortcuts, while genuine quiz answers remain real assessment evidence. Existing completed real sessions are not relabelled by retrying the tool. Reports expose engagement_and_support with durations/end reasons, activity totals, attention response/accuracy and reveals; average duration uses closed breaks only.

Removed: full-screen attention route/mock questions, per-step transition component/assets/generator, gamification page/navigation/client profile reads, and now-unused Lottie packages. The database profile column is retained as deprecated. Original local visual shapes and their CC0 source/license are recorded in the README and component license.

## Boundary interpretation

“Between sessions” means Next boundaries between sections within a lesson. Daily boundaries are not separately prompted. A modal closes onto the same section; advancing requires Next again. Never first/last, practice, break or timed quiz.

## Verification

Completed locally on 2026-10-12. Synthetic fixtures are not proof of hosted Auth/PostgREST end-to-end behavior.

| Command (repository root unless noted) | Actual final result |
|---|---|
| `npm.cmd run test:support` | 110 isolated SQL/RLS checks; 18 attention-policy checks passed |
| `npm.cmd run test:db` | 37 PostgreSQL/pgvector regression checks passed |
| Backend directory: `.\\.venv\\Scripts\\python.exe -m pytest -q` | 77 passed, 1 skipped; optional live Gemini test not enabled |
| `npm.cmd run test:browser` | 16 passed using synthetic authenticated network fixtures |
| `npm.cmd run build` | TypeScript and production build passed; bundle-size warning remains (1,021.56 kB minified JS) |
| `npm.cmd run lint` | Exit 0; 14 React hooks/purity/Fast Refresh warnings remain, not a warning-free run |
| Backend directory: `.\\.venv\\Scripts\\python.exe scripts/smoke_server.py` | Real temporary Uvicorn: health 200; missing/invalid tokens 401; process stopped |
| Backend directory: `.\\.venv\\Scripts\\python.exe scripts/security_check.py` | No secret matches; history/frontend env clean; both private env files ignored |
| `git diff --check` | No whitespace errors |
| `rg -n -i 'streak|badge|StreaksBadges' src backend/app docs README.md package.json` | Only required deprecated schema-column documentation remains |

### What was actually exercised

SQL tests verify bounded/quantized monotonic allowances, fresh 300 seconds and stressed 600 seconds, unique open breaks, cross-student restrictions, direct progress/practice/completion/quiz guards, exact server deadline and lazy expiry, early/foreground closure, activity bounds, accurate break count and active-time exclusion. They verify two real saved wrong attempts (ignoring client-supplied attempts), worked regrouping from 58 + 36 = 94, persisted reveal metadata, weak mastery/support-topic selection, authoritative perfect/non-perfect scoring, shortcut provenance/exclusions and unchanged six-session quiz unlock.

Backend tests additionally exercise authenticated FastAPI -> graph -> Teaching Agent -> isolated SQL via HTTP, service-only identity binding, default-off test flag, audited support events, deterministic question templates and grounded report statistics.

Browser tests exercise five activities, refresh and tab-close recovery, automatic deadline return, disabled lesson/quiz navigation, immediate section movement, occasional boundary prompts, answer/skip/Escape/focus trap and focus return, reveal/reload/continuation, perfect/non-perfect quiz results, exact-attempt report loading/polling/retry, all-six shortcut unlock and flag-off UI. In-app and OS reduced motion are covered. Deadline tests advance synthetic server time rather than waiting five minutes.

Visual review: inspected generated break-screen and attention-popup screenshots. The break screen exposes elapsed/remaining time and five activity choices with lesson controls hidden. The attention dialog has prominent 48-pixel number tiles, visible Answer/Skip controls and a dimmed lesson backdrop. This is a screenshot review plus automated UI exercise, not a human hosted walkthrough.

### Explicit verification/deployment gaps

- **Hosted migration applied on 2026-10-12 after Supabase reconnection.** Project URL confirmed as `https://wgjezrniifsbephacbdc.supabase.co`. Migration history now includes `20261012131501_learning_support`. Existing student rows were retained; new fields were added/backfilled by the reviewed forward migration.
- Hosted preflight confirmed prerequisite functions present, zero duplicate open-break groups, zero orphan breaks and no partially applied new fields. Applied [20261012000000_learning_support.sql](../supabase/migrations/20261012000000_learning_support.sql) once through migration tooling. Local and hosted timestamps differ; reconcile by migration name/history rather than replaying seeds or blindly bulk-pushing.
- Hosted REST checks for `session_progress.completed_via`, `break_records.allowed_seconds` and `attention_events` returned HTTP 200. The already-running local backend `/api/v1/ready` changed from 503 to HTTP 200 with status `ready`; no backend restart or credential replacement was needed.
- Hosted authenticated-role SQL (transaction rolled back) verified `learning_break_status` and `check_learning_available`. Permission checks verified attention RLS/read access, no direct attention/progress writes, no student allowance/shortcut service-RPC access, and fresh/stressed allowance values 300/600. Real browser login, full end-to-end report persistence, actual five-to-ten-minute wall-clock expiry and a human full-session walkthrough remain unverified. No isolated hosted test project or deployed app URLs were supplied.
- Live paid-provider calls, mobile/touch assistive-technology testing and simultaneous multi-device browser operation were not exercised.
- Activity snapshots persist roughly every ten visible activity seconds and on page-hide with keepalive; a killed browser or lost network can lose the last unsent activity snapshot. The server break deadline/count still persists.
- Calendar testing remains default-off. Enabling it requires backend `ENABLE_TEST_TOOLS=true` and a backend restart; do not enable it on a normal production learning deployment.

## Hosted security review

The Supabase skill guided explicit grant/RLS checks and a read-only preflight before deployment. Post-migration advisors were reviewed. The new table has RLS and own-row policies; all new privileged functions have fixed search paths and explicit role grants. Student-callable SECURITY DEFINER RPCs are intentional owned operations, not unrestricted admin APIs ([advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).

Pre-existing notices remain: backend-only agent_decisions has RLS with no student policies ([guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)); legacy match_curriculum_embeddings has a mutable search path ([guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)); vector remains in public ([guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)); leaked-password protection is disabled ([guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). These unrelated schema/auth-setting changes were not bundled into the connection fix.

## Math Agent availability correction

A later live reproduction of "Can you do 99+90" retrieved four curriculum chunks but Gemini returned 503 high demand; subsequent requests also returned provider 504/timeouts. The old shared fallback incorrectly described these failures as insufficient lesson information.

The direct-calculation shortcut was removed at the user's request. Every doubt now uses the existing RAG pipeline: owned lesson/grade context -> query embedding -> versioned, metadata-filtered vector retrieval -> grounded Gemini generation -> graph audit -> response. Bounded same-provider generation failover, safe failure metadata and distinct retrieval/generation outage messages are retained. No credential change, quota bypass or local arithmetic answer is used.

The bypass-only arithmetic module/tests were deleted (recoverable in Git). New authenticated API tests require embedding and match_curriculum for arithmetic and conceptual questions, verify grade/topic/chapter/model/dimension filters and generated-answer context, and require honest fallback with no locally calculated answer on empty retrieval or provider failure. Provider failure/failover tests use simulated 503/timeouts; successful live Gemini generation remains unverified during its outage. The newer Interactions interface was diagnosed but also timed out and was not substituted into production.

After restoring mandatory RAG, the final backend suite passed 104 tests with one optional live-agent test skipped. The backend was restarted to load the restored pipeline. Frontend HEAD returned 200; backend health returned 200/ok and readiness returned 200/ready. These startup checks are separate from successful live provider-generation verification.

## Working-tree safety

The checkout contains pre-existing changes and deletions. They are preserved. Feature-owned files/hunks are committed by concern; earlier README/document cleanup, report-storage privilege fixes and readiness changes are not swept into unrelated feature commits.
