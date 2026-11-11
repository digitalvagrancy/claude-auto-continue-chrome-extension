// ============================================================
// content.js - runs INSIDE every claude.ai tab.
// Job 1: watch for the limit message (on page load, then once a minute).
// Job 2: when asked: close the popup (carefully), type the message, press send.
// ============================================================
(() => {
  // If this file gets loaded twice into one tab (e.g. after an update), only the newest copy stays in charge.
  const MY_TOKEN = Math.random().toString(36).slice(2);
  document.documentElement.dataset.cacOwner = MY_TOKEN;
  const isOwner = () => document.documentElement.dataset.cacOwner === MY_TOKEN;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Keeps checking `fn` until it returns something truthy, or time runs out.
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(500);
    }
    return fn() || null; // one last check, in case a slow timer overshot the deadline
  }

  const getBox = () => document.querySelector('[data-testid="chat-input"]');
  const getSendBtn = () => document.querySelector('[data-testid="chat-input-send"]');

  // Looks at all visible page text for any limit phrase. Returns the matched phrase or null.
  function findLimitText(keywords) {
    const text = (document.body.innerText || "").toLowerCase();
    return keywords.find((k) => k.trim() && text.includes(k.toLowerCase().trim())) || null;
  }

  // ---------- Reads the reset time out of Claude's wording ----------
  // Understands things like:
  //   "until tomorrow at 12:50 AM"   "until 3:15 PM"   "It resets at 12:50 AM"
  //   "returns Nov 11 at 12:50 AM"   "17:00"           "resets in 2 hours 15 minutes"
  // BEGIN parse
  function readTime(slice, nowMs) {
    // "in 2 hours", "in 1 hour 30 minutes", "in 45 minutes"
    const hm = slice.match(/\bin\s+(\d+)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?/i);
    if (hm) return nowMs + (Number(hm[1]) * 60 + Number(hm[2] || 0)) * 60000;
    const mm = slice.match(/\bin\s+(\d+)\s*(?:minutes?|mins?)\b/i);
    if (mm) return nowMs + Number(mm[1]) * 60000;

    // A clock time: "5:00 AM", "5 pm" or 24-hour "17:00" ("at" is not required)
    let h, m = 0;
    const ap = slice.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i);
    const h24 = slice.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (ap) {
      h = Number(ap[1]) % 12;
      m = Number(ap[2] || 0);
      if (ap[3].toLowerCase() === "p") h += 12;
    } else if (h24) {
      h = Number(h24[1]); m = Number(h24[2]);
    } else {
      return null;
    }
    if (h > 23 || m > 59) return null;

    // Next time that clock time happens (assumes the page shows YOUR local time).
    const d = new Date(nowMs);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  function parseResetFromText(text, nowMs) {
    const low = text.toLowerCase();
    const triggers = ["out of free messages", "message limit", "resets at", "resets in", "free usage returns"];
    for (const t of triggers) {
      let from = 0, idx;
      while ((idx = low.indexOf(t, from)) >= 0) {
        const r = readTime(text.slice(idx, idx + 200), nowMs); // only look just after the phrase
        if (r) return r;
        from = idx + t.length;
      }
    }
    return null;
  }
  // END parse
  const parseResetTime = () => parseResetFromText(document.body.innerText || "", Date.now());

  // ---------- Is the text box actually usable? ----------
  function describeEl(el) {
    if (!el) return "nothing";
    return el.tagName.toLowerCase() +
      (el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : "") +
      (el.getAttribute("data-testid") ? "[testid=" + el.getAttribute("data-testid") + "]" : "") +
      (el.getAttribute("aria-label") ? "[label=" + el.getAttribute("aria-label") + "]" : "");
  }
  function inspectBox(box) {
    const r = box.getBoundingClientRect();
    // Ask the browser: "what element is on top at the middle of the text box?"
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = !(top && (top === box || box.contains(top)));
    box.focus();
    return {
      editable: box.isContentEditable,
      inert: !!box.closest("[inert]"),
      ariaDisabled: box.getAttribute("aria-disabled") === "true",
      pointerEventsNone: getComputedStyle(box).pointerEvents === "none",
      coveredBy: covered ? describeEl(top) : "nothing (clear)",
      canFocus: document.activeElement === box || box.contains(document.activeElement)
    };
  }

  // ---------- Strict popup-closer ----------
  // Clicks the popup's Close button ONLY if everything checks out:
  //  - icon-only button with aria-label="Close"
  //  - inside a popup that mentions a limit/upgrade phrase
  //  - in the popup's top-right corner
  //  - the only such button (no ambiguity)
  function findCloseButton(keywords) {
    const lower = keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
    const UPGRADE_WORDS = ["upgrade", "claude pro", "pro plan", "premium", "subscribe", "free messages", "usage limit"];
    const hasKeyword = (el) => {
      const t = (el.innerText || "").toLowerCase();
      return lower.some((k) => t.includes(k)) || UPGRADE_WORDS.some((k) => t.includes(k));
    };

    const buttons = [...document.querySelectorAll('button[aria-label="Close"][data-cds-icon-only]')];
    if (buttons.length === 0) return { ok: false, reason: "no icon-only Close button on the page" };

    const good = [];
    const notes = [];
    for (const btn of buttons) {
      const br = btn.getBoundingClientRect();
      if (br.width === 0 || br.height === 0) { notes.push("a Close button is hidden"); continue; }

      let container = btn.closest('[role="dialog"], [aria-modal="true"]');
      if (container && !hasKeyword(container)) { notes.push("dialog has no limit phrase"); continue; }
      if (!container) {
        let el = btn.parentElement, depth = 0;
        while (el && el !== document.body && el !== document.documentElement && depth < 12) {
          if (hasKeyword(el)) { container = el; break; }
          el = el.parentElement; depth++;
        }
        if (container) {
          const cr = container.getBoundingClientRect();
          if (cr.width > innerWidth * 0.9 && cr.height > innerHeight * 0.9) { notes.push("container is page-sized"); continue; }
        }
      }
      if (!container) { notes.push("Close button not inside a limit popup"); continue; }

      const cr = container.getBoundingClientRect();
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      const rightSide = cx >= cr.left + cr.width * 0.6;
      const topSide = cy - cr.top <= Math.max(80, cr.height * 0.25);
      if (!(rightSide && topSide)) { notes.push("Close button not in top-right corner"); continue; }

      good.push({ btn, container });
    }
    if (good.length === 0) return { ok: false, reason: notes.join("; ") || "no match" };
    if (good.length > 1) return { ok: false, reason: "more than one match - refusing to guess" };
    return { ok: true, ...good[0] };
  }

  async function closeLimitPopup(keywords, dryRun) {
    const f = findCloseButton(keywords);
    if (!f.ok) return "not clicked: " + f.reason;
    if (dryRun) return "VERIFIED - would click Close (top-right of limit popup)";
    f.btn.click();
    const gone = await waitFor(() => !f.container.isConnected || f.container.getBoundingClientRect().height === 0, 3000);
    return gone ? "clicked Close; popup gone" : "clicked Close; popup still there";
  }

  // ---------- JOB 1: the watcher ----------
  // Checks 3s and 8s after the page loads, then once a minute.
  // Skips the check while armed with a real reset time (but keeps looking if it's only on a fallback estimate).
  let lastReport = 0;
  let timer = null;
  async function tick() {
    try {
      if (!isOwner()) { clearInterval(timer); return; } // a newer copy took over
      if (!location.pathname.startsWith("/chat/")) return;
      const { state } = await chrome.storage.local.get("state");
      if (state && state.armed && state.fireSource !== "fallback") return; // armed with a real time = nothing to learn
      const s = await getSettings();
      const hit = findLimitText(s.keywords);
      if (hit && Date.now() - lastReport > 5 * 60 * 1000) {
        lastReport = Date.now();
        chrome.runtime.sendMessage({ type: "LIMIT_SEEN", url: location.href, keyword: hit, resetAt: parseResetTime() });
      }
    } catch (e) { /* extension was reloaded; ignore */ }
  }
  timer = setInterval(tick, 60000);
  setTimeout(tick, 3000);
  setTimeout(tick, 8000);

  // ---------- JOB 2: close popup, type, send ----------
  async function trySend({ message, stamp = "", keywords, dryRun, sendDraft = true, shortDraftChars = 15 }) {
    const box = await waitFor(getBox, 25000);
    if (!box) return { status: "no_box" };
    await sleep(4000); // let the popup draw itself

    const limit = findLimitText(keywords);

    // ---- helpers for working with whatever is already in the box ----
    const TAG_AT_END = /\s*\[auto-sent[^\]]*\]$/i;                      // a stamp left by one of OUR earlier tries
    const readBox = () => (getBox().innerText || "").replace(/\s+$/, ""); // box text, without trailing blank space
    const caretToEnd = () => {                                          // put the typing cursor at the very end
      box.focus();
      const range = document.createRange();
      range.selectNodeContents(box.lastElementChild || box);
      range.collapse(false);                                            // false = collapse to the END
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    const typeText = async (t) => { document.execCommand("insertText", false, t); await sleep(600); };
    const wipeBox = async () => { box.focus(); document.execCommand("selectAll"); document.execCommand("delete"); await sleep(300); };

    // DRY RUN: report everything, touch nothing (apart from a harmless focus).
    if (dryRun) {
      const reset = parseResetTime();
      const btn = getSendBtn();
      return {
        status: "dry_ok",
        limitMessageFound: limit || "none right now",
        resetTimeRead: reset ? new Date(reset).toLocaleString() : "none",
        closeButton: await closeLimitPopup(keywords, true),
        popupTextPreview: [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
          .map((d) => (d.innerText || "").replace(/\s+/g, " ").slice(0, 200)),
        textBox: inspectBox(box),
        whatItWouldDo: (() => {
          const ex = readBox();
          const core = ex.replace(TAG_AT_END, "").trim();
          if (!ex) return "box is empty: would type '" + message + "'";
          if (core.toLowerCase() === message.trim().toLowerCase()) return "box holds a leftover '" + message + "': would retype it fresh";
          if (!sendDraft) return "box has text but 'send my draft' is OFF: would NOT send";
          if (core.length < shortDraftChars) return "short draft (" + core.length + " characters): would add '" + message + "' after it";
          return "your draft (" + core.length + " characters): would send it as written, plus the timestamp if that's switched on";
        })(),
        sendButton: btn ? (btn.disabled ? "found (disabled - normal when box is empty)" : "found, enabled") : "missing"
      };
    }

    // REAL RUN
    let popupNote = "no limit popup";
    if (limit) popupNote = await closeLimitPopup(keywords, false);

    // ---- Decide what to do about whatever is already in the box ----
    let existing = readBox();
    const core0 = existing.replace(TAG_AT_END, "").trim();
    let draftNote;

    if (existing && core0.toLowerCase() === message.trim().toLowerCase()) {
      await wipeBox();                     // our own leftover from an earlier try: wipe it and retype fresh
      existing = "";
    } else if (existing && !sendDraft) {
      return { status: "draft_present" };  // it's yours, and you asked us not to touch it
    }

    if (!existing) {
      // Empty box: type the message (plus the timestamp).
      box.focus();
      await typeText(message + stamp);
      draftNote = "typed the message";
    } else {
      // There's a draft. First remove a stamp left by an earlier try of ours, so we never end up with two.
      const old = existing.match(TAG_AT_END);
      if (old) {
        caretToEnd();
        for (let i = 0; i < old[0].length; i++) document.execCommand("delete"); // backspace, one character at a time
        await sleep(400);
        const after = readBox();
        if (after !== existing.slice(0, existing.length - old[0].length)) {
          return { status: "draft_unclear", detail: "couldn't cleanly remove an old timestamp, so left your text alone" };
        }
        existing = after;
      }
      // Short = probably accidental leftovers: add the message AFTER them. Long = your real instruction: send as written.
      // Either way we only ever ADD to the end. We never retype your text, so line breaks and formatting survive.
      if (existing.trim().length < shortDraftChars) {
        caretToEnd();
        await typeText(" " + message + stamp);
        draftNote = "short draft: added the message after it";
      } else {
        if (stamp) { caretToEnd(); await typeText(stamp); }
        draftNote = stamp ? "sent your draft plus the timestamp" : "sent your draft as written";
      }
    }
    const sentPreview = readBox().replace(/\s+/g, " ").slice(0, 60); // for the activity log only (never sent anywhere)

    // Click Send once enabled; fall back to pressing Enter.
    const btn = await waitFor(() => { const b = getSendBtn(); return b && !b.disabled ? b : null; }, 5000);
    if (btn) btn.click();
    else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

    // Verify: the box should empty out...
    const cleared = await waitFor(() => (getBox().innerText || "").trim() === "", 8000);
    if (!cleared) return { status: "send_failed", detail: popupNote };
    // ...and the limit message should NOT come back.
    await sleep(6000);
    const limitAfter = findLimitText(keywords);
    if (!limitAfter) return { status: "sent", detail: popupNote + "; " + draftNote, sentPreview };
    return { status: "still_limited", detail: limitAfter };
  }

  // ---------- "Check now" button: scan this tab right now and explain what happened ----------
  async function checkNow() {
    const s = await getSettings();
    const onChat = location.pathname.startsWith("/chat/");
    const hit = findLimitText(s.keywords);
    const resetAt = parseResetTime();
    const info = {
      page: onChat ? "chat page - OK" : "NOT a /chat/ page (" + location.pathname + ") - the watcher ignores this",
      limitPhraseFound: hit || "none",
      resetTimeRead: resetAt ? new Date(resetAt).toLocaleString() : "none"
    };
    if (hit) { // show the page's own words, so a wording we don't understand is easy to spot
      const text = document.body.innerText || "";
      const i = text.toLowerCase().indexOf(hit.toLowerCase());
      info.pageSaid = text.slice(i, i + 200).replace(/\s+/g, " ");
    }
    if (!onChat) return info;
    if (!hit) { info.result = "No limit message on this page, so nothing was armed."; return info; }
    const resp = await chrome.runtime.sendMessage({ type: "LIMIT_SEEN", url: location.href, keyword: hit, resetAt, force: true });
    info.result = resp && resp.result ? resp.result : "No answer from the background worker.";
    return info;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isOwner()) return; // only the newest copy answers
    if (msg.type === "TRY_SEND") { trySend(msg).then(sendResponse); return true; } // true = "I'll answer later"
    if (msg.type === "CHECK_NOW") { checkNow().then(sendResponse); return true; }
  });
})();
