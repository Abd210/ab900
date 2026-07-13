/**
 * db.js — Data layer for AZ / AB Practice Lab
 * Uses Firebase Firestore.
 */

const db = firebase.firestore();

async function saveSession(payload, mode, exam) {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const sessionRef = db.collection("users").doc(user.uid).collection("sessions").doc();
    const wrongQuestionIds = (payload.wrongAnswers || []).map((w) => w.sourceQuestionId);
    const allQuestionIds = (payload.allQuestionIds || []);

    await sessionRef.set({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      wrongQuestionIds,
      allQuestionIds,
      exam,
      mode,
      totalQuestions: payload.totalQuestions,
      correctCount: payload.correctAnswers,
      wrongAnswersData: payload.wrongAnswers
    });
  } catch (err) {
    console.error("Could not save session to Firestore:", err);
    if (err.code === 'permission-denied') {
      alert("Firestore Error: Permission Denied. You need to enable Firestore Database in the Firebase Console and set rules to allow read/write.");
    }
  }
}

/**
 * Load wrong question IDs from Firestore.
 * Returns { smart: Set, all: Set }
 */
async function loadWrongQuestionIds(exam = "ab") {
  const user = getCurrentUser();
  if (!user) return { smart: new Set(), all: new Set() };

  try {
    const snapshot = await db.collection("users").doc(user.uid).collection("sessions")
      .orderBy("timestamp", "asc")
      .get();

    const allWrongs = new Set();
    const latestOutcome = new Map();

    snapshot.forEach((doc) => {
      const data = doc.data();
      const sessionExam = data.exam || "ab";
      if (sessionExam !== exam) return;

      const wrongSet = new Set(data.wrongQuestionIds || []);
      const testedIds = data.allQuestionIds || [];

      wrongSet.forEach((id) => allWrongs.add(id));

      if (testedIds.length > 0) {
        testedIds.forEach((id) => {
          if (wrongSet.has(id)) {
            latestOutcome.set(id, false);
          } else {
            latestOutcome.set(id, true);
          }
        });
      } else {
        wrongSet.forEach((id) => {
          latestOutcome.set(id, false);
        });
      }
    });

    const smartWrongs = new Set();
    allWrongs.forEach((id) => {
      const gotItRight = latestOutcome.get(id);
      if (gotItRight !== true) {
        smartWrongs.add(id);
      }
    });

    return { smart: smartWrongs, all: allWrongs };
  } catch (err) {
    console.error("Could not load wrong question IDs from Firestore:", err);
    return { smart: new Set(), all: new Set() };
  }
}

/**
 * Reset wrong-answer history without deleting exam sessions or score stats.
 */
async function resetAllWrongs(exam = "ab") {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const snapshot = await db.collection("users").doc(user.uid).collection("sessions")
      .get();

    const matchingRefs = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const sessionExam = data.exam || "ab";
      if (sessionExam === exam) {
        matchingRefs.push(doc.ref);
      }
    });

    // Firestore batches are limited to 500 writes.
    for (let index = 0; index < matchingRefs.length; index += 450) {
      const batch = db.batch();
      matchingRefs.slice(index, index + 450).forEach((ref) => {
        batch.update(ref, {
          wrongQuestionIds: [],
          wrongAnswersData: [],
        });
      });
      await batch.commit();
    }
  } catch (err) {
    console.error("Could not reset wrongs:", err);
  }
}

/**
 * Load stats for the stats dashboard.
 * Returns { totalExams, avgScore, recentSessions[] }
 */
async function loadStats(exam = "ab") {
  const user = getCurrentUser();
  if (!user) return { totalExams: 0, avgScore: 0, bestScore: 0, recentSessions: [] };

  try {
    const snapshot = await db.collection("users").doc(user.uid).collection("sessions")
      .orderBy("timestamp", "desc")
      .get();

    const sessions = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const sessionExam = data.exam || "ab";
      if (sessionExam !== exam) return;
      const total = data.totalQuestions || 0;
      const correct = data.correctCount || 0;
      const score = total > 0 ? Math.round((correct / total) * 100) : 0;
      sessions.push({
        timestamp: data.timestamp?.toDate?.() || new Date(),
        mode: data.mode || "unknown",
        total,
        correct,
        wrong: total - correct,
        score,
      });
    });

    const totalExams = sessions.length;
    const avgScore = totalExams > 0
      ? Math.round(sessions.reduce((sum, s) => sum + s.score, 0) / totalExams)
      : 0;
    const bestScore = totalExams > 0
      ? Math.max(...sessions.map((s) => s.score))
      : 0;

    return {
      totalExams,
      avgScore,
      bestScore,
      recentSessions: sessions.slice(0, 10),
    };
  } catch (err) {
    console.error("Could not load stats:", err);
    return { totalExams: 0, avgScore: 0, bestScore: 0, recentSessions: [] };
  }
}
