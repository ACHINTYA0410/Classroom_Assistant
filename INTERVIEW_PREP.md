# Inclusive Classroom Assistant - Comprehensive Technical Guide

This document is a deep dive into the **Inclusive Classroom Assistant**, detailing exactly what the project does, the technical architecture, how the AI agents are implemented at the code level, and how to discuss these in a technical interview.

---

## 1. What the Project Does (Product Vision)

The **Inclusive Classroom Assistant** is a web-based, AI-driven learning platform designed specifically for students with ADHD in Grades 2–5. It teaches mathematics through a highly adaptive, multi-agent system.

**Key Product Features:**
1.  **Distraction-Free UX**: Minimalist UI, integrating Lottie animations (e.g., breathing exercises) for cognitive breaks (Attention Check-ins) without overstimulating the user.
2.  **Adaptive Learning (RAG)**: When teaching a lesson, the app dynamically generates explanations. It pulls from a verified curriculum database and rewrites the content using analogies suitable for a 7-8-year-old.
3.  **Targeted Quizzing**: Instead of generic questions, the app analyzes exactly *why* a student is failing (e.g., "forgets to carry the one" in addition) and procedurally generates questions to target that specific misconception.
4.  **Friendly Reporting**: It converts raw scores into encouraging, plain-language narrative reports for the student and educator.

---

## 2. Technical Architecture & Tech Stack

*   **Frontend**: React, TypeScript, Vite. (Tailwind/Vanilla CSS for UI).
*   **Database**: Supabase (PostgreSQL).
    *   **Vector Database**: `pgvector` extension is used to store high-dimensional embeddings of the curriculum.
    *   **Security**: PostgreSQL Row Level Security (RLS) ensures students only access their own progress data.
*   **AI Models (Google Gemini via REST APIs)**:
    *   `gemini-embedding-001`: Used to convert text into 768-dimensional vector embeddings.
    *   `gemini-3.6-flash`: The core Large Language Model (LLM) used for text generation, RAG synthesis, and report writing.
*   **Audio**: Browser-native `speechSynthesis` API for Text-to-Speech (with an ElevenLabs fallback).

---

## 3. The Multi-Agent System: How We Actually Did It

The application is orchestrated by three distinct "Agents". These aren't just prompts; they are specialized service layers in the code (`src/services/api.ts`) that interact with the database and the LLM.

### A. The Teaching Agent (RAG Implementation)
**Goal:** Teach concepts without hallucinating, using analogies appropriate for ADHD students.

**How it works in code (`getDynamicExplanation` / `askMathAgent`):**
1.  **Embedding Generation**: When a student asks a question or views a lesson, the app sends the query to the `gemini-embedding-001` API to get a 768-dimensional vector.
2.  **Similarity Search (`pgvector`)**: The app calls a Supabase RPC function (`match_curriculum_embeddings`) passing the vector. PostgreSQL performs a cosine similarity search against the stored curriculum chunks to find the top 3 most relevant matches.
3.  **Prompt Construction**: A prompt is built injecting the student's Grade Level, their Preferred Style (e.g., "Analogy-rich"), and the retrieved curriculum chunks as "Reference Context".
4.  **LLM Generation**: The prompt is sent to `gemini-3.6-flash` to generate the final, grounded response.
5.  **Audit Logging**: The action, the retrieved chunks, and the output are logged to the `agent_decisions` table.

### B. The Quiz Agent (Adaptive Assessment)
**Goal:** Generate questions that specifically target a student's weaknesses.

**How it works in code (`startQuizAttempt` / `recomputeProgress`):**
1.  **Progress Tracking**: When a student answers questions, the `recomputeProgress` engine calculates their accuracy per topic. If accuracy is <60%, the topic is marked as `weak`. It also logs specific `misconception_tag`s (e.g., `forgot_carry_hundreds`).
2.  **Adaptive Template Selection**: When starting a quiz, the Quiz Agent fetches the student's `weak` topics and `misconception_tag`s from the `student_progress` table.
3.  **Filtering**: It filters the database of `questions` (templates), actively seeking templates where the `distractor_rules` match the student's known misconceptions.
4.  **Procedural Generation**: Using a helper function (`generateQuestionInstance`), it procedurally generates the math problem (e.g., randomizing `param_a` and `param_b`) while ensuring the incorrect multiple-choice options (distractors) map exactly to the targeted misconception.

