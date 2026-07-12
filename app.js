/* ============================================================
Exam Timer — core logic (vanilla JS, offline)
============================================================ */

const STORAGE_SETUP = "timer-setup";
const STORAGE_SESSION = "timer-session";
const STORAGE_KEEPAWAKE = "timer-keepawake";


// Color thresholds as fraction of a question's budget.
const ORANGE_AT = 0.80; // >= 80% of budget -> orange
const RED_AT = 1.00; // >= 100% of budget -> red (overtime)

/* ---------- App state ---------- */
let setup = { totalMinutes: 180, questions: [] };
let session = null; // built on Start / Resume
let tickHandle = null;
let lastTickMs = null;
let muted = false;
let wakeLock = null;
let keepAwake = true;

/* ---------- Element refs ---------- */
const $ = (id) => document.getElementById(id);
const setupScreen = $("setup-screen");
const timerScreen = $("timer-screen");
const totalMinutesInput = $("total-minutes");
const questionRows = $("question-rows");
const setupSummary = $("setup-summary");
const resumeNote = $("resume-note");

/* ============================================================
SETUP SCREEN
============================================================ */

function defaultQuestions() {
    const q = [];
    for (let i = 0; i < 10; i++) q.push({ marks: 10, minutes: 7.5 });
    for (let i = 0; i < 10; i++) q.push({ marks: 15, minutes: 10.5 });
    return q;
}

function renderQuestionRows() {
    questionRows.innerHTML = "";
    setup.questions.forEach((q, i) => {
        const row = document.createElement("div");
        row.className = "q-row";
        row.innerHTML = `
<span class="col-num">${i + 1}</span>
<input type="number" class="q-marks" min="0" step="1" value="${q.marks}" />
<input type="number" class="q-mins" min="0" step="0.5" value="${q.minutes}" />
<button type="button" class="del-q" title="Remove" aria-label="Remove question">×</button>
`;
        row.querySelector(".q-marks").addEventListener("input", (e) => {
            q.marks = parseFloat(e.target.value) || 0;
            saveSetup(); renderSummary();
        });
        row.querySelector(".q-mins").addEventListener("input", (e) => {
            q.minutes = parseFloat(e.target.value) || 0;
            saveSetup(); renderSummary();
        });
        row.querySelector(".del-q").addEventListener("click", () => {
            setup.questions.splice(i, 1);
            saveSetup(); renderQuestionRows(); renderSummary();
        });
        questionRows.appendChild(row);
    });
}

function renderSummary() {
    const totalSec = (parseFloat(totalMinutesInput.value) || 0) * 60;
    const sumMins = setup.questions.reduce((s, q) => s + (q.minutes || 0), 0);
    const sumMarks = setup.questions.reduce((s, q) => s + (q.marks || 0), 0);
    const bufferMin = (totalSec / 60) - sumMins;
    const bufferTxt = bufferMin >= 0
        ? `<strong>${fmtMinShort(bufferMin)}</strong> starting buffer`
        : `<span class="warn">over by ${fmtMinShort(-bufferMin)}</span>`;
    setupSummary.innerHTML =
        `${setup.questions.length} questions · ${sumMarks} marks · ` +
        `${fmtMinShort(sumMins)} of question time vs ${fmtMinShort(totalSec / 60)} exam time · ${bufferTxt}`;
}

function fmtMinShort(mins) {
    const m = Math.floor(Math.abs(mins));
    const s = Math.round((Math.abs(mins) - m) * 60);
    return `${m}m${s ? " " + s + "s" : ""}`;
}

function applyPreset(kind) {
    if (kind === "clear") {
        setup.questions = [];
    } else if (kind === "gs") {
        const m10 = parseFloat($("preset-10").value) || 7.5;
        const m15 = parseFloat($("preset-15").value) || 10.5;
        setup.questions = [];
        for (let i = 0; i < 10; i++) setup.questions.push({ marks: 10, minutes: m10 });
        for (let i = 0; i < 10; i++) setup.questions.push({ marks: 15, minutes: m15 });
    }
    saveSetup(); renderQuestionRows(); renderSummary();
}

