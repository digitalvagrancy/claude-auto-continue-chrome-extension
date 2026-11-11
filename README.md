# Claude Auto-Continue (v2.3)

A small Chrome extension that presses **"Continue"** for you in Claude (claude.ai) after a usage limit resets, so a long job can carry on while you sleep.

> **Unofficial and unsupported.** This is a hobby project, not made by or affiliated with Anthropic. It comes with no warranty and no support. It depends on how claude.ai's page is built today, so it can stop working whenever Claude changes its site. Use it at your own risk.

**Tested on:** Chrome for Windows, free Claude plan. Edge and Brave should work the same way but haven't been tested.

---

## What it does

1. You hit Claude's usage limit ("You are out of free messages until tomorrow at 12:50 AM").
2. The extension notices, reads the reset time, and **arms itself**. If it can't read a time, it estimates one.
3. A few minutes after the reset time, it closes the limit popup, types **Continue** in your chat, and sends it.
4. It checks that the message really went through. If not, it tries again a few times.
5. Optionally, it sends an alert to your phone.

It only ever sends your one message into the chat that hit the limit. If it never saw a limit message, it does nothing.

## Features

- **Reads the reset time from Claude's message**, in several wordings ("until tomorrow at 12:50 AM", "until 3:15 PM", "resets at...", "resets in 2 hours"), and presses a few minutes after it (you choose how many)
- **Fallback estimate:** if it can't read a reset time, it presses 5.5 hours after spotting the limit, and keeps looking so it can swap in the real time if it becomes readable
- **Safety locks:** won't send unless it saw a limit message, won't send twice within 10 minutes, never types over a draft you wrote
- **Closes the limit popup carefully:** it only clicks the popup's X if the button passes several checks, otherwise it refuses
- **Retries** if the limit is still active (defaults: every 5 minutes, 3 extra tries)
- **Keeps your computer awake** while waiting (the screen can still turn off)
- **Optional timestamp** on the message, e.g. `Continue [auto-sent 1:10 AM, 11 Nov]`
- **Optional phone alerts** through the free ntfy app when it arms, succeeds or fails
- **Only-once mode:** switches itself off after one successful send
- **Check now button** that explains exactly what the extension can see and why
- **Activity log** of everything it did, so you can see what happened overnight
- **Works in tabs that were already open**, with no refresh needed after an update

## Install (Chrome on Windows, Mac or Linux)

1. Unzip the download into a folder and **keep that folder somewhere permanent**. Chrome reads the extension from it every time.
2. Open `chrome://extensions` in the address bar.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the puzzle-piece icon in Chrome's toolbar and **pin** Claude Auto-Continue so it's easy to find.
6. If Chrome asks about permissions, accept them (explained below).

To update later: replace the files in the folder, then click the reload arrow on the extension at `chrome://extensions`. Your settings are kept.

## First-time setup

1. Open the Claude chat you want to continue and leave that tab open.
2. Click the extension's icon. Settings save automatically as you change them.
3. Click **Dry run (safe)** while a limit popup is showing. It reports what it can see without sending anything. Look for `closeButton: VERIFIED`.
4. Optional: set up phone alerts (below).

## Before you go to bed

1. Make sure the popup says **Armed** with a press time. If it says Idle after you hit the limit, click **Check now**.
2. Leave **Chrome open** and the **Claude tab on the same chat**.
3. Set Windows sleep to **Never** while plugged in (Settings > System > Power & battery), or leave the **Keep computer awake** switch on. A sleeping computer can't run the extension.
4. In Chrome go to `chrome://settings/performance` and add `claude.ai` to **Always keep these sites active**, so Chrome doesn't put the tab to sleep.
5. If your job uses connectors or tools that ask for approval, **approve them before you sleep**. The extension can't approve prompts for you.

## What the status pill means

| Pill | Meaning |
|---|---|
| **Idle** | Watching. It hasn't seen a limit message, so nothing will be sent. |
| **Armed** | It saw a limit message and will press at the time shown. If the time says "estimate", it couldn't read Claude's reset time. |
| **Paused** | Switched off. Nothing will be sent. |

## What the buttons do

| Button | What it does |
|---|---|
| **Check now** | Scans your current Claude tab right now and tells you if it found the limit message, what reset time it read, and what the page actually said (`pageSaid`). It then arms, or tells you why not. It skips the 10-minute safety pause, and if no reset time can be read it re-estimates the fallback from now. |
| **Dry run (safe)** | Reports what it can see on the page (limit message, popup, close button, text box, send button). Sends nothing. |
| **Full test (sends!)** | Runs the real routine on your current chat right now, including typing and sending your message. Check the Activity log about 40 seconds later. |
| **Copy** | Copies the result box so you can paste it somewhere. |
| **Test** (next to Phone alerts) | Sends a test notification to your phone. |

