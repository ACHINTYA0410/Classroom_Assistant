# Inclusive Classroom Assistant - Interview Prep Guide

## 1. Project Workflow & Architecture

### High-Level User Flow
1.  **Authentication/Onboarding**: Student logs in securely (managed via Supabase RLS).
2.  **Learning Phase (Teaching Agent)**:
    *   Student selects a topic (e.g., Grade 3 Addition).
    *   **RAG Process**: The system queries the Supabase `pgvector` database for curriculum embeddings matching the topic.
    *   **Generation**: The Teaching Agent (Google Gemini) generates a personalized explanation grounded in the retrieved curriculum, adapting the tone for an ADHD profile (calm, focused, analogy-rich).
    *   **Engagement**: UI incorporates "Attention Check-ins" (Lottie breathing animations) to reduce cognitive load.
3.  **Assessment Phase (Quiz Agent)**:
    *   The Quiz Agent selects questions adaptively.
    *   It checks the `student_progress` table for `primary_misconception_tag`s and mastery status (`weak`, `in_progress`, `mastered`).
    *   Questions are targeted at the student's specific weak spots.
4.  **Feedback & Reporting Phase (Report Agent)**:
    *   Student answers are evaluated.
    *   The Report Agent analyzes deterministic stats (score delta, accuracy) and uses Gemini to write a plain-language narrative report.
    *   The database (`agent_decisions` and `student_progress`) is updated with the latest interaction data.

### Multi-Agent Orchestration (Graph-Based Routing)
The core innovation is the orchestration of three distinct AI agents:
*   **Teaching Agent**: RAG-based content delivery.
*   **Quiz Agent**: Adaptive assessment logic.
*   **Report Agent**: Data analysis and natural language generation.
*   *Orchestrator*: A central router that directs the flow between these agents based on the user's state in the application, ensuring context is passed correctly and decisions are logged centrally.

---

## 2. Technical Deep Dive (Interview Talking Points)

### **Frontend (React, TypeScript, Vite)**
*   **Why React/TypeScript?** React provides a component-based architecture for managing complex UI states (like switching between learning, quizzing, and animations). TypeScript ensures type safety, which is crucial when handling complex data structures returned by the AI agents and Supabase.
*   **ADHD-Specific UI/UX**:
    *   Minimalist design to prevent overstimulation.
    *   Integrated Lottie animations for non-intrusive breaks (breathing/wave) and positive reinforcement (star pop/confetti).
    *   Built-in Text-to-Speech (TTS) using browser `speechSynthesis` (with an ElevenLabs fallback) to support auditory learners.

### **Backend & Database (Supabase, PostgreSQL)**
*   **Why Supabase over Firebase/MongoDB?** Supabase provides a full PostgreSQL database, which is necessary for `pgvector` (essential for RAG). It also offers robust Row Level Security (RLS).
*   **Vector Database (`pgvector`)**:
    *   *How it works*: Curriculum text (chapters, lessons) is converted into high-dimensional vectors (embeddings) using Google's `gemini-embedding-001` model.
    *   *Search*: When a student needs help, their query is embedded, and `pgvector` performs a cosine similarity search to find the most relevant curriculum chunks.
*   **Data Modeling for Tracking**:
    *   `student_progress`: Tracks mastery state (`weak`, `in_progress`, `mastered`) and specific `primary_misconception_tag`s per topic. This is the engine driving the Quiz Agent's adaptivity.
    *   `agent_decisions`: An audit log. It stores *why* an agent made a decision (e.g., the input context, the chosen action, and the reasoning). This provides observability into the AI's behavior.
*   **Security**: Row Level Security (RLS) ensures that a student can only query and mutate their own progress data.

### **AI Integration (Google Gemini)**
*   **Model Choice**: `gemini-3.6-flash` is used for its speed and context window, making real-time multi-agent orchestration feasible. `gemini-embedding-001` handles the vectorization.
*   **Prompt Engineering Techniques**:
    *   *System Prompts*: Enforcing a specific persona (calm, patient tutor).
    *   *Few-Shot Prompting*: Providing examples of how to rewrite content using analogies.
    *   *Context Injection*: Injecting the RAG results (curriculum) and the student's current misconception tags into the prompt to ground the response.

---

## 3. Potential Interview Questions & How to Answer Them

**Q1: Explain how Retrieval-Augmented Generation (RAG) works in your project.**
*   **Answer**: "We embedded approved Grade 2-5 math curriculum into a Supabase PostgreSQL database using the `pgvector` extension. When a student asks a question, we convert their query into an embedding, perform a similarity search in Supabase to fetch the relevant curriculum text, and pass that text as context to the Gemini Teaching Agent. This ensures the AI tutor doesn't hallucinate and only teaches approved material."

**Q2: How does the system adapt to the student's learning pace?**
*   **Answer**: "The Quiz Agent drives adaptivity. We maintain a `student_progress` table that tracks mastery levels and specific `misconception_tags` (e.g., 'struggles with carrying over in addition'). Before generating a quiz, the agent queries this table. If a student has a specific misconception tag, the agent dynamically selects or generates questions targeting that exact weak spot."

**Q3: How did you design the application specifically for students with ADHD?**
*   **Answer**: "We minimized visual clutter in the UI to reduce cognitive load. More importantly, we integrated 'Attention Check-ins'—interstitial breaks using calm Lottie animations (like a breathing circle) to help them refocus. We also implemented Text-to-Speech (TTS) for auditory learning support, and the AI agent is prompted to use analogy-rich, bite-sized explanations."

**Q4: Why did you log `agent_decisions`? Isn't that a lot of data?**
*   **Answer**: "In an educational setting, transparency is critical. We needed an audit trail. By logging the input context and the AI's reasoning for every action in the `agent_decisions` table, we can debug why the system gave a specific explanation or chose a specific question. It provides necessary observability for a multi-agent system."