function saveSetup() {
    setup.totalMinutes = parseFloat(totalMinutesInput.value) || 0;
    localStorage.setItem(STORAGE_SETUP, JSON.stringify(setup));
}

function loadSetup() {
    try {
        const raw = localStorage.getItem(STORAGE_SETUP);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.questions)) setup = parsed;
        }
    } catch (e) { /* ignore corrupt storage */ }
    if (!setup.questions || setup.questions.length === 0) setup.questions = defaultQuestions();
    if (!setup.totalMinutes) setup.totalMinutes = 180;
    totalMinutesInput.value = setup.totalMinutes;
}

/* ============================================================
SESSION / TIMER ENGINE
============================================================ */

function buildSession() {
    const totalSec = (parseFloat(totalMinutesInput.value) || 0) * 60;
    return {
        totalSec,
        questions: setup.questions.map((q) => ({
            marks: q.marks,
            budgetSec: (q.minutes || 0) * 60,
        })),
        elapsed: setup.questions.map(() => 0), // accumulated time per question
        done: setup.questions.map(() => false), // completed flag per question
        index: 0,
        paused: false,
        finished: false,
        alerted: {}, // per-question threshold flags
    };
}

// ---- Derived values (single active question ticks, so these are always live) ----
function sumBudgetSec() {
    return session.questions.reduce((s, q) => s + q.budgetSec, 0);
}
function totalElapsedSec() {
    return session.elapsed.reduce((s, e) => s + e, 0);
}
function bufferSec() {
    // leftover reserve (exam time not allocated to questions) + time saved on done ones
    let saved = 0;
    session.questions.forEach((q, i) => {
        if (session.done[i]) saved += q.budgetSec - session.elapsed[i];
    });
    return (session.totalSec - sumBudgetSec()) + saved;
}

function saveSession() {
    if (session) localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
}

function loadSession() {
    try {
        const raw = localStorage.getItem(STORAGE_SESSION);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.questions && Array.isArray(parsed.elapsed) && !parsed.finished) return parsed;
        }
    } catch (e) { /* ignore */ }
    return null;
}

function startTicking() {
    stopTicking();
    lastTickMs = Date.now();
    tickHandle = setInterval(tick, 250);
}

function stopTicking() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

function tick() {
    const now = Date.now();
    const delta = (now - lastTickMs) / 1000;
    lastTickMs = now;
    if (!session || session.paused || session.finished) return;
    session.elapsed[session.index] += delta;

    checkAlerts();

    // Auto-finish whole exam when total time is up.
    if (totalElapsedSec() >= session.totalSec) {
        renderTimer();
        finishExam();
        return;
    }
    renderTimer();
    saveSession();
}

function currentQuestion() { return session.questions[session.index]; }

function questionState() {
    const q = currentQuestion();
    if (!q || q.budgetSec <= 0) return "green";
    const frac = session.elapsed[session.index] / q.budgetSec;
    if (frac >= RED_AT) return "red";
    if (frac >= ORANGE_AT) return "orange";
    return "green";
}

function checkAlerts() {
    const q = currentQuestion();
    if (!q || q.budgetSec <= 0) return;
    const frac = session.elapsed[session.index] / q.budgetSec;
    const flags = session.alerted[session.index] || {};
    if (frac >= ORANGE_AT && !flags.orange) { flags.orange = true; beep(660, 0.12); }
    if (frac >= RED_AT && !flags.red) { flags.red = true; beep(320, 0.25); }
    session.alerted[session.index] = flags;
}

function markDone() {
    if (!session || session.finished) return;
    session.done[session.index] = true;

    // Jump to the next not-done question (wrapping); finish if all are done.
    const n = session.questions.length;
    let next = -1;
    for (let step = 1; step <= n; step++) {
        const i = (session.index + step) % n;
        if (!session.done[i]) { next = i; break; }
    }
    if (next === -1) { finishExam(); return; }
    session.index = next;
    saveSession();
    renderTimer();
}
// Jump straight to any question (from side-panel click or Prev/Next).
function goToQuestion(i) {
    if (!session || session.finished) return;
    if (i < 0 || i >= session.questions.length) return;
    session.index = i;
    saveSession();
    renderTimer();
}
function nextQuestion() { goToQuestion(session.index + 1); }
function prevQuestion() { goToQuestion(session.index - 1); }

