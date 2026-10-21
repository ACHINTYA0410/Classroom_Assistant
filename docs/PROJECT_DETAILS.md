# Classroom Assistant: project design and operation

This document describes the current application, its components, APIs, data ownership and request flows. It is a design reference, not an implementation history. Local start/stop commands are in [README.md](../README.md).

## 1. Purpose and components

Classroom Assistant is a primary-school mathematics learning application. Students sign in, select preferences, study curriculum sections, answer practice questions, take adaptive quizzes and view progress reports. Existing curriculum is displayed directly; AI adds grounded explanations and report wording.

The system has three runtime components:

- A React single-page application in the browser.
- A Python FastAPI backend containing a LangGraph workflow.
- Hosted Supabase, supplying Auth, PostgREST, PostgreSQL and pgvector.

Gemini is the external embedding and text-generation provider. Supabase PostgreSQL is the durable source of truth for curriculum, attempts, responses, mastery, reports and agent audit records.

## 2. Technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend runtime | React 19, React DOM | Screens, components and rendering |
| Frontend language/build | TypeScript 6, Vite 8, Node.js 24, npm | Types, development server and production bundle |
| Navigation/state | React Router 7; React Context and hooks | Routes, authentication, settings and lesson lifecycle |
| Styling | Tailwind CSS 3, PostCSS, Autoprefixer | Design tokens, responsive layout and CSS generation |
| UI libraries | Lucide React, Recharts | Icons and progress charts |
| Animation | Framer Motion; original local CC0 shapes | Attention entrance, calm breathing and quiz celebration only |
| Speech | Browser SpeechSynthesis API | User-triggered lesson narration |
| Frontend data client | Supabase JavaScript SDK; browser fetch | Auth/direct data operations and authenticated backend calls |
| Backend runtime | Python 3.14, FastAPI, Uvicorn | Typed HTTP routes and ASGI serving |
| Backend validation/config | Pydantic, pydantic-settings, python-dotenv | Request/response models and environment configuration |
| Orchestration | LangGraph StateGraph; LangChain support libraries | Route requests and coordinate agent execution |
| Backend HTTP | Async HTTPX | Supabase PostgREST/RPC and JWT key retrieval |
| Authentication | Supabase Auth, PyJWT, cryptography | Sessions, OAuth and token verification |
| Persistence | Supabase PostgreSQL, SQL/PLpgSQL, RLS | Relational records, permissions and authoritative assessment rules |
| Retrieval | pgvector, vector(768), cosine similarity | Metadata-filtered curriculum retrieval |
| AI | Official google-genai SDK | Structured Gemini text generation and embeddings |
| Quality checks | pytest, pytest-asyncio, respx; PGlite + pgvector; Playwright; Oxlint; TypeScript | Backend, SQL/RLS, browser, lint and type checks |
| Packaging | Static frontend build; backend Dockerfile | Deployment artifacts; backend container runs as a non-root user |

Exact dependency declarations are in [package.json](../package.json), the npm lockfile and [backend/requirements.txt](../backend/requirements.txt). An installed dependency is not necessarily an active service: production database access uses HTTPX/PostgREST, and this application does not configure a LangSmith tracing service, Redis, Celery or a separate vector database.

## 3. High-level design (HLD)

~~~mermaid
flowchart LR
    UI["React browser UI"]
    Auth["Supabase Auth"]
    REST["Supabase PostgREST"]
    DB[("PostgreSQL + pgvector")]
    API["FastAPI: JWT verification, validation, limits"]
    Graph["LangGraph router"]
    Teaching["Teaching Agent"]
    Quiz["Quiz Agent"]
    Report["Report Agent"]
    Progress["Mastery refresh"]
    Gemini["Gemini SDK"]
    Errors["Error normalization"]
    Audit["Service-role audit write"]
    Reply["JSON response"]

    UI <-->|"Sign-in and session"| Auth
    UI <-->|"Curriculum and profile"| REST
    REST <-->|"RLS and owned SQL RPCs"| DB
    UI -->|"Bearer JWT + JSON"| API
    API --> Graph
    Graph --> Teaching
    Graph --> Quiz
    Graph --> Report
    Teaching <-->|"Lesson retrieval and owned support RPCs"| REST
    Teaching <-->|"Embed query and generate answer"| Gemini
    Quiz <-->|"User-token assessment RPCs"| REST
    Quiz -->|"Successful quiz finish"| Progress
    Progress <-->|"User-token mastery RPC"| REST
    Progress -->|"Success"| Report
    Report <-->|"User-token reads; service-role persistence"| REST
    Report <-->|"Generate narrative"| Gemini
    Teaching --> Errors
    Quiz -->|"Other events or failure"| Errors
    Progress -->|"Failure"| Errors
    Report --> Errors
    Errors --> Audit
    Audit -->|"Service role"| REST
    Audit --> Reply
    Reply --> UI
