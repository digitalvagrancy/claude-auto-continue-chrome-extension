// ============================================================
// popup.js - the little settings window when you click the icon.
// Settings save automatically the moment you change them.
// ============================================================
const $ = (id) => document.getElementById(id);

// Every setting that has a control in the popup.
const CHECKS  = ["enabled", "onlyOnce", "keepAwake", "timestamp", "useDetectedTime", "bringToFront", "reloadFirst"]; // switches
const NUMBERS = ["resetBufferMinutes", "retryMinutes", "maxRetries", "fallbackHours"];                  // number boxes
const TEXTS   = ["message", "ntfyTopic"];                                                               // text boxes

async function load() {
  const s = await getSettings();
  CHECKS.forEach((k) => ($(k).checked = s[k]));
  NUMBERS.concat(TEXTS).forEach((k) => ($(k).value = s[k]));
  refreshStatus();
}

async function save() {
  const current = await getSettings();
  const next = { ...current };
  CHECKS.forEach((k) => (next[k] = $(k).checked));
  NUMBERS.forEach((k) => { const v = Number($(k).value); next[k] = Number.isFinite(v) && $(k).value !== "" ? v : current[k]; });
  TEXTS.forEach((k) => (next[k] = $(k).value.trim() || DEFAULTS[k]));
  await chrome.storage.local.set({ settings3: next });
  $("saved").style.opacity = 1;
  setTimeout(() => ($("saved").style.opacity = 0), 1200);
}

async function refreshStatus() {
  const s = await getSettings();
  const { state } = await chrome.storage.local.get("state");
  const st = state || { log: [] };
  const pill = $("pill");
  pill.className = "";
  if (!s.enabled) {
    pill.textContent = "Paused"; pill.className = "paused";
    $("statusText").textContent = "Switched off. Nothing will be sent.";
  } else if (st.armed) {
    pill.textContent = "Armed"; pill.className = "armed";
    $("statusText").textContent = "Limit spotted. Will press continue at " + new Date(st.fireAt).toLocaleString() +
      (st.fireSource === "fallback" ? " (estimate: no reset time could be read)" : "");
  } else {
    pill.textContent = "Idle";
    $("statusText").textContent = "Waiting for a limit message. Nothing will be sent until one shows up.";
  }
  $("log").textContent = (st.log || []).join("\n") || "Nothing yet.";
}

// Auto-save whenever any control changes.
CHECKS.concat(NUMBERS, TEXTS).forEach((k) => $(k).addEventListener("change", async () => { await save(); refreshStatus(); }));
setInterval(refreshStatus, 2000); // keep the status card fresh while the popup is open

function showOut(text) { $("outCard").hidden = false; $("out").textContent = text; }

async function activeClaudeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith("https://claude.ai/")) return null;
  return tab;
}

// Talks to the Claude tab. If the tab was open before an update (so it has no extension code yet),
// this installs the code into it automatically and tries again - no refresh needed.
async function sendToTab(tab, msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["shared.js", "content.js"] });
    await new Promise((r) => setTimeout(r, 800));
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

$("check").onclick = async () => {
  const tab = await activeClaudeTab();
  if (!tab) return showOut("Open your Claude chat tab first, then click Check now.");
  showOut("Checking...");
  try { showOut(JSON.stringify(await sendToTab(tab, { type: "CHECK_NOW" }), null, 2)); }
  catch (e) { showOut("Couldn't reach the page: " + e.message); }
  refreshStatus();
};

$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("out").textContent);
  $("copy").textContent = "Copied ✓";
  setTimeout(() => ($("copy").textContent = "Copy"), 1200);
};

$("dry").onclick = async () => {
  const tab = await activeClaudeTab();
  if (!tab) return showOut("Open a claude.ai chat tab first, then click this.");
  showOut("Checking (takes ~5 seconds)...");
  const s = await getSettings();
  try { showOut(JSON.stringify(await sendToTab(tab, { type: "TRY_SEND", message: s.message, keywords: s.keywords, dryRun: true }), null, 2)); }
  catch (e) { showOut("Couldn't reach the page: " + e.message); }
};

$("full").onclick = async () => {
  const tab = await activeClaudeTab();
  if (!tab || !tab.url.includes("/chat/")) return showOut("Open an actual chat (URL contains /chat/) first.");
  showOut("Full test running. Check the Activity log in about 40 seconds.");
  chrome.runtime.sendMessage({ type: "FULL_TEST", url: tab.url });
};

$("ntfyTest").onclick = async () => {
  await save(); // make sure the topic you just typed is saved first
  showOut("Sending test alert...");
  const r = await chrome.runtime.sendMessage({ type: "NTFY_TEST" });
  showOut(r && r.result === "sent" ? "Test alert sent. Check your phone." : "Alert not sent: " + (r && r.result));
};

load();
