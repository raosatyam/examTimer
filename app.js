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
let customGroups = [{ marks: 10, count: 10 }]; // working state for the Custom preset builder

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
            saveSetup(); renderTypeEditor(); renderSummary();
        });
        row.querySelector(".q-mins").addEventListener("input", (e) => {
            q.minutes = parseFloat(e.target.value) || 0;
            saveSetup(); renderTypeEditor(); renderSummary();
        });
        row.querySelector(".del-q").addEventListener("click", () => {
            setup.questions.splice(i, 1);
            saveSetup(); renderQuestionRows(); renderTypeEditor(); renderSummary();
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

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// Re-render the whole setup area after questions change.
function refreshSetup() {
    renderQuestionRows();
    renderTypeEditor();
    renderSummary();
}

// Expand preset groups into a flat question list.
// A group without `minutes` gets time proportional to its marks share of the total.
function expandGroups(groups, totalMinutes) {
    const totalMarks = groups.reduce((s, g) => s + (g.marks || 0) * (g.count || 0), 0);
    const questions = [];
    groups.forEach((g) => {
        const count = Math.max(0, Math.floor(g.count || 0));
        let minutes;
        if (g.minutes != null) minutes = g.minutes;
        else if (totalMarks > 0) minutes = round2(totalMinutes * (g.marks / totalMarks));
        else minutes = 0;
        for (let i = 0; i < count; i++) questions.push({ marks: g.marks, minutes });
    });
    return questions;
}

function applyPreset(id) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    if (preset.totalMinutes) totalMinutesInput.value = preset.totalMinutes;
    const totalMinutes = parseFloat(totalMinutesInput.value) || 0;
    setup.questions = expandGroups(preset.groups, totalMinutes);
    saveSetup();
    refreshSetup();
}

function clearAll() {
    setup.questions = [];
    saveSetup();
    refreshSetup();
}

function populatePresetDropdown() {
    const sel = $("preset-select");
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = "Load a preset…"; ph.disabled = true; ph.selected = true;
    sel.appendChild(ph);
    PRESETS.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id; opt.textContent = p.name;
        sel.appendChild(opt);
    });
    const custom = document.createElement("option");
    custom.value = "__custom__"; custom.textContent = "Custom…";
    sel.appendChild(custom);
}

/* ---------- Time-per-type editor (edits auto-apply to all of that type) ---------- */
function renderTypeEditor() {
    const wrap = $("type-editor");
    const groups = {};
    setup.questions.forEach((q) => {
        if (!groups[q.marks]) groups[q.marks] = { marks: q.marks, count: 0, minutes: q.minutes };
        groups[q.marks].count++;
    });
    const keys = Object.keys(groups).map(Number).sort((a, b) => a - b);
    if (keys.length === 0) { wrap.innerHTML = ""; return; }

    wrap.innerHTML = `<div class="te-title">Time per question type <span class="te-hint">(auto-applies to all of that type)</span></div>`;
    keys.forEach((k) => {
        const g = groups[k];
        const row = document.createElement("div");
        row.className = "te-row";
        row.innerHTML = `
            <span class="te-label">${g.marks} marks × ${g.count}</span>
            <input type="number" class="te-mins" min="0" step="0.5" value="${round2(g.minutes)}" />
            <span class="te-unit">min each</span>
        `;
        row.querySelector(".te-mins").addEventListener("input", (e) => {
            const v = parseFloat(e.target.value);
            if (isNaN(v)) return;
            setup.questions.forEach((q) => { if (q.marks === g.marks) q.minutes = v; });
            saveSetup();
            renderQuestionRows(); // reflect new minutes in per-question rows
            renderSummary();
            // deliberately NOT re-rendering the type editor, to keep input focus
        });
        wrap.appendChild(row);
    });
}