function togglePause() {
    if (!session || session.finished) return;
    session.paused = !session.paused;
    $("pause-btn").textContent = session.paused ? "Resume" : "Pause";
    renderTimer();
    saveSession();
}

function finishExam() {
    session.finished = true;
    stopTicking();
    saveSession();
    renderTimer();
    $("big-time").textContent = "DONE";
    $("done-btn").disabled = true;
    $("pause-btn").disabled = true;
    // Release wake lock after finishing if user hasn't requested keep-awake
    if (!keepAwake) releaseWakeLock();
}

function resetToSetup() {
    stopTicking();
    releaseWakeLock();
    localStorage.removeItem(STORAGE_SESSION);
    session = null;
    timerScreen.classList.remove("active");
    setupScreen.classList.add("active");
    $("done-btn").disabled = false;
    $("pause-btn").disabled = false;
    checkResumeAvailable();
    renderSummary();
}

/* ============================================================
TIMER RENDER
============================================================ */
function fmtClock(sec) {
    const neg = sec < 0;
    sec = Math.abs(Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return (neg ? "-" : "") + body;
}

function renderTimer() {
    const q = currentQuestion();
    const qElapsed = session.elapsed[session.index] || 0;
    const qRemaining = q ? q.budgetSec - qElapsed : 0;
    const totalRemaining = session.totalSec - totalElapsedSec();
    // Big timer
    $("cur-q-num").textContent = session.index + 1;
    $("cur-q-marks").textContent = `${q ? q.marks : 0} marks`;
    if (!session.finished) $("big-time").textContent = fmtClock(qRemaining);
    const big = $("big-timer");
    big.classList.remove("state-green", "state-orange", "state-red");
    big.classList.add("state-" + questionState());
    // Medium + buffer
    $("total-time").textContent = fmtClock(totalRemaining);
    const bufBox = $("buffer-box");
    const buf = bufferSec();
    $("buffer-time").textContent = (buf >= 0 ? "+" : "-") + fmtClock(Math.abs(buf)).replace("-", "");
    bufBox.classList.toggle("negative", buf < 0);
    // Prev/Next availability
    $("prev-btn").disabled = session.finished || session.index === 0;
    $("next-btn").disabled = session.finished || session.index === session.questions.length - 1;
    renderQuestionList();
}

function renderQuestionList() {
    const list = $("question-list");
    list.innerHTML = "";
    session.questions.forEach((q, i) => {
        const li = document.createElement("li");
        li.className = "q-item";
        const elapsed = session.elapsed[i] || 0;
        let status = "";
        if (session.done[i]) {
            const diff = q.budgetSec - elapsed;
            li.classList.add("done", diff >= 0 ? "saved" : "over");
            status = (diff >= 0 ? "saved " : "over ") + fmtClock(Math.abs(diff));
        } else {
            status = fmtClock(q.budgetSec - elapsed);
        }
        if (i === session.index && !session.finished) li.classList.add("current");
        li.innerHTML = `
<span class="q-idx">${i + 1}</span>
<span class="q-info">Q${i + 1}<div class="q-marks">${q.marks} marks · ${fmtMinShort(q.budgetSec / 60)}</div></span>
<span class="q-status">${status}</span>
`;
        li.addEventListener("click", () => goToQuestion(i));
        list.appendChild(li);
    });
}

/* ---------- Sound ---------- */
let audioCtx = null;

function beep(freq, dur) {
    if (muted) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
    } catch (e) { /* audio not available */ }
}

/* ============================================================
SCREEN WAKE LOCK (keep display on)
============================================================ */

const wakeSupported = () => "wakeLock" in navigator;