~~~

There are two application data paths. Profile/curriculum reads and owned profile preferences go directly from the browser to Supabase. Lesson progress, breaks, attention recording, answer reveal, calendar test completion, teaching, quiz, practice grading and reports go through FastAPI. Supabase SQL RPCs can also be invoked by authenticated users directly where EXECUTE is granted; those calls enforce ownership but do not execute the FastAPI graph or its audit node.

The graph and agents live inside one backend application. They are not independently deployed microservices.

## 4. Frontend organization

| Location | Responsibility |
|---|---|
| src/main.tsx and src/App.tsx | Mount React, providers, public routes and session-protected routes |
| src/pages/ | Login, callback, onboarding, dashboard, lessons, quizzes, progress, reports, educator view and settings |
| src/components/ | Layout, sidebar, navigation and learning transitions |
| src/context/AuthContext.tsx | Current Supabase session/user, profile loading and auth-state changes |
| src/context/SettingsContext.tsx | Explanation preference and reduced-motion settings |
| src/context/SessionContext.tsx | Lesson active time, pause/resume, breaks and completion |
| src/lib/supabaseClient.ts | Supabase SDK initialized with public frontend configuration |
| src/services/auth.ts | Email signup/sign-in, Google OAuth, logout and session subscription |
| src/services/api.ts | Screen-oriented data functions and backend endpoint wrappers |
| src/services/backendClient.ts | Bearer attachment, fetch, timeout, result decoding and friendly errors |
| src/services/sessionService.ts | Authenticated backend learning-progress and break wrappers |
| src/services/voice.ts | Browser speech synthesis |
| src/components/BreakScreen.tsx | Server-restored break screen and five local activities |
| src/components/AttentionPopup.tsx | Accessible, recorded boundary modal |
| src/services/attentionPolicy.ts | Observation clock/transport guards; intervention decisions live in the Teaching Agent |
| src/hooks/useAttentionSupport.ts | Per-student, per-section live observations, periodic checks, interruption safeguards and stale-response protection |
| src/components/QuizCelebration.tsx | Skippable full-marks animation |
| src/components/ANIMATION_LICENSE.txt | Original local visual definitions, CC0 |

Supabase manages persisted auth sessions and refreshes; AuthContext subscribes to changes. Explanation preference persists in the profile. Reduced-motion preference uses localStorage and the operating system preference. The current lesson section uses sessionStorage. Lesson time is flushed periodically and on section boundaries through FastAPI to an owned SQL RPC; SQL caps increases by server elapsed active time. Break state is restored from the database on startup/focus, and its countdown uses server time plus a monotonic browser clock.

Attention uses deterministic Class 2 templates at eligible section boundaries, with events recorded and answers checked server-side. It is not an AI attention detector or a medical diagnostic agent. Educator View reads the signed-in student's data; it is not a teacher-wide authorization system.

## 5. Authentication and the normal backend round trip

1. The browser calls Supabase Auth through the SDK. Email/password and Google OAuth helpers are available; Google provider credentials and redirect URLs belong in Supabase configuration.
2. Supabase supplies a session containing an access JWT. The signup database trigger creates a profile.
3. A React screen calls a function in src/services/api.ts.
4. For an agent operation, backendRequest reads the current session and sends GET or POST to VITE_API_BASE_URL + /api/v1 + the route. Headers contain Authorization: Bearer access_token and Content-Type: application/json.
5. FastAPI adds a request ID. Its dependency verifies the JWT; Pydantic validates the path/body. Request models reject unknown fields, including a supplied student identity.
6. JWT verification checks signature, issuer, audience, expiry and required claims, requires the authenticated role and a UUID subject. ES256/RS256 use cached Supabase JWKS, refreshing on unknown signing keys. Legacy HS256 uses the configured secret or Supabase Auth verification followed by claim checks.
7. The route converts the action to a graph event. execute applies applicable per-user limits, requires audit credentials and creates a user-bound database client.
8. LangGraph chooses the Teaching, Quiz or Report Agent. The agent calls Supabase and, when needed, Gemini.
9. SQL/RLS verifies access and returns data. The agent validates/shapes its result and records a decision for auditing.
10. The graph normalizes errors and writes decisions to agent_decisions using the private service-role client.
11. FastAPI sends a typed JSON response; backendRequest extracts result and React updates the screen. Errors become safe messages and retry states.

