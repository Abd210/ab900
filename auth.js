/**
 * auth.js — Authentication layer for AZ / AB Practice Lab
 * Uses Firebase Client SDK.
 */

const firebaseConfig = {
  apiKey: "AIzaSyCaTykjrI9Ob_EUmeTX6LwvRMNhHqLJjRk",
  authDomain: "ab900-87fbf.firebaseapp.com",
  projectId: "ab900-87fbf",
  storageBucket: "ab900-87fbf.firebasestorage.app",
  messagingSenderId: "333635428702",
  appId: "1:333635428702:web:31f9c765c34bcec9a8afcf",
  measurementId: "G-N3HERYX1ML"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const USER_ACCESS_TOKEN = "thegoodstuff";
const ADMIN_ACCESS_TOKEN = "theadminstuff";
const ADMIN_STORAGE_KEY = "practice-lab-admin-uids";
const ADMIN_ACCOUNT_EMAIL = "thegoodstuff@ab900.local";

function getCurrentUser() {
  return auth.currentUser;
}

function signOutUser() {
  const user = getCurrentUser();
  if (user) {
    const admins = getStoredAdminUids();
    admins.delete(user.uid);
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify([...admins]));
  }
  auth.signOut().then(() => {
    renderAuthScreen();
  });
}

function getStoredAdminUids() {
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function rememberAdminUser(uid) {
  const admins = getStoredAdminUids();
  admins.add(uid);
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify([...admins]));
}

function isCurrentUserAdmin() {
  const user = getCurrentUser();
  return Boolean(
    user &&
      (user.email === ADMIN_ACCOUNT_EMAIL || getStoredAdminUids().has(user.uid)),
  );
}

async function upsertUserProfile(user, { isAdmin = false } = {}) {
  if (!user || typeof db === "undefined") return;
  try {
    await db.collection("userProfiles").doc(user.uid).set({
      uid: user.uid,
      displayName: user.displayName || user.email?.split("@")[0] || "Student",
      email: user.email || "",
      isAdmin: Boolean(isAdmin || isCurrentUserAdmin()),
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn("Could not save user profile.", err);
  }
}

let _onAuthSuccess = null;

function initAuth(onSuccess) {
  _onAuthSuccess = onSuccess;
  auth.onAuthStateChanged((user) => {
    if (user) {
      upsertUserProfile(user, { isAdmin: isCurrentUserAdmin() });
      onSuccess(user);
    } else {
      renderAuthScreen();
    }
  });
}

function renderAuthScreen() {
  document.title = "Sign In · AZ / AB Practice Lab";
  const app = document.querySelector("#app");

  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-card">
        <div class="auth-brand">
          <span class="auth-brand-mark">AZ</span>
          <div>
            <strong>Practice Lab</strong>
            <small>AZ-900 &amp; AB-900 exam simulators</small>
          </div>
        </div>

        <div class="auth-tabs" role="tablist">
          <button class="auth-tab active" role="tab" data-tab="login" aria-selected="true">Sign in</button>
          <button class="auth-tab" role="tab" data-tab="register" aria-selected="false">Create account</button>
        </div>

        <form class="auth-form" id="auth-form" novalidate>
          <div class="auth-field">
            <label for="auth-name">Your name</label>
            <input
              id="auth-name"
              type="text"
              placeholder="e.g. Alex"
              autocomplete="username"
              required
            />
          </div>
          <div class="auth-field">
            <label for="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="••••••••"
              autocomplete="current-password"
              required
            />
          </div>
          <div class="auth-field">
            <label for="auth-token">Access token</label>
            <input
              id="auth-token"
              type="password"
              placeholder="Enter the access token"
              autocomplete="off"
              required
            />
            <span class="auth-field-hint">Required to access this site</span>
          </div>

          <div class="auth-error" id="auth-error" role="alert" aria-live="polite"></div>

          <button class="auth-submit" type="submit" id="auth-submit">
            <span id="auth-submit-text">Sign in</span>
            <span class="auth-spinner" id="auth-spinner" hidden></span>
          </button>
        </form>
      </div>
    </section>
  `;

  let currentTab = "login";

  app.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      currentTab = tab.dataset.tab;
      app.querySelectorAll(".auth-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      app.querySelector("#auth-submit-text").textContent =
        currentTab === "login" ? "Sign in" : "Create account";
      clearError();
    });
  });

  app.querySelector("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const name = app.querySelector("#auth-name").value.trim();
    const password = app.querySelector("#auth-password").value;
    const token = app.querySelector("#auth-token").value.trim();
    const submitBtn = app.querySelector("#auth-submit");
    const spinner = app.querySelector("#auth-spinner");
    const submitText = app.querySelector("#auth-submit-text");

    if (!name) return showError("Please enter your name.");
    if (password.length < 6) return showError("Password must be at least 6 characters.");
    if (!token) return showError("Please enter the access token.");
    
    const isAdminToken = token === ADMIN_ACCESS_TOKEN;
    if (token !== USER_ACCESS_TOKEN && !isAdminToken) {
      return showError("Invalid access token.");
    }

    submitBtn.disabled = true;
    submitText.hidden = true;
    spinner.hidden = false;

    // We map the "name" to a mock email for Firebase Auth
    // Because Firebase requires emails, we just append @ab900.local
    const mockEmail = `${name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}@ab900.local`;
    const isConfiguredAdminAccount = mockEmail === ADMIN_ACCOUNT_EMAIL;

    try {
      if (currentTab === "login") {
        const cred = await auth.signInWithEmailAndPassword(mockEmail, password);
        if (isAdminToken || isConfiguredAdminAccount) rememberAdminUser(cred.user.uid);
        await upsertUserProfile(cred.user, { isAdmin: isAdminToken || isConfiguredAdminAccount });
      } else {
        const cred = await auth.createUserWithEmailAndPassword(mockEmail, password);
        await cred.user.updateProfile({ displayName: name });
        if (isAdminToken || isConfiguredAdminAccount) rememberAdminUser(cred.user.uid);
        await upsertUserProfile(cred.user, { isAdmin: isAdminToken || isConfiguredAdminAccount });
      }
      // onAuthStateChanged will handle the redirect
    } catch (err) {
      submitBtn.disabled = false;
      submitText.hidden = false;
      spinner.hidden = true;
      if (err.code === 'auth/user-not-found') showError("Account not found. Try 'Create account'.");
      else if (err.code === 'auth/wrong-password') showError("Incorrect password.");
      else if (err.code === 'auth/email-already-in-use') showError("Name already taken. Try logging in.");
      else if (err.code === 'auth/operation-not-allowed') showError("CRITICAL: Email/Password auth is NOT enabled in your Firebase Console!");
      else showError(err.message);
    }
  });

  function showError(msg) {
    const el = app.querySelector("#auth-error");
    el.textContent = msg;
    el.classList.add("visible");
  }

  function clearError() {
    const el = app.querySelector("#auth-error");
    el.textContent = "";
    el.classList.remove("visible");
  }
}
