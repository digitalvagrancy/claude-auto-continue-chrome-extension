// ============================================================
// shared.js - default settings + a helper, used by every file.
// ("var" on purpose: lets the file safely load twice.)
// ============================================================

var DEFAULTS = {
  enabled: true,            // master on/off switch
  onlyOnce: false,          // true = after one successful send, switch the extension off
  keepAwake: true,          // keep the computer awake while armed (screen may still turn off)
  useDetectedTime: true,    // read the reset time from Claude's message and use it
  resetBufferMinutes: 10,   // minutes AFTER the reset time to press continue
  fallbackHours: 5.5,       // if no reset time can be read: press this many hours after the limit was spotted
  message: "Continue",      // what gets typed into the box
  sendDraft: true,          // if you've typed something in the box, send THAT (instead of only "Continue")
  shortDraftChars: 15,      // a draft shorter than this counts as accidental leftovers: "Continue" is added after it
  timestamp: true,         // add a small tag like [auto-sent 1:10 AM, 11 Nov] so you can see when it went through
  retryMinutes: 5,          // if still limited, wait this long and try again
  maxRetries: 3,            // how many EXTRA tries after the first one
  reloadFirst: false,       // false = use the open tab as-is (refresh only on retries)
  bringToFront: true,       // switch to the Claude tab when it's time (stops Chrome slowing a hidden tab)
  ntfyTopic: "",            // ntfy.sh topic name for phone alerts. Empty = no alerts.
  // Words that mean "limit hit". Built in on purpose - no need to touch these.
  keywords: [
    "out of free messages",
    "hour message limit",
    "hit your limit",
    "reached your limit"
  ]
};

// Reads saved settings and fills any gaps with the defaults above.
async function getSettings() {
  const { settings3 } = await chrome.storage.local.get("settings3");
  return { ...DEFAULTS, ...(settings3 || {}) };
}
