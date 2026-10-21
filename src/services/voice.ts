export const stopSpeaking = () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };

export const speak = async (text: string) => {
  // User-triggered browser speech keeps provider credentials out of the browser.
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
