
/**
 * F-BASE GITHUB BRIDGE
 * Add at the END of Code.gs.
 * Do not redeclare const FBASE.
 */

function fbaseBridgeAction_(action, payload) {
  try {
    if (typeof action !== "string") {
      throw new Error("Invalid action");
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid payload");
    }

    const allowedActions = [
      "health",
      "google_login",
      "google_register",
      "login",
      "register",
      "me",
      "logout"
    ];

    if (!allowedActions.includes(action)) {
      throw new Error("Action not allowed");
    }

    // Account creation remains disabled until security review.
    if (
      action === "register" ||
      action === "google_register"
    ) {
      throw new Error("Registration is temporarily disabled.");
    }

    const requestBody = Object.assign({}, payload, {
      action: action
    });

    // Existing backend action handler.
    return handleAction_(requestBody);

  } catch (error) {
    return {
      ok: false,
      error: String(error && error.message ? error.message : error)
    };
  }
}