Successful agent responses use this envelope:

~~~json
{
  "result": {},
  "request_id": "request-uuid"
}
~~~

Errors generally contain detail and request_id. X-Request-ID is also a response header; authentication/validation errors may omit the ID in the JSON body. Health and readiness return their own status objects rather than the agent envelope.

## 6. All FastAPI routes and frontend callers

Base path: /api/v1. All agent routes require the student's Bearer JWT. Health, readiness and API documentation are public.

| Method/path | Frontend caller or use | Body | Event / downstream action |
|---|---|---|---|
| GET /health | Process check | None | Reports that FastAPI is running |
| GET /ready | Deployment readiness check | None | Read-only service-client checks for configuration, schema columns, PostgREST relationships and versioned embeddings |
| POST /teaching/ask | askMathAgent, getDynamicExplanation | section_id, question, optional style | student_question; lesson context, match_curriculum, Gemini |
| POST /quiz/start | startQuizAttempt | quiz_id | quiz_started; start_quiz_attempt then get_quiz_plan |
| GET /quiz/{attempt_id} | getQuizAttemptDetails | None | quiz_loaded; get_quiz_plan |
| POST /quiz/answer | submitQuizAnswer | attempt_id, question_id, answer, time_taken_seconds | quiz_answered; submit_quiz_answer |
| POST /quiz/finish | completeQuizAttempt | attempt_id | quiz_completed; finish, mastery refresh, report |
| POST /practice/answer | recordPracticeResponse | section_id, answer, attempts, time_taken_seconds | practice_recorded; record_practice_answer, including SQL mastery refresh |
| GET /reports | getReports | None | reports_requested; owned report SELECT, newest first, maximum 100 |
| POST /reports/generate | generateReport | attempt_id | report_requested; reuse or create a completed-attempt report |
| POST /orchestrate | Alternate generic API; normal screens use specific routes | request_type and matching payload | Same compiled graph and rules as the specific routes |

The normal quiz screen calls start, answer and finish. Start also resumes an existing active attempt. The load endpoint is available through its wrapper. Finishing normally creates/reuses the report. A later mastery/report failure returns the saved result with report_pending=true; View Report targets that attempt, requests generation when absent, polls every two seconds for up to sixty seconds and provides Retry without displaying another attempt's report.

Interactive OpenAPI documentation is served at /docs; the schema is at /openapi.json, and FastAPI's alternate reference is /redoc.

Teaching questions are 1-1500 characters. Styles are text, visual or analogy. IDs are UUIDs, numeric answers must be finite, and timing/attempt fields have bounded positive/nonnegative validation.

The learning-support route/field/permission contract is in [schema.md](schema.md); this adds eleven authenticated routes for sessions, breaks, attention, reveal and test tools. All mutating new events go through the same graph and Teaching Agent. Restoring a break and reading flags/practice state are read-oriented endpoints; overdue break closure is an owned SQL lifecycle operation and writes its expiry audit atomically.

## 7. How Supabase and Gemini APIs are called

### Direct browser Supabase operations

SDK auth helpers call Supabase Auth. The browser reads profile, curriculum hierarchy, session sections, quiz availability, completed attempts and mastery with the current session. It updates its own profile. Direct writes to session_progress, break_records and attention_events are revoked; learning writes use owned RPCs through the backend graph. The old increment_break_count RPC is no longer executable by students.

SDK .from(table).select(...) becomes a PostgREST GET against /rest/v1/table. Inserts use POST; updates use PATCH. SDK .rpc(name, args) calls POST /rest/v1/rpc/name. The public key identifies the project, while the student's JWT supplies the identity used by RLS.

### Backend Supabase operations

backend/app/core/supabase_client.py wraps Async HTTPX:

- select: GET /rest/v1/table with filter/select/order parameters.
- rpc: POST /rest/v1/rpc/function with JSON arguments.
- insert: POST /rest/v1/table requesting returned rows.
- upsert: POST /rest/v1/table with on_conflict and Prefer: resolution=merge-duplicates,return=representation.

