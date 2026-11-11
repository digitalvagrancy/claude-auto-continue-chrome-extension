// ============================================================
// background.js - the "brain". Runs quietly in the background.
// Owns the alarm clock, the safety checks, keep-awake, alerts and retry logic.
// ============================================================
importScripts("shared.js");

const COOLDOWN_MS = 10 * 60 * 1000;        // after a send, ignore new limit messages for 10 min
const ARM_EXPIRY_MS = 20 * 60 * 60 * 1000; // a "limit seen" flag expires after 20 hours
const STALE_RUN_MS = 5 * 60 * 1000;        // a "busy" flag older than this is treated as stuck

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- saved state ----------
async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return { armed: false, armedUrl: null, armedAt: 0, fireAt: 0, fireSource: "", lastSentAt: 0, attempts: 0, running: false, runningSince: 0, log: [], ...(state || {}) };
}
async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ state: next });
  chrome.action.setBadgeText({ text: next.armed ? "ARM" : "" }); // "ARM" = limit seen, waiting
  chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
  await syncKeepAwake(next.armed);
  return next;
}
async function log(text) {
  const st = await getState();
  await setState({ log: [new Date().toLocaleString() + " - " + text, ...st.log].slice(0, 15) });
}

// ---------- keep the computer awake while armed ----------
async function syncKeepAwake(armed) {
  const s = await getSettings();
  try {
    if (armed && s.enabled && s.keepAwake) chrome.power.requestKeepAwake("system"); // screen can still turn off
    else chrome.power.releaseKeepAwake();
  } catch (e) { /* not fatal */ }
}

// ---------- phone alerts via ntfy.sh ----------
// Returns "sent" or an error text. Titles are plain English letters only (HTTP headers can't hold emoji).
async function notify(title, message, priority = "default", tags = "") {
  const s = await getSettings();
  if (!s.ntfyTopic) return "no topic set";
  try {
    const r = await fetch("https://ntfy.sh/" + encodeURIComponent(s.ntfyTopic), {
      method: "POST",
      body: message,
      headers: { Title: title, Priority: priority, Tags: tags }
    });
    return r.ok ? "sent" : "ntfy answered with error " + r.status;
  } catch (e) {
    return "failed: " + e.message;
  }
}

// ---------- setup / restore ----------
// Make the extension work in Claude tabs that were already open (no refresh needed after an update).
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  for (const t of tabs) {
    try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["shared.js", "content.js"] }); } catch (e) { /* sleeping tab - fine */ }
  }
}
// If Chrome was restarted while armed, put the alarm back.
async function restoreAlarm() {
  const st = await getState();
  if (st.armed && st.fireAt) chrome.alarms.create("reset", { when: Math.max(st.fireAt, Date.now() + 5000) });
  await setState({}); // re-applies the badge + keep-awake
}
chrome.runtime.onInstalled.addListener(async () => { await injectIntoOpenTabs(); await restoreAlarm(); });
chrome.runtime.onStartup.addListener(restoreAlarm);
chrome.storage.onChanged.addListener(async (c) => { if (c.settings3) await syncKeepAwake((await getState()).armed); });

// ---------- alarms ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const s = await getSettings();
  if (!s.enabled) return;
  if (alarm.name === "reset") { await setState({ attempts: 0 }); await attempt(); }
  if (alarm.name === "retry") await attempt();
});

// ---------- builds the text that gets typed ----------
// Example: "Continue [auto-sent 1:10 AM, 11 Nov]". Square brackets + "auto-sent" make it
// obviously a note-to-self, so Claude just carries on with the task and ignores the tag.
function buildMessage(s) {
  if (!s.timestamp) return s.message;
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { day: "numeric", month: "short" });
  return s.message + " [auto-sent " + time + ", " + date + "]";
}

// ---------- the main routine ----------
async function attempt() {
  const st = await getState();
  const s = await getSettings();

  // SAFETY 1: only act if we saw a limit message recently.
  if (!st.armed || Date.now() - st.armedAt > ARM_EXPIRY_MS) { await log("Skipped: no limit message was seen, so nothing was sent."); return; }
  // SAFETY 2: never send twice in a short window.
  if (Date.now() - st.lastSentAt < COOLDOWN_MS) { await log("Skipped: already sent recently."); return; }
  // SAFETY 3: no two attempts at once (a flag stuck for 5+ min is ignored).
  if (st.running && Date.now() - st.runningSince < STALE_RUN_MS) return;
  await setState({ running: true, runningSince: Date.now() });

  try {
    // First try: use the open tab as-is. Retries (and sleeping tabs) get a reload.
    const tabId = await openTab(st.armedUrl, st.attempts > 0 || s.reloadFirst, s.bringToFront);
    const finalMessage = buildMessage(s); // made at the moment of sending, so the time is accurate
    const result = await askTab(tabId, { type: "TRY_SEND", message: finalMessage, keywords: s.keywords, dryRun: false });

    if (result && result.status === "sent") {
      await setState({ armed: false, fireAt: 0, fireSource: "", lastSentAt: Date.now(), attempts: 0 });
      await log("SUCCESS: sent '" + finalMessage + "'. (" + (result.detail || "") + ")");
      await notify("Claude Auto-Continue: sent", "Sent: " + finalMessage, "default", "white_check_mark");
      if (s.onlyOnce) {
        await chrome.storage.local.set({ settings3: { ...s, enabled: false } }); // switch ourselves off
        await log("Only-once mode: extension has switched itself off.");
      }
      return;
    }
    const attempts = st.attempts + 1;
    await setState({ attempts });
    const why = result ? result.status + (result.detail ? " (" + result.detail + ")" : "") : "no response from page";
    if (attempts <= s.maxRetries) {
      chrome.alarms.create("retry", { delayInMinutes: s.retryMinutes });
      await log("Not sent: " + why + ". Retry " + attempts + "/" + s.maxRetries + " in " + s.retryMinutes + " min.");
    } else {
      await setState({ armed: false, fireAt: 0, fireSource: "" });
      chrome.action.setBadgeText({ text: "!" });
      await log("GAVE UP after " + attempts + " tries (1 + " + s.maxRetries + " retries). Last reason: " + why);
      await notify("Claude Auto-Continue: FAILED", "Gave up after " + attempts + " tries. Last reason: " + why, "high", "warning");
    }
  } catch (e) {
    await log("Error: " + e.message);
  } finally {
    await setState({ running: false });
  }
}