### C. The Report Agent (Data-to-Text Generation)
**Goal:** Provide friendly feedback based on raw data.

**How it works in code (`generateReport`):**
1.  **Deterministic Analytics**: After a quiz, the system calculates raw metrics: `currentScore`, `previousScore`, `scoreDelta`, and a mathematical `trend` (improving, declining, or stable).
2.  **Context Assembly**: It fetches the student's newly updated `weak_topics` and `strong_topics`.
3.  **LLM Narrative Generation**: A JSON snapshot of these stats is passed to the Gemini LLM with a prompt to write a friendly, supportive narrative summary.
4.  **Storage**: The resulting narrative is saved to the `reports` table.

### D. The Orchestrator (Audit & Routing)
All agents write to a central `agent_decisions` PostgreSQL table. This table logs:
*   `agent_name` (e.g., `teaching_agent`)
*   `decision_type`
*   `input_snapshot` (the exact context given to the agent)
*   `output` (what the agent decided/generated)
*   `reasoning_summary` (Why it made that choice)

This provides **observability**, which is critical when using stochastic LLMs in an educational context.

---

## 4. Interview Q&A Guide

**Q1: Walk me through how you implemented RAG in this project.**
*   **Answer**: "We used Google's `gemini-embedding-001` to vectorize our Grade 2-5 math curriculum and stored it in a Supabase PostgreSQL database using the `pgvector` extension. When the Teaching Agent needs to explain a concept or answer a student's question, we embed the query, perform a cosine similarity search via a Supabase RPC function (`match_curriculum_embeddings`) to fetch the top 3 relevant chunks, and inject those chunks into the prompt for `gemini-3.6-flash`. This ensures the LLM's answers are strictly grounded in our approved curriculum."

**Q2: How exactly does the Quiz Agent adapt to the student?**
*   **Answer**: "It's driven by a `student_progress` table that tracks mastery status (`weak`, `in_progress`, `mastered`) and specific `misconception_tag`s. When a quiz starts, the agent queries this table. If a student is flagged with the `forgot_carry` misconception, the Quiz Agent filters our question templates to find those that support that specific distractor rule. It then procedurally generates the math problem (randomizing the numbers) and ensures one of the multiple-choice distractors is the exact wrong answer you'd get if you forgot to carry the one."

**Q3: How did you design for ADHD?**
*   **Answer**: "From a UX perspective, we kept the interface highly minimalist to reduce cognitive load, avoiding the loud, gamified UIs typical of EdTech. We integrated 'Attention Check-ins'—interstitial breaks using calm Lottie animations (like a breathing circle) to help them refocus. At the AI level, we prompt the Teaching Agent to use bite-sized, analogy-rich explanations (like comparing numbers to marble bags) which are easier to process."

**Q4: Dealing with LLMs can be unpredictable. How did you handle observability and debugging?**
*   **Answer**: "Transparency is critical in EdTech. We built an 'Orchestrator' concept backed by an `agent_decisions` table in Postgres. Every single time an agent acts—whether the Teaching Agent generates an explanation or the Quiz Agent selects a template—we log a snapshot of the inputs, the output, and a reasoning summary. If a student gets a weird explanation, we can look at the database and see exactly which curriculum chunks were retrieved and what the prompt was."

**Q5: Why did you choose Supabase over something like Firebase?**
*   **Answer**: "We needed a relational database (PostgreSQL) for complex queries, specifically for the `pgvector` extension to handle our RAG implementation. Firebase's NoSQL structure doesn't support native vector similarity search in the same robust, relational way. Supabase also gave us excellent Row Level Security (RLS) out of the box."