The normal client sends the public project key plus the student's Bearer JWT. The separate service client sends the private service-role key. Service use is limited to audit/report persistence, administrative embeddings, read-only readiness, owned break creation, attention prompt creation and server-flagged calendar completion. These new privileged actions bind the verified JWT subject in Python and recheck grade/ownership in SQL.

### Gemini operations

core/llm.py calls the official SDK's models.embed_content and models.generate_content. The generation model defaults to gemini-3.8-flash and the embedding model defaults to gemini-embedding-001; both are environment configurable. These names describe the application's configured defaults, not a claim about the provider's latest models.

Embeddings use RETRIEVAL_DOCUMENT for stored curriculum and RETRIEVAL_QUERY for student questions, request 768 dimensions and normalize valid finite vectors. Text generation requests schema-validated JSON with a 2400-token limit, provider-default temperature and low thinking for Gemini 3 models. Each generation model gets one bounded attempt; transient 5xx/network/timeouts can fail over to GEMINI_FALLBACK_MODEL (default gemini-3.5-flash-lite). Authentication, quota and other client errors do not trigger model switching. Hidden SDK retries are disabled and incomplete/malformed responses are rejected. Gemini credentials stay in the backend; no provider call is made directly by the browser.

## 8. Agent roles and graph orchestration

| Component | Role | Uses Gemini? |
|---|---|---|
| Teaching Agent | RAG-grounded doubt clarification; deterministic break/support workflow | All doubt answers require retrieval and generation; never used for support rules |
| Quiz Agent | Call authoritative quiz/practice RPCs, shape feedback and explain saved adaptive timing | No |
| Report Agent | Load/reuse reports, compute statistics, generate/validate narrative and persist the report | Yes for new narrative generation; no for listing/reusing reports |
| Progress node | Refresh topic mastery after quiz completion | No; SQL RPC |
| Router | Map the validated request_type to the correct agent | No; deterministic Python |
| Error handler | Normalize graph errors | No |
| Audit node | Persist agent decision records under service credentials | No |

All specific agent routes call the same execute function. The compiled StateGraph maintains per-request user ID, request type, payload, results, quiz plan, computed stats, retrieved context IDs, errors and decisions. Credentials live in runtime dependencies and are not serialized as durable graph state.

Most actions run router -> selected agent -> error handler -> audit -> response. Successful quiz completion runs router -> Quiz Agent -> progress -> Report Agent -> error handler -> audit -> response. Failures skip dependent success steps and still reach audit where possible. Authentication/validation failures occur before graph execution.

Durable state is stored in PostgreSQL; no graph checkpoint store is configured. Agents execute bounded application workflows rather than an autonomous tool-selection loop.

## 9. Teaching request and retrieval (RAG)

For a question such as "Why do we regroup the ones?":

1. LessonSession calls askMathAgent with section_id and question; alternate explanations use the same endpoint with a style.
2. FastAPI verifies the student and routes student_question to the Teaching Agent.
3. lesson_context reads the student's grade/style, the section's source content, its session/topic/chapter and the student's weak topics. A grade mismatch is denied.
4. Every doubt-clearing question, including simple arithmetic such as 99 + 90, is embedded by Gemini into a normalized 768-dimensional vector. No direct-calculation or local-answer bypass exists.
5. match_curriculum first filters curriculum_embeddings by topic_id, chapter_id, grade_level, embedding_model and embedding_dimension. It also verifies the student's grade.
6. SQL ranks that eligible set by cosine similarity. The backend asks for up to four matches above 0.2.
7. The agent supplies the current lesson, retrieved source text, grade, style, weak topics and question to structured Gemini generation.
8. The agent returns answer, sufficient_context, fallback and context_ids. The graph audits it, and the screen displays the answer.

Missing compatible retrieval, generation failure or insufficient context produces a friendly fallback while leaving the static lesson visible. Instructions tell the model to treat student/curriculum text as untrusted data, stay within the lesson and avoid diagnostic claims.

The administrative reembed.py job reads lesson sections through the service client, generates document embeddings and upserts rows by section/model with explicit model/dimension provenance. Unknown provenance does not receive an inferred model label and is excluded from versioned retrieval. Re-embedding is maintenance work, not a startup step.

## 10. Quiz, practice and mastery

### Starting and answering

start_quiz_attempt checks authentication, profile grade and required lesson/revision completion. An advisory transaction lock serializes starts for the student/quiz. It resumes an in-progress attempt or creates a new one.

