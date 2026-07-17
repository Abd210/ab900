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

async function listUserProfiles() {
  if (!isCurrentUserAdmin()) return [];

  try {
    const snapshot = await db.collection("userProfiles")
      .orderBy("lastLoginAt", "desc")
      .get();
    const users = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      users.push({
        id: doc.id,
        uid: data.uid || doc.id,
        displayName: data.displayName || "Student",
        email: data.email || "",
        isAdmin: Boolean(data.isAdmin),
        createdAt: data.createdAt?.toDate?.() || null,
        lastLoginAt: data.lastLoginAt?.toDate?.() || null,
        totalSessions: 0,
        lastSessionAt: null,
      });
    });
    await Promise.all(users.map(async (profile) => {
      try {
        const sessions = await db.collection("users")
          .doc(profile.uid)
          .collection("sessions")
          .orderBy("timestamp", "desc")
          .get();
        profile.totalSessions = sessions.size;
        const latest = sessions.docs[0]?.data?.();
        profile.lastSessionAt = latest?.timestamp?.toDate?.() || null;
      } catch (err) {
        console.warn("Could not load sessions for user profile.", profile.uid, err);
      }
    }));
    return users;
  } catch (err) {
    console.error("Could not load user profiles:", err);
    return [];
  }
}

async function loadQuestionEdits() {
  try {
    const edits = {};
    await Promise.all(
      Object.keys(EXAMS).map(async (exam) => {
        const snapshot = await db.collection("questionEdits")
          .doc(exam)
          .collection("items")
          .get();
        edits[exam] = {};
        snapshot.forEach((doc) => {
          edits[exam][doc.id] = doc.data();
        });
      }),
    );
    return edits;
  } catch (err) {
    console.warn("Could not load question edits:", err);
    return {};
  }
}

async function saveQuestionEdit(exam, question) {
  if (!isCurrentUserAdmin()) return;
  const user = getCurrentUser();
  await db.collection("questionEdits")
    .doc(exam)
    .collection("items")
    .doc(String(question.id))
    .set({
      question,
      deleted: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user?.uid || "",
      updatedByName: user?.displayName || user?.email || "Admin",
    }, { merge: true });
}

async function hideQuestion(exam, questionId) {
  if (!isCurrentUserAdmin()) return;
  const user = getCurrentUser();
  await db.collection("questionEdits")
    .doc(exam)
    .collection("items")
    .doc(String(questionId))
    .set({
      deleted: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user?.uid || "",
      updatedByName: user?.displayName || user?.email || "Admin",
    }, { merge: true });
}

async function restoreQuestion(exam, questionId) {
  if (!isCurrentUserAdmin()) return;
  const user = getCurrentUser();
  await db.collection("questionEdits")
    .doc(exam)
    .collection("items")
    .doc(String(questionId))
    .set({
      deleted: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user?.uid || "",
      updatedByName: user?.displayName || user?.email || "Admin",
    }, { merge: true });
}

async function saveQuestionReport(exam, question, message) {
  const user = getCurrentUser();
  if (!user) return;
  await db.collection("questionReports").doc().set({
    exam,
    questionId: question.id,
    prompt: question.prompt || "",
    message,
    status: "open",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    userId: user.uid,
    userName: user.displayName || user.email?.split("@")[0] || "Student",
    userEmail: user.email || "",
  });
}

async function listQuestionReports() {
  if (!isCurrentUserAdmin()) return [];

  try {
    const snapshot = await db.collection("questionReports")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const reports = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      reports.push({
        id: doc.id,
        exam: data.exam || "ab",
        questionId: data.questionId,
        prompt: data.prompt || "",
        message: data.message || "",
        status: data.status || "open",
        userId: data.userId || "",
        userName: data.userName || "Student",
        userEmail: data.userEmail || "",
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null,
      });
    });
    return reports;
  } catch (err) {
    console.error("Could not load question reports:", err);
    return [];
  }
}

async function updateQuestionReportStatus(reportId, status) {
  if (!isCurrentUserAdmin()) return;
  await db.collection("questionReports").doc(reportId).set({
    status,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
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