async function requestWakeLock() {
    if (!wakeSupported() || !keepAwake || wakeLock) return; 
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (err) {
        console.error(`${err.name}: ${err.message}`);
    }
}

async function releaseWakeLock() {
    if (wakeLock) {
        try {
            await wakeLock.release();
        } catch (err) {
            console.error(`${err.name}: ${err.message}`);
        }
        // Ensure internal reference is cleared after releasing
        wakeLock = null;
    }
}

function updateWakeButton() {
    const btn = $("wake-btn");
    
    if (!wakeSupported()) {
        btn.disabled = true;
        btn.textContent = "🔆 Not supported";
        btn.setAttribute("aria-pressed", "false");
        return;
    }
    btn.textContent = keepAwake ? "🔆 Screen on" : "💤 Screen off";
    btn.setAttribute("aria-pressed", String(keepAwake));
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" &&
        timerScreen.classList.contains("active")) {
        requestWakeLock();  
    }
});

/* ============================================================
NAVIGATION
============================================================ */
function enterTimer() {
    setupScreen.classList.remove("active");
    timerScreen.classList.add("active");
    $("done-btn").disabled = false;
    $("pause-btn").disabled = false;
    $("pause-btn").textContent = "Pause";
    renderTimer();
    startTicking();
    requestWakeLock();
}

function checkResumeAvailable() {
    const s = loadSession();
    resumeNote.classList.toggle("hidden", !s);
}

/* ============================================================
INIT / EVENT WIRING
============================================================ */
function init() {
    loadSetup();
    keepAwake = localStorage.getItem(STORAGE_KEEPAWAKE) !== "0";
    updateWakeButton();
    renderQuestionRows();
    renderSummary();
    checkResumeAvailable();
    totalMinutesInput.addEventListener("input", () => { saveSetup(); renderSummary(); });
    $("add-question").addEventListener("click", () => {
        setup.questions.push({ marks: 10, minutes: 7.5 });
        saveSetup(); renderQuestionRows(); renderSummary();
    });
    document.querySelectorAll("[data-preset]").forEach((btn) =>
        btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));
    $("start-exam").addEventListener("click", () => {
        saveSetup();
        if (setup.questions.length === 0) { alert("Add at least one question."); return; }
        session = buildSession();
        saveSession();
        enterTimer();
    });
    
    $("resume-exam").addEventListener("click", () => {
        const s = loadSession();
        if (!s) { checkResumeAvailable(); return; }
        session = s;
        enterTimer();
    });
    
    $("done-btn").addEventListener("click", markDone);
    $("prev-btn").addEventListener("click", prevQuestion);
    $("next-btn").addEventListener("click", nextQuestion);
    $("pause-btn").addEventListener("click", togglePause);
    $("reset-btn").addEventListener("click", () => {
        if (confirm("Reset and return to setup? Current session will be cleared.")) resetToSetup();
    });

    $("mute-btn").addEventListener("click", () => {
        muted = !muted;
        const b = $("mute-btn");
        b.textContent = muted ? "🔇 Muted" : "🔊 Sound";
        b.setAttribute("aria-pressed", String(muted));
        if (!muted) beep(880, 0.08); // quick confirmation blip
    });
    
    $("wake-btn").addEventListener("click", async () => {
        if (!wakeSupported()) return;
        keepAwake = !keepAwake;
        localStorage.setItem(STORAGE_KEEPAWAKE, keepAwake ? "1" : "0");
        updateWakeButton();
        if (keepAwake) await requestWakeLock(); else await releaseWakeLock();
    });
    
    // Keyboard shortcuts: space = pause, n = next.
    document.addEventListener("keydown", (e) => {
        if (!timerScreen.classList.contains("active")) return;
        if (e.code === "Space") { e.preventDefault(); togglePause(); }
        if (e.key === "n" || e.key === "N") markDone();
        if (e.key === "ArrowLeft") prevQuestion();
        if (e.key === "ArrowRight") nextQuestion();
    });
}

// Register service worker for offline / PWA.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => { });
    });
}

document.addEventListener("DOMContentLoaded", init);
