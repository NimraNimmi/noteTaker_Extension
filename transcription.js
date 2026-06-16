// transcription.js (runs inside offscreen.html)
//
// IMPORTANT LIMITATION:
// The Web Speech API (SpeechRecognition) in Chrome can ONLY listen to the
// microphone — it cannot be fed an arbitrary MediaStream (like tab audio).
// This is a browser restriction, not something code can bypass for free.
//
// PRACTICAL WORKAROUND (used here):
// We run SpeechRecognition on your microphone in parallel. This transcribes
// YOUR voice live in real time. For the FULL meeting transcript (everyone's
// audio, including tab audio), we transcribe the recorded .webm file AFTER
// the meeting ends using a free local Whisper model (see post-processing
// section in popup.js / README). This gives you:
//   - Live captions of your own speech during the call
//   - Full accurate transcript of everyone (post-meeting, free, offline)

let recognition = null;
let fullTranscript = [];

window.addEventListener("start-transcription", (e) => {
  startLiveTranscription();
});

window.addEventListener("stop-transcription", () => {
  stopLiveTranscription();
});

function startLiveTranscription() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("SpeechRecognition not supported in this context.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcriptPiece = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcriptPiece + " ";
      } else {
        interim += transcriptPiece;
      }
    }

    if (final) {
      fullTranscript.push({ text: final.trim(), time: Date.now(), speaker: "You" });
      window.dispatchEvent(new CustomEvent("live-transcript-final", { detail: { text: final.trim() } }));
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_UPDATE", text: final.trim(), final: true });
    }
    if (interim) {
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_UPDATE", text: interim, final: false });
    }
  };

  recognition.onerror = (e) => console.warn("Speech recognition error:", e.error);

  recognition.onend = () => {
    // Auto-restart if still recording (recognition stops after silence)
    if (recognition && recognition._shouldRestart) {
      recognition.start();
    }
  };

  recognition._shouldRestart = true;
  recognition.start();
}

function stopLiveTranscription() {
  if (recognition) {
    recognition._shouldRestart = false;
    recognition.stop();
  }
  fullTranscript = [];
}
