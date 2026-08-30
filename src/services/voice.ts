export const speak = async (text: string) => {
  const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;

  if (apiKey && apiKey !== 'your_api_key_here') {
    try {
      // Stub for ElevenLabs API
      const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await audio.play();
        return;
      } else {
        console.warn("ElevenLabs API failed, falling back to speechSynthesis");
      }
    } catch (error) {
      console.warn("ElevenLabs API failed, falling back to speechSynthesis", error);
    }
  }

  // Fallback to browser speechSynthesis
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    // Try to pick a calm, friendly voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes("Google US English") || v.lang === 'en-US');
    if (preferredVoice) utterance.voice = preferredVoice;
    
    window.speechSynthesis.speak(utterance);
  } else {
    console.warn("Speech synthesis not supported in this browser.");
  }
};
