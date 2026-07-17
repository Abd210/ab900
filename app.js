/**
 * app.js — AZ / AB Practice Lab
 * Exam simulator with auth and exam-scoped wrong-answer persistence.
 * Both source-derived question banks are loaded during bootstrap.
 */

const app = document.querySelector("#app");

const state = {
  exam: "ab",
  rawBanks: {},
  banks: {},
  bank: [],
  mode: "custom",        // "all" | "custom" | "wrongs-smart" | "wrongs-all" | "should-check" | "memorise" | "real-deal"
  customCount: 0,        // set during bootstrap to halfCount()
  wrongs: { smart: new Set(), all: new Set() },
  flags: new Set(),      // persistently flagged question IDs
  slowQuestions: new Set(), // question IDs where user spent >30s
  questions: [],
  current: 0,
  answers: {},
  results: [],
  filter: "all",
  bookmarks: new Set(),  // bookmarked question indices
  checked: new Set(),    // question IDs already checked mid-exam
  timer: null,           // interval id
  timerEnabled: false,
  timeLeft: 0,           // seconds remaining for current question
  questionTimes: {},     // { questionId: totalSeconds } accumulated per question
  questionEnteredAt: 0,  // Date.now() when current question was entered
  submitting: false,
  view: "home",          // "home" | "quiz" | "results" | "stats" | "memorise"
  realDealCount: 40,
  realDealPartialCredit: true,
  categoryFilter: "All",
  questionEdits: {},
  memorise: {
    queue: [],           // shuffled question objects still to drill
    mastered: new Set(), // question IDs answered correctly
    attempts: {},        // { questionId: attemptCount }
    totalInSession: 0,   // initial queue size
    revealed: false,     // whether the current card's answer is revealed
  },
};

let activeQuizKeyHandler = null;

const EXAMS = {
  ab: {
    code: "AB-900",
    mark: "AB",
    subtitle: "Microsoft 365 Copilot & Agent Administration",
    file: "questions.json",
  },
  az: {
    code: "AZ-900",
    mark: "AZ",
    subtitle: "Microsoft Azure Fundamentals",
    file: "az-diff-questions.json",
  },
  ai: {
    code: "AI-901",
    mark: "AI",
    subtitle: "Microsoft Azure AI Fundamentals",
    file: "ai-questions.json",
  },
  sc: {
    code: "SC-900",
    mark: "SC",
    subtitle: "Microsoft Security, Compliance, and Identity Fundamentals",
    file: "sc-questions.json",
  },
};

const examConfig = () => EXAMS[state.exam];
const wrongAnswersStorageKey = () => `${state.exam}900-last-wrong-answers`;
const flagsStorageKey = () => `${state.exam}-flagged-questions`;
const slowStorageKey = () => `${state.exam}-slow-questions`;
const halfCount = () => Math.ceil(state.bank.length / 2);

// ─── Persistent flags ────────────────────────────────────────────────────────

