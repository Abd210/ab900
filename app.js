/**
 * app.js — AB-900 Practice Lab
 * Exam simulator with auth + wrong-answer persistence via Vercel API routes.
 * Questions are loaded from public/questions.json (untouched).
 */

const app = document.querySelector("#app");

const state = {
  bank: [],
  mode: "half",           // "all" | "half" | "wrongs"
  wrongIds: new Set(),    // historical wrong IDs loaded from Firestore
  questions: [],
  current: 0,
  answers: {},
  results: [],
  filter: "all",
};

const WRONG_ANSWERS_STORAGE_KEY = "ab900-last-wrong-answers";

// ─── Utilities ───────────────────────────────────────────────────────────────

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

function getUserAnswer(question) {
  const answer = state.answers[question.id];
  if (Array.isArray(answer)) return answer.map((value) => value || "").join("; ");
  return answer || "";
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
    return Array.isArray(answer) ? answer : [];
  }
  return answer || "";
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
        answerKey: question.answer,
        explanation: question.explanation,
      };
    });

  return {
    exportedAt: new Date().toISOString(),
    mode: state.mode,
    totalQuestions: state.results.length,
    correctAnswers: state.results.filter((result) => result.correct).length,
    wrongAnswersCount: wrongAnswers.length,
    wrongAnswers,
  };
}

function saveWrongAnswersLocal(payload) {
  try {
    localStorage.setItem(WRONG_ANSWERS_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not save wrong answers locally.", error);
  }
}

function getWrongAnswersExportText() {
  const payload = buildWrongAnswersExport();
  return JSON.stringify(payload, null, 2);
}

// ─── Header ───────────────────────────────────────────────────────────────────

function updateHeaderUser(user) {
  const headerMeta = document.querySelector(".header-meta");
  if (!headerMeta) return;
  const displayName = user.displayName || user.email?.split("@")[0] || "Student";
  headerMeta.innerHTML = `
    <span class="status-dot"></span>
    <span class="header-username">${escapeHtml(displayName)}</span>
    <button class="header-logout" type="button" id="header-logout-btn" title="Sign out">Sign out</button>
  `;
  const logoutBtn = document.getElementById("header-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (window.confirm("Sign out of AB-900 Practice Lab?")) {
        signOutUser();
      }
    });
  }
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function renderHome() {
  document.title = "AB-900 Practice Lab";
  const wrongCount = state.wrongIds.size;
  const hasWrongs = wrongCount > 0;

  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">AB-900 exam simulator</p>
        <h1>Know the material.<br /><em>Keep your nerve.</em></h1>
        <p class="hero-copy">
          Practice all 89 questions extracted from your source PDF, or take a fresh
          random half. Every question is rebuilt as a real interactive exam item:
          radios, checkboxes, dropdowns, and Yes/No tables.
        </p>
        <div class="hero-points" aria-label="Features">
          <span>Fully text-based</span>
          <span>Instant grading</span>
          <span>Detailed answer review</span>
          <span>Wrong-answer history</span>
        </div>
      </div>

      <aside class="mode-panel">
        <h2>Choose your run</h2>
        <p>You can switch modes before starting.</p>
        <div class="mode-grid">
          <button class="mode-card" type="button" data-mode="all">
            <span class="mode-icon">89</span>
            <span>
              <strong>Full exam</strong>
              <small>Every question, in the original order.</small>
            </span>
            <span class="mode-count">89 Q</span>
          </button>
          <button class="mode-card selected" type="button" data-mode="half">
            <span class="mode-icon">½</span>
            <span>
              <strong>Random half</strong>
              <small>A new shuffled set each time.</small>
            </span>
            <span class="mode-count">45 Q</span>
          </button>
          <button
            class="mode-card ${hasWrongs ? "" : "mode-card--disabled"}"
            type="button"
            data-mode="wrongs"
            ${hasWrongs ? "" : "disabled"}
            title="${hasWrongs ? "" : "Complete at least one test to unlock"}"
          >
            <span class="mode-icon mode-icon--wrongs">✗</span>
            <span>
              <strong>Retry wrongs</strong>
              <small>${
                hasWrongs
                  ? `${wrongCount} question${wrongCount === 1 ? "" : "s"} from your history.`
                  : "Complete a test to unlock this mode."
              }</small>
            </span>
            <span class="mode-count ${hasWrongs ? "mode-count--bad" : ""}">${hasWrongs ? `${wrongCount} Q` : "–"}</span>
          </button>
        </div>
        <button class="primary-button" type="button" id="start-test">Start practice test →</button>
        <div class="source-note">
          <span>✦</span>
          <p>The simulator follows the answer key printed in the supplied PDF, including every hotspot selection.</p>
        </div>
      </aside>
    </section>
  `;

  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.mode = button.dataset.mode;
      app
        .querySelectorAll("[data-mode]")
        .forEach((card) => card.classList.toggle("selected", card === button));
    });
  });
  app.querySelector("#start-test").addEventListener("click", startTest);
}

// ─── Quiz ─────────────────────────────────────────────────────────────────────

function startTest() {
  if (state.mode === "all") {
    state.questions = [...state.bank];
  } else if (state.mode === "half") {
    state.questions = shuffle(state.bank).slice(0, 45);
  } else {
    // wrongs mode — load only historically wrong questions
    const wrongBank = state.bank.filter((q) => state.wrongIds.has(q.id));
    state.questions = shuffle(wrongBank);
  }
  state.current = 0;
  state.answers = {};
  state.results = [];
  renderQuiz();
}

function answerControl(question) {
  const interaction = question.interaction;
  const current = state.answers[question.id];
  if (interaction.type === "single" || interaction.type === "multi") {
    const selected = Array.isArray(current) ? current : current ? [current] : [];
    const options = interaction.options.map((option, index) => {
      if (typeof option === "string") {
        return {
          id: option,
          label: option,
          marker: String.fromCharCode(65 + index),
        };
      }
      return { id: option.id, label: option.label, marker: option.id };
    });
    return `
      <div class="choice-list" role="${question.kind === "single" ? "radiogroup" : "group"}">
        ${options
          .map(
            (option) => `
              <label class="choice ${selected.includes(option.id) ? "selected" : ""}">
                <input
                  type="${interaction.type === "single" ? "radio" : "checkbox"}"
                  name="question-${question.id}"
                  value="${option.id}"
                  ${selected.includes(option.id) ? "checked" : ""}
                />
                <span class="choice-letter">${option.marker}</span>
                <span class="choice-text">${escapeHtml(option.label)}</span>
              </label>
            `,
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
                    (value) => `
                      <label class="matrix-choice ${selected[index] === value ? "selected" : ""}">
                        <input
                          type="radio"
                          name="question-${question.id}-statement-${index}"
                          value="${value}"
                          data-matrix-index="${index}"
                          ${selected[index] === value ? "checked" : ""}
                        />
                        <span>${value}</span>
                      </label>
                    `,
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
            <label class="select-field">
              <span>${escapeHtml(field.label)}</span>
              <select data-field-index="${index}" aria-label="${escapeHtml(field.label)}">
                <option value="">Select an answer…</option>
                ${field.options
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option)}" ${selected[index] === option ? "selected" : ""}>${escapeHtml(option)}</option>`,
                  )
                  .join("")}
              </select>
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

