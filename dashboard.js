// dashboard.js — NO local Whisper dependency, uses Groq cloud only
import { getGroqKey, setGroqKey, groqTranscribe, groqSummarize, groqAnswer } from "./groq.js";
import { getAllMeetings, getMeeting, updateMeeting, deleteMeeting } from "./db.js";

// ---- Element refs ----
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const meetingsListEl = document.getElementById("meetingsList");
const groqKeyInput = document.getElementById("groqKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatusEl = document.getElementById("keyStatus");
const noSelectionEl = document.getElementById("noSelection");
const meetingViewEl = document.getElementById("meetingView");
const meetingTitleEl = document.getElementById("meetingTitle");
const meetingTitleInputEl = document.getElementById("meetingTitleInput");
const saveTitleBtn = document.getElementById("saveTitleBtn");
const audioPlayerEl = document.getElementById("audioPlayer");
const transcribeBtn = document.getElementById("transcribeBtn");
const manualTranscribeBtn = document.getElementById("manualTranscribeBtn");
const deleteBtn = document.getElementById("deleteBtn");
const transcribeStatusEl = document.getElementById("transcribeStatus");
const liveTranscriptEl = document.getElementById("liveTranscript");
const fullTranscriptEl = document.getElementById("fullTranscript");
const manualTranscriptInputEl = document.getElementById("manualTranscriptInput");
const saveManualTranscriptBtn = document.getElementById("saveManualTranscriptBtn");
const cancelManualTranscriptBtn = document.getElementById("cancelManualTranscriptBtn");
const keyPointsEl = document.getElementById("keyPoints");
const chatInputEl = document.getElementById("chatInput");
const chatBtn = document.getElementById("chatBtn");
const chatHistoryEl = document.getElementById("chatHistory");

// ---- State ----
let currentMeetingId = null;
let fullTranscript = "";
let sentences = [];
let chatHistory = [];

// ============================================================
// RECORDING CONTROLS
// ============================================================
async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (state?.isRecording) {
      statusEl.textContent = state.isStopping ? "Stopping..." : "🔴 Recording...";
      statusEl.classList.add("recording");
      startBtn.textContent = "Recording..."; startBtn.disabled = true;
      stopBtn.textContent = state.isStopping ? "Stopping..." : "Stop Recording";
      stopBtn.disabled = !!state.isStopping;
    } else {
      statusEl.textContent = "Not recording"; statusEl.classList.remove("recording");
      startBtn.textContent = "Start Recording"; startBtn.disabled = false;
      stopBtn.textContent = "Stop Recording"; stopBtn.disabled = true;
    }
  } catch (e) { console.warn("refreshState:", e); }
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true; startBtn.textContent = "Starting...";
  const meetTabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
  const zoomTabs = await chrome.tabs.query({ url: "https://*.zoom.us/*" });
  const tabs = [...meetTabs, ...zoomTabs];
  if (!tabs.length) {
    alert("Open a Google Meet or Zoom tab first.");
    startBtn.disabled = false; startBtn.textContent = "Start Recording"; return;
  }
  const res = await chrome.runtime.sendMessage({ type: "START_RECORDING", tabId: tabs[0].id });
  if (!res?.ok) {
    startBtn.disabled = false; startBtn.textContent = "Start Recording";
    alert("Failed to start:\n\n" + (res?.error || "Unknown"));
  } else {
    await refreshState();
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true; stopBtn.textContent = "Stopping...";
  await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  await refreshState();
});

// ============================================================
// MESSAGES FROM BACKGROUND
// ============================================================
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") {
    statusEl.textContent = "🔴 Recording..."; statusEl.classList.add("recording");
    startBtn.disabled = true; startBtn.textContent = "Recording...";
    stopBtn.disabled = false; stopBtn.textContent = "Stop Recording";
  }
  if (msg.type === "TRANSCRIPT_CHUNK" && msg.final) {
    liveTranscriptEl.textContent += msg.text + " ";
    liveTranscriptEl.scrollTop = liveTranscriptEl.scrollHeight;
  }
  if (msg.type === "RECORDING_DONE") {
    refreshState();
    loadList().then(() => {
      if (msg.meetingId) setTimeout(() => runTranscription(msg.meetingId, false), 600);
    });
  }
  if (msg.type === "RECORDING_DONE_ERROR") {
    refreshState(); alert("Recording save failed: " + msg.error);
  }
});