function loadFlags() {
  try {
    const raw = localStorage.getItem(flagsStorageKey());
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveFlags() {
  try {
    localStorage.setItem(flagsStorageKey(), JSON.stringify([...state.flags]));
  } catch (e) { console.warn('Could not save flags.', e); }
}

function toggleFlag(questionId) {
  if (state.flags.has(questionId)) {
    state.flags.delete(questionId);
  } else {
    state.flags.add(questionId);
  }
  saveFlags();
}

// ─── Persistent slow-question tracking ───────────────────────────────────────

const SLOW_THRESHOLD_SECONDS = 30;

function loadSlowQuestions() {
  try {
    const raw = localStorage.getItem(slowStorageKey());
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveSlowQuestions() {
  try {
    localStorage.setItem(slowStorageKey(), JSON.stringify([...state.slowQuestions]));
  } catch (e) { console.warn('Could not save slow questions.', e); }
}

/** Record elapsed seconds for the current question before leaving it. */
function recordQuestionTime() {
  if (!state.questionEnteredAt || state.questions.length === 0) return;
  const question = state.questions[state.current];
  if (!question) return;
  const elapsed = (Date.now() - state.questionEnteredAt) / 1000;
  state.questionTimes[question.id] = (state.questionTimes[question.id] || 0) + elapsed;
  state.questionEnteredAt = Date.now();
}

/** Merge newly-slow questions into the persistent set after a test. */
function persistSlowQuestions() {
  let changed = false;
  for (const [qid, seconds] of Object.entries(state.questionTimes)) {
    if (seconds >= SLOW_THRESHOLD_SECONDS) {
      state.slowQuestions.add(Number(qid) || qid);
      changed = true;
    }
  }
  if (changed) saveSlowQuestions();
}

/** Build the "should-check" set: wrong (smart) + slow questions. */
function getShouldCheckIds() {
  const ids = new Set(state.wrongs.smart);
  for (const id of state.slowQuestions) ids.add(id);
  return ids;
}

// ─── Real Deal domain mapping (SC-900) ───────────────────────────────────────

const REAL_DEAL_DOMAINS = [
  {
    name: "Concepts of security, compliance, and identity",
    weight: 0.125,  // midpoint of 10–15%
    categories: ["General Security & Governance"],
  },
  {
    name: "Capabilities of Microsoft Entra",
    weight: 0.275,  // midpoint of 25–30%
    categories: ["Identity & Access"],
  },
  {
    name: "Capabilities of Microsoft security solutions",
    weight: 0.375,  // midpoint of 35–40%
    categories: ["Microsoft Defender", "Microsoft Sentinel", "Cloud Security & Network"],
  },
  {
    name: "Capabilities of Microsoft compliance solutions",
    weight: 0.225,  // midpoint of 20–25%
    categories: ["Microsoft Purview"],
  },
];

function selectWeightedQuestions(bank, totalCount) {
  const selected = [];
  const remaining = [...bank];

  for (const domain of REAL_DEAL_DOMAINS) {
    const domainQuestions = remaining.filter(
      (q) => domain.categories.includes(q.category),
    );
    const count = Math.round(totalCount * domain.weight);
    const picked = shuffle(domainQuestions).slice(0, count);
    selected.push(...picked);
    // Remove picked questions from remaining pool to avoid duplicates
    const pickedIds = new Set(picked.map((q) => q.id));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (pickedIds.has(remaining[i].id)) remaining.splice(i, 1);
    }
  }

  // If rounding left us short, fill from remaining pool
  while (selected.length < totalCount && remaining.length > 0) {
    const idx = Math.floor(Math.random() * remaining.length);
    selected.push(remaining.splice(idx, 1)[0]);
  }

  return shuffle(selected.slice(0, totalCount));
}

function getPartialScore(question) {
  const interaction = question.interaction;
  const actual = state.answers[question.id];
  if (interaction.type === "matrix") {
    if (!Array.isArray(actual)) return 0;
    let correct = 0;
    for (let i = 0; i < interaction.correct.length; i++) {
      if (normalize(actual[i]) === normalize(interaction.correct[i])) correct++;
    }
    return correct / interaction.correct.length;
  }
  if (interaction.type === "fields") {
    if (!Array.isArray(actual)) return 0;
    let correct = 0;
    for (let i = 0; i < interaction.fields.length; i++) {
      if (normalize(actual[i]) === normalize(interaction.fields[i].correct)) correct++;
    }
    return correct / interaction.fields.length;
  }
  // Single / multi — binary
  return isCorrect(question) ? 1 : 0;
}

function getQuestionDomain(question) {
  for (const domain of REAL_DEAL_DOMAINS) {
    if (domain.categories.includes(question.category)) return domain.name;
  }
  return "Other";
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function refreshBank() {
  const fullBank = state.banks[state.exam];
  if (state.categoryFilter === "All") {
    state.bank = fullBank;
  } else {
    state.bank = fullBank.filter((q) => q.category === state.categoryFilter);
  }
}

function applyQuestionEdits(rawBanks, edits) {
  const output = {};
  for (const [exam, questions] of Object.entries(rawBanks)) {
    const examEdits = edits[exam] || {};
    output[exam] = questions
      .map((question) => {
        const edit = examEdits[String(question.id)];
        if (!edit) return question;
        if (edit.deleted) return null;
        return edit.question ? edit.question : question;
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.id) - Number(b.id));
  }
  return output;
}

async function reloadEditedBanks() {
  state.questionEdits = await loadQuestionEdits();
  state.banks = applyQuestionEdits(state.rawBanks, state.questionEdits);
  refreshBank();
}


function explanationParagraphs(text) {
  return text.split("\n").filter(Boolean).map(function(p) { return "<p>" + escapeHtml(p) + "</p>"; }).join("");
}

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\bmicrosoft\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\band\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function shuffle(items) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const target = random[0] % (index + 1);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function splitMatchList(value = "") {
  return String(value)
    .split(/\s+\/\s+|,\s*/)
    .map((item) => item.trim().replace(/[.;:]$/, ""))
    .filter(Boolean);
}

function extractListAfter(prompt, label) {
  const match = String(prompt).match(new RegExp(`${label}:\\s*([^.;]+)`, "i"));
  return match ? splitMatchList(match[1]) : [];
}

function extractNumberedPromptItems(prompt) {
  const items = [];
  const text = String(prompt);
  const pattern = /\((\d+)\)\s*([^()]+?)(?=\s*\(\d+\)|$)/g;
  let match;
  while ((match = pattern.exec(text))) {
    items.push({
      number: match[1],
      label: match[2].trim().replace(/[.;:]$/, ""),
    });
  }
  return items;
}

function uniqueOptions(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dragDropOptionsFromPrompt(prompt, correctValues) {
  const headings = [
    "Benefits",
    "Cloud models",
    "Services",
    "Serverless Solutions",
    "Features",
    "Cloud services",
    "Layers",
    "Authentication methods",
    "Resources",
    "Terms",
  ];
  return uniqueOptions([
    ...headings.flatMap((heading) => extractListAfter(prompt, heading)),
    ...correctValues,
  ]);
}

function parseDragDropPairs(question) {
  const answer = String(question.answer || question.interaction?.correct || "");
  const semicolonPairs = answer
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return null;
      return {
        label: part.slice(0, separator).trim(),
        correct: part.slice(separator + 1).trim(),
      };
    })
    .filter(Boolean);
  if (semicolonPairs.length > 1) return semicolonPairs;

  const numberedPairs = [];
  const numberedPattern = /(\d+)\s*=\s*([^,;]+)/g;
  let match;
  while ((match = numberedPattern.exec(answer))) {
    numberedPairs.push({ number: match[1], correct: match[2].trim() });
  }
  if (numberedPairs.length > 1) {
    const promptItems = extractNumberedPromptItems(question.prompt);
    return numberedPairs.map((pair) => ({
      label:
        promptItems.find((item) => item.number === pair.number)?.label ||
        `Item ${pair.number}`,
      correct: pair.correct,
    }));
  }

  const ordered = answer
    .replace(/^Top to bottom:\s*/i, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ordered.length > 1) {
    const components = extractListAfter(question.prompt, "Components");
    const numberedItems = extractNumberedPromptItems(question.prompt);
    const labels =
      components.length === ordered.length
        ? components
        : numberedItems.length >= ordered.length
          ? numberedItems.slice(0, ordered.length).map((item) => item.label)
          : ordered.map((_, index) => `Position ${index + 1}`);
    return ordered.map((correct, index) => ({
      label: labels[index],
      correct,
    }));
  }

  return [];
}

function normalizeDragDropQuestion(question) {
  const interaction = question.interaction;
  if (
    question.sourceType !== "drag-drop" ||
    interaction?.type !== "single" ||
    interaction.options?.length !== 1
  ) {
    return question;
  }

  const prompt = String(question.prompt || "");
  if (!/^(Match|Arrange)|In which order|Drag/i.test(prompt)) return question;

  const pairs = parseDragDropPairs(question);
  if (pairs.length < 2) return question;

  const correctValues = pairs.map((pair) => pair.correct);
  const options = dragDropOptionsFromPrompt(prompt, correctValues);
  if (options.length < 2) return question;

  return {
    ...question,
    kind: "fields",
    interaction: {
      type: "fields",
      fields: pairs.map((pair) => ({
        label: pair.label,
        options,
        correct: pair.correct,
      })),
    },
  };
}

/**
 * Deep-clone a question and shuffle its options (single/multi only).
 * The correct answers are matched by value, not position, so this is safe.
 */
function shuffleQuestionOptions(question) {
  const q = normalizeDragDropQuestion(JSON.parse(JSON.stringify(question)));
  if (q.interaction.type === "single" || q.interaction.type === "multi") {
    q.interaction.options = shuffle(q.interaction.options);
  }
  return q;
}

function getUserAnswer(question) {
  const answer = state.answers[question.id];
  if (Array.isArray(answer)) return answer.map((value) => value || "").join("; ");
  return answer || "";
}

function formatAnswerDisplay(question, answer) {
  const interaction = question.interaction;
  if (interaction.type === "single" || interaction.type === "multi") {
    const selected = Array.isArray(answer) ? answer : answer ? [answer] : [];
    return selected
      .map((value) => {
        const option = interaction.options.find((item) =>
          typeof item === "string" ? item === value : item.id === value
        );
        return typeof option === "string" ? option : option?.label || value;
      })
      .join("; ");
  }
  if (Array.isArray(answer)) return answer.filter(Boolean).join("; ");
  return answer || "";
}

function getCorrectAnswerDisplay(question) {
  const interaction = question.interaction;
  if (interaction.type === "fields") {
    return interaction.fields.map((field) => field.correct).join("; ");
  }
  return formatAnswerDisplay(question, interaction.correct);
}

function isAnswered(question) {
  const interaction = question.interaction;
  const answer = state.answers[question.id];
  if (interaction.type === "matrix" || interaction.type === "fields") {
    const expectedLength =
      interaction.type === "matrix"
        ? interaction.statements.length
        : interaction.fields.length;
    return (
      Array.isArray(answer) &&
      answer.length === expectedLength &&
      answer.every((value) => normalize(value).length > 0)
    );
  }
  if (interaction.type === "multi") {
    return Array.isArray(answer) && answer.length > 0;
  }
  return normalize(answer).length > 0;
}

function isCorrect(question) {
  const interaction = question.interaction;
  const actual = state.answers[question.id];
  if (interaction.type === "matrix") {
    return (
      Array.isArray(actual) &&
      actual.length === interaction.correct.length &&
      interaction.correct.every(
        (expected, index) => normalize(actual[index]) === normalize(expected),
      )
    );
  }
  if (interaction.type === "fields") {
    return (
      Array.isArray(actual) &&
      interaction.fields.every(
        (field, index) => normalize(actual[index]) === normalize(field.correct),
      )
    );
  }
  if (interaction.type === "multi") {
    const expected = [...interaction.correct].map(normalize).sort();
    const received = Array.isArray(actual)
      ? [...actual].map(normalize).sort()
      : [];
    return JSON.stringify(expected) === JSON.stringify(received);
  }
  return normalize(actual) === normalize(interaction.correct);
}

function refreshProgressIndicators() {
  const label = app.querySelector(".progress-label span");
  if (label) {
    label.textContent = `${state.questions.filter(isAnswered).length} answered`;
  }
  app.querySelectorAll(".question-jump").forEach((button, index) => {
    button.classList.toggle("answered", isAnswered(state.questions[index]));
  });
  const checkBtn = app.querySelector("#check-answer-btn");
  if (checkBtn) {
    checkBtn.disabled = !isAnswered(state.questions[state.current]);
  }
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function formatAnswerForExport(question, answer) {
  const interaction = question.interaction;
  if (interaction.type === "matrix") {
    if (!Array.isArray(answer)) return [];
    return interaction.statements.map((statement, index) => ({
      statement,
      selected: answer[index] || "",
      correct: interaction.correct[index] || "",
    }));
  }
  if (interaction.type === "fields") {
    if (!Array.isArray(answer)) return [];
    return interaction.fields.map((field, index) => ({
      field: field.label,
      selected: answer[index] || "",
      correct: field.correct,
    }));
  }
  if (interaction.type === "multi") {
    if (!Array.isArray(answer)) return [];
    return answer.map((value) => formatAnswerDisplay(question, value));
  }
  return formatAnswerDisplay(question, answer);
}

function buildWrongAnswersExport() {
  const wrongAnswers = state.results
    .filter((result) => !result.correct)
    .map((result, index) => {
      const { question } = result;
      const rawAnswer = state.answers[question.id];
      return {
        item: index + 1,
        sourceQuestionId: question.id,
        type: question.interaction.type,
        prompt: question.prompt,
        stem: question.interaction.stem || "",
        context: question.interaction.context || [],
        yourAnswer: formatAnswerForExport(question, rawAnswer),
        answerKey: getCorrectAnswerDisplay(question),
        explanation: question.explanation,
      };
    });

  return {
    exportedAt: new Date().toISOString(),
    exam: examConfig().code,
    mode: state.mode,
    totalQuestions: state.results.length,
    correctAnswers: state.results.filter((result) => result.correct).length,
    wrongAnswersCount: wrongAnswers.length,
    wrongAnswers,
    allQuestionIds: state.questions.map((q) => q.id),
  };
}

function saveWrongAnswersLocal(payload) {
  try {
    localStorage.setItem(wrongAnswersStorageKey(), JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not save wrong answers locally.", error);
  }
}

function getWrongAnswersExportText() {
  const payload = buildWrongAnswersExport();
  return JSON.stringify(payload, null, 2);
}

// ─── Header ───────────────────────────────────────────────────────────────────

function updateHeaderBrand() {
  const config = examConfig();
  const mark = document.querySelector(".brand-mark");
  const subtitle = document.querySelector(".brand small");
  if (mark) mark.textContent = config.mark;
  if (subtitle) subtitle.textContent = config.subtitle;
}

function updateHeaderUser(user) {
  const headerMeta = document.querySelector(".header-meta");
  if (!headerMeta) return;
  const displayName = user.displayName || user.email?.split("@")[0] || "Student";
  headerMeta.innerHTML = `
    <span class="status-dot"></span>
    <span class="header-username">${escapeHtml(displayName)}</span>
    ${isCurrentUserAdmin() ? '<button class="header-admin" type="button" id="header-admin-btn" title="Admin dashboard">Admin</button>' : ""}
    <button class="header-logout" type="button" id="header-logout-btn" title="Sign out">Sign out</button>
  `;
  const adminBtn = document.getElementById("header-admin-btn");
  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      renderAdminDashboard();
    });
  }
  const logoutBtn = document.getElementById("header-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (window.confirm("Sign out of Practice Lab?")) {
        clearQuizKeyHandler();
        stopQuestionTimer();
        signOutUser();
      }
    });
  }
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function renderHome() {
  clearQuizKeyHandler();
  stopQuestionTimer();
  const config = examConfig();
  const total = state.bank.length;
  if (state.customCount < 1 || state.customCount > total) {
    state.customCount = halfCount();
  }
  updateHeaderBrand();
  document.title = `${config.code} Practice Lab`;
  const smartCount = state.wrongs.smart.size;
  const allCount = state.wrongs.all.size;
  const hasSmartWrongs = smartCount > 0;
  const hasAllWrongs = allCount > 0;
  const shouldCheckIds = getShouldCheckIds();
  const shouldCheckCount = state.bank.filter((q) => shouldCheckIds.has(q.id)).length;
  const hasShouldCheck = shouldCheckCount > 0;
  const flagCount = state.flags.size;
  const hasFlaggedQuestions = flagCount > 0;
  const flaggedQuestions = hasFlaggedQuestions
    ? state.bank.filter((q) => state.flags.has(q.id))
    : [];

  app.innerHTML = `
    <nav class="exam-switch" aria-label="Choose an exam">
      <span>Question bank</span>
      <div>
        ${Object.entries(EXAMS)
          .map(
            ([key, exam]) => `
              <button class="${state.exam === key ? "active" : ""}" type="button" data-exam="${key}">
                <strong>${exam.code}</strong>
                <small>${state.banks[key].length} questions</small>
              </button>
            `,
          )
          .join("")}
      </div>
    </nav>
    <section class="hero">
      <div>
        <p class="eyebrow">${config.code} exam simulator</p>
        <h1>Know the material.<br /><em>Keep your nerve.</em></h1>
        <p class="hero-copy">
          Practice all ${total} questions or pick exactly how many you want.
          Every question is rebuilt as a real interactive exam item with
          <strong>shuffled answer choices</strong> so you can't memorise positions.
        </p>
        <div class="hero-points" aria-label="Features">
          <span>Shuffled choices</span>
          <span>Instant grading</span>
          <span>Detailed answer review</span>
          <span>Smart wrong-answer tracking</span>
        </div>
      </div>

      <aside class="mode-panel">
        <h2>Choose your run</h2>
        <p>Pick a mode, then hit start.</p>
        ${state.exam === "sc" ? `
          <div class="category-filter-row">
            <select id="category-select" class="category-select" aria-label="Filter by category">
              <option value="All" ${state.categoryFilter === "All" ? "selected" : ""}>All Services</option>
              <option value="Identity & Access" ${state.categoryFilter === "Identity & Access" ? "selected" : ""}>Identity & Access</option>
              <option value="Microsoft Purview" ${state.categoryFilter === "Microsoft Purview" ? "selected" : ""}>Microsoft Purview</option>
              <option value="Microsoft Defender" ${state.categoryFilter === "Microsoft Defender" ? "selected" : ""}>Microsoft Defender</option>
              <option value="Cloud Security & Network" ${state.categoryFilter === "Cloud Security & Network" ? "selected" : ""}>Cloud Security & Network</option>
              <option value="Microsoft Sentinel" ${state.categoryFilter === "Microsoft Sentinel" ? "selected" : ""}>Microsoft Sentinel</option>
              <option value="General Security & Governance" ${state.categoryFilter === "General Security & Governance" ? "selected" : ""}>General Security & Governance</option>
            </select>
          </div>
        ` : ""}
        <div class="mode-grid">
          <button class="mode-card ${state.mode === "all" ? "selected" : ""}" type="button" data-mode="all">
            <span class="mode-icon">${total}</span>
            <span>
              <strong>Full exam</strong>
              <small>Every question, shuffled choices.</small>
            </span>
            <span class="mode-count">${total} Q</span>
          </button>
          <button class="mode-card ${state.mode === "custom" ? "selected" : ""}" type="button" data-mode="custom">
            <span class="mode-icon">🎯</span>
            <span>
              <strong>Custom</strong>
              <small>Pick exactly how many questions you want.</small>
            </span>
            <span class="mode-count" id="custom-count-badge">${state.customCount} Q</span>
          </button>
          <div class="custom-slider-row ${state.mode === "custom" ? "visible" : ""}" id="custom-slider-row">
            <input
              type="range"
              class="custom-slider"
              id="custom-slider"
              min="1"
              max="${total}"
              value="${state.customCount}"
              aria-label="Number of questions"
            />
            <span class="custom-slider-value" id="custom-slider-value">${state.customCount}</span>
          </div>
          <button
            class="mode-card ${state.mode === "wrongs-smart" ? "selected" : ""} ${hasSmartWrongs ? "" : "mode-card--disabled"}"
            type="button"
            data-mode="wrongs-smart"
            ${hasSmartWrongs ? "" : "disabled"}
            title="${hasSmartWrongs ? "" : "Complete at least one test to unlock"}"
          >
            <span class="mode-icon mode-icon--wrongs">✗</span>
            <span>
              <strong>Smart wrongs</strong>
              <small>${
                hasSmartWrongs
                  ? `${smartCount} question${smartCount === 1 ? "" : "s"} you still get wrong.`
                  : "Corrected mistakes auto-remove."
              }</small>
            </span>
            <span class="mode-count ${hasSmartWrongs ? "mode-count--bad" : ""}">${hasSmartWrongs ? `${smartCount} Q` : "–"}</span>
          </button>
          <button
            class="mode-card ${state.mode === "wrongs-all" ? "selected" : ""} ${hasAllWrongs ? "" : "mode-card--disabled"}"
            type="button"
            data-mode="wrongs-all"
            ${hasAllWrongs ? "" : "disabled"}
            title="${hasAllWrongs ? "" : "Complete at least one test to unlock"}"
          >
            <span class="mode-icon mode-icon--all-wrongs">∞</span>
            <span>
              <strong>All-time wrongs</strong>
              <small>${
                hasAllWrongs
                  ? `${allCount} question${allCount === 1 ? "" : "s"} you've ever missed.`
                  : "Every mistake stays here permanently."
              }</small>
            </span>
            <span class="mode-count ${hasAllWrongs ? "mode-count--gold" : ""}">${hasAllWrongs ? `${allCount} Q` : "–"}</span>
          </button>
          <button
            class="mode-card ${state.mode === "should-check" ? "selected" : ""} ${hasShouldCheck ? "" : "mode-card--disabled"}"
            type="button"
            data-mode="should-check"
            ${hasShouldCheck ? "" : "disabled"}
            title="${hasShouldCheck ? "" : "Take a test first so we can measure your speed"}"
          >
            <span class="mode-icon mode-icon--should-check">🔍</span>
            <span>
              <strong>You should check</strong>
              <small>${
                hasShouldCheck
                  ? `${shouldCheckCount} question${shouldCheckCount === 1 ? "" : "s"} you got wrong or hesitated on (>30s).`
                  : "Wrong answers + questions that took you >30 seconds."
              }</small>
            </span>
            <span class="mode-count ${hasShouldCheck ? "mode-count--check" : ""}">${hasShouldCheck ? `${shouldCheckCount} Q` : "–"}</span>
          </button>
          <button class="mode-card ${state.mode === "memorise" ? "selected" : ""}" type="button" data-mode="memorise">
            <span class="mode-icon mode-icon--memorise">🧠</span>
            <span>
              <strong>Memorise</strong>
              <small>Drill every question until you recall the answer. Wrong answers come back.</small>
            </span>
            <span class="mode-count">${total} Q</span>
          </button>
          ${state.exam === "sc" ? `
          <button class="mode-card ${state.mode === "real-deal" ? "selected" : ""}" type="button" data-mode="real-deal">
            <span class="mode-icon mode-icon--real-deal">🎯</span>
            <span>
              <strong>Real Deal</strong>
              <small>Weighted domain proportions matching the real SC-900 exam.</small>
            </span>
            <span class="mode-count mode-count--real-deal" id="real-deal-count-badge">${state.realDealCount} Q</span>
          </button>
          <div class="real-deal-controls ${state.mode === "real-deal" ? "visible" : ""}" id="real-deal-controls">
            <div class="real-deal-slider-row">
              <input
                type="range"
                class="custom-slider"
                id="real-deal-slider"
                min="10"
                max="60"
                value="${state.realDealCount}"
                aria-label="Number of questions"
              />
              <span class="custom-slider-value" id="real-deal-slider-value">${state.realDealCount}</span>
              <button class="real-deal-random-btn" type="button" id="real-deal-random">🎲 Random</button>
            </div>
            <label class="real-deal-partial-toggle">
              <input type="checkbox" id="real-deal-partial-checkbox" ${state.realDealPartialCredit ? "checked" : ""} />
              <span>Partial credit for Yes/No questions</span>
              <small>Get points for each correct row instead of all-or-nothing</small>
            </label>
          </div>
          ` : ""}
        </div>
        <label class="timer-toggle" id="timer-toggle">
          <input type="checkbox" id="timer-checkbox" ${state.timerEnabled ? "checked" : ""} />
          <span>⏱ Timer mode</span>
          <small>60 seconds per question</small>
        </label>
        <button class="primary-button" type="button" id="start-test">Start practice test →</button>
        ${hasAllWrongs || state.slowQuestions.size > 0 ? `
        <div class="home-actions">
          ${hasAllWrongs ? `<button class="home-action-btn home-action-btn--danger" type="button" id="reset-wrongs-btn">🗑 Reset all-time wrongs</button>` : ""}
          ${state.slowQuestions.size > 0 ? `<button class="home-action-btn home-action-btn--danger" type="button" id="reset-slow-btn">🗑 Reset slow history</button>` : ""}
        </div>
        ` : ""}
        <div class="source-note">
          <span>✦</span>
          <p>Answer choices are randomly shuffled each run so you learn the material, not the letter.</p>
        </div>
      </aside>
    </section>
    ${hasFlaggedQuestions ? `
    <section class="flagged-section">
      <div class="flagged-header">
        <div>
          <h2>🚩 Flagged for review</h2>
          <p>${flagCount} question${flagCount === 1 ? "" : "s"} flagged in ${config.code}. Review them before your next test.</p>
        </div>
        <button class="home-action-btn home-action-btn--danger" type="button" id="clear-flags-btn">🗑 Clear all flags</button>
      </div>
      <div class="flagged-list">
        ${flaggedQuestions.map((q) => {
          const text = q.prompt || q.question || "";
          const preview = escapeHtml(text.substring(0, 80)) + (text.length > 80 ? "\u2026" : "");
          const bodyHtml = text.split("\n").filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
          const explHtml = q.explanation
            ? `<div class="review-explanation"><strong>Explanation</strong><p>${escapeHtml(q.explanation)}</p></div>`
            : "";
          return `
          <article class="flagged-card" data-flag-id="${q.id}">
            <button class="flagged-summary" type="button" aria-expanded="false">
              <span class="flagged-icon">🚩</span>
              <span>
                <strong>Question #${q.id}</strong>
                <small>${preview}</small>
              </span>
              <span class="flagged-chevron">\u2304</span>
            </button>
            <div class="flagged-details">
              <div class="question-copy">${bodyHtml}</div>
              ${explHtml}
              <div class="flagged-actions">
                <button class="home-action-btn" type="button" data-unflag="${q.id}">Remove flag</button>
              </div>
            </div>
          </article>`;
        }).join("")}
      </div>
    </section>
    ` : ""}
  `;

  // Exam switch
  app.querySelectorAll("[data-exam]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.exam === state.exam) return;
      const selectedExam = button.dataset.exam;
      state.exam = selectedExam;
      state.categoryFilter = "All";
      refreshBank();
      state.mode = "custom";
      state.customCount = halfCount();
      const wrongs = await loadWrongQuestionIds(selectedExam);
      if (state.exam !== selectedExam) return;
      state.wrongs = wrongs;
      state.flags = loadFlags();
      state.slowQuestions = loadSlowQuestions();
      renderHome();
    });
  });

  // Mode cards
  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.mode = button.dataset.mode;
      app
        .querySelectorAll("[data-mode]")
        .forEach((card) => card.classList.toggle("selected", card === button));
      // Show/hide slider row
      const sliderRow = document.getElementById("custom-slider-row");
      sliderRow.classList.toggle("visible", state.mode === "custom");
      // Show/hide real-deal controls
      const realDealRow = document.getElementById("real-deal-controls");
      if (realDealRow) realDealRow.classList.toggle("visible", state.mode === "real-deal");
    });
  });

  // Category filter
  const categorySelect = app.querySelector("#category-select");
  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      state.categoryFilter = categorySelect.value;
      refreshBank();
      state.mode = "all"; // Reset mode to 'all' to avoid custom mode bounds issues
      state.customCount = halfCount();
      renderHome();
    });
  }

  // Real Deal controls
  const realDealSlider = document.getElementById("real-deal-slider");
  if (realDealSlider) {
    realDealSlider.addEventListener("input", () => {
      state.realDealCount = Number(realDealSlider.value);
      const valueLabel = document.getElementById("real-deal-slider-value");
      if (valueLabel) valueLabel.textContent = state.realDealCount;
      const badge = document.getElementById("real-deal-count-badge");
      if (badge) badge.textContent = state.realDealCount + " Q";
    });
  }
  const realDealRandomBtn = document.getElementById("real-deal-random");
  if (realDealRandomBtn) {
    realDealRandomBtn.addEventListener("click", () => {
      const randomCount = 30 + Math.floor(Math.random() * 31); // 30–60
      state.realDealCount = randomCount;
      if (realDealSlider) realDealSlider.value = randomCount;
      const valueLabel = document.getElementById("real-deal-slider-value");
      if (valueLabel) valueLabel.textContent = randomCount;
      const badge = document.getElementById("real-deal-count-badge");
      if (badge) badge.textContent = randomCount + " Q";
    });
  }
  const partialCreditCheckbox = document.getElementById("real-deal-partial-checkbox");
  if (partialCreditCheckbox) {
    partialCreditCheckbox.addEventListener("change", () => {
      state.realDealPartialCredit = partialCreditCheckbox.checked;
    });
  }

  // Timer toggle
  const timerCheckbox = document.getElementById("timer-checkbox");
  if (timerCheckbox) {
    timerCheckbox.addEventListener("change", () => {
      state.timerEnabled = timerCheckbox.checked;
    });
  }

  // Reset all-time wrongs
  const resetBtn = document.getElementById("reset-wrongs-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (!window.confirm(`Reset ALL wrong-answer history for ${examConfig().code}? This cannot be undone.`)) return;
      resetBtn.disabled = true;
      resetBtn.textContent = "Resetting…";
      await resetAllWrongs(state.exam);
      state.wrongs = await loadWrongQuestionIds(state.exam);
      renderHome();
    });
  }

  // Reset slow question history
  const resetSlowBtn = document.getElementById("reset-slow-btn");
  if (resetSlowBtn) {
    resetSlowBtn.addEventListener("click", () => {
      if (!window.confirm(`Clear slow-question history for ${examConfig().code}?`)) return;
      state.slowQuestions.clear();
      saveSlowQuestions();
      renderHome();
    });
  }

  app.querySelector("#start-test").addEventListener("click", startTest);

  // Custom slider
  const slider = document.getElementById("custom-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      state.customCount = Number(slider.value);
      const valDisplay = document.getElementById("custom-slider-value");
      const badge = document.getElementById("custom-count-badge");
      if (valDisplay) valDisplay.textContent = state.customCount;
      if (badge) badge.textContent = `${state.customCount} Q`;
    });
  }

  // Flagged section
  const clearFlagsBtn = document.getElementById("clear-flags-btn");
  if (clearFlagsBtn) {
    clearFlagsBtn.addEventListener("click", () => {
      if (!window.confirm(`Clear all ${state.flags.size} flagged questions for ${examConfig().code}?`)) return;
      state.flags.clear();
      saveFlags();
      renderHome();
    });
  }

  app.querySelectorAll(".flagged-summary").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".flagged-card");
      const isOpen = card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  });

  app.querySelectorAll("[data-unflag]").forEach((button) => {
    button.addEventListener("click", () => {
      const qid = Number(button.dataset.unflag) || button.dataset.unflag;
      toggleFlag(qid);
      renderHome();
    });
  });
}

// ─── Quiz ─────────────────────────────────────────────────────────────────────

function startTest() {
  if (state.mode === "all") {
    state.questions = shuffle([...state.bank]);
  } else if (state.mode === "custom") {
    state.questions = shuffle(state.bank).slice(0, state.customCount);
  } else if (state.mode === "wrongs-smart") {
    const wrongBank = state.bank.filter((q) => state.wrongs.smart.has(q.id));
    state.questions = shuffle(wrongBank);
  } else if (state.mode === "wrongs-all") {
    const wrongBank = state.bank.filter((q) => state.wrongs.all.has(q.id));
    state.questions = shuffle(wrongBank);
  } else if (state.mode === "should-check") {
    const checkIds = getShouldCheckIds();
    const checkBank = state.bank.filter((q) => checkIds.has(q.id));
    state.questions = shuffle(checkBank);
  } else if (state.mode === "memorise") {
    state.questions = shuffle([...state.bank]);
  } else if (state.mode === "real-deal") {
    // Use the FULL sc bank (ignore category filter) for weighted selection
    const fullBank = state.banks[state.exam];
    state.questions = selectWeightedQuestions(fullBank, state.realDealCount);
  }

  // Shuffle answer choices for every question so users can't memorise positions
  state.questions = state.questions.map(shuffleQuestionOptions);
  if (state.questions.length === 0) {
    window.alert("No matching questions are available for this mode yet.");
    state.mode = "custom";
    renderHome();
    return;
  }

  // ── Memorise mode uses its own flow ──
  if (state.mode === "memorise") {
    state.memorise = {
      allQuestions: [...state.questions],
      queue: state.questions.slice(0, 40),
      mastered: new Set(),
      attempts: {},
      batchSize: 40,
      currentBatchIndex: 0,
      totalBatches: Math.ceil(state.questions.length / 40),
      totalInSession: state.questions.length,
      revealed: false,
    };
    state.current = 0;
    state.answers = {};
    state.view = "memorise";
    renderMemoriseCard();
    return;
  }

  state.current = 0;
  state.answers = {};
  state.results = [];
  state.bookmarks = new Set();
  state.checked = new Set();
  state.questionTimes = {};
  state.questionEnteredAt = Date.now();
  state.submitting = false;
  state.view = "quiz";

  stopQuestionTimer();
  renderQuiz();
  if (state.timerEnabled) {
    startQuestionTimer();
  }
}

function stopQuestionTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function startQuestionTimer() {
  stopQuestionTimer();
  state.timeLeft = 60;
  updateTimerDisplay();
  state.timer = setInterval(() => {
    state.timeLeft -= 1;
    updateTimerDisplay();
    if (state.timeLeft <= 0) {
      stopQuestionTimer();
      // Auto-advance to next question
      if (state.current < state.questions.length - 1) {
        state.current += 1;
        renderQuiz();
        startQuestionTimer();
      } else {
        submitTest({ skipUnansweredConfirm: true });
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById("timer-display");
  if (!el) return;
  const mins = Math.floor(state.timeLeft / 60);
  const secs = String(state.timeLeft % 60).padStart(2, "0");
  el.textContent = `${mins}:${secs}`;
  el.classList.toggle("timer-warn", state.timeLeft <= 10);
}

function answerControl(question) {
  const interaction = question.interaction;
  const current = state.answers[question.id];
  const locked = state.checked.has(question.id);
  if (interaction.type === "single" || interaction.type === "multi") {
    const selected = Array.isArray(current) ? current : current ? [current] : [];
    const correct = new Set(
      Array.isArray(interaction.correct)
        ? interaction.correct
        : [interaction.correct],
    );
    const options = interaction.options.map((option, index) => {
      if (typeof option === "string") {
        return {
          id: option,
          label: option,
          marker: String.fromCharCode(65 + index),
        };
      }
      return {
        id: option.id,
        label: option.label,
        marker: String.fromCharCode(65 + index),
      };
    });
    return `
      <div class="choice-list" role="${interaction.type === "single" ? "radiogroup" : "group"}">
        ${options
          .map(
            (option) => {
              const isSelected = selected.includes(option.id);
              const checkedClass = locked
                ? correct.has(option.id)
                  ? "answer-correct"
                  : isSelected
                    ? "answer-incorrect"
                    : ""
                : "";
              return `
              <label class="choice ${isSelected ? "selected" : ""} ${checkedClass}">
                <input
                  type="${interaction.type === "single" ? "radio" : "checkbox"}"
                  name="question-${question.id}"
                  value="${option.id}"
                  ${selected.includes(option.id) ? "checked" : ""}
                  ${locked ? "disabled" : ""}
                />
                <span class="choice-letter">${option.marker}</span>
                <span class="choice-text">${escapeHtml(option.label)}</span>
              </label>
            `;
            },
          )
          .join("")}
      </div>
      ${
        interaction.type === "multi"
          ? `<p class="answer-hint">Select every answer that applies.</p>`
          : ""
      }
    `;
  }

  if (interaction.type === "matrix") {
    const selected = Array.isArray(current)
      ? current
      : Array(interaction.statements.length).fill("");
    return `
      <div class="matrix" role="group" aria-label="Yes or No statements">
        <div class="matrix-head" aria-hidden="true">
          <span>Statement</span><span>Yes</span><span>No</span>
        </div>
        ${interaction.statements
          .map(
            (statement, index) => `
              <div class="matrix-row">
                <p>${escapeHtml(statement)}</p>
                ${["Yes", "No"]
                  .map(
                    (value) => {
                      const isSelected = selected[index] === value;
                      const checkedClass = locked
                        ? interaction.correct[index] === value
                          ? "answer-correct"
                          : isSelected
                            ? "answer-incorrect"
                            : ""
                        : "";
                      return `
                      <label class="matrix-choice ${isSelected ? "selected" : ""} ${checkedClass}">
                        <input
                          type="radio"
                          name="question-${question.id}-statement-${index}"
                          value="${value}"
                          data-matrix-index="${index}"
                          ${selected[index] === value ? "checked" : ""}
                          ${locked ? "disabled" : ""}
                        />
                        <span>${value}</span>
                      </label>
                    `;
                    },
                  )
                  .join("")}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  const selected = Array.isArray(current)
    ? current
    : Array(interaction.fields.length).fill("");
  return `
    <div class="field-list">
      ${interaction.fields
        .map(
          (field, index) => `
            <label class="select-field ${
              locked
                ? selected[index] === field.correct
                  ? "answer-correct"
                  : "answer-incorrect"
                : ""
            }">
              <span>${escapeHtml(field.label)}</span>
              <select data-field-index="${index}" aria-label="${escapeHtml(field.label)}" ${locked ? "disabled" : ""}>
                <option value="">Select an answer…</option>
                ${field.options
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option)}" ${selected[index] === option ? "selected" : ""}>${escapeHtml(option)}</option>`,
                  )
                  .join("")}
              </select>
              ${
                locked
                  ? `<small class="field-correct-answer">Correct answer: ${escapeHtml(field.correct)}</small>`
                  : ""
              }
            </label>
          `,
        )
        .join("")}
    </div>
  `;
}

function reviewAnswerControl(question) {
  const interaction = question.interaction;
  const userAnswer = state.answers[question.id];

  if (interaction.type === "single" || interaction.type === "multi") {
    const selected = Array.isArray(userAnswer) ? userAnswer : userAnswer ? [userAnswer] : [];
    const correct = new Set(
      Array.isArray(interaction.correct) ? interaction.correct : [interaction.correct],
    );
    const options = interaction.options.map((option, index) => {
      if (typeof option === "string") {
        return { id: option, label: option, marker: String.fromCharCode(65 + index) };
      }
      return { id: option.id, label: option.label, marker: String.fromCharCode(65 + index) };
    });
    return `
      <div class="choice-list review-choices" role="list">
        ${options
          .map((option) => {
            const isSelected = selected.includes(option.id);
            const isCorrect = correct.has(option.id);
            const cls = isCorrect
              ? "answer-correct"
              : isSelected
                ? "answer-incorrect"
                : "";
            return `
              <label class="choice ${isSelected ? "selected" : ""} ${cls} review-locked">
                <input type="${interaction.type === "single" ? "radio" : "checkbox"}"
                  name="review-${question.id}" value="${option.id}"
                  ${isSelected ? "checked" : ""} disabled />
                <span class="choice-letter">${option.marker}</span>
                <span class="choice-text">${escapeHtml(option.label)}</span>
                ${isCorrect ? '<span class="choice-tag correct-tag">✓ Correct</span>' : ""}
                ${isSelected && !isCorrect ? '<span class="choice-tag wrong-tag">✗ Your answer</span>' : ""}
              </label>
            `;
          })
          .join("")}
      </div>
    `;
  }

  if (interaction.type === "matrix") {
    const selected = Array.isArray(userAnswer) ? userAnswer : Array(interaction.statements.length).fill("");
    return `
      <div class="matrix review-choices" role="group">
        <div class="matrix-head" aria-hidden="true">
          <span>Statement</span><span>Yes</span><span>No</span>
        </div>
        ${interaction.statements
          .map(
            (statement, index) => `
              <div class="matrix-row">
                <p>${escapeHtml(statement)}</p>
                ${["Yes", "No"]
                  .map((value) => {
                    const isSelected = selected[index] === value;
                    const isCorrect = interaction.correct[index] === value;
                    const cls = isCorrect
                      ? "answer-correct"
                      : isSelected
                        ? "answer-incorrect"
                        : "";
                    return `
                      <label class="matrix-choice ${isSelected ? "selected" : ""} ${cls} review-locked">
                        <input type="radio" name="review-${question.id}-s-${index}"
                          value="${value}" ${isSelected ? "checked" : ""} disabled />
                        <span>${value}</span>
                      </label>
                    `;
                  })
                  .join("")}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  // fields type
  const selected = Array.isArray(userAnswer) ? userAnswer : Array(interaction.fields.length).fill("");
  return `
    <div class="field-list review-choices">
      ${interaction.fields
        .map(
          (field, index) => `
            <label class="select-field ${selected[index] === field.correct ? "answer-correct" : "answer-incorrect"}">
              <span>${escapeHtml(field.label)}</span>
              <select disabled>
                <option>${escapeHtml(selected[index] || "No answer")}</option>
              </select>
              <small class="field-correct-answer">Correct answer: ${escapeHtml(field.correct)}</small>
            </label>
          `,
        )
        .join("")}
    </div>
  `;
}

function questionTextMarkup(question) {
  const interaction = question.interaction;
  const promptParagraphs = question.prompt
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const context = interaction.context?.length
    ? `
      <div class="exhibit-text">
        <span class="exhibit-label">Exhibit details</span>
        <ul>${interaction.context.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      </div>
    `
    : "";
  const stem =
    interaction.stem && !question.prompt.includes(interaction.stem)
      ? `<h2>${escapeHtml(interaction.stem)}</h2>`
      : "";

  return `
    <div class="question-copy">
      ${promptParagraphs}
      ${context}
      ${stem}
    </div>
  `;
}

function renderQuiz({ scrollToTop = true } = {}) {
  document.title = `Question ${state.current + 1} · ${examConfig().code} Practice Lab`;
  const question = state.questions[state.current];
  const answered = state.questions.filter(isAnswered).length;
  const progress = ((state.current + 1) / state.questions.length) * 100;

  app.innerHTML = `
    <section class="quiz-shell">
      <aside class="quiz-sidebar" aria-label="Test progress">
        <div class="progress-label">
          <span>${answered} answered</span>
          <span>${state.questions.length} total</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="question-grid">
          ${state.questions
            .map(
              (item, index) => `
                <button
                  class="question-jump ${isAnswered(item) ? "answered" : ""} ${index === state.current ? "current" : ""} ${state.bookmarks.has(index) ? "bookmarked" : ""} ${state.flags.has(item.id) ? "flagged" : ""}"
                  type="button"
                  data-jump="${index}"
                  aria-label="Go to question ${index + 1}"
                >${index + 1}</button>
              `,
            )
            .join("")}
        </div>
        <div class="sidebar-key">
          <span><i class="key-dot done"></i> Answered</span>
          <span><i class="key-dot"></i> Not answered</span>
          <span><i class="key-dot bookmark-dot"></i> Bookmarked</span>
          <span><i class="key-dot flag-dot"></i> Flagged</span>
        </div>
      </aside>

      <article class="quiz-card">
        <div class="question-head">
          <div>
            <span class="question-number">Question ${state.current + 1} of ${state.questions.length}</span>
            <span class="question-type">Source #${question.id} · ${
              question.interaction.type === "matrix"
                ? "Yes / No"
                : question.interaction.type === "fields"
                  ? "Dropdowns"
                  : question.interaction.type === "multi"
                  ? "Multiple select"
                  : "Multiple choice"
            }</span>
          </div>
          <div class="question-actions">
            ${state.timerEnabled ? `<span class="timer-display" id="timer-display"></span>` : ""}
            <button class="flag-btn ${state.flags.has(question.id) ? "active" : ""}" id="flag-btn" type="button" aria-label="Flag question for review">
              ${state.flags.has(question.id) ? "🚩 Flagged" : "⚑ Flag"}
            </button>
            <button class="bookmark-btn ${state.bookmarks.has(state.current) ? "active" : ""}" id="bookmark-btn" type="button" aria-label="Bookmark question">
              ${state.bookmarks.has(state.current) ? "★ Bookmarked" : "☆ Bookmark"}
            </button>
            <button class="report-btn" id="report-question-btn" type="button" aria-label="Report a problem with this question">
              Report
            </button>
          </div>
        </div>

        ${questionTextMarkup(question)}

        ${
          question.sourceImages?.length
            ? `
              <div class="source-control-row">
                <button
                  class="source-toggle-btn"
                  id="source-toggle-btn"
                  type="button"
                  aria-expanded="false"
                  aria-controls="source-screenshot-panel"
                >▧ View original PDF question</button>
              </div>
              <section class="source-screenshot-panel" id="source-screenshot-panel" hidden>
                <div class="source-screenshot-head">
                  <strong>Original PDF question</strong>
                  <small>Answer section excluded</small>
                </div>
                <div class="source-screenshot-list">
                  ${question.sourceImages
                    .map(
                      (path, index) => `
                        <img
                          src="${escapeHtml(path)}"
                          alt="Original PDF screenshot for source question ${question.id}, part ${index + 1}"
                          loading="lazy"
                        />
                      `,
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }

        <div class="answer-block">
          <h3>Your answer</h3>
          ${answerControl(question)}
        </div>
        ${state.checked.has(question.id) ? `
          <div
            class="mid-exam-feedback ${isCorrect(question) ? "feedback-correct" : "feedback-incorrect"}"
            id="mid-exam-feedback"
            role="status"
            aria-live="polite"
          >
            <h3 class="feedback-title">${isCorrect(question) ? "Correct!" : "Incorrect"}</h3>
            <div class="review-meta">
              <span class="source-id">Source answer:</span>
              <span class="source-key">${escapeHtml(getCorrectAnswerDisplay(question))}</span>
            </div>
            ${question.explanation ? `
              <div class="review-explanation">
                <strong>Explanation</strong>
                <p>${escapeHtml(question.explanation)}</p>
              </div>
            ` : ""}
          </div>
        ` : ""}

        <nav class="quiz-nav" aria-label="Question navigation">
          <button class="nav-button previous" type="button" ${state.current === 0 ? "disabled" : ""}>← Previous</button>
          <div class="quiz-nav-center">
            ${!state.checked.has(question.id) ? `<button class="secondary-button" type="button" id="check-answer-btn" ${!isAnswered(question) ? "disabled" : ""}>Check Answer</button>` : ""}
            <button class="submit-link" type="button">Submit test</button>
          </div>
          <button class="nav-button next" type="button">
            ${state.current === state.questions.length - 1 ? "Review & submit" : "Next →"}
          </button>
        </nav>
      </article>
    </section>
  `;

  bindQuizEvents(question);
  if (state.timerEnabled) updateTimerDisplay();
  if (scrollToTop) window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearQuizKeyHandler() {
  if (!activeQuizKeyHandler) return;
  document.removeEventListener("keydown", activeQuizKeyHandler);
  activeQuizKeyHandler = null;
}

function navigateToQuestion(index) {
  if (index === state.current || index < 0 || index >= state.questions.length) return;
  recordQuestionTime();
  state.current = index;
  state.questionEnteredAt = Date.now();
  renderQuiz();
  if (state.timerEnabled) startQuestionTimer();
}

function bindQuizEvents(question) {
  const sourceToggle = app.querySelector("#source-toggle-btn");
  const sourcePanel = app.querySelector("#source-screenshot-panel");
  if (sourceToggle && sourcePanel) {
    sourceToggle.addEventListener("click", () => {
      const willOpen = sourcePanel.hidden;
      sourcePanel.hidden = !willOpen;
      sourceToggle.setAttribute("aria-expanded", String(willOpen));
      sourceToggle.textContent = willOpen
        ? "▣ Hide original PDF question"
        : "▧ View original PDF question";
    });
  }

  app.querySelectorAll(".choice input").forEach((input) => {
    input.addEventListener("change", () => {
      if (question.interaction.type === "single") {
        state.answers[question.id] = input.value;
      } else {
        const selected = [
          ...app.querySelectorAll(".choice input:checked"),
        ].map((item) => item.value);
        state.answers[question.id] = selected;
      }
      app.querySelectorAll(".choice").forEach((choice) => {
        choice.classList.toggle("selected", choice.querySelector("input").checked);
      });
      refreshProgressIndicators();
    });
  });

  app.querySelectorAll("[data-matrix-index]").forEach((input) => {
    input.addEventListener("change", () => {
      const answers = Array.isArray(state.answers[question.id])
        ? [...state.answers[question.id]]
        : Array(question.interaction.statements.length).fill("");
      answers[Number(input.dataset.matrixIndex)] = input.value;
      state.answers[question.id] = answers;
      const row = input.closest(".matrix-row");
      row.querySelectorAll(".matrix-choice").forEach((choice) => {
        choice.classList.toggle("selected", choice.querySelector("input").checked);
      });
      refreshProgressIndicators();
    });
  });

  app.querySelectorAll("[data-field-index]").forEach((select) => {
    select.addEventListener("change", () => {
      const answers = Array.isArray(state.answers[question.id])
        ? [...state.answers[question.id]]
        : Array(question.interaction.fields.length).fill("");
      answers[Number(select.dataset.fieldIndex)] = select.value;
      state.answers[question.id] = answers;
      refreshProgressIndicators();
    });
  });

  const flagBtn = app.querySelector("#flag-btn");
  if (flagBtn) {
    flagBtn.addEventListener("click", () => {
      toggleFlag(question.id);
      renderQuiz({ scrollToTop: false });
    });
  }

  const bookmarkBtn = app.querySelector("#bookmark-btn");
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener("click", () => {
      if (state.bookmarks.has(state.current)) {
        state.bookmarks.delete(state.current);
      } else {
        state.bookmarks.add(state.current);
      }
      renderQuiz();
    });
  }

  const reportBtn = app.querySelector("#report-question-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async () => {
      const message = window.prompt(
        "What is wrong with this question, answer, or explanation?",
        "",
      );
      if (!message || !message.trim()) return;
      reportBtn.disabled = true;
      reportBtn.textContent = "Reporting...";
      try {
        await saveQuestionReport(state.exam, question, message.trim());
        window.alert("Thanks. The report was sent to the admin queue.");
      } catch (err) {
        console.error("Could not save report.", err);
        window.alert("Could not save the report. Please try again later.");
      } finally {
        renderQuiz({ scrollToTop: false });
      }
    });
  }

  const checkBtn = app.querySelector("#check-answer-btn");
  if (checkBtn) {
    checkBtn.addEventListener("click", () => {
      state.checked.add(question.id);
      renderQuiz({ scrollToTop: false });
      window.requestAnimationFrame(() => {
        app.querySelector("#mid-exam-feedback")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    });
  }

  app.querySelector(".previous").addEventListener("click", () => {
    navigateToQuestion(state.current - 1);
  });

  app.querySelector(".next").addEventListener("click", () => {
    if (state.current < state.questions.length - 1) {
      navigateToQuestion(state.current + 1);
    } else {
      submitTest();
    }
  });

  app.querySelector(".submit-link").addEventListener("click", submitTest);
  app.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToQuestion(Number(button.dataset.jump));
    });
  });

  // Keyboard navigation
  clearQuizKeyHandler();
  activeQuizKeyHandler = (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      navigateToQuestion(state.current + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      navigateToQuestion(state.current - 1);
    }
  };
  document.addEventListener("keydown", activeQuizKeyHandler);
}

// ─── Submit & Results ─────────────────────────────────────────────────────────

async function submitTest({ skipUnansweredConfirm = false } = {}) {
  if (state.submitting) return;
  const unanswered = state.questions.filter((question) => !isAnswered(question));
  if (
    !skipUnansweredConfirm &&
    unanswered.length &&
    !window.confirm(
      `${unanswered.length} question${unanswered.length === 1 ? " is" : "s are"} unanswered. Submit anyway?`,
    )
  ) {
    return;
  }

  state.submitting = true;
  clearQuizKeyHandler();
  stopQuestionTimer();
  recordQuestionTime();

  state.results = state.questions.map((question) => {
    const userAnswer = getUserAnswer(question);
    const correct = isCorrect(question);
    const usePartial = state.mode === "real-deal" && state.realDealPartialCredit;
    return {
      question,
      userAnswer,
      correct,
      score: usePartial ? getPartialScore(question) : (correct ? 1 : 0),
      timeSpent: state.questionTimes[question.id] || 0,
    };
  });

  // Persist slow questions
  persistSlowQuestions();

  const payload = buildWrongAnswersExport();
  saveWrongAnswersLocal(payload);

  // Persist via API + update local wrongs immediately
  await saveSession(payload, state.mode, state.exam);
  // Reload wrongs from Firestore so smart/all sets are recalculated
  state.wrongs = await loadWrongQuestionIds(state.exam);

  state.filter = "all";
  state.submitting = false;
  renderResults();
}

function resultMessage(percent) {
  if (percent >= 85) return "Very sharp work.";
  if (percent >= 70) return "You're in striking distance.";
  if (percent >= 50) return "The shape is there—now tighten the weak spots.";
  return "Good reconnaissance. The review below is your map.";
}

function reviewCard(result) {
  const { question, correct, timeSpent, score } = result;
  const userAnswer = formatAnswerDisplay(question, state.answers[question.id]);
  const roundedTime = Math.round(timeSpent);
  const isSlow = roundedTime >= SLOW_THRESHOLD_SECONDS;
  const timeLabel = roundedTime >= 60
    ? `${Math.floor(roundedTime / 60)}m ${roundedTime % 60}s`
    : `${roundedTime}s`;
  const isPartialMatrix = state.mode === "real-deal" && state.realDealPartialCredit
    && (question.interaction.type === "matrix" || question.interaction.type === "fields")
    && score !== undefined && score > 0 && score < 1;
  const partialBadge = isPartialMatrix
    ? (function() {
        const total = question.interaction.type === "matrix"
          ? question.interaction.correct.length
          : question.interaction.fields.length;
        const got = Math.round(score * total);
        return '<span class="partial-score-badge">' + got + '/' + total + '</span>';
      })()
    : "";
  return `
    <article class="review-card ${correct ? "" : (isPartialMatrix ? "partial" : "incorrect")}" data-correct="${correct}">
      <button class="review-summary" type="button" aria-expanded="false">
        <span class="review-icon">${correct ? "✓" : (isPartialMatrix ? "◐" : "×")}</span>
        <span>
          <strong>Question ${question.id}</strong>
          <small>${correct ? "Correct" : (isPartialMatrix ? "Partial credit" : "Needs review")}${isSlow ? " · \ud83d\udc22 slow" : ""}</small>
        </span>
        ${partialBadge}
        <span class="review-time ${isSlow ? "review-time--slow" : ""}">\u23f1 ${timeLabel}</span>
        <span class="review-chevron">⌄</span>
      </button>
      <div class="review-details">
        ${questionTextMarkup(question)}
        <div class="review-choices-section">
          <h4>Answer choices</h4>
          ${reviewAnswerControl(question)}
        </div>
        <div class="answer-comparison">
          <div class="answer-chip">
            <label>Your answer</label>
            <span>${escapeHtml(userAnswer || "No answer")}</span>
          </div>
          <div class="answer-chip correct">
            <label>PDF answer key</label>
            <span>${escapeHtml(getCorrectAnswerDisplay(question))}</span>
          </div>
        </div>
        <div class="review-explanation">
          <h4>Explanation from the PDF</h4>
          ${question.explanation
            .split("\n")
            .filter(Boolean)
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("")}
        </div>
      </div>
    </article>
  `;
}

function renderResults() {
  document.title = `Your result · ${examConfig().code} Practice Lab`;
  const correct = state.results.filter((result) => result.correct).length;
  const total = state.results.length;
  const isRealDeal = state.mode === "real-deal";
  const usePartial = isRealDeal && state.realDealPartialCredit;

  // Compute score
  let totalScore, maxScore, percent;
  if (usePartial) {
    totalScore = state.results.reduce((sum, r) => sum + (r.score || 0), 0);
    maxScore = total;
    percent = Math.round((totalScore / maxScore) * 100);
  } else {
    totalScore = correct;
    maxScore = total;
    percent = Math.round((correct / total) * 100);
  }

  const incorrect = total - correct;
  const wrongAnswersJson = getWrongAnswersExportText();
  const visible =
    state.filter === "incorrect"
      ? state.results.filter((result) => !result.correct)
      : state.results;

  // Domain breakdown for Real Deal
  let domainBreakdownHtml = "";
  if (isRealDeal) {
    const domainStats = {};
    for (const r of state.results) {
      const domain = getQuestionDomain(r.question);
      if (!domainStats[domain]) domainStats[domain] = { score: 0, max: 0 };
      domainStats[domain].score += usePartial ? (r.score || 0) : (r.correct ? 1 : 0);
      domainStats[domain].max += 1;
    }
    const rows = REAL_DEAL_DOMAINS.map((d) => {
      const stats = domainStats[d.name] || { score: 0, max: 0 };
      const pct = stats.max > 0 ? Math.round((stats.score / stats.max) * 100) : 0;
      const scoreDisplay = usePartial
        ? stats.score.toFixed(1) + " / " + stats.max
        : Math.round(stats.score) + " / " + stats.max;
      return "<tr>"
        + "<td>" + escapeHtml(d.name) + "</td>"
        + "<td>" + scoreDisplay + "</td>"
        + "<td><div class=\"domain-bar\"><div class=\"domain-bar-fill\" style=\"width:" + pct + "%\"></div></div></td>"
        + "<td>" + pct + "%</td>"
        + "</tr>";
    }).join("");

    domainBreakdownHtml = `
      <section class="domain-breakdown">
        <h2>Domain breakdown</h2>
        <p>Score distribution across the four official SC-900 exam domains.</p>
        <table>
          <thead><tr><th>Domain</th><th>Score</th><th>Progress</th><th>%</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }

  // Score ring angle for the animated arc
  const deg = Math.round((percent / 100) * 360);
  const scoreLabel = usePartial ? totalScore.toFixed(1) + " / " + maxScore + " pts" : percent + "%";

  app.innerHTML = `
    <section class="results">
      <div class="result-hero">
        <div class="score-ring" style="--score-deg:${deg}deg">
          <strong>${percent}%</strong>
          <small>${usePartial ? totalScore.toFixed(1) + " pts" : "final grade"}</small>
        </div>
        <div class="result-copy">
          <p class="eyebrow">${isRealDeal ? "Real Deal Simulation complete" : "Test complete"}</p>
          <h1>${resultMessage(percent)}</h1>
          <p>Your result is graded against the answer key in the supplied ${examConfig().code} PDF.${usePartial ? " Partial credit is enabled for Yes/No questions." : ""}</p>
          <div class="result-stats">
            ${usePartial ? `
              <div><strong>${totalScore.toFixed(1)}</strong><span>Points</span></div>
              <div><strong>${maxScore}</strong><span>Max points</span></div>
              <div><strong>${total}</strong><span>Questions</span></div>
            ` : `
              <div><strong>${correct}</strong><span>Correct</span></div>
              <div><strong>${incorrect}</strong><span>Incorrect</span></div>
              <div><strong>${total}</strong><span>Questions</span></div>
            `}
          </div>
        </div>
        <div class="result-actions">
          <button class="secondary-button" type="button" id="retry">Try another test</button>
          <button class="ghost-button" type="button" id="home">Change mode</button>
        </div>
      </div>

      ${domainBreakdownHtml}

      <section class="export-panel">
        <div class="export-copy">
          <p class="eyebrow">Wrong answers JSON</p>
          <h2>Study only what you missed</h2>
          <p>
            This export saves every incorrect question with your answer, the PDF answer key,
            and the explanation text. You can copy it into notes or paste it straight into AI.
            ${incorrect === 0 ? "<br /><strong>🎉 Perfect score — nothing to export!</strong>" : ""}
          </p>
        </div>
        <div class="export-actions">
          <button class="secondary-button" type="button" id="copy-wrong-json" ${incorrect === 0 ? "disabled" : ""}>Copy JSON</button>
          <button class="ghost-button export-download" type="button" id="download-wrong-json" ${incorrect === 0 ? "disabled" : ""}>Download JSON</button>
        </div>
        <label class="export-box">
          <span>Latest wrong answers export</span>
          <textarea id="wrong-json-output" readonly>${escapeHtml(wrongAnswersJson)}</textarea>
        </label>
      </section>

      <section class="review-section">
        <div class="review-toolbar">
          <div>
            <h2>Answer review</h2>
            <p>Open any item to see the exact source answer and explanation.</p>
          </div>
          <div class="filter-pills">
            <button class="filter-pill ${state.filter === "all" ? "active" : ""}" type="button" data-filter="all">All ${total}</button>
            <button class="filter-pill ${state.filter === "incorrect" ? "active" : ""}" type="button" data-filter="incorrect">Incorrect ${incorrect}</button>
          </div>
        </div>
        <div class="review-list">
          ${
            visible.length
              ? visible.map(reviewCard).join("")
              : `<div class="empty-review">Nothing to review here. A clean sweep! 🎉</div>`
          }
        </div>
      </section>
    </section>
  `;

  app.querySelector("#retry").addEventListener("click", startTest);
  app.querySelector("#home").addEventListener("click", () => {
    // Reload wrongs from API so both modes are up to date
    loadWrongQuestionIds(state.exam).then((wrongs) => {
      state.wrongs = wrongs;
      renderHome();
    });
  });
  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderResults();
    });
  });
  app.querySelectorAll(".review-summary").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".review-card");
      const isOpen = card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  });
  app.querySelector("#copy-wrong-json").addEventListener("click", async () => {
    if (incorrect === 0) return;
    const textarea = app.querySelector("#wrong-json-output");
    const text = textarea.value;
    try {
      await navigator.clipboard.writeText(text);
      const button = app.querySelector("#copy-wrong-json");
      button.textContent = "Copied ✓";
      window.setTimeout(() => {
        button.textContent = "Copy JSON";
      }, 1800);
    } catch (error) {
      textarea.focus();
      textarea.select();
    }
  });
  app.querySelector("#download-wrong-json").addEventListener("click", () => {
    if (incorrect === 0) return;
    const blob = new Blob([wrongAnswersJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${examConfig().code.toLowerCase()}-wrong-answers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Admin dashboard ─────────────────────────────────────────────────────────

function adminDate(value) {
  return value ? value.toLocaleString() : "Never";
}

function rawQuestionFor(exam, id) {
  return (state.rawBanks[exam] || []).find((question) => String(question.id) === String(id));
}

function editedQuestionFor(exam, id) {
  const edit = state.questionEdits[exam]?.[String(id)];
  return edit?.question || rawQuestionFor(exam, id);
}

async function renderAdminDashboard(options = {}) {
  if (!isCurrentUserAdmin()) {
    renderHome();
    return;
  }

  clearQuizKeyHandler();
  stopQuestionTimer();
  state.view = "admin";

  const selectedExam = options.exam || state.exam;
  const users = await listUserProfiles();
  const reports = await listQuestionReports();
  const rawQuestions = state.rawBanks[selectedExam] || [];
  const selectedQuestionId = options.questionId || rawQuestions[0]?.id;
  const selectedQuestion = selectedQuestionId
    ? editedQuestionFor(selectedExam, selectedQuestionId)
    : null;
  const selectedEdit = selectedQuestionId
    ? state.questionEdits[selectedExam]?.[String(selectedQuestionId)]
    : null;
  const questionJson = selectedQuestion
    ? JSON.stringify(selectedQuestion, null, 2)
    : "";
  const openReports = reports.filter((report) => report.status !== "fixed");

  document.title = "Admin · Practice Lab";
  app.innerHTML = `
    <section class="admin-shell">
      <div class="admin-hero">
        <div>
          <p class="eyebrow">Admin dashboard</p>
          <h1>Users, reports, and question fixes</h1>
          <p>Review submitted reports, hide broken questions, and save edited question JSON as Firestore overrides.</p>
        </div>
        <div class="admin-actions">
          <button class="secondary-button" type="button" id="admin-refresh">Refresh</button>
          <button class="ghost-button" type="button" id="admin-home">Back to practice</button>
        </div>
      </div>

      <section class="admin-section">
        <div class="admin-section-head">
          <div>
            <h2>Users</h2>
            <p>${users.length} profile${users.length === 1 ? "" : "s"} seen by the app.</p>
          </div>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Last test</th>
                <th>Last login</th>
                <th>UID</th>
              </tr>
            </thead>
            <tbody>
              ${users.map((user) => `
                <tr>
                  <td>${escapeHtml(user.displayName)}</td>
                  <td>${escapeHtml(user.email)}</td>
                  <td>${user.isAdmin ? "Admin" : "User"}</td>
                  <td>${user.totalSessions}</td>
                  <td>${escapeHtml(adminDate(user.lastSessionAt))}</td>
                  <td>${escapeHtml(adminDate(user.lastLoginAt))}</td>
                  <td><code>${escapeHtml(user.uid)}</code></td>
                </tr>
              `).join("") || '<tr><td colspan="7">No user profiles found yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="admin-grid">
        <div class="admin-section">
          <div class="admin-section-head">
            <div>
              <h2>Reports</h2>
              <p>${openReports.length} open report${openReports.length === 1 ? "" : "s"}.</p>
            </div>
          </div>
          <div class="admin-report-list">
            ${reports.map((report) => `
              <article class="admin-report ${report.status === "fixed" ? "admin-report-fixed" : ""}">
                <div>
                  <strong>${escapeHtml(EXAMS[report.exam]?.code || report.exam)} #${escapeHtml(report.questionId)}</strong>
                  <span>${escapeHtml(report.userName)} · ${escapeHtml(adminDate(report.createdAt))}</span>
                </div>
                <p>${escapeHtml(report.message)}</p>
                <small>${escapeHtml((report.prompt || "").slice(0, 140))}${report.prompt?.length > 140 ? "..." : ""}</small>
                <div class="admin-report-actions">
                  <button type="button" data-report-edit="${escapeHtml(report.id)}" data-report-exam="${escapeHtml(report.exam)}" data-report-question="${escapeHtml(report.questionId)}">Edit question</button>
                  <button type="button" data-report-status="${escapeHtml(report.id)}" data-status="${report.status === "fixed" ? "open" : "fixed"}">
                    ${report.status === "fixed" ? "Reopen" : "Mark fixed"}
                  </button>
                </div>
              </article>
            `).join("") || '<p class="admin-empty">No reports yet.</p>'}
          </div>
        </div>

        <div class="admin-section">
          <div class="admin-section-head">
            <div>
              <h2>Question editor</h2>
              <p>Changes are saved as overrides. Hidden questions are removed from practice runs.</p>
            </div>
          </div>

          <div class="admin-editor-controls">
            <label>
              <span>Exam</span>
              <select id="admin-exam-select">
                ${Object.entries(EXAMS).map(([key, exam]) => `
                  <option value="${key}" ${key === selectedExam ? "selected" : ""}>${exam.code}</option>
                `).join("")}
              </select>
            </label>
            <label>
              <span>Question</span>
              <select id="admin-question-select">
                ${rawQuestions.map((question) => {
                  const edit = state.questionEdits[selectedExam]?.[String(question.id)];
                  const suffix = edit?.deleted ? " hidden" : edit?.question ? " edited" : "";
                  return `<option value="${escapeHtml(question.id)}" ${String(question.id) === String(selectedQuestionId) ? "selected" : ""}>#${escapeHtml(question.id)}${suffix}</option>`;
                }).join("")}
              </select>
            </label>
          </div>

          ${selectedQuestion ? `
            <div class="admin-editor-status">
              <span>${selectedEdit?.question ? "Edited override saved" : "Using source JSON"}</span>
              <span>${selectedEdit?.deleted ? "Hidden from tests" : "Visible in tests"}</span>
            </div>
            <textarea id="admin-question-json" class="admin-json-editor" spellcheck="false">${escapeHtml(questionJson)}</textarea>
            <div class="admin-editor-actions">
              <button class="primary-button" type="button" id="admin-save-question">Save edit</button>
              <button class="home-action-btn home-action-btn--danger" type="button" id="admin-hide-question">Remove from test</button>
              <button class="home-action-btn" type="button" id="admin-restore-question">Restore question</button>
            </div>
            <p class="admin-editor-note">After saving, users will see the edited version the next time the question bank loads.</p>
          ` : '<p class="admin-empty">No questions found for this exam.</p>'}
        </div>
      </section>
    </section>
  `;

  document.getElementById("admin-home")?.addEventListener("click", () => renderHome());
  document.getElementById("admin-refresh")?.addEventListener("click", async () => {
    await reloadEditedBanks();
    renderAdminDashboard({ exam: selectedExam, questionId: selectedQuestionId });
  });

  document.getElementById("admin-exam-select")?.addEventListener("change", (event) => {
    renderAdminDashboard({ exam: event.target.value });
  });

  document.getElementById("admin-question-select")?.addEventListener("change", (event) => {
    renderAdminDashboard({ exam: selectedExam, questionId: event.target.value });
  });

  document.getElementById("admin-save-question")?.addEventListener("click", async () => {
    const textarea = document.getElementById("admin-question-json");
    try {
      const parsed = JSON.parse(textarea.value);
      if (!parsed.id) throw new Error("Question JSON must include an id.");
      await saveQuestionEdit(selectedExam, parsed);
      await reloadEditedBanks();
      window.alert("Question edit saved.");
      renderAdminDashboard({ exam: selectedExam, questionId: parsed.id });
    } catch (err) {
      window.alert(`Could not save question: ${err.message}`);
    }
  });

  document.getElementById("admin-hide-question")?.addEventListener("click", async () => {
    if (!window.confirm(`Remove question #${selectedQuestionId} from ${EXAMS[selectedExam].code} practice runs?`)) return;
    await hideQuestion(selectedExam, selectedQuestionId);
    await reloadEditedBanks();
    renderAdminDashboard({ exam: selectedExam, questionId: selectedQuestionId });
  });

  document.getElementById("admin-restore-question")?.addEventListener("click", async () => {
    await restoreQuestion(selectedExam, selectedQuestionId);
    await reloadEditedBanks();
    renderAdminDashboard({ exam: selectedExam, questionId: selectedQuestionId });
  });

  app.querySelectorAll("[data-report-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      renderAdminDashboard({
        exam: button.dataset.reportExam,
        questionId: button.dataset.reportQuestion,
      });
    });
  });

  app.querySelectorAll("[data-report-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      await updateQuestionReportStatus(button.dataset.reportStatus, button.dataset.status);
      renderAdminDashboard({ exam: selectedExam, questionId: selectedQuestionId });
    });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Memorise mode ────────────────────────────────────────────────────────────