Question selection uses matching grade/week topics, prioritizes up to four weak-topic templates when available, and selects up to seven templates. SQL generates operand values and distinct answer options, stores private question instances, calculates timing from the actual generated count and saves adaptive_plan.

get_quiz_plan returns safe options, parameters, timer metadata and answered IDs. It does not label the correct option or expose private misconception mappings. submit_quiz_answer locks the owned attempt, checks question membership, status, deadline and option validity, grades in SQL and stores the response. A same-answer retry returns the saved feedback; changing an already submitted answer is rejected.

The browser renders the timer, but SQL enforces the deadline independently.

### Adaptive timing

quiz_timing is the sole timing formula and examines up to three completed attempts:

- Start at 90 seconds per question with no history.
- With history, average accuracy below 60% gives 135 seconds; above 85% gives 72; otherwise use 90.
- A declining trend raises the value to at least 117 seconds, or adds 10% when the current value is already higher.
- If average time used per question is at least 80% of the previous allocation, add a 20% buffer.
- Clamp to 45-150 seconds, round, and multiply by the actual generated count.

With seven questions and no history, the time limit is 630 seconds. The Python agent describes the saved SQL decision without recalculating it.

### Finishing and mastery

finish_quiz_attempt validates ownership, saves completion and returns counts, score, accuracy and missed-question review. Score is 100 * correct / max(total questions, 1); accuracy is 100 * correct / max(submitted answers, 1). Unanswered questions lower score. Review reveals answers after finishing.

refresh_student_progress combines submitted responses from completed quizzes and persisted practice responses from real lesson-flow sessions. Answer reveals are not independently correct; repeated wrong attempts or a reveal mark a support-heavy topic weak and feed quiz selection. A topic is also weak when accuracy is below 60% or its dominant tagged error has occurred at least twice. Otherwise it is mastered at accuracy >=85% with at least three responses, or in_progress. It upserts per-student/topic status and primary misconception.

record_practice_answer checks grade and practice-section availability, grades the answer, upserts the section response and refreshes mastery inside SQL. Practice lessons may expose their answer content to the browser for learning; they do not have the same hidden-key boundary as quiz assessment instances.

Finishing is retryable. Score persistence, mastery refresh, report creation and audit persistence are separate operations; a later failure can leave a saved score and require a retry.

## 11. Reports and audit records

A new report first checks for an existing owned report. If absent, student_report_input verifies a completed owned attempt and returns completed history, mastery, practice and break data. Python computes the numeric stats before any text generation.

Stats include current/previous score, recent delta, overall/recent score and accuracy trends, histories, weak/mastered topics, primary misconception summaries, practice response/attempt counts and break counts/durations. Overall trend compares first to current score; recent trend compares previous to current. Assessment history is truncated at the requested attempt, while mastery/practice/break inputs reflect the data loaded at report creation.

Gemini writes narrative and suggestions from those stats. Every numeric literal in the generated candidate must occur in the computed snapshot; failure or rejection uses deterministic wording. This validates numeric membership, not every semantic interpretation.

After user-scoped ownership/completion verification, the service client upserts reports by student_id/quiz_attempt_id. Students read their reports with RLS and cannot directly insert/update/delete reports.

The audit node inserts agent_decisions containing student ID, agent name, decision type, linked entity, input snapshot, output, reasoning summary and context IDs. Students cannot read/write that table. The reasoning summary is an application explanation, not private model chain-of-thought. Audit failure returns a safe error; it is not a durable transactional outbox.

## 12. Database structure and SQL ownership

| Domain | Tables | Purpose |
|---|---|---|
| Identity | auth.users; public.profiles | Login identity and grade/preferences/onboarding |
| Curriculum | subjects, chapters, weeks, sessions, session_sections | Ordered subject-to-section hierarchy and practice content |
| Lesson activity | session_progress, break_records, attention_events, attention_section_visits | Owned completion, server-bounded active time, adaptive breaks, personalized section timing and recorded check-ins |
| Practice | session_responses | Authoritatively graded practice results |
| Assessment | questions, quizzes, quiz_attempts, quiz_attempt_questions, quiz_responses | Templates, weekly assessments, private instances, answers and completion |
| Mastery | student_progress | Unique student/topic mastery and misconceptions |
| Reports | reports | Unique student/attempt stats and narrative |
| Retrieval | curriculum_embeddings | Source sections/text, metadata, model provenance and vector(768) |
| Audit | agent_decisions | Backend-only decision records |

