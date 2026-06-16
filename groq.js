// groq.js

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";
const GROQ_AUDIO_MODEL = "whisper-large-v3";
const GROQ_MAX_BYTES = 24 * 1024 * 1024; // 24MB — stay under 25MB limit

export async function getGroqKey() {
  const d = await chrome.storage.local.get(["groqApiKey"]);
  return d.groqApiKey || null;
}
export async function setGroqKey(key) {
  await chrome.storage.local.set({ groqApiKey: key });
}

// ── Audio transcription — auto-chunks if file > 24MB ──
export async function groqTranscribe(audioBlob, onProgress) {
  const apiKey = await getGroqKey();
  if (!apiKey) return null;

  if (audioBlob.size <= GROQ_MAX_BYTES) {
    // Small file — send directly
    return await transcribeChunk(audioBlob, apiKey);
  }

  // Large file — split into ~24MB chunks and join transcripts
  const chunks = splitBlob(audioBlob, GROQ_MAX_BYTES);
  console.log(`[groq] File ${(audioBlob.size/1024/1024).toFixed(1)}MB — splitting into ${chunks.length} chunks`);

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i + 1, chunks.length);
    console.log(`[groq] Transcribing chunk ${i+1}/${chunks.length} (${(chunks[i].size/1024/1024).toFixed(1)}MB)`);
    const text = await transcribeChunk(chunks[i], apiKey);
    if (text) parts.push(text);
    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  return parts.join(" ").trim() || null;
}

function splitBlob(blob, maxBytes) {
  const chunks = [];
  let offset = 0;
  while (offset < blob.size) {
    chunks.push(blob.slice(offset, offset + maxBytes, blob.type));
    offset += maxBytes;
  }
  return chunks;
}

async function transcribeChunk(blob, apiKey) {
  try {
    const form = new FormData();
    form.append("file", blob, "recording.webm");
    form.append("model", GROQ_AUDIO_MODEL);
    form.append("language", "en");
    form.append("response_format", "text");

    const res = await fetch(GROQ_AUDIO_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[groq] Audio error:", res.status, err);
      return null;
    }
    return (await res.text()).trim() || null;
  } catch (e) {
    console.error("[groq] transcribeChunk failed:", e);
    return null;
  }
}

// ── Chat ──
async function callGroq(messages, maxTokens = 1024) {
  const apiKey = await getGroqKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: GROQ_CHAT_MODEL, messages, max_tokens: maxTokens, temperature: 0.3 })
    });
    if (!res.ok) { console.error("[groq] Chat error:", res.status, await res.text()); return null; }
    return (await res.json()).choices?.[0]?.message?.content || null;
  } catch (e) { console.error("[groq] callGroq failed:", e); return null; }
}

export async function groqSummarize(transcript) {
  const t = transcript.length > 24000 ? transcript.slice(0, 24000) + "..." : transcript;
  return await callGroq([
    { role: "system", content: "You are a meeting notes assistant. Given a transcript produce: 1) 2-3 sentence overview, 2) Key discussion points as bullet points, 3) Action items/decisions as bullet points. Be concise. Use Markdown." },
    { role: "user", content: `Transcript:\n\n${t}` }
  ], 1024);
}

export async function groqAnswer(question, transcript, history = []) {
  const t = transcript.length > 20000 ? transcript.slice(0, 20000) + "..." : transcript;
  return await callGroq([
    { role: "system", content: `Answer questions about this meeting transcript only. If not found, say so.\n\nTranscript:\n\n${t}` },
    ...(history || []).slice(-10),
    { role: "user", content: question }
  ], 512);
}
