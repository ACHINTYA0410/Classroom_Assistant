/**
 * Report Agent Service
 * Handles generating plain-language report narratives grounded in the student's progress stats.
 * Integrates with Gemini or OpenAI API if keys are provided, otherwise falls back to a deterministic fallback narrative generator.
 */

export interface StatsSnapshot {
  current_score: number;
  previous_score: number | null;
  score_delta: number;
  trend: 'improving' | 'declining' | 'stable';
  weak_topics: Array<{ topic_id: string; topic_name: string; primary_misconception_tag: string | null }>;
  strong_topics: Array<{ topic_id: string; topic_name: string }>;
}

export const generateNarrative = async (stats: StatsSnapshot): Promise<string> => {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const prompt = `You are a helpful and encouraging educational AI Report Agent.
Analyze this student's progress stats and write a brief, friendly, plain-language narrative (1-2 paragraphs) for the student explaining what changed and why it matters.
Rules:
1. Ground your response ONLY in the provided statistics snapshot. Do not invent any external facts.
2. Address the student directly in an encouraging tone.
3. Highlight their score improvement or outline steps to improve if it declined/remained stable.
4. Mention their mastered (strong) topics and address any weak topics without using technical database terminology (explain misconceptions in parent-friendly or student-friendly language).

Stats Snapshot:
- Current Quiz Score: ${stats.current_score}%
- Previous Quiz Score: ${stats.previous_score !== null ? `${stats.previous_score}%` : 'No prior quiz'}
- Score Delta: ${stats.score_delta > 0 ? `+${stats.score_delta}%` : `${stats.score_delta}%`}
- Overall Trend: ${stats.trend}
- Strong Topics: ${stats.strong_topics.length > 0 ? stats.strong_topics.map(t => t.topic_name).join(', ') : 'None yet'}
- Weak Topics: ${stats.weak_topics.length > 0 ? stats.weak_topics.map(t => `${t.topic_name} (Misconception: ${t.primary_misconception_tag || 'Needs review'})`).join(', ') : 'None'}`;

  if (geminiKey) {
    try {
      console.log('[Report Agent] Calling Gemini 2.0 Flash to generate narrative...');
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );
      if (response.ok) {
        const json = await response.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log('[Report Agent] Successfully generated narrative from Gemini.');
          return text.trim();
        }
      } else {
        const errBody = await response.text();
        console.error(`[Report Agent] Gemini API error ${response.status}:`, errBody);
      }
    } catch (err) {
      console.error('[Report Agent] Gemini API call threw an exception:', err);
    }
  } else {
    console.warn('[Report Agent] VITE_GEMINI_API_KEY is not set. Using fallback narrative.');
  }



  if (openaiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful educational AI assistant.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (response.ok) {
        const json = await response.json();
        const text = json.choices?.[0]?.message?.content;
        if (text) return text.trim();
      }
    } catch (err) {
      console.warn('OpenAI API call failed, using local narrative fallback:', err);
    }
  }

  return generateNarrativeFallback(stats);
};

const generateNarrativeFallback = (stats: StatsSnapshot): string => {
  const parts: string[] = [];

  // Intro message based on trend and delta
  if (stats.previous_score === null) {
    parts.push(
      `Fantastic job taking your first assessment! You scored ${stats.current_score}% which establishes a great baseline for your learning journey.`
    );
  } else if (stats.score_delta > 0) {
    parts.push(
      `Awesome work! Your score increased to ${stats.current_score}% (a boost of +${stats.score_delta}% from your previous score of ${stats.previous_score}%). This shows that your hard work and practice are really paying off!`
    );
  } else if (stats.score_delta < 0) {
    parts.push(
      `You completed the assessment with a score of ${stats.current_score}%. Although this is slightly lower than your previous score of ${stats.previous_score}%, remember that learning is a journey full of ups and downs. Every mistake is just another step toward mastery!`
    );
  } else {
    parts.push(
      `Great effort! You maintained a stable score of ${stats.current_score}%, matching your previous performance. Keeping your skills sharp is a big win!`
    );
  }

  // Strong topics highlight
  if (stats.strong_topics.length > 0) {
    const strongList = stats.strong_topics.map(t => t.topic_name).join(' and ');
    parts.push(
      `You are showing exceptional strength in ${strongList}. Your understanding here is solid, and you're consistently getting these concepts correct.`
    );
  }

  // Weak topics focus
  if (stats.weak_topics.length > 0) {
    const weakList = stats.weak_topics.map(t => {
      let desc = t.topic_name;
      if (t.primary_misconception_tag) {
        const friendlyMsg = getFriendlyMisconception(t.primary_misconception_tag);
        desc += ` (where we noticed you might be ${friendlyMsg})`;
      }
      return desc;
    }).join(', ');
    parts.push(
      `To continue growing, let's spend a bit more time reviewing ${weakList}. Focusing on these specific areas in your next sessions will help you push past these hurdles in no time!`
    );
  } else {
    parts.push("You don't have any major areas that need review right now. Keep up the perfect streak!");
  }

  return parts.join(' ');
};

const getFriendlyMisconception = (tag: string): string => {
  const mapping: Record<string, string> = {
    forget_regrouping_tens: 'forgetting to add the regrouped 10 to the tens column',
    forget_regrouping: 'missing the regrouping step when numbers exceed 9',
    ones_column_only: 'only adding the ones digits',
    add_regrouped_to_ones: 'accidentally adding the regrouped ten to the ones column instead of the tens column',
  };
  return mapping[tag] || tag.replace(/_/g, ' ');
};