Hierarchy: subject -> chapter -> week -> session -> section; a week also owns quizzes. A profile owns attempts, progress, practice and reports. Attempts own generated questions and responses. Each generated question references its template. Embeddings reference source sections and carry chapter/topic/grade metadata.

Unique indexes protect answer idempotency (attempt/question), report idempotency (student/attempt), practice upserts (student/section) and embedding versions (section/model). Student mastery is unique by student/topic, and session progress by student/session. Metadata and audit-time indexes support retrieval filtering and audit lookups.

| SQL function | Responsibility |
|---|---|
| handle_new_user | Signup trigger creates a profile |
| learning_progress | Owned start/restore/flush/complete with server active-time budget and break lock |
| learning_break_status / begin_learning_break / end_learning_break | Server time, allowance, unique open break, bounded activity records and expiry |
| attention_context / offer_attention / answer_attention | Backend-only observations and atomic prompt creation; owned server-checked responses |
| reveal_practice_answer | Persist supported practice and actual-number worked solutions |
| calendar_test_complete | Service-only, backend-flagged test completion provenance |
| start_quiz_attempt | Gate, lock, create/resume and generate assessment |
| quiz_timing | Internal adaptive allocation |
| get_quiz_plan | Return an owned safe question plan |
| submit_quiz_answer | Grade, check deadline and enforce retry rules |
| finish_quiz_attempt | Save score/completion and provide review |
| refresh_student_progress | Compute and persist topic mastery |
| record_practice_answer | Grade/upsert practice and refresh mastery |
| student_report_input | Return completed owned report inputs |
| match_curriculum | Filter compatible metadata and rank vectors |

RLS remains enabled. Browser writes to assessments, mastery, practice results and reports are revoked; relevant owned SQL RPCs perform assessment writes. Quiz templates/answer-instance tables are not browser-readable. Definer functions use explicit ownership checks and fixed search paths. The old match_curriculum_embeddings RPC is unavailable to browser roles.

Keep migration files: the isolated test bootstrap reads the baseline files and the forward authoritative-agent migration. They are not executed on every application start. Do not bulk replay template seeding against an existing student database; separate rollout needs schema review, duplicate preflight, a backup and appropriate migration tracking.

## 13. Configuration and runtime behavior

### Sequential learning and the testing shortcut

Sessions unlock in `order_index` order within a week. Every earlier session must be completed before a later session can be attended or marked complete, even when older progress records contain gaps. The dashboard disables locked sessions, direct lesson navigation checks the same prerequisites, and the `session_progress_sequential_access` database trigger guards both genuine learning progress and calendar test completions. Existing completion records are preserved. Lesson sections advance one at a time, with practice completion or supported answer reveal required before continuing. The weekly quiz remains locked until all required lesson and revision sessions are completed.

With `ENABLE_TEST_TOOLS=true` in `backend/.env`, an adjacent **Mark as done** button lets testers complete the next unlocked session without traversing its content. The shortcut is authenticated, audited, and stored as `calendar_test_shortcut`; it does not manufacture practice or engagement data. Restart the backend after changing this flag. The checked-in default remains `false`; keep it disabled in production.

Frontend configuration is read from root .env at Vite startup/build. Backend Settings reads backend/.env regardless of working directory; process environment overrides file values.

| Setting | Location | Use/default |
|---|---|---|
| VITE_SUPABASE_URL | Frontend | Hosted project's URL |
| VITE_SUPABASE_ANON_KEY | Frontend | Public anon/publishable key |
| VITE_API_BASE_URL | Frontend | Backend URL; local http://127.0.0.1:8000 |
| SUPABASE_URL | Backend | Same hosted project URL |
| SUPABASE_ANON_KEY | Backend | Public key for user-token requests; not the VITE-prefixed name |
| SUPABASE_SERVICE_ROLE_KEY | Backend only | Privileged backend key for approved service-client operations |
| SUPABASE_JWT_SECRET | Backend only | Optional legacy HS256 secret; not required for ES256/JWKS |
| JWT_AUDIENCE | Backend | authenticated |
| GEMINI_API_KEY | Backend only | Provider key |
| GEMINI_CHAT_MODEL | Backend | gemini-3.8-flash default |
| GEMINI_EMBEDDING_MODEL | Backend | gemini-embedding-001 default |
| EMBEDDING_DIMENSION | Backend | Must be 768 |
| ALLOWED_ORIGINS | Backend | JSON list of exact HTTP(S) frontend origins; local localhost and 127.0.0.1 on 5173 |
| REQUEST_TIMEOUT_SECONDS | Backend | 45; graph work budget |
| LLM_TIMEOUT_SECONDS | Backend | 12 per attempt; up to two attempts |
| LLM_REQUESTS_PER_MINUTE | Backend | 20 applicable graph events per user |

