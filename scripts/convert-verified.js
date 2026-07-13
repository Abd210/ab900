#!/usr/bin/env node
/**
 * convert-verified.js
 *
 * Reads AZ-900-Questions-Verified.json and converts every question into the
 * internal app format used by az-questions.json.
 *
 * Produces:
 *   az-full-questions.json   — all 474 verified questions
 *   az-diff-questions.json   — verified questions NOT already in az-questions.json
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const verifiedData = JSON.parse(
  fs.readFileSync(path.join(ROOT, "AZ-900-Questions-Verified.json"), "utf-8").replace(/^\uFEFF/, ""),
);
const normalBank = JSON.parse(
  fs.readFileSync(path.join(ROOT, "az-questions.json"), "utf-8"),
);

// ── helpers ──────────────────────────────────────────────────────────────────

function norm(s = "") {
  return s
    .toLowerCase()
    .replace(/\u0026/g, "and")
    .replace(/microsoft entra id/gi, "azure active directory")
    .replace(/entra id/gi, "azure ad")
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[\r\n]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to extract selectable choices from a question string.
 * Returns an array of choice strings, or null if no choices found.
 */
function extractChoicesFromText(text) {
  // Pattern 1: (option1 / option2 / option3) at end of question
  const slashParen = text.match(/\(([^)]{5,}\/[^)]+)\)\s*[.?]?\s*$/);
  if (slashParen) {
    return slashParen[1].split("/").map((c) => c.trim()).filter(Boolean);
  }

  // Pattern 2: (Options: opt1, opt2, opt3) or Options: opt1, opt2, opt3
  const optionsTag = text.match(/\(?Options?:\s*(.+?)\)?\s*$/i);
  if (optionsTag) {
    return optionsTag[1]
      .replace(/\)\s*$/, "")
      .split(/,\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
  }

  // Pattern 3: [ opt1 / opt2 / opt3 ] — bracket choices with slashes
  const bracketSlash = text.match(/\[\s*([^\]]{5,}\/[^\]]+)\s*\]/);
  if (bracketSlash) {
    return bracketSlash[1].split("/").map((c) => c.trim()).filter(Boolean);
  }

  // Pattern 4: inline (opt1 / opt2 / opt3) anywhere in text (not just end)
  const inlineSlash = text.match(/\(([^)]{5,}\/[^)]+)\)/);
  if (inlineSlash) {
    return inlineSlash[1].split("/").map((c) => c.trim()).filter(Boolean);
  }

  // Pattern 5: "Options: opt1, opt2, opt3, opt4" in middle of text
  const midOptions = text.match(/Options?:\s*(.+?)(?:\.|$)/i);
  if (midOptions) {
    const choices = midOptions[1].split(/,\s*/).map((c) => c.trim()).filter(Boolean);
    if (choices.length >= 2) return choices;
  }

  return null;
}

/**
 * Extract numbered statements from question text.
 * Looks for patterns like: (1) statement one; (2) statement two; (3) statement three
 */
function extractNumberedStatements(text, expectedCount) {
  // Pattern A: (1) text (2) text (3) text
  // Use [\s\S]+? to allow content with parentheses like (CapEx), (PaaS) etc.
  // Lookahead matches " (digit) " (space-digit-paren) or end of string
  const regexA = /\((\d)\)\s*([\s\S]+?)(?=\s*\(\d\)\s|$)/g;
  const matchesA = [];
  let match;
  while ((match = regexA.exec(text)) !== null) {
    matchesA.push(match[2].trim().replace(/[;.]\s*$/, "").trim());
  }
  if (matchesA.length === expectedCount) return matchesA;

  // Pattern B: 1) text 2) text 3) text (without outer parens)
  const regexB = /(\d)\)\s*([\s\S]+?)(?=\s*\d\)\s|$)/g;
  const matchesB = [];
  while ((match = regexB.exec(text)) !== null) {
    matchesB.push(match[2].trim().replace(/[;.]\s*$/, "").trim());
  }
  if (matchesB.length === expectedCount) return matchesB;

  // Pattern C: semicolon-separated in the latter half of the question
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0) {
    const afterColon = text.substring(colonIdx + 1).trim();
    const parts = afterColon.split(/;\s*/).filter((p) => p.trim().length > 5);
    const cleaned = parts.map((p) => p.replace(/^\(?\d\)?\s*/, "").trim());
    if (cleaned.length === expectedCount) return cleaned;
  }

  return null;
}