// Finds your open Claude tab (or opens the chat if it was closed). Returns the tab id.
async function openTab(url, reload, bringToFront) {
  const base = url.split("#")[0];
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  const match = tabs.find((t) => t.url && t.url.split("#")[0] === base);
  let tabId, needsLoad = false;
  if (match) {
    tabId = match.id;
    // Reload only if asked, or if Chrome put the tab to sleep ("discarded").
    if (reload || match.discarded) { await chrome.tabs.reload(tabId); needsLoad = true; }
  } else {
    tabId = (await chrome.tabs.create({ url: base, active: false })).id;
    needsLoad = true;
  }
  if (bringToFront) {
    // Chrome slows down hidden tabs. Showing the tab keeps our timers on schedule.
    const t = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    const w = await chrome.windows.get(t.windowId);
    await chrome.windows.update(t.windowId, { focused: true, ...(w.state === "minimized" ? { state: "normal" } : {}) });
  }
  if (needsLoad) {
    await sleep(2000);
    for (let i = 0; i < 30; i++) { // wait up to ~60s for loading
      if ((await chrome.tabs.get(tabId)).status === "complete") break;
      await sleep(2000);
    }
  }
  return tabId;
}

// Talks to the page. If the page's script isn't there yet, retry - and after 3 misses, inject it.
async function askTab(tabId, msg) {
  for (let i = 0; i < 10; i++) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (e) {
      if (i === 2) { try { await chrome.scripting.executeScript({ target: { tabId }, files: ["shared.js", "content.js"] }); } catch (e2) {} }
      await sleep(2000);
    }
  }
  return null;
}

// ---------- messages from the page and the popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    let result = "ok";
    if (msg.type === "LIMIT_SEEN") result = await handleLimitSeen(msg);
    if (msg.type === "FULL_TEST") {
      await setState({ armed: true, armedUrl: msg.url, armedAt: Date.now(), fireAt: 0, fireSource: "", lastSentAt: 0, attempts: 0 });
      await log("Full test started.");
      await attempt();
    }
    if (msg.type === "NTFY_TEST") {
      result = await notify("Claude Auto-Continue: test", "If you can read this, phone alerts work.", "default", "bell");
    }
    sendResponse({ ok: true, result });
  })();
  return true;
});

// A tab reported the limit message. Decide whether to arm, and say why (or why not).
async function handleLimitSeen(msg) {
  const st = await getState();
  const s = await getSettings();
  const force = !!msg.force; // true when you pressed "Check now"
  const busy = st.running && Date.now() - st.runningSince < STALE_RUN_MS;

  if (!s.enabled) return "Ignored: the extension is switched off.";
  if (busy) return "Ignored: an attempt is running right now.";
  const sentAgo = Date.now() - st.lastSentAt;
  if (!force && sentAgo < COOLDOWN_MS) return "Ignored: a message was sent " + Math.round(sentAgo / 60000) + " min ago (10-minute safety pause).";

  const firstTime = !st.armed;
  await setState({ armed: true, armedUrl: msg.url, armedAt: Date.now(), ...(force ? { lastSentAt: 0, attempts: 0 } : {}) });

  // Work out WHEN to press.
  const sane = msg.resetAt && msg.resetAt - Date.now() < 36 * 3600 * 1000;
  let fireAt = st.fireAt, source = st.fireSource;
  if (s.useDetectedTime && sane && (firstTime || !st.fireAt || force || st.fireSource === "fallback")) {
    fireAt = msg.resetAt + s.resetBufferMinutes * 60000;   // Claude's reset time + buffer
    source = "detected";
  } else if (firstTime || !st.fireAt || (force && st.fireSource !== "detected")) {
    fireAt = Date.now() + s.fallbackHours * 3600 * 1000;   // couldn't read a time: estimate
    source = "fallback";
  }

  const changed = fireAt !== st.fireAt;
  if (changed) {
    await setState({ fireAt, fireSource: source });
    chrome.alarms.create("reset", { when: fireAt });
    await log("Limit spotted. Will press at " + new Date(fireAt).toLocaleTimeString() + (source === "fallback" ? " (fallback estimate, no reset time could be read)." : "."));
  }
  if (firstTime) await notify("Claude Auto-Continue: armed", "Limit spotted. Will press at " + new Date(fireAt).toLocaleString() + ".", "low", "hourglass_flowing_sand");

  return (changed || firstTime ? "Armed" : "Already armed") + ". Will press at " + new Date(fireAt).toLocaleString() +
    (source === "fallback" ? " (fallback estimate: no reset time could be read)." : ".");
}
