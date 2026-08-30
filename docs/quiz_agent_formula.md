# Quiz Agent - Adaptive Time Limit Formula

To support ADHD-friendly learning, the Quiz Agent dynamically calibrates the quiz time limit. It gives students enough breathing room without causing undue time anxiety.

## Formula Variables & Inputs

The algorithm considers up to the **last 3 completed quiz attempts** for the current student:
- **`prior_attempt_count`**: Number of completed quiz attempts (0 to 3).
- **`rolling_accuracy`**: Average accuracy percentage (0-100%) across the analyzed attempts.
- **`rolling_time_per_question`**: Average actual time used in seconds per question across those attempts:
  $$\text{rolling\_time\_per\_question} = \frac{\sum \text{time\_used}}{\sum \text{question\_count}}$$
- **`trend`**: Direction of student accuracy over the recent attempts:
  - **`improving`**: Most recent attempt accuracy > average accuracy of prior attempts.
  - **`declining`**: Most recent attempt accuracy < average accuracy of prior attempts.
  - **`stable`**: Accuracy has remained unchanged.
- **`prev_limit`**: The per-question time limit allocated on the most recent attempt.

---

## Adaptation Logic

### 1. Cold-Start (First-Ever Attempt)
If `prior_attempt_count` is 0:
- Use a **base time of 90 seconds** per question.

---

### 2. Accuracy-Based Adjustment
If history exists, the 90-second base per question is adjusted as follows:
- **Low Accuracy (< 60%):** Increase time limit per question by **+50%** (base becomes **135s**).
- **High Accuracy (> 85%):** Decrease time limit per question by **-20%** (base becomes **72s**).
- **Average Accuracy (60% - 85%):** Keep base at **90s**.

---

### 3. Trend Adjustment (Declining Trend Safeguard)
If the student's performance trend is **declining**:
- Override any accuracy-based decreases.
- Set the per-question time to at least **117s** (90s * 1.3).
- If time was already increased due to low accuracy (135s), add an extra **+10% buffer** (becomes **148.5s**) to relieve time pressure.

---

### 4. Time Usage Safeguard (Pacing Buffer)
If the student used **$\ge$ 80%** of their allocated time on the most recent attempt:
- Add a **+20% buffer** to the adjusted per-question time to prevent time stress.

---

### 5. Clamping & Final Output
To prevent outliers, the final calculated per-question time is strictly clamped to:
$$\text{Per-Question Time} \in [45\text{ seconds}, 150\text{ seconds}]$$

The overall quiz time limit is then:
$$\text{time\_limit\_seconds} = \text{Clamped Per-Question Time} \times \text{question\_count}$$

All calculations are logged to `agent_decisions` for audit.
