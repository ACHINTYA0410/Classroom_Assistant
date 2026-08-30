# Inclusive Classroom Assistant

This is a React-based web application tailored for students with ADHD, providing a calm, distraction-free learning environment for Grade 2–5 Mathematics.

## Voice Stub Setup
This application includes a stubbed text-to-speech feature. 
To enable the ElevenLabs API, copy `.env.example` to `.env` and add your API key:
```
VITE_ELEVENLABS_API_KEY=your_api_key_here
```
If the API key is not provided, the application will safely fallback to the browser's built-in `speechSynthesis` API for demoing purposes.

## Animations
The "Attention Check-in" and "Streaks and Badges" screens use open-source Lottie animations from LottieFiles.
- Attention Check-in: Breathing/Gentle Wave (Calm, non-stimulating)
- Streaks and Badges: Star Pop/Confetti (Celebratory)