function renderMemoriseCard() {
  clearQuizKeyHandler();
  stopQuestionTimer();
  const mem = state.memorise;
  if (mem.queue.length === 0) {
    if (mem.currentBatchIndex < mem.totalBatches - 1) {
      mem.currentBatchIndex++;
      const start = mem.currentBatchIndex * mem.batchSize;
      mem.queue = mem.allQuestions.slice(start, start + mem.batchSize);
    } else {
      renderMemoriseComplete();
      return;
    }
  }

  const question = mem.queue[0];
  const mastered = mem.mastered.size;
  const total = mem.totalInSession;
  const remaining = mem.queue.length;
  const progressPercent = Math.round((mastered / total) * 100);
  const attemptCount = mem.attempts[question.id] || 0;
  const config = examConfig();
  document.title = `Memorise · ${config.code} Practice Lab`;

  app.innerHTML = `
    <section class="memorise-shell">
      <div class="memorise-topbar">
        <button class="memorise-quit" type="button" id="memorise-quit">← Quit</button>
        <div class="memorise-stats">
          <span class="memorise-mastered">🧠 ${mastered} mastered</span>
          <span class="memorise-remaining">📋 Batch ${mem.currentBatchIndex + 1}: ${remaining} remaining</span>
        </div>
      </div>
      <div class="memorise-progress-track">
        <div class="memorise-progress-fill" style="width:${progressPercent}%"></div>
      </div>

      <article class="memorise-card">
        <div class="question-head">
          <div>
            <span class="question-number">Batch ${mem.currentBatchIndex + 1} of ${mem.totalBatches} • Mastered ${mastered} of ${total}</span>
            <span class="question-type">Source #${question.id} · ${
              question.interaction.type === "matrix"
                ? "Yes / No"
                : question.interaction.type === "fields"
                  ? "Dropdowns"
                  : question.interaction.type === "multi"
                  ? "Multiple select"
                : "Multiple choice"
            }</span>
          </div>
          <div class="question-actions">
            ${attemptCount > 0 ? `<span class="memorise-retry-badge">Retry #${attemptCount}</span>` : ""}
            <button class="report-btn" id="report-question-btn" type="button" aria-label="Report a problem with this question">Report</button>
          </div>
        </div>

        ${questionTextMarkup(question)}

        ${
          question.sourceImages?.length
            ? `
              <div class="source-control-row">
                <button
                  class="source-toggle-btn"
                  id="source-toggle-btn"
                  type="button"
                  aria-expanded="false"
                  aria-controls="source-screenshot-panel"
                >▧ View original PDF question</button>
              </div>
              <section class="source-screenshot-panel" id="source-screenshot-panel" hidden>
                <div class="source-screenshot-head">
                  <strong>Original PDF question</strong>
                  <small>Answer section excluded</small>
                </div>
                <div class="source-screenshot-list">
                  ${question.sourceImages
                    .map(
                      (path, index) => `
                        <img
                          src="${escapeHtml(path)}"
                          alt="Original PDF screenshot for source question ${question.id}, part ${index + 1}"
                          loading="lazy"
                        />
                      `,
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }

        <div class="answer-block">
          <h3>Your answer</h3>
          ${mem.revealed ? reviewAnswerControl(question) : answerControl(question)}
        </div>

        ${mem.revealed ? `
          <div
            class="memorise-reveal ${isCorrect(question) ? "feedback-correct" : "feedback-incorrect"}"
            id="memorise-reveal"
          >
            <h3 class="feedback-title">${isCorrect(question) ? "✓ Correct — mastered!" : "✗ Incorrect — this will come back"}</h3>
            <div class="review-meta">
              <span class="source-id">Correct answer:</span>
              <span class="source-key">${escapeHtml(getCorrectAnswerDisplay(question))}</span>
            </div>
            ${question.explanation ? `
              <div class="review-explanation">
                <strong>Explanation</strong>
                ${explanationParagraphs(question.explanation)}
              </div>
            ` : ""}
          </div>
          <nav class="quiz-nav memorise-nav">
            <button class="primary-button" type="button" id="memorise-next">
              ${mem.queue.length <= 1 && isCorrect(question) 
                 ? (mem.currentBatchIndex < mem.totalBatches - 1 ? "Next batch →" : "Finish 🎉") 
                 : "Next card →"}
            </button>
          </nav>
        ` : `
          <nav class="quiz-nav memorise-nav">
            <button class="primary-button" type="button" id="memorise-confirm" ${!isAnswered(question) ? "disabled" : ""}>
              Confirm answer
            </button>
          </nav>
        `}
      </article>
    </section>
  `;

  // Bind events
  document.getElementById("memorise-quit")?.addEventListener("click", () => {
    if (window.confirm("Quit this memorise session? Progress in this session will be lost.")) {
      renderHome();
    }
  });

  const sourceToggle = app.querySelector("#source-toggle-btn");
  const sourcePanel = app.querySelector("#source-screenshot-panel");
  if (sourceToggle && sourcePanel) {
    sourceToggle.addEventListener("click", () => {
      const willOpen = sourcePanel.hidden;
      sourcePanel.hidden = !willOpen;
      sourceToggle.setAttribute("aria-expanded", String(willOpen));
      sourceToggle.textContent = willOpen
        ? "▣ Hide original PDF question"
        : "▧ View original PDF question";
    });
  }

  const reportBtn = app.querySelector("#report-question-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async () => {
      const message = window.prompt(
        "What is wrong with this question, answer, or explanation?",
        "",
      );
      if (!message || !message.trim()) return;
      reportBtn.disabled = true;
      reportBtn.textContent = "Reporting...";
      try {
        await saveQuestionReport(state.exam, question, message.trim());
        window.alert("Thanks. The report was sent to the admin queue.");
      } catch (err) {
        console.error("Could not save report.", err);
        window.alert("Could not save the report. Please try again later.");
      } finally {
        renderMemoriseCard();
      }
    });
  }


  if (!mem.revealed) {
    bindMemoriseInputEvents(question);
    document.getElementById("memorise-confirm")?.addEventListener("click", () => {
      confirmMemoriseAnswer();
    });
  } else {
    document.getElementById("memorise-next")?.addEventListener("click", () => {
      advanceMemoriseQueue();
    });
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindMemoriseInputEvents(question) {
  // Single / Multi choice
  app.querySelectorAll(".choice input").forEach((input) => {
    input.addEventListener("change", () => {
      if (question.interaction.type === "single") {
        state.answers[question.id] = input.value;
      } else {
        const selected = [...app.querySelectorAll(".choice input:checked")].map((item) => item.value);
        state.answers[question.id] = selected;
      }
      app.querySelectorAll(".choice").forEach((choice) => {
        choice.classList.toggle("selected", choice.querySelector("input").checked);
      });
      const confirmBtn = document.getElementById("memorise-confirm");
      if (confirmBtn) confirmBtn.disabled = !isAnswered(question);
    });
  });

  // Matrix
  app.querySelectorAll("[data-matrix-index]").forEach((input) => {
    input.addEventListener("change", () => {
      const answers = Array.isArray(state.answers[question.id])
        ? [...state.answers[question.id]]
        : Array(question.interaction.statements.length).fill("");
      answers[Number(input.dataset.matrixIndex)] = input.value;
      state.answers[question.id] = answers;
      const row = input.closest(".matrix-row");
      row.querySelectorAll(".matrix-choice").forEach((choice) => {
        choice.classList.toggle("selected", choice.querySelector("input").checked);
      });
      const confirmBtn = document.getElementById("memorise-confirm");
      if (confirmBtn) confirmBtn.disabled = !isAnswered(question);
    });
  });

  // Fields / dropdowns
  app.querySelectorAll("[data-field-index]").forEach((select) => {
    select.addEventListener("change", () => {
      const answers = Array.isArray(state.answers[question.id])
        ? [...state.answers[question.id]]
        : Array(question.interaction.fields.length).fill("");
      answers[Number(select.dataset.fieldIndex)] = select.value;
      state.answers[question.id] = answers;
      const confirmBtn = document.getElementById("memorise-confirm");
      if (confirmBtn) confirmBtn.disabled = !isAnswered(question);
    });
  });
}

function confirmMemoriseAnswer() {
  const mem = state.memorise;
  const question = mem.queue[0];
  mem.attempts[question.id] = (mem.attempts[question.id] || 0) + 1;
  mem.revealed = true;
  renderMemoriseCard();
  // Scroll to feedback
  window.requestAnimationFrame(() => {
    document.getElementById("memorise-reveal")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function advanceMemoriseQueue() {
  const mem = state.memorise;
  const question = mem.queue.shift();
  const correct = isCorrect(question);

  if (correct) {
    mem.mastered.add(question.id);
  } else {
    // Re-insert the question 5–10 positions ahead (randomised)
    // Re-shuffle its options so it looks fresh
    const reinsertAt = Math.min(
      mem.queue.length,
      5 + Math.floor(Math.random() * 6),
    );
    const reshuffled = shuffleQuestionOptions(question);
    mem.queue.splice(reinsertAt, 0, reshuffled);
    // Clear the previous answer so the user starts fresh
    delete state.answers[question.id];
  }

  mem.revealed = false;
  renderMemoriseCard();
}

function renderMemoriseComplete() {
  const mem = state.memorise;
  const config = examConfig();
  document.title = `Memorise complete · ${config.code} Practice Lab`;

  // Build retry stats sorted by most retries
  const retryEntries = Object.entries(mem.attempts)
    .map(([id, count]) => ({ id: Number(id) || id, count }))
    .sort((a, b) => b.count - a.count);
  const totalAttempts = retryEntries.reduce((sum, e) => sum + e.count, 0);
  const hardest = retryEntries.filter((e) => e.count > 1);

  app.innerHTML = `
    <section class="memorise-complete">
      <div class="memorise-complete-hero">
        <div class="memorise-complete-icon">🧠</div>
        <p class="eyebrow">${config.code} memorise session</p>
        <h1>All ${mem.totalInSession} questions mastered!</h1>
        <p class="hero-copy">
          You drilled every question until you got it right.
          ${hardest.length > 0
            ? hardest.length + " question" + (hardest.length === 1 ? "" : "s") + " needed extra attempts."
            : "Perfect recall on every single question — outstanding!"
          }
        </p>
        <div class="result-stats">
          <div><strong>${mem.totalInSession}</strong><span>Mastered</span></div>
          <div><strong>${totalAttempts}</strong><span>Total attempts</span></div>
          <div><strong>${hardest.length}</strong><span>Needed retries</span></div>
        </div>
        <div class="result-actions">
          <button class="secondary-button" type="button" id="memorise-restart">Run again</button>
          <button class="ghost-button" type="button" id="memorise-home">Back to menu</button>
        </div>
      </div>

      ${hardest.length > 0 ? `
        <section class="review-section">
          <div class="review-toolbar">
            <div>
              <h2>Questions that needed extra work</h2>
              <p>These took more than one attempt. Consider flagging them for future review.</p>
            </div>
          </div>
          <div class="review-list">
            ${hardest.map((entry) => {
              const q = state.bank.find((bq) => bq.id === entry.id);
              if (!q) return "";
              const text = q.prompt || "";
              const preview = escapeHtml(text.substring(0, 100)) + (text.length > 100 ? "…" : "");
              return `
                <article class="review-card incorrect" data-retry-id="${q.id}">
                  <button class="review-summary" type="button" aria-expanded="false">
                    <span class="review-icon">×</span>
                    <span>
                      <strong>Question #${q.id}</strong>
                      <small>${entry.count} attempt${entry.count === 1 ? "" : "s"} · ${preview}</small>
                    </span>
                    <span class="memorise-retry-badge">${entry.count}×</span>
                    <span class="review-chevron">⌄</span>
                  </button>
                  <div class="review-details">
                    ${questionTextMarkup(q)}
                    <div class="review-meta">
                      <span class="source-id">Correct answer:</span>
                      <span class="source-key">${escapeHtml(getCorrectAnswerDisplay(q))}</span>
                    </div>
                    ${q.explanation ? `
                      <div class="review-explanation">
                        <strong>Explanation</strong>
                        ${explanationParagraphs(q.explanation)}
                      </div>
                    ` : ""}
                    <div class="flagged-actions">
                      <button class="home-action-btn" type="button" data-memorise-flag="${q.id}">
                        ${state.flags.has(q.id) ? "🚩 Flagged" : "⚑ Flag for review"}
                      </button>
                    </div>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        </section>
      ` : ""}
    </section>
  `;

  // Bind events
  document.getElementById("memorise-restart")?.addEventListener("click", startTest);
  document.getElementById("memorise-home")?.addEventListener("click", () => {
    renderHome();
  });

  app.querySelectorAll(".review-summary").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".review-card");
      const isOpen = card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  });

  app.querySelectorAll("[data-memorise-flag]").forEach((button) => {
    button.addEventListener("click", () => {
      const qid = Number(button.dataset.memoriseFlag) || button.dataset.memoriseFlag;
      toggleFlag(qid);
      button.textContent = state.flags.has(qid) ? "🚩 Flagged" : "⚑ Flag for review";
    });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

Promise.all(
  Object.entries(EXAMS).map(async ([key, exam]) => {
    const response = await fetch(exam.file, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${exam.code} question bank returned ${response.status}`);
    }
    return [key, await response.json()];
  }),
)
  .then((banks) => {
    state.rawBanks = Object.fromEntries(banks);
    state.banks = applyQuestionEdits(state.rawBanks, {});
    refreshBank();

    initAuth(async (user) => {
      updateHeaderUser(user);
      await reloadEditedBanks();
      // Set initial custom count to half
      state.customCount = halfCount();
      // Load historical wrong question IDs from API
      state.wrongs = await loadWrongQuestionIds(state.exam);
      state.flags = loadFlags();
      state.slowQuestions = loadSlowQuestions();
      renderHome();
    });
  })
  .catch((error) => {
    app.innerHTML = `
      <section class="error-card">
        <h1>The question bank could not load.</h1>
        <p>
          Start the site through a local web server instead of opening the HTML file directly.
          The included README has the one-line command.
        </p>
        <small>${escapeHtml(error.message)}</small>
      </section>
    `;
  });