// ============================================================
// GROQ KEY
// ============================================================
saveKeyBtn.addEventListener("click", async () => {
  const key = groqKeyInput.value.trim();
  await setGroqKey(key);
  keyStatusEl.textContent = key
    ? "✓ Key saved. Fast cloud transcription enabled!"
    : "Key cleared.";
});

// ============================================================
// MEETINGS LIST — loaded fresh from IndexedDB every time
// ============================================================
async function loadList() {
  const meetings = await getAllMeetings();
  if (!meetings.length) {
    meetingsListEl.innerHTML = '<div class="muted">No recordings yet.</div>'; return;
  }
  meetingsListEl.innerHTML = meetings.map(m => `
    <div class="meeting-item ${m.id === currentMeetingId ? "active" : ""}" data-id="${m.id}">
      <div class="meeting-item-title">${esc(m.title)}</div>
      <div class="meeting-item-date">${new Date(m.date).toLocaleString()}</div>
      <div class="meeting-item-status ${m.transcript ? "transcribed" : "not-transcribed"}">
        ${m.transcript ? "✓ Transcribed" : "⏳ Not transcribed"}
      </div>
    </div>`).join("");
  meetingsListEl.querySelectorAll(".meeting-item")
    .forEach(el => el.addEventListener("click", () => openMeeting(el.dataset.id)));
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// ============================================================
// OPEN / VIEW MEETING
// ============================================================
async function openMeeting(id) {
  const meeting = await getMeeting(id);
  if (!meeting) return;

  currentMeetingId = id;
  chatHistory = [];

  noSelectionEl.classList.add("hidden");
  meetingViewEl.classList.remove("hidden");

  meetingTitleEl.textContent = meeting.title;
  meetingTitleInputEl.value = meeting.title;

  if (audioPlayerEl.src?.startsWith("blob:")) URL.revokeObjectURL(audioPlayerEl.src);
  audioPlayerEl.src = URL.createObjectURL(meeting.audioBlob);

  liveTranscriptEl.textContent = meeting.liveTranscript || "(no live captions)";
  hideManualEditor();
  if (chatHistoryEl) chatHistoryEl.innerHTML = "";

  if (meeting.transcript) {
    fullTranscript = meeting.transcript;
    sentences = toSentences(fullTranscript);
    fullTranscriptEl.textContent = fullTranscript;
    transcribeStatusEl.textContent = "✓ Transcribed";
    transcribeBtn.textContent = "Re-transcribe";
    transcribeBtn.disabled = false;
    manualTranscribeBtn.classList.remove("hidden");
  } else {
    fullTranscript = ""; sentences = [];
    fullTranscriptEl.textContent = "(not transcribed yet — starting now...)";
    transcribeStatusEl.textContent = "";
    transcribeBtn.textContent = "Transcribe (Groq Whisper)";
    transcribeBtn.disabled = false;
    manualTranscribeBtn.classList.add("hidden");
  }

  keyPointsEl.innerHTML = meeting.keyPoints
    ? meeting.keyPoints.replace(/\n/g, "<br>")
    : "(will generate after transcription)";

  await loadList();
  if (!meeting.transcript) runTranscription(id, false);
}

// ============================================================
// TITLE RENAME
// ============================================================
saveTitleBtn?.addEventListener("click", async () => {
  if (!currentMeetingId) return;
  const t = meetingTitleInputEl.value.trim(); if (!t) return;
  await updateMeeting(currentMeetingId, { title: t });
  meetingTitleEl.textContent = t;
  await loadList();
});

// ============================================================
// DELETE
// ============================================================
deleteBtn.addEventListener("click", async () => {
  if (!currentMeetingId || !confirm("Delete this recording permanently?")) return;
  await deleteMeeting(currentMeetingId);
  currentMeetingId = null;
  fullTranscript = ""; sentences = []; chatHistory = [];
  meetingViewEl.classList.add("hidden");
  noSelectionEl.classList.remove("hidden");
  await loadList();
});

// ============================================================
// TRANSCRIPTION — Groq Whisper cloud only (no local model)
// ============================================================
transcribeBtn.addEventListener("click", async () => {
  if (!currentMeetingId) return;
  if (transcribeBtn.textContent.includes("Re-") &&
      !confirm("Replace existing transcript?")) return;
  await runTranscription(currentMeetingId, true);
});

async function runTranscription(meetingId, force) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return;
  if (!force && meeting.transcript) return; // already done, skip

  const isCurrent = meetingId === currentMeetingId;

  if (isCurrent) {
    transcribeBtn.disabled = true;
    fullTranscriptEl.textContent = "(transcribing...)";
    transcribeStatusEl.textContent = "Contacting Groq Whisper...";
  }

  const key = await getGroqKey();

  if (!key) {
    if (isCurrent) {
      transcribeStatusEl.textContent = "❌ No Groq API key. Add your key above and click Transcribe.";
      fullTranscriptEl.textContent = "(add Groq key above to transcribe — or use Manual Entry)";
      transcribeBtn.disabled = false;
      manualTranscribeBtn.classList.remove("hidden");
    }
    return;
  }

  const transcript = await groqTranscribe(meeting.audioBlob, isCurrent ? (done, total) => {
    transcribeStatusEl.textContent = `Transcribing chunk ${done}/${total} (large recording — splitting)...`;
  } : null);

  if (!transcript) {
    if (isCurrent) {
      transcribeStatusEl.textContent = "❌ Groq transcription failed. Check your API key or try Manual Entry.";
      fullTranscriptEl.textContent = "(failed — try again or use Manual Entry)";
      transcribeBtn.disabled = false;
      manualTranscribeBtn.classList.remove("hidden");
    }
    return;
  }

  // Save to DB
  await updateMeeting(meetingId, { transcript });

  if (isCurrent) {
    fullTranscript = transcript;
    sentences = toSentences(transcript);
    fullTranscriptEl.textContent = transcript;
    transcribeStatusEl.textContent = `✓ Done — ${sentences.length} sentences`;
    transcribeBtn.textContent = "Re-transcribe";
    transcribeBtn.disabled = false;
    manualTranscribeBtn.classList.remove("hidden");
    await generateSummary();
  } else {
    // Background recording: also summarize
    const summary = await groqSummarize(transcript);
    if (summary) await updateMeeting(meetingId, { keyPoints: summary });
  }

  await loadList();
}

