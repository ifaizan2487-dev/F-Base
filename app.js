
/* =====================================================
   F-BASE - COMPLETE APP.JS
   Frontend: GitHub Pages
   Backend: Google Apps Script
   Storage: Google Drive registry (account metadata)
===================================================== */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const FBASE_BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbwYCaXbnJwE6cA6xUcbj7unhka8MMlSfQTSvzcJhSz0KoKTWLUGwNat2pTfARD8mGIl/exec?bridge=1";

const FBASE_PARENT_ORIGIN =
  "https://ifaizan2487-dev.github.io";

const GOOGLE_AUTH_URL =
  "https://ifaizan2487-dev.github.io/F-Base/google-auth.html";

/* ---------------- DOM ELEMENTS ---------------- */

const $ = (id) => document.getElementById(id);

const authView = $("authView");
const dashboardView = $("dashboardView");
const loginForm = $("loginForm");
const registerForm = $("registerForm");
const authMessage = $("authMessage");
const recordMessage = $("recordMessage");
const recordsList = $("recordsList");

/* ---------------- APP STATE ---------------- */

let currentUser = null;
let token = sessionStorage.getItem("fbase_token");

let fbaseBridgeFrame = null;
let fbaseBridgeReady = false;
let fbaseBridgeRequests = new Map();

let googlePopup = null;

/* ---------------- MESSAGE HELPER ---------------- */

function message(element, text, type = "") {
  if (!element) return;

  element.textContent = text;
  element.className = "message" + (type ? " " + type : "");
}

/* =====================================================
   APPS SCRIPT BRIDGE
===================================================== */

function fbaseStartBridge() {
  if (fbaseBridgeFrame) return;

  fbaseBridgeFrame = document.createElement("iframe");

  fbaseBridgeFrame.src = FBASE_BRIDGE_URL;
  fbaseBridgeFrame.title = "F-Base backend connection";
  fbaseBridgeFrame.setAttribute("aria-hidden", "true");
  fbaseBridgeFrame.style.display = "none";

  document.body.appendChild(fbaseBridgeFrame);

  window.addEventListener("message", function (event) {
    if (event.origin !== new URL(FBASE_BRIDGE_URL).origin) return;

    if (event.source !== fbaseBridgeFrame.contentWindow) return;

    const data = event.data;

    if (!data || typeof data !== "object") return;

    if (data.type === "FBASE_BRIDGE_READY") {
      fbaseBridgeReady = true;
      console.log("F-Base backend bridge ready.");
      return;
    }

    if (
      data.type === "FBASE_BRIDGE_RESULT" ||
      data.type === "FBASE_BRIDGE_ERROR"
    ) {
      const pending = fbaseBridgeRequests.get(data.requestId);

      if (!pending) return;

      clearTimeout(pending.timeout);
      fbaseBridgeRequests.delete(data.requestId);

      if (data.type === "FBASE_BRIDGE_ERROR") {
        pending.reject(
          new Error(data.error || "Backend request failed.")
        );
      } else {
        pending.resolve(data.result);
      }
    }
  });

  fbaseBridgeFrame.addEventListener("load", function () {
    fbaseBridgeFrame.contentWindow.postMessage(
      {
        type: "FBASE_BRIDGE_INIT",
        requestId: "fbase-init"
      },
      FBASE_PARENT_ORIGIN
    );
  });
}

function fbaseBridgeCall(action, payload = {}) {
  return new Promise(function (resolve, reject) {
    if (!fbaseBridgeFrame || !fbaseBridgeReady) {
      reject(
        new Error(
          "F-Base backend is not connected. Refresh the page and try again."
        )
      );
      return;
    }

    const requestId =
      "fbase-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2);

    const timeout = setTimeout(function () {
      fbaseBridgeRequests.delete(requestId);

      reject(new Error("Backend request timed out."));
    }, 20000);

    fbaseBridgeRequests.set(requestId, {
      resolve: resolve,
      reject: reject,
      timeout: timeout
    });

    fbaseBridgeFrame.contentWindow.postMessage(
      {
        type: "FBASE_BRIDGE_ACTION",
        requestId: requestId,
        action: action,
        payload: payload
      },
      FBASE_PARENT_ORIGIN
    );
  });
}

