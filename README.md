# Inclusive Classroom Assistant — adaptive RAG learning environment

A React-based web application providing a calm, distraction-free learning environment for students with ADHD in Grade 2–5 Mathematics. It features a multi-agent AI architecture that dynamically retrieves curriculum, adaptively targets specific student misconceptions during quizzes, and generates plain-language progress reports.

**Student progress tracking, vector search, and AI inference are live.** The frontend communicates directly with Supabase (using `pgvector`) and Google's Gemini API. This is an educational prototype and not a certified medical or clinical intervention tool.

## Run locally

Requires Node.js 18 or newer.

1. Install dependencies:
```sh
npm install
```

2. Configure environment variables. Copy `.env.example` to `.env` and add your keys:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_ELEVENLABS_API_KEY=your_elevenlabs_api_key # Optional: falls back to browser speech synthesis
```

3. Start the development server:
```sh
npm run dev
```

Open **http://localhost:5173**. 

## Interview walkthrough

The application is driven by state machines stored in the database. When walking through the demo, emphasize how the AI strictly grounds itself in the provided curriculum.

1. **Dashboard & Onboarding:** View the student's dashboard. Point out the minimalist, distraction-free UI designed to reduce cognitive load.
2. **Learning Phase (RAG):** Select a lesson. The **Teaching Agent** converts the topic into vector embeddings and searches the `pgvector` database to retrieve verified curriculum chunks. It then rewrites the content on the fly (e.g., using an "Analogy-rich" style) tailored for a 7-8-year-old.
3. **Q&A Widget:** Ask a question in the "Ask the Math Agent" interface. Demonstrate how the response is dynamically generated but strictly bounded by the retrieved context.
4. **Attention Check-ins:** Note the interstitial Lottie breathing animations that trigger between heavy cognitive tasks to help students refocus without overwhelming them.
5. **Adaptive Quizzing:** Take a quiz. If a student consistently makes the same type of error (e.g., "forgets to carry the tens"), the `recomputeProgress` engine logs this as a `primary_misconception_tag`. 
6. **Procedural Generation:** The **Quiz Agent** actively selects question templates that target this exact misconception and procedurally generates numbers, ensuring one of the multiple-choice distractors maps exactly to the student's specific error pattern.
7. **Narrative Reporting:** After the quiz, view the generated report. The **Report Agent** analyzes deterministic metrics (score delta, accuracy trend) and generates a friendly, supportive summary of the student's progress.

## What is implemented

- A responsive, highly accessible React frontend. Minimal visual clutter and open-source Lottie animations (breathing, star pop) for calm engagement and positive reinforcement.
- Multi-agent orchestration using Google Gemini (`gemini-3.6-flash` for reasoning/generation, `gemini-embedding-001` for vectorization).
- RAG pipeline backed by Supabase `pgvector` to ensure AI explanations do not hallucinate outside approved educational material.
- A deterministic progress engine that tracks mastery (`weak`, `in_progress`, `mastered`) and categorizes distinct mathematical misconceptions per student per topic.
- A comprehensive `agent_decisions` audit log. Every AI action (retrieved context, generated prompt, output, and reasoning) is stored for full traceability.
- Built-in Text-to-Speech (TTS) using the browser `speechSynthesis` API with a graceful upgrade to ElevenLabs if an API key is provided.

## Design and code

```text
Dashboard → Learning (RAG) → Q&A / Check-ins → Quiz (Adaptive) → Report
    ↓             ↓                ↓                 ↓              ↓
Supabase RLS → pgvector → gemini-embedding-001 → gemini-flash → agent_decisions log
```

| File | Responsibility |
|---|---|
| `src/services/api.ts` | The core multi-agent engine: RAG implementation, procedural question generation, and progress tracking. |
| `src/services/reportAgent.ts` | Gemini prompt definitions for converting statistical snapshots into narrative reports. |
| `src/components/` | React components including the Q&A Widget, Lottie animations, and Quiz interfaces. |
| `src/lib/supabaseClient.ts` | Supabase initialization and authentication handling. |
| `supabase/migrations/` | SQL schemas defining `student_progress`, `agent_decisions`, and `pgvector` configuration. |

## AI Agents & Core Logic

Instead of a traditional REST backend, the logic resides in client-side services communicating securely with Supabase and Gemini. 

| Agent / Service | Core Functions | Purpose |
|---|---|---|
| **Teaching Agent** | `getDynamicExplanation`, `askMathAgent` | Generates analogies and answers questions by querying `pgvector` (`match_curriculum_embeddings` RPC) and injecting the chunks into a Gemini prompt. |
| **Quiz Agent** | `startQuizAttempt`, `submitQuizAnswer` | Analyzes `primary_misconception_tag`s, filters question templates via `distractor_rules`, and procedurally generates math problems. |
| **Progress Engine** | `recomputeProgress` | Deterministically calculates accuracy, detects recurring errors, and updates the `mastery_status` in `student_progress`. |
| **Report Agent** | `generateReport` | Calculates `score_delta` and `trend`, passing a JSON snapshot to Gemini to generate a narrative stored in the `reports` table. |

## Boundaries worth discussing in an interview

The current architecture places the LLM orchestration logic in the client-side browser (`api.ts`). While Supabase Row Level Security (RLS) protects the database from unauthorized access, a production application would move the Gemini API calls and prompt assembly behind a secure backend (e.g., Supabase Edge Functions or a Node.js server) to prevent API key exposure and prompt injection attacks from sophisticated users.

The RAG implementation uses a basic cosine similarity search. A production-grade tutor might require a more advanced retrieval strategy (like Hybrid Search with BM25 + Vectors) or a re-ranking step to ensure mathematical formulas are retrieved with perfect precision.

The `agent_decisions` table provides crucial observability by logging exactly what context was provided to the LLM and why a specific question was chosen. However, the system relies on the LLM's stochastic nature for the final teaching text, meaning edge-case hallucinations are still technically possible despite the strong RAG grounding.