// ============================================================
// MANUAL TRANSCRIPT
// ============================================================
manualTranscribeBtn?.addEventListener("click", showManualEditor);
cancelManualTranscriptBtn?.addEventListener("click", hideManualEditor);
saveManualTranscriptBtn?.addEventListener("click", async () => {
  if (!currentMeetingId) return;
  const text = manualTranscriptInputEl.value.trim();
  if (!text) { alert("Please enter a transcript."); return; }
  await updateMeeting(currentMeetingId, { transcript: text });
  fullTranscript = text; sentences = toSentences(text);
  fullTranscriptEl.textContent = text;
  transcribeStatusEl.textContent = "✓ Manual transcript saved";
  transcribeBtn.textContent = "Re-transcribe";
  transcribeBtn.disabled = false;
  hideManualEditor();
  await generateSummary();
  await loadList();
});

function showManualEditor() {
  manualTranscriptInputEl.value = fullTranscript || "";
  document.getElementById("manualTranscriptSection").classList.remove("hidden");
}
function hideManualEditor() {
  document.getElementById("manualTranscriptSection")?.classList.add("hidden");
}

// ============================================================
// SUMMARY / KEY POINTS
// ============================================================
async function generateSummary() {
  if (!sentences.length) return;
  keyPointsEl.textContent = "Generating summary...";
  const key = await getGroqKey();
  const summary = key ? await groqSummarize(fullTranscript) : null;
  const final = summary || fallbackSummary(sentences);
  keyPointsEl.innerHTML = final.replace(/\n/g, "<br>");
  if (currentMeetingId) await updateMeeting(currentMeetingId, { keyPoints: final });
}