## Settings

| Setting | Meaning |
|---|---|
| Enabled | Master switch |
| Only run once | After one successful send, switch the extension off |
| Keep computer awake | Stops your PC sleeping while armed |
| Message to send | The text typed into the chat (default: Continue) |
| Add a timestamp | Adds a small tag with the time it was sent |
| Wait after reset | Minutes added to Claude's reset time before pressing (default 10) |
| Retry every / Retries | How long to wait, and how many extra tries, if it's still limited (defaults: 5 minutes, 3 tries) |
| Phone alerts (ntfy) | Your ntfy topic name. Empty means no alerts |
| Read reset time from Claude | Use the time in Claude's message (recommended) |
| Fallback wait | Hours to wait if no reset time can be read (default 5.5) |
| Switch to the Claude tab | Brings the tab to the front at press time so Chrome doesn't slow it down |
| Refresh tab first | Off by default: it uses your open tab as-is and only refreshes on retries |

## Phone alerts (optional)

1. Install the **ntfy** app on your phone (free).
2. Subscribe to a topic name you make up, such as `yourname-claude-7f3k9x`. **Make it hard to guess:** anyone who knows the name can read your alerts.
3. Type the same name into **Phone alerts** in the extension and click **Test**.

## Privacy

- It only runs on claude.ai pages.
- It reads the page text **on your computer** to look for the limit message. Nothing is uploaded.
- Settings and the activity log are stored in your browser.
- The **only** thing that leaves your computer is the ntfy alert, and only if you set a topic. Alerts contain short text such as the message it sent and any failure reason.

## Permissions explained

| Permission | Why |
|---|---|
| `claude.ai` pages | To look for the limit message and type into the chat |
| `ntfy.sh` | To send phone alerts (only if you set a topic) |
| `alarms` | To wake up at the press time |
| `storage` | To save your settings and the activity log |
| `power` | To keep the computer awake while armed |
| `scripting` | To add the extension to Claude tabs that were open before an update |

## Changing the icon

The toolbar icon is an original drawing (not Claude's or Anthropic's logo). To use your own, replace the four PNG files in the `icons` folder (16, 32, 48 and 128 pixels square, same file names), then reload the extension.

## Limits and known issues

- **Chrome must be open and the computer awake.** It can't wake a sleeping computer.
- It was built and tested against the **free plan** wording ("out of free messages"). Other plans may word things differently, and then it may not recognise the limit.
- **It can arm itself by mistake** if a page happens to contain one of its limit phrases. If that happens it will still send your message at the press time, so switch **Enabled** off if you spot a false alarm.
- If Claude redesigns its site, it may stop working until the code is updated.
- It treats a send as successful when the message box empties and the limit message disappears. If Claude then asks for permission to use a tool, it can't help with that.
- It uses your computer's local time for the reset time it reads.
- Phone alerts and keep-awake are the newest features and have had the least testing.

## Troubleshooting

- **Says Idle although you're limited:** click **Check now**. It tells you why. Common reasons: you're not on a `/chat/` page, or a message was sent in the last 10 minutes.
- **Says "estimate" or "no reset time":** click **Check now**, then **Copy**, and read the `pageSaid` line. That is the page's own wording, which shows what the extension is failing to read.
- **"Couldn't reach the page":** make sure the active tab is claude.ai.
- **Close button "not clicked":** run **Dry run** and read the reason it gives.
- **Nothing happened overnight:** open the **Activity log**. It records every attempt and why it did or didn't send.

## Version history

| Version | What changed |
|---|---|
| Early builds | Press at a set time, safety locks, dry run and full test. Then: read the reset time from Claude's message, strict popup-closing, use the open tab without refreshing, redesigned popup, only-once mode, retry defaults, Check now, copy button |
| 2.0 | Keep computer awake, phone alerts (ntfy), check as soon as a page loads and then once a minute, fallback of 5.5 hours, installs itself into already-open tabs |
| 2.1 | Optional timestamp on the message, README |
| 2.2 | Toolbar icon |
| 2.3 | Reads many more reset-time wordings, `pageSaid` in Check now, fallback re-estimates and keeps looking for the real time, removed an over-broad trigger phrase |
