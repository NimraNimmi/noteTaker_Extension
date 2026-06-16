// content.js
// Runs on meet.google.com pages. Detects when you're actually in a meeting
// (vs. the lobby) and exposes meeting title/participant info to the extension.

function getMeetingInfo() {
  const titleEl = document.querySelector('[data-meeting-title]') ||
                   document.querySelector('div[jsname="r4nke"]');
  const title = titleEl ? titleEl.textContent.trim() : document.title;

  const url = window.location.href;
  const meetingCode = url.split("meet.google.com/")[1]?.split("?")[0] || "unknown";

  return { title, meetingCode, url };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_MEETING_INFO") {
    sendResponse(getMeetingInfo());
  }
});

// Notify background that a Meet tab is ready
chrome.runtime.sendMessage({ type: "MEET_TAB_READY", info: getMeetingInfo() }).catch(() => {});
