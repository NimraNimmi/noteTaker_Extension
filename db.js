// db.js
// IndexedDB storage for meeting recordings, transcripts, and summaries.
// Each meeting is one record: { id, title, date, audioBlob, transcript, keyPoints }

const DB_NAME = "meet-notetaker-db";
const DB_VERSION = 1;
const STORE_NAME = "meetings";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMeeting(meeting) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(meeting);
    tx.oncomplete = () => resolve(meeting.id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeeting(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllMeetings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const results = req.result || [];
      results.sort((a, b) => b.date - a.date);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMeeting(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateMeeting(id, updates) {
  const meeting = await getMeeting(id);
  if (!meeting) throw new Error("Meeting not found: " + id);
  Object.assign(meeting, updates);
  await saveMeeting(meeting);
  return meeting;
}

export async function saveMeetingSafe(meeting) {
  meeting.id = meeting.id || crypto.randomUUID();
  return saveMeeting(meeting);
}
