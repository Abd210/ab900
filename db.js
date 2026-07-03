/**
 * db.js — Data layer for AB-900 Practice Lab
 * Uses Firebase Firestore.
 */

const db = firebase.firestore();

async function saveSession(payload, mode) {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const sessionRef = db.collection("users").doc(user.uid).collection("sessions").doc();
    const wrongQuestionIds = (payload.wrongAnswers || []).map((w) => w.sourceQuestionId);

    await sessionRef.set({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      wrongQuestionIds,
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

async function loadWrongQuestionIds() {
  const user = getCurrentUser();
  if (!user) return new Set();

  try {
    const snapshot = await db.collection("users").doc(user.uid).collection("sessions").get();
    const wrongIds = new Set();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.wrongQuestionIds) {
        data.wrongQuestionIds.forEach((id) => wrongIds.add(id));
      }
    });
    return wrongIds;
  } catch (err) {
    console.error("Could not load wrong question IDs from Firestore:", err);
    return new Set();
  }
}