/* =====================================================
   AUTHENTICATION SCREENS
===================================================== */

function showLogin() {
  authView.hidden = false;
  dashboardView.hidden = true;

  loginForm.hidden = false;
  registerForm.hidden = true;

  $("loginTab").classList.add("active");
  $("registerTab").classList.remove("active");

  message(authMessage, "");
}

function showRegister() {
  authView.hidden = false;
  dashboardView.hidden = true;

  loginForm.hidden = true;
  registerForm.hidden = false;

  $("loginTab").classList.remove("active");
  $("registerTab").classList.add("active");

  message(authMessage, "");
}

function showDashboard(user) {
  currentUser = user;

  authView.hidden = true;
  dashboardView.hidden = false;

  $("userName").textContent =
    user.username || user.email || "F-Base User";

  recordsList.replaceChildren();

  $("recordCount").textContent = "0";

  message(
    recordMessage,
    "Personal Google Drive storage is not connected yet."
  );
}

/* =====================================================
   GOOGLE SIGN-IN
===================================================== */

function startGoogleSignIn() {
  if (!fbaseBridgeReady) {
    message(
      authMessage,
      "Connecting to F-Base backend. Please wait a moment.",
      "error"
    );
    return;
  }

  const state =
    "fbase-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2);

  sessionStorage.setItem("fbase_google_state", state);

  const popupUrl =
    GOOGLE_AUTH_URL +
    "?state=" +
    encodeURIComponent(state) +
    "&parentOrigin=" +
    encodeURIComponent(FBASE_PARENT_ORIGIN);

  googlePopup = window.open(
    popupUrl,
    "FBaseGoogleSignIn",
    "width=500,height=650,resizable=yes,scrollbars=yes"
  );

  if (!googlePopup) {
    message(
      authMessage,
      "Popup blocked. Allow popups for GitHub Pages.",
      "error"
    );
    return;
  }

  message(authMessage, "Opening Google Sign-In...");
}

/* ---------------- RECEIVE GOOGLE CREDENTIAL ---------------- */

window.addEventListener("message", async function (event) {
  if (event.origin !== FBASE_PARENT_ORIGIN) return;

  if (
    event.source !== googlePopup &&
    event.source !== window
  ) {
    return;
  }

  const data = event.data;

  if (!data || data.type !== "FBASE_GOOGLE_CREDENTIAL") return;

  const expectedState = sessionStorage.getItem("fbase_google_state");

  if (!expectedState || data.state !== expectedState) {
    message(
      authMessage,
      "Google sign-in verification failed. Please try again.",
      "error"
    );
    return;
  }

  sessionStorage.removeItem("fbase_google_state");

  const credential = data.credential;

  if (typeof credential !== "string" || !credential) {
    message(authMessage, "Google credential is missing.", "error");
    return;
  }

  if (!fbaseBridgeReady) {
    message(authMessage, "Backend is not connected.", "error");
    return;
  }

  message(authMessage, "Verifying your Google account...");

  try {
    const result = await fbaseBridgeCall("google_login", {
      credential: credential
    });

    if (!result || !result.ok) {
      throw new Error(
        result && result.error
          ? result.error
          : "Google sign-in failed."
      );
    }

    const sessionToken =
      result.sessionToken || result.token || null;

    const user = result.account || result.user || null;

    if (!user) {
      throw new Error("Backend did not return account information.");
    }

    if (sessionToken) {
      token = sessionToken;
      sessionStorage.setItem("fbase_token", token);
    }

    if (googlePopup && !googlePopup.closed) {
      googlePopup.close();
    }

    loginForm.reset();

    showDashboard(user);

  } catch (error) {
    message(authMessage, error.message, "error");
  }
});