The frontend aborts agent fetches after 50 seconds. The backend bounds the graph to 45 seconds and, after a timeout, attempts a separate audit write for up to three seconds. Main HTTPX database requests have a 10-second timeout. The LLM limiter applies to student_question, quiz_completed and report_requested; it is per-user, in-memory and process-local, including applicable retries. Use one worker until a shared limiter exists.

CORS permits configured exact origins, GET/POST and Authorization/Content-Type headers. Production should use HTTPS and an actual frontend URL/backend URL pair. Privileged/provider secrets must never be VITE variables or committed configuration. Restart/rebuild after relevant configuration changes.

Health checks only the running process. Readiness validates configured learning credentials, service-client database access, required columns, real PostgREST lesson relationships and some compatible embeddings. It also verifies learning-support tables/columns. It does not test token login/refresh, Gemini availability or complete curriculum coverage.

| HTTP status | Meaning |
|---|---|
| 401 | Missing, invalid or expired authentication |
| 403 | Ownership/permission denial |
| 404 | Unavailable lesson |
| 409 | Gated, expired or unavailable assessment |
| 422 | Invalid request fields/values |
| 429 | Per-user LLM-event rate limit; Retry-After: 60 |
| 503 | Configuration, dependency or audit failure |
| 504 | Total request timeout |

## 14. Accessibility and functional limits

### Live personalized learning check-ins

`useAttentionSupport` sends a bounded snapshot to `POST /api/v1/attention/check` every 15 seconds while a lesson is visible, including while the student stays on the same section. The authenticated request passes through LangGraph to the Teaching Agent and its deterministic policy in `backend/app/services/attention.py`. There are no LLM calls in this workflow. The retired `/attention/show` endpoint does not manufacture boundary prompts.

The backend uses `attention_context` to record server-capped visible section time and load the student's comparable completed section durations, recent practice errors, uninterrupted visible learning time, and previous check-in outcome. At least three comparable completed sections provide a median baseline; otherwise a bounded content-length allowance is used. Testing shortcuts are excluded. Hidden-tab time, breaks, AI waiting, narration and open popups do not add to the frontend section clock. Meaningful actions reset inactivity; pointer movement alone does not.

The policy requires multiple signals, not elapsed time alone. Prolonged section time plus inactivity can offer an ungraded number activity; recent difficulty plus inactivity offers a visual hint; extended visible learning plus inactivity can offer a break. This is an optional support suggestion, not a diagnosis or proof of distraction. The lesson topic selects validated build-a-ten, place-value, addition or subtraction templates. There is no automatic sound, flashing, camera, gaze tracking or external activity content.

SQL `offer_attention` rechecks lifecycle state under a per-student lock and deduplicates offers. Prompts have a two-minute cooldown after answering, four minutes after skipping, a three-per-session maximum and an eight-per-rolling-day maximum. The browser also defers while typing, speaking, waiting for a provider, another popup, or a break; break resume has a one-minute grace period. Timed quizzes never run this hook. Late responses cannot open a popup in a different section, and leaving a section closes any pending offer there.

**Quick number adventure** preserves the lesson position, supports Keep learning, Answer and Take a break, and restores keyboard focus. Build-a-ten lets students tap ten ones into one ten. Feedback is encouraging and does not change quiz scores or mastery. Reduced-motion preferences apply. Students can disable **Learning check-ins** in Settings; this preference is stored separately for each student on the device. A failed attention request does not block learning and is retried automatically. Backend decisions and their signal snapshots are audited.

Static lesson content remains available when AI fails. Alternative explanations use text/visual/analogy preferences; the structured response currently returns text, not a generated visual asset. Ordinary section advances and page navigation have no entrance/exit animation. Purposeful attention, breathing and full-marks celebration animations respect OS/in-app reduced motion; reduced-motion celebration is static. Speech synthesis is user-triggered and browser-dependent.

Lesson completion and activity time are student-owned, not proctored evidence. Dashboard recommendations use stored weak-topic/progress data, not a separate recommendation LLM. Direct owned RPC calls do not produce graph audits. Multi-step agent completion has no distributed transaction. Numeric report validation cannot guarantee semantic truth. These constraints are part of the current design.