function renderQuiz() {
  document.title = `Question ${state.current + 1} · AB-900 Practice Lab`;
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
                  class="question-jump ${isAnswered(item) ? "answered" : ""} ${index === state.current ? "current" : ""}"
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
        </div>
      </aside>

      <article class="quiz-card">
        <div class="question-head">
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

        ${questionTextMarkup(question)}

        <div class="answer-block">
          <h3>Your answer</h3>
          ${answerControl(question)}
        </div>

        <nav class="quiz-nav" aria-label="Question navigation">
          <button class="nav-button previous" type="button" ${state.current === 0 ? "disabled" : ""}>← Previous</button>
          <button class="submit-link" type="button">Submit test</button>
          <button class="nav-button next" type="button">
            ${state.current === state.questions.length - 1 ? "Review & submit" : "Next →"}
          </button>
        </nav>
      </article>
    </section>
  `;

  bindQuizEvents(question);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindQuizEvents(question) {
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

  app.querySelector(".previous").addEventListener("click", () => {
    if (state.current > 0) {
      state.current -= 1;
      renderQuiz();
    }
  });

  app.querySelector(".next").addEventListener("click", () => {
    if (state.current < state.questions.length - 1) {
      state.current += 1;
      renderQuiz();
    } else {
      submitTest();
    }
  });

  app.querySelector(".submit-link").addEventListener("click", submitTest);
  app.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = Number(button.dataset.jump);
      renderQuiz();
    });
  });

  // Keyboard navigation
  document.addEventListener(
    "keydown",
    function quizKeyHandler(e) {
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT"
      )
        return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (state.current < state.questions.length - 1) {
          state.current += 1;
          renderQuiz();
          document.removeEventListener("keydown", quizKeyHandler);
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (state.current > 0) {
          state.current -= 1;
          renderQuiz();
          document.removeEventListener("keydown", quizKeyHandler);
        }
      }
    },
    { once: false },
  );
}

// ─── Submit & Results ─────────────────────────────────────────────────────────

async function submitTest() {
  const unanswered = state.questions.filter((question) => !isAnswered(question));
  if (
    unanswered.length &&
    !window.confirm(
      `${unanswered.length} question${unanswered.length === 1 ? " is" : "s are"} unanswered. Submit anyway?`,
    )
  ) {
    return;
  }

  state.results = state.questions.map((question) => {
    const userAnswer = getUserAnswer(question);
    return {
      question,
      userAnswer,
      correct: isCorrect(question),
    };
  });

  const payload = buildWrongAnswersExport();
  saveWrongAnswersLocal(payload);

  // Persist via API + update local wrongIds immediately
  await saveSession(payload, state.mode);
  payload.wrongAnswers.forEach((w) => state.wrongIds.add(w.sourceQuestionId));

  state.filter = "all";
  renderResults();
}

function resultMessage(percent) {
  if (percent >= 85) return "Very sharp work.";
  if (percent >= 70) return "You're in striking distance.";
  if (percent >= 50) return "The shape is there—now tighten the weak spots.";
  return "Good reconnaissance. The review below is your map.";
}

function reviewCard(result) {
  const { question, userAnswer, correct } = result;
  return `
    <article class="review-card ${correct ? "" : "incorrect"}" data-correct="${correct}">
      <button class="review-summary" type="button" aria-expanded="false">
        <span class="review-icon">${correct ? "✓" : "×"}</span>
        <span>
          <strong>Question ${question.id}</strong>
          <small>${correct ? "Correct" : "Needs review"}</small>
        </span>
        <span class="review-chevron">⌄</span>
      </button>
      <div class="review-details">
        <div class="answer-comparison">
          <div class="answer-chip">
            <label>Your answer</label>
            <span>${escapeHtml(userAnswer || "No answer")}</span>
          </div>
          <div class="answer-chip correct">
            <label>PDF answer key</label>
            <span>${escapeHtml(question.answer)}</span>
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
  document.title = "Your result · AB-900 Practice Lab";
  const correct = state.results.filter((result) => result.correct).length;
  const total = state.results.length;
  const percent = Math.round((correct / total) * 100);
  const incorrect = total - correct;
  const wrongAnswersJson = getWrongAnswersExportText();
  const visible =
    state.filter === "incorrect"
      ? state.results.filter((result) => !result.correct)
      : state.results;

  // Score ring angle for the animated arc
  const deg = Math.round((percent / 100) * 360);

  app.innerHTML = `
    <section class="results">
      <div class="result-hero">
        <div class="score-ring" style="--score-deg:${deg}deg">
          <strong>${percent}%</strong>
          <small>final grade</small>
        </div>
        <div class="result-copy">
          <p class="eyebrow">Test complete</p>
          <h1>${resultMessage(percent)}</h1>
          <p>Your result is graded against the answer key in the supplied AB-900 PDF.</p>
          <div class="result-stats">
            <div><strong>${correct}</strong><span>Correct</span></div>
            <div><strong>${incorrect}</strong><span>Incorrect</span></div>
            <div><strong>${total}</strong><span>Questions</span></div>
          </div>
        </div>
        <div class="result-actions">
          <button class="secondary-button" type="button" id="retry">Try another test</button>
          <button class="ghost-button" type="button" id="home">Change mode</button>
        </div>
      </div>

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
    // Reload wrong IDs from API so "Retry Wrongs" mode is up to date
    loadWrongQuestionIds().then((ids) => {
      state.wrongIds = ids;
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
    link.download = `ab900-wrong-answers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

fetch("questions.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Question bank returned ${response.status}`);
    return response.json();
  })
  .then((questions) => {
    state.bank = questions;

    // Init auth — only render app after user is signed in
    initAuth(async (user) => {
      updateHeaderUser(user);
      // Load historical wrong question IDs from API
      const ids = await loadWrongQuestionIds();
      state.wrongIds = ids;
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