/* ---------- Custom paper builder ---------- */
function renderCustomGroups() {
    const wrap = $("custom-groups");
    wrap.innerHTML = "";
    customGroups.forEach((g, i) => {
        const row = document.createElement("div");
        row.className = "cb-row";
        row.innerHTML = `
            <input type="number" class="cb-marks" min="0" step="1" value="${g.marks}" />
            <span>marks ×</span>
            <input type="number" class="cb-count" min="1" step="1" value="${g.count}" />
            <span>questions</span>
            <button type="button" class="del-q cb-del" title="Remove group" aria-label="Remove group">×</button>
        `;
        row.querySelector(".cb-marks").addEventListener("input", (e) => {
            g.marks = parseFloat(e.target.value) || 0; rebuildFromCustom();
        });
        row.querySelector(".cb-count").addEventListener("input", (e) => {
            g.count = parseInt(e.target.value, 10) || 0; rebuildFromCustom();
        });
        row.querySelector(".cb-del").addEventListener("click", () => {
            customGroups.splice(i, 1);
            if (customGroups.length === 0) customGroups.push({ marks: 10, count: 1 });
            renderCustomGroups(); rebuildFromCustom();
        });
        wrap.appendChild(row);
    });
}

function rebuildFromCustom() {
    const totalMinutes = parseFloat(totalMinutesInput.value) || 0;
    const groups = customGroups
        .filter((g) => g.marks > 0 && g.count > 0)
        .map((g) => ({ marks: g.marks, count: g.count })); // no minutes → proportional fill
    setup.questions = expandGroups(groups, totalMinutes);
    saveSetup();
    refreshSetup();
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
    requestAnimationFrame(fitTimer); 
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

    // Footer (feedback / github) only once the exam is finished, to avoid accidental clicks during the exam.
    $("timer-footer").classList.toggle("hidden", !session.finished);

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
        btn.textContent = "🔒 Not supported";
        btn.setAttribute("aria-pressed", "false");
        return;
    }
    btn.textContent = keepAwake ? "🔒 Screen on" : "💤 Screen off";
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

// Portrait phones: scale the timer block down so it fits its 75% cell (zoom out to fit).
function fitTimer() {
    const main = document.querySelector(".timer-main");
    const fit = document.querySelector(".timer-fit");
    if (!main || !fit) return;
    fit.style.transform = ""; // reset before measuring natural size
    // Only scale when the css has turned the wrapper into a real box (i.e. a compact layout).
    // On desktop the wrapper is `display: contents` and we don't want to scale that.
    if (getComputedStyle(fit).display === "contents") return;
    const avail = main.clientHeight; // the timer cell (75% in portrait, full height in landscape)
    const needed = fit.scrollHeight; // the timer block's natural height
    if (needed > avail && avail > 0) fit.style.transform = `scale(${avail / needed})`;
}

function enterTimer() {
    setupScreen.classList.remove("active");
    timerScreen.classList.add("active");
    $("done-btn").disabled = false;
    $("pause-btn").disabled = false;
    $("pause-btn").textContent = "Pause";
    renderTimer();
    startTicking();
    requestWakeLock();
    requestAnimationFrame(fitTimer);
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
    populatePresetDropdown();
    renderQuestionRows();
    renderTypeEditor();
    renderSummary();
    checkResumeAvailable();

    // Re-fit the timer when the viewport changes (rotate / resize / on =screen keyboard).
    window.addEventListener("resize", fitTimer);
    window.addEventListener("orientationchange", fitTimer);

    totalMinutesInput.addEventListener("input", () => {
        saveSetup();
        // In custom mode, total time drives the proportional per-question times.
        if (!$("custom-builder").classList.contains("hidden")) rebuildFromCustom();
        else renderSummary();
    });
    $("add-question").addEventListener("click", () => {
        setup.questions.push({ marks: 10, minutes: 7.5 });
        saveSetup(); refreshSetup();
    });

    $("preset-select").addEventListener("change", (e) => {
        const val = e.target.value;
        if (!val) return;
        if (val === "__custom__") {
            $("custom-builder").classList.remove("hidden");
            renderCustomGroups();
            rebuildFromCustom();
        } else {
            $("custom-builder").classList.add("hidden");
            applyPreset(val);
        }
    });
    $("clear-all").addEventListener("click", clearAll);
    $("add-group").addEventListener("click", () => {
        customGroups.push({ marks: 10, count: 1 });
        renderCustomGroups(); rebuildFromCustom();
    });

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
