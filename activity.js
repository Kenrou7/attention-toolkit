const focusModeButton = document.querySelector("#focusModeButton");
const restModeButton = document.querySelector("#restModeButton");
const modeBadge = document.querySelector("#modeBadge");
const modeSummary = document.querySelector("#modeSummary");
const sessionTimer = document.querySelector("#sessionTimer");
const activityState = document.querySelector("#activityState");
const idleValue = document.querySelector("#idleValue");
const lastInput = document.querySelector("#lastInput");
const coachNote = document.querySelector("#coachNote");
const suggestedAction = document.querySelector("#suggestedAction");

const MODE_CONFIG = {
  focus: {
    durationMs: 20 * 60 * 1000,
    snapshotMs: 2500,
    idleWarningMs: 30000,
    lightIdleMs: 10000,
    activeEvents: 8,
    activeDistance: 750,
    summary: "Focus mode uses a longer session, faster idle nudges, and encourages reading momentum.",
  },
  rest: {
    durationMs: 5 * 60 * 1000,
    snapshotMs: 2500,
    idleWarningMs: 90000,
    lightIdleMs: 20000,
    activeEvents: 14,
    activeDistance: 1200,
    summary: "Rest mode uses a shorter timer, softer idle thresholds, and encourages recovery instead of output.",
  },
};

const tracker = {
  mode: "focus",
  mouseMoves: 0,
  mouseDistance: 0,
  clicks: 0,
  scrolls: 0,
  keydowns: 0,
  tabVisible: document.visibilityState === "visible",
  windowFocused: document.hasFocus(),
  lastMousePosition: null,
  lastInputAt: null,
  snapshot: {
    mouseMoves: 0,
    mouseDistance: 0,
    clicks: 0,
    scrolls: 0,
    keydowns: 0,
  },
  timerEndsAt: Date.now() + (20 * 60 * 1000),
};

let intervalId;
let timerIntervalId;
let timerAlignmentTimeoutId;

function getModeConfig() {
  return MODE_CONFIG[tracker.mode];
}