Break allowance and attention policy rules are documented with verification in [CHANGES_BREAK_ATTENTION.md](CHANGES_BREAK_ATTENTION.md). The default backend test-tool flag is ENABLE_TEST_TOOLS=false. Explicitly enable it only on a testing server; students cannot enable it from the browser.

## 15. Repository map, setup and maintenance

~~~text
README.md                       Local start and stop commands
docs/PROJECT_DETAILS.md         This current design reference
src/                            React app, components, state, clients and local assets
public/favicon.svg              Browser favicon referenced by index.html
backend/app/                    Routes, agents, graph, schemas and core/services
backend/requirements.txt         Pinned Python dependencies
backend/Dockerfile              Backend image definition
backend/tests/                  Backend unit/integration tests
backend/scripts/                Embedding, smoke, security, provider and asset utilities
scripts/                        Isolated PostgreSQL/RLS test harness and HTTP adapter
tests/browser/                  Playwright screen/flow tests
supabase/migrations/             Schema, curriculum/bootstrap and authoritative RPC SQL
supabase/checks/                 Preflight and rollback-only SQL checks
package.json/package-lock.json  Node commands and dependency lock
vite/tsconfig/tailwind/postcss   Frontend tool configuration
~~~

For a fresh checkout, install dependencies and copy example environment files only if actual files do not exist:

~~~powershell
Set-Location 'D:\Project\ClassroomAssistant'
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
if (-not (Test-Path -LiteralPath 'backend\.venv\Scripts\python.exe')) {
    python -m venv backend\.venv
}
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
if (-not (Test-Path -LiteralPath 'backend\.env')) {
    Copy-Item -LiteralPath 'backend\.env.example' -Destination 'backend\.env'
}
~~~

Fill private configuration with actual values, ensure the target Supabase schema/curriculum exists and use README start commands. The example placeholders alone are not working credentials. Changing the embedding model requires deliberate re-embedding.

Build/type/lint and isolated tests:

~~~powershell
Set-Location 'D:\Project\ClassroomAssistant'
npm.cmd run typecheck
npm.cmd run build
npm.cmd run lint
npm.cmd run test:db
npm.cmd run test:support
npm.cmd run test:browser
Push-Location .\backend
.\.venv\Scripts\python.exe -m pytest -q
Pop-Location
.\backend\.venv\Scripts\python.exe .\backend\scripts\smoke_server.py
.\backend\.venv\Scripts\python.exe .\backend\scripts\security_check.py
~~~

Browser tests use installed Microsoft Edge and synthetic network fixtures. SQL/backend integration uses ephemeral PGlite PostgreSQL + pgvector behind a test-only adapter, not hosted Auth/PostgREST. The adapter is never part of the deployed backend. Isolated SQL/provider/browser tests do not establish a complete hosted signed-in end-to-end deployment.

Optional live provider integration uses quota:

~~~powershell
Set-Location 'D:\Project\ClassroomAssistant\backend'
$env:RUN_LIVE_GEMINI='1'
try {
    .\.venv\Scripts\python.exe -m pytest tests/test_live_agents.py -q
} finally {
    Remove-Item Env:RUN_LIVE_GEMINI
}
~~~

For deliberately updating hosted curriculum embeddings after content/model changes:

~~~powershell
Set-Location 'D:\Project\ClassroomAssistant'
.\backend\.venv\Scripts\python.exe .\backend\scripts\reembed.py
~~~

This job writes versioned embeddings and uses paid provider quota. probe_live.py is a manual provider/JWKS diagnostic; smoke_server.py starts and stops its own temporary-port backend for checks. security_check.py reports counts rather than secret values. Purposeful visuals are authored locally in the three React components and licensed in src/components/ANIMATION_LICENSE.txt; no external animation asset is fetched.

For a different database rollout, use supabase/checks/fastapi_preflight.sql to inspect duplicates, extension/signature prerequisites and permissions before applying a reviewed forward migration. The transactional smoke SQL requires an admin connection, uses synthetic users and rolls fixture writes back; it validates deployed SQL/RLS, not actual Auth HTTP login. Keep private logical database snapshots separate from documentation and source control.

The frontend build writes dist; preview serves an existing build. Production can host that static output separately from FastAPI. The backend image copies only the application and runs as a non-root user; secrets must be supplied at runtime. Configure exact origins, auth redirect URLs and a single worker. No background job queue, streaming answer endpoint or Supabase Edge Function is used by the current code.
