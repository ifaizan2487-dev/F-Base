
/* =====================================================
   F-BASE - COMPLETE APP.JS
   Frontend: GitHub Pages
   Backend: Google Apps Script Bridge
===================================================== */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const FBASE_BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbwYCaXbnJwE6cA6xUcbj7unhka8MMlSfQTSvzcJhSz0KoKTWLUGwNat2pTfARD8mGIl/exec?bridge=1";

const FBASE_BRIDGE_ORIGIN = new URL(FBASE_BRIDGE_URL).origin;

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

const loginTab = $("loginTab");
const registerTab = $("registerTab");
const googleButton = $("googleSignInButton");

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
   AUTHENTICATION SCREENS
===================================================== */

function showLogin() {
  if (authView) authView.hidden = false;
  if (dashboardView) dashboardView.hidden = true;

  if (loginForm) loginForm.hidden = false;
  if (registerForm) registerForm.hidden = true;

  if (loginTab) loginTab.classList.add("active");
  if (registerTab) registerTab.classList.remove("active");

  message(authMessage, "");
}

function showRegister() {
  if (authView) authView.hidden = false;
  if (dashboardView) dashboardView.hidden = true;

  if (loginForm) loginForm.hidden = true;
  if (registerForm) registerForm.hidden = false;

  if (loginTab) loginTab.classList.remove("active");
  if (registerTab) registerTab.classList.add("active");

  message(authMessage, "");
}

function showDashboard(user) {
  currentUser = user;

  if (authView) authView.hidden = true;
  if (dashboardView) dashboardView.hidden = false;

  const userName = $("userName");

  if (userName) {
    userName.textContent =
      user.username || user.email || "F-Base User";
  }

  if (recordsList) recordsList.replaceChildren();

  const recordCount = $("recordCount");
  if (recordCount) recordCount.textContent = "0";

  message(
    recordMessage,
    "Personal Google Drive storage is not connected yet."
  );
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

  window.addEventListener("message", function (event) {
    if (event.origin !== FBASE_BRIDGE_ORIGIN) return;

    if (!fbaseBridgeFrame ||
        event.source !== fbaseBridgeFrame.contentWindow) return;

    const data = event.data;

    if (!data || typeof data !== "object") return;

    if (data.type === "FBASE_BRIDGE_READY") {
      if (fbaseBridgeReady) return;

      fbaseBridgeReady = true;

      console.log("F-Base backend bridge ready.");

      restoreSession();
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
      FBASE_BRIDGE_ORIGIN
    );
  });

  document.body.appendChild(fbaseBridgeFrame);
}

function fbaseBridgeCall(action, payload = {}) {
  return new Promise(function (resolve, reject) {
    if (!fbaseBridgeFrame || !fbaseBridgeReady) {
      reject(
        new Error(
          "F-Base backend is not connected. Refresh and try again."
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
      resolve,
      reject,
      timeout
    });

    fbaseBridgeFrame.contentWindow.postMessage(
      {
        type: "FBASE_BRIDGE_ACTION",
        requestId,
        action,
        payload
      },
      FBASE_BRIDGE_ORIGIN
    );
  });
}

/* =====================================================
   GOOGLE SIGN-IN
===================================================== */

function startGoogleSignIn() {
  if (!fbaseBridgeReady) {
    message(
      authMessage,
      "Connecting to F-Base backend. Please wait.",
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

/* ---------------- GOOGLE CREDENTIAL RECEIVER ---------------- */

window.addEventListener("message", async function (event) {
  if (event.origin !== FBASE_PARENT_ORIGIN) return;

  // Only accept messages from the actual Google popup.
  if (!googlePopup || event.source !== googlePopup) return;

  const data = event.data;

  if (!data || data.type !== "FBASE_GOOGLE_CREDENTIAL") return;

  const expectedState =
    sessionStorage.getItem("fbase_google_state");

  if (!expectedState || data.state !== expectedState) {
    message(
      authMessage,
      "Google sign-in verification failed. Try again.",
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
      credential
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

    showDashboard(user);

  } catch (error) {
    message(authMessage, error.message, "error");
  }
});

/* =====================================================
   TAB BUTTONS
===================================================== */

if (loginTab) {
  loginTab.addEventListener("click", function (event) {
    event.preventDefault();
    showLogin();
  });
}

if (registerTab) {
  registerTab.addEventListener("click", function (event) {
    event.preventDefault();
    showRegister();
  });
}

/* =====================================================
   GOOGLE BUTTON
===================================================== */

if (googleButton) {
  googleButton.addEventListener("click", startGoogleSignIn);
}

/* =====================================================
   REGISTRATION
===================================================== */

if (registerForm) {
  registerForm.addEventListener("submit", function (event) {
    event.preventDefault();

    message(
      authMessage,
      "Registration is temporarily disabled while account security is being completed.",
      "error"
    );
  });
}

/* =====================================================
   USERNAME + PASSWORD LOGIN
===================================================== */

if (loginForm) {
  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const button = loginForm.querySelector('button[type="submit"]');

    if (button) button.disabled = true;

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
      if (button) button.disabled = false;
    }
  });
}

/* =====================================================
   RECORDS - PERSONAL DRIVE API PENDING
===================================================== */

async function loadRecords() {
  if (recordsList) recordsList.replaceChildren();

  const recordCount = $("recordCount");
  if (recordCount) recordCount.textContent = "0";

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

  if (recordsList) recordsList.replaceChildren();

  const recordCount = $("recordCount");
  if (recordCount) recordCount.textContent = "0";

  showLogin();
}

const logoutButton = $("logoutButton");

if (logoutButton) {
  logoutButton.addEventListener("click", logout);
}

/* =====================================================
   SESSION RESTORE
===================================================== */

async function restoreSession() {
  if (!token) {
    showLogin();
    return;
  }

  if (!fbaseBridgeReady) return;

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
   INITIALIZATION
===================================================== */

function initializeFBase() {
  showLogin();
  fbaseStartBridge();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeFBase
  );
} else {
  initializeFBase();
}
