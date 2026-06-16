// popup.js
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const openDashboardBtn = document.getElementById("openDashboardBtn");

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (state && state.isRecording) {
      const stopping = !!state.isStopping;
      statusEl.textContent = stopping ? "Stopping..." : "🔴 Recording...";
      statusEl.classList.add("recording");
      startBtn.textContent = "Recording...";
      startBtn.disabled = true;
      stopBtn.textContent = stopping ? "Stopping..." : "Stop Recording";
      stopBtn.disabled = stopping;
    } else {
      statusEl.textContent = "Not recording";
      statusEl.classList.remove("recording");
      startBtn.textContent = "Start Recording";
      startBtn.disabled = false;
      stopBtn.textContent = "Stop Recording";
      stopBtn.disabled = true;
    }
  } catch (e) {
    console.warn("refreshState error:", e);
  }
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Starting...";
  statusEl.textContent = "Starting...";

  // Find a Meet or Zoom tab — don't rely on the currently active tab
  // because clicking the extension icon makes the popup the active context
  const meetTabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
  const zoomTabs = await chrome.tabs.query({ url: "https://*.zoom.us/*" });
  const allTabs = [...meetTabs, ...zoomTabs];

  if (allTabs.length === 0) {
    // No meeting tab found — allow recording any tab as fallback
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.url || activeTab.url.startsWith("chrome://")) {
      alert("Open a Google Meet or Zoom tab first, then try again.");
      startBtn.disabled = false;
      startBtn.textContent = "Start Recording";
      statusEl.textContent = "Not recording";
      return;
    }
    // Use the active tab as fallback
    allTabs.push(activeTab);
  }

  const targetTab = allTabs[0];

  try {
    const res = await chrome.runtime.sendMessage({ type: "START_RECORDING", tabId: targetTab.id });
    if (!res || !res.ok) {
      startBtn.disabled = false;
      startBtn.textContent = "Start Recording";
      statusEl.textContent = "Not recording";
      alert("Failed to start recording:\n\n" + (res?.error || "Unknown error") +
            "\n\nTip: Make sure the Meet tab is visible and focused before clicking Start.");
      return;
    }
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = "Start Recording";
    statusEl.textContent = "Not recording";
    alert("Error: " + err.message);
    return;
  }

  await refreshState();
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  stopBtn.textContent = "Stopping...";
  await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  await refreshState();
});

openDashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") {
    statusEl.textContent = "🔴 Recording...";
    statusEl.classList.add("recording");
    startBtn.disabled = true;
    startBtn.textContent = "Recording...";
    stopBtn.disabled = false;
    stopBtn.textContent = "Stop Recording";
  }
  if (msg.type === "RECORDING_DONE" || msg.type === "RECORDING_DONE_ERROR") {
    refreshState();
  }
});

refreshState();
