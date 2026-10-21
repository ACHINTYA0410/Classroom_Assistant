# Current learning-support schema

The complete domain/table overview is in [PROJECT_DETAILS.md](PROJECT_DETAILS.md). This file records the learning-support schema and permission contract; it is not a rollout history.

## Tables and fields

| Table | Fields / constraints |
|---|---|
| session_progress | Existing student/session unique key. completed_via: lesson_flow or calendar_test_shortcut (default lesson_flow); active_updated_at: server heartbeat/time budget. Raw browser writes revoked. |
| break_records | student_id backfilled from owned progress; allowed_seconds 300–600 and divisible by 30; ended_reason resumed_early / timeout / expired_while_away; agent_decision_id FK; activities JSON array of id/seconds. Existing break_start, break_end, duration_seconds retained. Partial unique index: one row with break_end IS NULL per student. |
| attention_events | UUID id; student/session/section FKs; trigger_reason; question_type; question_payload; server shown_at/answered_at; response, is_correct, response_time_seconds; nullable outcome until answered/skipped. Own-row SELECT/INSERT/UPDATE RLS policies. Direct writes revoked; owned backend/RPC writes only. |
| attention_section_visits | UUID visit ID; student/session/section FKs; server-capped visible_seconds; continuous_seconds and last_break_at; finished; server started_at/updated_at. Own-row SELECT RLS; backend service-role writes only. |

`attention_events.signals_snapshot` stores the Teaching Agent's bounded evidence for an optional support decision. It is not an attention diagnosis. `attention_context` and `offer_attention` are service-only SECURITY INVOKER functions, with fixed search paths; the backend supplies the verified JWT identity. Offer creation rechecks break/quiz/real-session eligibility, deduplicates outstanding events, and enforces cooldowns and prompt limits. Answer keys are removed from API responses.
| session_responses | SQL-owned attempts, wrong_attempts, selected_answer; answer_revealed (default false), attempts_before_reveal, revealed_at. Unique student/section preserved. Revealed answers never independently correct. |
| session_sections | worked_explanation: optional stored deterministic solution; otherwise actual addition operands generate column/carry steps in SQL. |
| agent_decisions | Backend-only; allowance decision inserted atomically with its break and linked by FK. Graph records support actions; lazy expiry records its deterministic decision in SQL. |
| profiles.streak_days | Deprecated. Retained without dropping or erasing existing values; no UI/client/service reads it. |

## Permissions and deterministic rules

All existing RLS remains enabled; attention_events has own-row RLS. No student may forge break allowances or activity duration, assessment scores, mastery, generated report stats or completion provenance through direct table writes.

Student-executable RPCs are bound to auth.uid(): learning_progress, learning_break_status, check_learning_available, end_learning_break, save_break_activities, practice_state, reveal_practice_answer, answer_attention and assessment RPCs. Fixed search paths and ownership checks protect SECURITY DEFINER functions.

begin_learning_break, show_attention and calendar_test_complete are service-role-only entry points. FastAPI binds the verified JWT student identity; calendar completion also requires ENABLE_TEST_TOOLS=true on the server (default false). The public generic orchestrator cannot bypass this flag.

Internal allowance, expiry, availability, mastery and legacy assessment implementations are not executable by student/browser roles. increment_break_count is deprecated and revoked; a real break increments the count once at creation. Retries do not double count.

The new forward migration is [20261012000000_learning_support.sql](../supabase/migrations/20261012000000_learning_support.sql). Apply it after the authoritative-agent migration, once, through migration tooling. Do not replay baseline seeds. Duplicate historical open breaks must be reconciled deliberately before applying the partial unique index; the migration aborts rather than choosing a row or deleting data silently.

Break time and offline time are not added to total_active_seconds. Server elapsed-budget caps protect updates; restarting a lesson resets the current time budget without resetting accumulated active time. Reviewing a real completed lesson preserves its completion/gating state and still supports breaks.

Shortcut completions have no fabricated practice or active time. Their raw pre-existing records remain stored, but practice, break, attention and practice-only mastery inputs are excluded from analytics; real submitted quiz assessments are still real assessment evidence. Mastery is recomputed after shortcut completion and before quiz selection/report generation.

## New backend routes

All paths below have the /api/v1 prefix and require Bearer authentication.

| Method / path | Purpose |
|---|---|
| GET /breaks/status | Restore open break, server time, recent ending; lazily expire overdue breaks |
| POST /breaks/request | Teaching Agent creates/reuses a break for progress_id |
| POST /breaks/resume | End break with owned break_id, activity durations and optional timeout hint |
| POST /breaks/activities | Persist bounded local activity durations |
| POST /learning/session | Create/restore/flush/complete the owned session |
| GET /practice/state/{section_id} | Restore authoritative attempts/reveal state |
| POST /practice/reveal | Reveal only after at least two saved wrong attempts |
| POST /attention/check | Bounded live section snapshot; Teaching Agent returns continue, check_in, hint, break_offer or restore, optionally with a recorded activity |
| POST /attention/show | Retired; returns 409 instructing callers to use the live check endpoint |
| POST /attention/answer | Record/grade an answer or skip |
| GET /test-tools | Read the server flag |
| POST /test-tools/complete | Flagged, service-owned calendar completion |

New events use the existing orchestrator graph and Teaching Agent. Quiz selection uses real reveal/repeated-wrong topics via recomputed weak mastery and exposes support_topics in the saved adaptive plan. The quiz_timing function/formula is unchanged.

Reports persist engagement_and_support: break count, open count, total seconds and average closed-break duration, end reasons and activities; prompt shown/answer/skip counts, response rate and accuracy; reveal and wrong-attempt counts, plus linked allowance decision summaries. Report generation validates narrative numbers against that snapshot.