function markInput() {
  tracker.lastInputAt = new Date();
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return "0s";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatClock(ms) {
  const clampedMs = Math.max(ms, 0);
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resetCounters() {
  tracker.mouseMoves = 0;
  tracker.mouseDistance = 0;
  tracker.clicks = 0;
  tracker.scrolls = 0;
  tracker.keydowns = 0;
}

function snapshotCounters() {
  tracker.snapshot = {
    mouseMoves: tracker.mouseMoves,
    mouseDistance: tracker.mouseDistance,
    clicks: tracker.clicks,
    scrolls: tracker.scrolls,
    keydowns: tracker.keydowns,
  };
  resetCounters();
}

function getActivityLabel() {
  const config = getModeConfig();

  if (!tracker.tabVisible || !tracker.windowFocused) {
    return "Away from page";
  }

  if (!tracker.lastInputAt) {
    return "Waiting for input";
  }

  const idleMs = Date.now() - tracker.lastInputAt.getTime();
  if (idleMs >= config.idleWarningMs) {
    return tracker.mode === "focus" ? "Idle" : "Calm break";
  }

  const snapshot = tracker.snapshot;
  const totalEvents = snapshot.mouseMoves + snapshot.clicks + snapshot.scrolls + snapshot.keydowns;
  const activeBurst = totalEvents >= config.activeEvents || snapshot.mouseDistance >= config.activeDistance;

  if (activeBurst) {
    return tracker.mode === "focus" ? "Active interaction" : "Restless break";
  }

  if (idleMs >= config.lightIdleMs) {
    return tracker.mode === "focus" ? "Focused reading" : "Gentle reset";
  }

  return tracker.mode === "focus" ? "Light interaction" : "Transitioning to rest";
}

function updateCoachNote(activityLabel) {
  if (tracker.mode === "rest") {
    if (activityLabel === "Restless break") {
      coachNote.textContent = "Rest mode: your pace is still high. Put your hands down for one minute and breathe slowly.";
      return;
    }

    if (activityLabel === "Away from page") {
      coachNote.textContent = "Rest mode: that is fine. Step away fully and come back when the timer ends.";
      return;
    }

    coachNote.textContent = "Rest mode: great. Relax your eyes, shoulders, and hands before the next focus cycle.";
    return;
  }

  if (activityLabel === "Idle") {
    coachNote.textContent = "Focus mode: you have been idle for a while. Try a tiny next step: read one paragraph.";
    return;
  }

  if (activityLabel === "Focused reading") {
    coachNote.textContent = "Focus mode: steady reading detected. Keep going with short chunks.";
    return;
  }

  if (activityLabel === "Away from page") {
    coachNote.textContent = "Focus mode: page is in background. Return when ready and continue your next chunk.";
    return;
  }

  coachNote.textContent = "Focus mode: keep your current pace and check progress every few minutes.";
}

function updateSuggestedAction(activityLabel) {
  if (tracker.mode === "rest") {
    if (activityLabel === "Restless break") {
      suggestedAction.textContent = "Suggested action: stop scrolling or typing, unclench your hands, and take five slow breaths.";
      return;
    }

    if (activityLabel === "Calm break" || activityLabel === "Gentle reset") {
      suggestedAction.textContent = "Suggested action: look away from the screen, stretch your neck and shoulders, and wait for the timer.";
      return;
    }

    suggestedAction.textContent = "Suggested action: keep the break low-stimulation so the next focus block starts with less friction.";
    return;
  }

  if (activityLabel === "Idle") {
    suggestedAction.textContent = "Suggested action: restart with one paragraph only, then pause and summarize it in one line.";
    return;
  }

  if (activityLabel === "Focused reading") {
    suggestedAction.textContent = "Suggested action: finish the current section before switching tasks or tabs.";
    return;
  }

  if (activityLabel === "Active interaction") {
    suggestedAction.textContent = "Suggested action: stay on one task and avoid opening extra tabs while your momentum is good.";
    return;
  }

  suggestedAction.textContent = "Suggested action: pick one paragraph, read it fully, then summarize it in one sentence.";
}

function updateTimerUI() {
  const remainingMs = tracker.timerEndsAt - Date.now();
  sessionTimer.textContent = formatClock(remainingMs);

  if (remainingMs <= 0) {
    if (tracker.mode === "focus") {
      coachNote.textContent = "Focus block complete. Switch to Rest mode for a short reset.";
      suggestedAction.textContent = "Suggested action: click Rest Mode and step away from the reading for five minutes.";
    } else {
      coachNote.textContent = "Rest block complete. Switch back to Focus mode when you are ready.";
      suggestedAction.textContent = "Suggested action: click Focus Mode and restart with one small reading goal.";
    }
  }
}

function resetModeTimer() {
  tracker.timerEndsAt = Date.now() + getModeConfig().durationMs;
}

function clearTimerTickers() {
  if (timerAlignmentTimeoutId) {
    clearTimeout(timerAlignmentTimeoutId);
    timerAlignmentTimeoutId = undefined;
  }

  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = undefined;
  }
}

function startTimerTickers() {
  clearTimerTickers();
  updateTimerUI();

  const alignmentDelayMs = 1000 - (Date.now() % 1000);
  timerAlignmentTimeoutId = window.setTimeout(() => {
    updateTimerUI();
    timerIntervalId = window.setInterval(() => {
      updateTimerUI();
    }, 1000);
    timerAlignmentTimeoutId = undefined;
  }, alignmentDelayMs);
}

function updateModeUI() {
  const isFocus = tracker.mode === "focus";
  modeBadge.textContent = isFocus ? "Focus mode" : "Rest mode";
  modeBadge.classList.toggle("mode-focus", isFocus);
  modeBadge.classList.toggle("mode-rest", !isFocus);
  modeSummary.textContent = getModeConfig().summary;
}

function refreshUI() {
  const label = getActivityLabel();
  activityState.textContent = label;

  if (!tracker.lastInputAt) {
    idleValue.textContent = "0s";
    lastInput.textContent = "Never";
  } else {
    const idleMs = Date.now() - tracker.lastInputAt.getTime();
    idleValue.textContent = formatDuration(idleMs);
    lastInput.textContent = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(tracker.lastInputAt);
  }

  updateCoachNote(label);
  updateSuggestedAction(label);
}

focusModeButton.addEventListener("click", () => {
  tracker.mode = "focus";
  resetModeTimer();
  updateModeUI();
  refreshUI();
  startTimerTickers();
});

restModeButton.addEventListener("click", () => {
  tracker.mode = "rest";
  resetModeTimer();
  updateModeUI();
  refreshUI();
  startTimerTickers();
});

window.addEventListener("mousemove", (event) => {
  if (tracker.lastMousePosition) {
    const deltaX = event.clientX - tracker.lastMousePosition.x;
    const deltaY = event.clientY - tracker.lastMousePosition.y;
    tracker.mouseDistance += Math.hypot(deltaX, deltaY);
  }

  tracker.mouseMoves += 1;
  tracker.lastMousePosition = { x: event.clientX, y: event.clientY };
  markInput();
}, { passive: true });

window.addEventListener("click", () => {
  tracker.clicks += 1;
  markInput();
}, { passive: true });

window.addEventListener("wheel", () => {
  tracker.scrolls += 1;
  markInput();
}, { passive: true });

window.addEventListener("keydown", () => {
  tracker.keydowns += 1;
  markInput();
});

window.addEventListener("focus", () => {
  tracker.windowFocused = true;
  markInput();
  refreshUI();
});

window.addEventListener("blur", () => {
  tracker.windowFocused = false;
  refreshUI();
});

document.addEventListener("visibilitychange", () => {
  tracker.tabVisible = document.visibilityState === "visible";
  if (tracker.tabVisible) {
    markInput();
  }
  refreshUI();
});

window.addEventListener("beforeunload", () => {
  if (intervalId) {
    clearInterval(intervalId);
  }

  clearTimerTickers();
});

updateModeUI();
refreshUI();
startTimerTickers();
intervalId = window.setInterval(() => {
  snapshotCounters();
  refreshUI();
}, Math.min(MODE_CONFIG.focus.snapshotMs, MODE_CONFIG.rest.snapshotMs));