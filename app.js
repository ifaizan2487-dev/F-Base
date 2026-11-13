
/* F-BASE APPS SCRIPT BRIDGE */

const FBASE_BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbwYCaXbnJwE6cA6xUcbj7unhka8MMlSfQTSvzcJhSz0KoKTWLUGwNat2pTfARD8mGIl/exec?bridge=1";

const FBASE_PARENT_ORIGIN =
  "https://ifaizan2487-dev.github.io";

let fbaseBridgeFrame = null;
let fbaseBridgeReady = false;
let fbaseBridgeRequests = new Map();

function fbaseStartBridge() {
  if (fbaseBridgeFrame) return;

  fbaseBridgeFrame = document.createElement("iframe");
  fbaseBridgeFrame.src = FBASE_BRIDGE_URL;
  fbaseBridgeFrame.title = "F-Base backend connection";
  fbaseBridgeFrame.style.display = "none";

  document.body.appendChild(fbaseBridgeFrame);

  window.addEventListener("message", function (event) {
    if (event.origin !== new URL(FBASE_BRIDGE_URL).origin) return;
    if (event.source !== fbaseBridgeFrame.contentWindow) return;

    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "FBASE_BRIDGE_READY") {
      fbaseBridgeReady = true;
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
        pending.reject(new Error(data.error || "Backend error"));
      } else {
        pending.resolve(data.result);
      }
    }
  });

  fbaseBridgeFrame.addEventListener("load", function () {
    fbaseBridgeFrame.contentWindow.postMessage({
      type: "FBASE_BRIDGE_INIT",
      requestId: "fbase-init"
    }, FBASE_PARENT_ORIGIN);
  });
}

function fbaseBridgeCall(action, payload = {}) {
  return new Promise(function (resolve, reject) {
    if (!fbaseBridgeFrame || !fbaseBridgeReady) {
      reject(new Error("F-Base backend is not connected yet."));
      return;
    }

    const requestId =
      "fbase-" + Date.now() + "-" +
      Math.random().toString(36).slice(2);

    const timeout = setTimeout(function () {
      fbaseBridgeRequests.delete(requestId);
      reject(new Error("F-Base backend request timed out."));
    }, 20000);

    fbaseBridgeRequests.set(requestId, {
      resolve: resolve,
      reject: reject,
      timeout: timeout
    });

    fbaseBridgeFrame.contentWindow.postMessage({
      type: "FBASE_BRIDGE_ACTION",
      requestId: requestId,
      action: action,
      payload: payload
    }, FBASE_PARENT_ORIGIN);
  });
}

document.addEventListener("DOMContentLoaded", fbaseStartBridge);

const API_BASE = "https://f-base-api.onrender.com";
const $ = (id) => document.getElementById(id);

const authView = $("authView");
const dashboardView = $("dashboardView");
const loginForm = $("loginForm");
const registerForm = $("registerForm");
const authMessage = $("authMessage");
const recordMessage = $("recordMessage");
const recordsList = $("recordsList");

let currentUser = null;

// Keep the session token for this browser tab only.
let token = sessionStorage.getItem("fbase_token");

function message(element, text, type = "") {
  element.textContent = text;
  element.className = "message" + (type ? " " + type : "");
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;

const response = await fetch(API_BASE + url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed (" + response.status + ")");
  }
  return data;
}

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
  $("userName").textContent = user.username;
  loadRecords();
}

$("loginTab").addEventListener("click", showLogin);
$("registerTab").addEventListener("click", showRegister);

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = registerForm.querySelector("button[type=submit]");
  button.disabled = true;
  message(authMessage, "Creating your account...");

  try {
    const body = {
      email: $("regEmail").value.trim(),
      username: $("regUsername").value.trim(),
      password: $("regPassword").value
    };
    const result = await api("/api/register", {
      method: "POST",
      body: JSON.stringify(body)
    });

    registerForm.reset();
    $("loginIdentity").value = result.user.username;
    showLogin();
    message(authMessage, "Account created! Now log in.", "success");
  } catch (error) {
    message(authMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  message(authMessage, "Signing in...");

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        identity: $("loginIdentity").value.trim(),
        password: $("loginPassword").value
      })
    });

    token = result.token;
    sessionStorage.setItem("fbase_token", token);
    loginForm.reset();
    showDashboard(result.user);
  } catch (error) {
    message(authMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function loadRecords() {
  recordsList.replaceChildren();
  message(recordMessage, "Loading records...");

  try {
    const result = await api("/api/records");
    const records = result.records || [];
    $("recordCount").textContent = records.length;

    if (!records.length) {
      recordsList.innerHTML = '<p class="empty-state">No records yet. Create your first one above.</p>';
    } else {
      for (const record of records) {
        const card = document.createElement("article");
        card.className = "record-card";

        const title = document.createElement("h3");
        title.textContent = record.data.title || "Untitled record";

        const content = document.createElement("p");
        content.textContent = record.data.content || "";

        const time = document.createElement("time");
        time.textContent = record.createdAt
          ? new Date(record.createdAt).toLocaleString()
          : "";

        card.append(title, content, time);
        recordsList.append(card);
      }
      message(recordMessage, "Records loaded.", "success");
    }
  } catch (error) {
    message(recordMessage, error.message, "error");
    if (error.message === "Please log in") await logout(false);
  }
}

$("recordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("recordForm").querySelector("button[type=submit]");
  button.disabled = true;
  message(recordMessage, "Saving record...");

  try {
    await api("/api/records", {
      method: "POST",
      body: JSON.stringify({
        data: {
          title: $("recordTitle").value.trim(),
          content: $("recordContent").value.trim()
        }
      })
    });

    $("recordForm").reset();
    message(recordMessage, "Record saved to SQLite.", "success");
    await loadRecords();
  } catch (error) {
    message(recordMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("refreshButton").addEventListener("click", loadRecords);

async function logout(callApi = true) {
  if (callApi && token) {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (_) {
      // Clear the browser session even if the server cannot be reached.
    }
  }

  token = null;
  currentUser = null;
  sessionStorage.removeItem("fbase_token");
  recordsList.replaceChildren();
  $("recordCount").textContent = "0";
  showLogin();
}

$("logoutButton").addEventListener("click", () => logout(true));

async function restoreSession() {
  if (!token) {
    showLogin();
    return;
  }

  try {
    const result = await api("/api/me");
    showDashboard(result.user);
  } catch (_) {
    await logout(false);
  }
}

restoreSession();