/* =====================================================
   TAB BUTTONS
===================================================== */

$("loginTab").addEventListener("click", showLogin);

$("registerTab").addEventListener("click", showRegister);

/* =====================================================
   GOOGLE BUTTON
===================================================== */

const googleButton = $("googleSignInButton");

if (googleButton) {
  googleButton.addEventListener("click", startGoogleSignIn);
}

/* =====================================================
   REGISTRATION
===================================================== */

registerForm.addEventListener("submit", function (event) {
  event.preventDefault();

  message(
    authMessage,
    "Registration is temporarily disabled while account security is being completed.",
    "error"
  );
});

/* =====================================================
   USERNAME + PASSWORD LOGIN
===================================================== */

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const button = loginForm.querySelector('button[type="submit"]');

  button.disabled = true;

  message(authMessage, "Signing in...");

  try {
    const result = await fbaseBridgeCall("login", {
      username: $("loginIdentity").value.trim(),
      password: $("loginPassword").value
    });

    if (!result || !result.ok) {
      throw new Error(
        result && result.error
          ? result.error
          : "Login failed."
      );
    }

    const sessionToken =
      result.sessionToken || result.token || null;

    const user = result.account || result.user || null;

    if (!user) {
      throw new Error("Account information missing.");
    }

    if (sessionToken) {
      token = sessionToken;
      sessionStorage.setItem("fbase_token", token);
    }

    loginForm.reset();

    showDashboard(user);

  } catch (error) {
    message(authMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

/* =====================================================
   RECORDS - WAITING FOR PERSONAL DRIVE API
===================================================== */

async function loadRecords() {
  recordsList.replaceChildren();

  $("recordCount").textContent = "0";

  message(
    recordMessage,
    "Records feature will be enabled after personal Google Drive integration."
  );
}

const recordForm = $("recordForm");

if (recordForm) {
  recordForm.addEventListener("submit", function (event) {
    event.preventDefault();

    message(
      recordMessage,
      "Record storage is not available yet.",
      "error"
    );
  });
}

const refreshButton = $("refreshButton");

if (refreshButton) {
  refreshButton.addEventListener("click", loadRecords);
}

/* =====================================================
   LOGOUT
===================================================== */

async function logout() {
  if (token && fbaseBridgeReady) {
    try {
      await fbaseBridgeCall("logout", {
        sessionToken: token
      });
    } catch (error) {
      console.warn("Server logout could not be completed.");
    }
  }

  token = null;
  currentUser = null;

  sessionStorage.removeItem("fbase_token");

  recordsList.replaceChildren();

  $("recordCount").textContent = "0";

  showLogin();
}

$("logoutButton").addEventListener("click", logout);

/* =====================================================
   SESSION RESTORE
===================================================== */

async function restoreSession() {
  if (!token) {
    showLogin();
    return;
  }

  if (!fbaseBridgeReady) {
    showLogin();
    message(
      authMessage,
      "Backend connection is required. Please sign in again."
    );
    return;
  }

  try {
    const result = await fbaseBridgeCall("me", {
      sessionToken: token
    });

    if (!result || !result.ok) {
      throw new Error("Session expired.");
    }

    const user = result.account || result.user;

    if (!user) {
      throw new Error("Account information missing.");
    }

    showDashboard(user);

  } catch (error) {
    token = null;
    sessionStorage.removeItem("fbase_token");
    showLogin();
  }
}

/* =====================================================
   INITIALIZE
===================================================== */

function initializeFBase() {
  showLogin();

  fbaseStartBridge();

  // Wait for bridge readiness before attempting session restore.
  window.addEventListener("message", function (event) {
    if (event.origin !== new URL(FBASE_BRIDGE_URL).origin) return;
    if (!fbaseBridgeFrame ||
        event.source !== fbaseBridgeFrame.contentWindow) return;

    if (event.data && event.data.type === "FBASE_BRIDGE_READY") {
      restoreSession();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeFBase);
} else {
  initializeFBase();
}