// ── convert one verified question → app format ──────────────────────────────

function convertQuestion(vq) {
  const interaction = buildInteraction(vq);
  return {
    id: vq.id + 10000,
    kind: interaction.type === "matrix" ? "matrix" : interaction.type,
    prompt: vq.question,
    answer: vq.correctAnswer,
    explanation: vq.explanation,
    section: vq.topic || "",
    sourceType: vq.type,
    interaction,
  };
}

function buildInteraction(vq) {
  const type = vq.type;
  const opts = vq.options || {};
  const keys = Object.keys(opts);
  const hasOptions = keys.length > 0;

  // ── single with structured options ────────────────────────────────────────
  if (type === "single" && hasOptions) {
    return {
      type: "single",
      options: keys.map((k) => ({ id: k, label: opts[k] })),
      correct: vq.correctAnswer.trim(),
    };
  }

  // ── multi with structured options ─────────────────────────────────────────
  if (type === "multi" && hasOptions) {
    const correctKeys = vq.correctAnswer.split(",").map((k) => k.trim());
    return {
      type: "multi",
      options: keys.map((k) => ({ id: k, label: opts[k] })),
      correct: correctKeys,
    };
  }

  // ── yesno → matrix ────────────────────────────────────────────────────────
  if (type === "yesno") {
    return buildMatrixInteraction(vq);
  }

  // ── hotspot ───────────────────────────────────────────────────────────────
  if (type === "hotspot") {
    return buildHotspotInteraction(vq);
  }

  // ── drag-drop ─────────────────────────────────────────────────────────────
  if (type === "drag-drop") {
    return buildDragDropInteraction(vq);
  }

  // ── single/multi without options — try to extract from text ───────────────
  const choices = extractChoicesFromText(vq.question);
  if (choices && choices.length >= 2) {
    if (type === "multi") {
      const correctKeys = vq.correctAnswer.split(",").map((k) => k.trim());
      return {
        type: "multi",
        options: choices.map((c) => ({ id: c, label: c })),
        correct: correctKeys,
      };
    }
    return {
      type: "single",
      options: choices.map((c) => ({ id: c, label: c })),
      correct: vq.correctAnswer.trim(),
    };
  }

  // Fallback: text answer
  return {
    type: "single",
    options: [{ id: vq.correctAnswer.trim(), label: vq.correctAnswer.trim() }],
    correct: vq.correctAnswer.trim(),
  };
}

function buildMatrixInteraction(vq) {
  const answers = vq.correctAnswer.split(",").map((a) => a.trim());

  if (answers.length > 1 && answers.every((a) => a === "Yes" || a === "No")) {
    const statements = extractNumberedStatements(vq.question, answers.length);
    if (statements) {
      return { type: "matrix", statements, correct: answers };
    }
  }

  // Fallback
  return {
    type: "single",
    options: [
      { id: "Yes", label: "Yes" },
      { id: "No", label: "No" },
    ],
    correct: answers.length === 1 ? answers[0] : answers[0],
  };
}

function buildHotspotInteraction(vq) {
  const answer = vq.correctAnswer.trim();
  const answers = answer.split(",").map((a) => a.trim());

  // Pattern 1: Yes/No matrix with numbered statements
  if (answers.length > 1 && answers.every((a) => a === "Yes" || a === "No")) {
    const statements = extractNumberedStatements(vq.question, answers.length);
    if (statements) {
      return { type: "matrix", statements, correct: answers };
    }
  }

  // Pattern 2: Try to extract choices from the question text
  const choices = extractChoicesFromText(vq.question);
  if (choices && choices.length >= 2) {
    return {
      type: "single",
      options: choices.map((c) => ({ id: c, label: c })),
      correct: answer,
    };
  }

  // Fallback: text answer
  return {
    type: "single",
    options: [{ id: answer, label: answer }],
    correct: answer,
  };
}