function fallbackSummary(sents) {
  // Simple extractive summary when no Groq key
  const stop = new Set(["the","a","an","and","or","but","is","are","was","were","to","of","in","on","for","with","this","that","it","we","you","i","they","he","she","be","as","at","by","um","uh","okay","yeah","right","so","just"]);
  const freq = {};
  sents.forEach(s => (s.toLowerCase().match(/[a-z']+/g)||[]).filter(w=>!stop.has(w)&&w.length>2).forEach(w=>freq[w]=(freq[w]||0)+1));
  const scored = sents.map((s,i) => {
    const ws = (s.toLowerCase().match(/[a-z']+/g)||[]).filter(w=>!stop.has(w)&&w.length>2);
    const score = ws.reduce((a,w)=>a+(freq[w]||0),0) / (ws.length||1);
    return { s, i, score };
  });
  return scored.sort((a,b)=>b.score-a.score)
    .slice(0, Math.max(3, Math.ceil(sents.length*0.15)))
    .sort((a,b)=>a.i-b.i)
    .map(x=>"• "+x.s.trim()).join("\n");
}

// ============================================================
// CHAT
// ============================================================
chatBtn.addEventListener("click", doChat);
chatInputEl.addEventListener("keydown", e => { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();doChat();} });

async function doChat() {
  const q = chatInputEl.value.trim();
  if (!q) return;
  if (!sentences.length) { addMsg("assistant","Transcribe this meeting first to enable chat."); return; }
  addMsg("you", q);
  chatInputEl.value = "";
  chatBtn.disabled = true;
  addMsg("assistant", "Thinking...", true);

  const key = await getGroqKey();
  const answer = key
    ? (await groqAnswer(q, fullTranscript, chatHistory)) || localSearch(q)
    : localSearch(q);

  chatHistory.push({ role: "user", content: q }, { role: "assistant", content: answer });
  // Keep last 20 turns
  if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

  updateTemp(answer);
  chatBtn.disabled = false;
}

function addMsg(role, text, temp=false) {
  const d = document.createElement("div");
  d.className = `chat-msg chat-msg-${role}${temp?" chat-temp":""}`;
  d.textContent = text;
  chatHistoryEl.appendChild(d);
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}
function updateTemp(text) {
  const t = chatHistoryEl.querySelector(".chat-temp");
  if (t) { t.textContent=text; t.classList.remove("chat-temp"); } else addMsg("assistant",text);
}
function localSearch(q) {
  const qw = q.toLowerCase().match(/[a-z']+/g)||[];
  const hits = sentences
    .map((s,i)=>({s,i,n:(s.toLowerCase().match(/[a-z']+/g)||[]).filter(w=>qw.includes(w)).length}))
    .filter(x=>x.n>0).sort((a,b)=>b.n-a.n).slice(0,3).sort((a,b)=>a.i-b.i);
  return hits.length ? hits.map(x=>x.s.trim()).join("\n\n") : "Nothing matching found in transcript.";
}

// ============================================================
// HELPERS
// ============================================================
function toSentences(text) {
  return text.replace(/\s+/g," ").match(/[^.!?]+[.!?]+/g) || [text];
}

// ============================================================
// INIT — runs every time dashboard opens/reloads
// ============================================================
(async () => {
  await refreshState();
  await loadList(); // loads ALL meetings from IndexedDB — persists forever

  const key = await getGroqKey();
  if (key) {
    groqKeyInput.value = key;
    keyStatusEl.textContent = "✓ Groq key loaded — cloud transcription ready";
  } else {
    keyStatusEl.textContent = "⚠️ Add a free Groq key above for transcription";
  }
})();
