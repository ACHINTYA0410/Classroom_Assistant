# Inclusive Classroom Assistant - Project Overview

## 🎯 Vision & Purpose
The **Inclusive Classroom Assistant** is a specialized React-based web application tailored for students with ADHD. It provides a calm, distraction-free, and adaptive learning environment focused on Grade 2–5 Mathematics. The system uses a multi-agent AI architecture to personalize the learning experience in real-time, helping students overcome specific misconceptions without feeling overwhelmed.

## 🏗️ Core Architecture & Tech Stack
*   **Frontend**: React (Vite), TypeScript, CSS (Vanilla/Tailwind). Features calm UI elements, open-source Lottie animations (e.g., gentle breathing for check-ins, star pop for celebrations).
*   **Backend & Database**: Supabase (PostgreSQL)
    *   **pgvector**: Used for storing curriculum embeddings to power Retrieval-Augmented Generation (RAG).
    *   **RLS (Row Level Security)**: Ensures student data privacy and secure API access.
*   **AI Integrations**:
    *   **Google Gemini (gemini-3.6-flash, gemini-embedding-001)**: Powers all intelligent agents (Teaching, Quiz, Report) and curriculum vector search.
    *   **Text-to-Speech (TTS)**: Built-in `speechSynthesis` API fallback with support for ElevenLabs API (`VITE_ELEVENLABS_API_KEY`) to provide auditory learning options.

## 🤖 Multi-Agent AI System
The application is driven by a sophisticated multi-agent system that analyzes student interactions and adapts the curriculum dynamically.

*   **Teaching Agent**: Uses RAG against embedded curriculum content to generate dynamic, personalized explanations. It can rewrite content on the fly (e.g., using "Analogy-rich" styles comparing math to marbles or lanes) based on the student's grade level and preferences.
*   **Quiz Agent**: Handles adaptive question selection based on the student's real-time mastery profile, ensuring questions target specific weak spots and known misconceptions.
*   **Report Agent**: Analyzes deterministic progress statistics (score delta, accuracy trend, mastery changes) and uses Gemini to generate friendly, plain-language narrative reports for the student and educator.
*   **Orchestrator**: Orchestrator ties Teaching/Quiz/Report agents together (graph-based routing) with agent_decisions fully populated across all three.

## 📊 Data Model & Tracking
*   **Curriculum Context**: Chapters, topics, and lessons are embedded into the database, allowing the AI to ground its answers strictly in approved educational material.
*   **Student Mastery & Misconceptions**: The `student_progress` table continuously recomputes a student's mastery status (`weak`, `in_progress`, `mastered`) per topic. It actively detects and logs specific `primary_misconception_tag`s (e.g., "forgetting to regroup tens").
*   **Agent Decisions**: Every major AI action (explanation generation, question selection, report writing) is logged in the `agent_decisions` table with input snapshots and reasoning, ensuring full transparency and traceability of the AI's behavior.

## 🎨 User Experience
*   **Distraction-Free UI**: Minimal visual clutter to reduce cognitive load.
*   **Attention Check-ins**: Interstitial breaks featuring breathing animations to help students refocus.
*   **Streaks & Badges**: Positive reinforcement mechanics that reward consistency without creating anxiety-inducing competition.
*   **Q&A Widget**: An "Ask the Math Agent" interface embedded in lessons for on-demand help.