function buildDragDropInteraction(vq) {
  const answer = vq.correctAnswer.trim();

  // Drag-drop doesn't map well to the app's interaction types.
  // Show the answer as the only option — the user will read the question context.
  return {
    type: "single",
    options: [{ id: answer, label: answer }],
    correct: answer,
  };
}

// ── Match verified questions to normal bank ─────────────────────────────────

function findMatchingVerifiedIds(verifiedQuestions, normalQuestions) {
  const matchedVerifiedIds = new Set();

  const normalIndex = normalQuestions.map((nq) => ({
    id: nq.id,
    norm: norm(nq.prompt),
  }));

  for (const vq of verifiedQuestions) {
    const vNorm = norm(vq.question);

    for (const nq of normalIndex) {
      const minLen = Math.min(vNorm.length, nq.norm.length);
      const checkLen = Math.min(60, minLen);
      if (
        checkLen > 20 &&
        (nq.norm.includes(vNorm.substring(0, checkLen)) ||
          vNorm.includes(nq.norm.substring(0, checkLen)) ||
          similarity(vNorm, nq.norm) > 0.75)
      ) {
        matchedVerifiedIds.add(vq.id);
        break;
      }
    }
  }

  return matchedVerifiedIds;
}

function similarity(a, b) {
  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Main ────────────────────────────────────────────────────────────────────

const verified = verifiedData.questions;
console.log(`Verified questions: ${verified.length}`);
console.log(`Normal bank questions: ${normalBank.length}`);

const allConverted = verified.map(convertQuestion);

const matchedIds = findMatchingVerifiedIds(verified, normalBank);
console.log(`Matched (overlap with normal AZ-900): ${matchedIds.size}`);

const diffConverted = allConverted.filter((q) => !matchedIds.has(q.id - 10000));
console.log(`Diff questions (only in verified, not in normal): ${diffConverted.length}`);

// Write files
fs.writeFileSync(
  path.join(ROOT, "az-full-questions.json"),
  JSON.stringify(allConverted, null, 2),
  "utf-8",
);
console.log(`\n✓ Wrote az-full-questions.json (${allConverted.length} questions)`);

fs.writeFileSync(
  path.join(ROOT, "az-diff-questions.json"),
  JSON.stringify(diffConverted, null, 2),
  "utf-8",
);
console.log(`✓ Wrote az-diff-questions.json (${diffConverted.length} questions)`);

// ── Validation ──────────────────────────────────────────────────────────────

const typeCounts = {};
for (const q of allConverted) {
  typeCounts[q.interaction.type] = (typeCounts[q.interaction.type] || 0) + 1;
}
console.log("\nInteraction type distribution:", typeCounts);

const singleOption = allConverted.filter(
  (q) =>
    (q.interaction.type === "single" || q.interaction.type === "multi") &&
    q.interaction.options.length <= 1,
);
console.log(`Text-answer questions (≤1 option): ${singleOption.length}`);
console.log("  By source type:", singleOption.reduce((acc, q) => {
  acc[q.sourceType] = (acc[q.sourceType] || 0) + 1;
  return acc;
}, {}));

const matrixQs = allConverted.filter((q) => q.interaction.type === "matrix");
console.log(`Matrix (Yes/No) questions: ${matrixQs.length}`);

const multiChoiceQs = allConverted.filter(
  (q) => q.interaction.type === "single" && q.interaction.options.length >= 2,
);
console.log(`Single-choice with ≥2 options: ${multiChoiceQs.length}`);

const multiSelectQs = allConverted.filter(
  (q) => q.interaction.type === "multi" && q.interaction.options.length >= 2,
);
console.log(`Multi-select with ≥2 options: ${multiSelectQs.length}`);

const missingCorrect = allConverted.filter(
  (q) =>
    !q.interaction.correct ||
    (typeof q.interaction.correct === "string" && q.interaction.correct.length === 0) ||
    (Array.isArray(q.interaction.correct) && q.interaction.correct.length === 0),
);
console.log(`Missing correct answer: ${missingCorrect.length}`);
