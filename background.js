// background.js — service worker
// Routes messages between popup/dashboard ↔ offscreen recorder

const STATE_KEY = "recordingState";

async function getState() {
  const d = await chrome.storage.session.get([STATE_KEY]);
  return d[STATE_KEY] || { isRecording: false, tabId: null, startTime: null };
}
async function setState(s) {
  await chrome.storage.session.set({ [STATE_KEY]: s });
}

// Broadcast to all extension pages (dashboard, popup) EXCEPT offscreen
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_STATE") {
    getState().then(async (state) => {
      if (state.isRecording) {
        const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
        if (!ctx.length) {
          state = { isRecording: false, tabId: null, startTime: null };
          await setState(state);
        }
      }
      sendResponse(state);
    });
    return true;
  }

  if (msg.type === "START_RECORDING") {
    startRecording(msg.tabId).then(sendResponse);
    return true;
  }

  if (msg.type === "STOP_RECORDING") {
    stopRecording().then(sendResponse);
    return true;
  }

  // From offscreen recorder — forward to UI pages only
  if (msg.type === "RECORDING_STARTED") {
    broadcast({ type: "RECORDING_STARTED" });
    return false;
  }

  if (msg.type === "TRANSCRIPT_UPDATE") {
    broadcast({ type: "TRANSCRIPT_CHUNK", text: msg.text, final: msg.final });
    return false;
  }

  if (msg.type === "RECORDING_SAVED") {
    setState({ isRecording: false, tabId: null, startTime: null });
    broadcast({ type: "RECORDING_DONE", meetingId: msg.meetingId, title: msg.title });
    return false;
  }

  if (msg.type === "RECORDING_SAVE_FAILED") {
    setState({ isRecording: false, tabId: null, startTime: null });
    broadcast({ type: "RECORDING_DONE_ERROR", error: msg.error });
    return false;
  }

  return false;
});

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture tab audio for meeting transcription"
  });
}

async function startRecording(tabId) {
  try {
    const state = await getState();
    const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });

    if (state.isRecording && ctx.length) return { ok: true, alreadyRecording: true };

    if (ctx.length && !state.isRecording) {
      await chrome.offscreen.closeDocument();
      await new Promise(r => setTimeout(r, 300));
    }

    // Focus the target tab (required for tabCapture API)
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.warn("Could not focus tab:", e);
    }

    await ensureOffscreen();
    await new Promise(r => setTimeout(r, 200));

    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      throw new Error("Could not capture tab audio. Make sure the Meet/Zoom tab is focused and visible. Error: " + e.message);
    }

    await setState({ isRecording: true, tabId, startTime: Date.now() });

    // Send to offscreen — fire and forget (offscreen will send RECORDING_STARTED back)
    chrome.runtime.sendMessage({ type: "OFFSCREEN_START", streamId }).catch(() => {});

    return { ok: true };
  } catch (err) {
    await setState({ isRecording: false, tabId: null, startTime: null });
    return { ok: false, error: err?.message || String(err) };
  }
}

async function stopRecording() {
  chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => {});
  const state = await getState();
  await setState({ ...state, isStopping: true });
  return { ok: true };
}
