// recorder.js — runs inside offscreen.html as ES module
// 
// AUDIO STRATEGY:
//   tabCapture  = captures what comes THROUGH the meeting (remote participants)
//   getUserMedia mic = captures the local speaker's own voice
//   Both are mixed together → full meeting audio of ALL participants

import { saveMeeting } from "./db.js";

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let micStream = null;
let tabStream = null;
let liveTranscriptText = "";

window.addEventListener("live-transcript-final", (e) => {
  liveTranscriptText += e.detail.text + " ";
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_START") {
    startCapture(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error("[recorder] startCapture failed:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  if (msg.type === "OFFSCREEN_STOP") {
    stopCapture();
    sendResponse({ ok: true });
    return false;
  }
});

async function startCapture(streamId) {
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  // ── TRACK 1: Tab audio (remote participants coming through speakers) ──
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId }
    },
    video: false
  });

  const tabSrc = audioContext.createMediaStreamSource(tabStream);
  tabSrc.connect(destination);          // record tab audio
  tabSrc.connect(audioContext.destination); // also play it so you can hear meeting

  // ── TRACK 2: Local mic (the notetaker/local speaker's own voice) ──
  // This is REQUIRED — tabCapture does NOT capture your own microphone.
  // Without this, the local speaker's voice is completely missing.
  let micCaptured = false;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, // keep echo cancellation OFF so mic captures full voice
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    });

    const micSrc = audioContext.createMediaStreamSource(micStream);

    // Gentle high-pass to cut low rumble (fan noise, desk vibration)
    const highPass = audioContext.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 80;

    // Light compressor to even out volume
    const comp = audioContext.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 30;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.1;

    micSrc.connect(highPass);
    highPass.connect(comp);
    comp.connect(destination); // record mic

    micCaptured = true;
    console.log("[recorder] Mic captured ✓");
  } catch (e) {
    // Mic permission denied or unavailable — still record tab audio only
    console.warn("[recorder] Mic unavailable — only remote audio will be recorded:", e.message);
  }

  // ── Start MediaRecorder on the mixed stream ──
  recordedChunks = [];
  liveTranscriptText = "";

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  mediaRecorder = new MediaRecorder(destination.stream, { mimeType });
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = saveRecording;
  mediaRecorder.start(1000); // save chunk every second — no data lost if browser closes

  chrome.runtime.sendMessage({ type: "RECORDING_STARTED" }).catch(() => {});
  window.dispatchEvent(new CustomEvent("start-transcription", { detail: { stream: destination.stream } }));

  console.log(`[recorder] Recording started. Tab audio: ✓  Mic: ${micCaptured ? "✓" : "✗ (not available)"}`);
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  window.dispatchEvent(new CustomEvent("stop-transcription"));
  micStream?.getTracks().forEach(t => t.stop());
  tabStream?.getTracks().forEach(t => t.stop());
  audioContext?.close();
  mediaRecorder = null; micStream = null; tabStream = null; audioContext = null;
  console.log("[recorder] Stopped.");
}

function saveRecording() {
  const blob = new Blob(recordedChunks, { type: "audio/webm" });
  console.log("[recorder] Saving blob, size:", blob.size, "bytes,", recordedChunks.length, "chunks");

  if (blob.size < 500) {
    console.error("[recorder] Blob too small — recording likely empty. Mic permission may have been denied.");
    chrome.runtime.sendMessage({
      type: "RECORDING_SAVE_FAILED",
      error: "Recording was empty. Make sure microphone permission is granted in Chrome settings."
    }).catch(() => {});
    return;
  }

  const meeting = {
    id: crypto.randomUUID(),
    title: "Meeting " + new Date().toLocaleString(),
    date: Date.now(),
    audioBlob: blob,
    transcript: null,
    keyPoints: null,
    liveTranscript: liveTranscriptText.trim()
  };

  saveMeeting(meeting)
    .then(() => {
      console.log("[recorder] Saved to IndexedDB:", meeting.id);
      chrome.runtime.sendMessage({
        type: "RECORDING_SAVED",
        meetingId: meeting.id,
        title: meeting.title
      }).catch(() => {});
    })
    .catch(err => {
      console.error("[recorder] DB save failed:", err);
      chrome.runtime.sendMessage({
        type: "RECORDING_SAVE_FAILED",
        error: err.message
      }).catch(() => {});
    });

  // Backup copy to Downloads folder
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({
      url: reader.result,
      filename: `MeetNotes/meeting-${Date.now()}.webm`,
      saveAs: false
    }).catch(() => {});
  };
  reader.readAsDataURL(blob);
}
