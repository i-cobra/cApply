import {
  SUPABASE_ANON_KEY,
  SUPABASE_SESSION_KEY,
  SUPABASE_URL,
} from "./supabase-config.js";

const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;

/**
 * @typedef {{
 *   access_token: string,
 *   refresh_token: string,
 *   expires_in: number,
 *   expires_at?: number,
 *   token_type: string,
 *   user: Record<string, unknown>
 * }} SupabaseSession
 */

/**
 * @param {SupabaseSession} session
 * @returns {SupabaseSession}
 */
function withExpiry(session) {
  if (session.expires_at) return session;
  const expiresAt = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  return { ...session, expires_at: expiresAt };
}

/**
 * @returns {Promise<SupabaseSession | null>}
 */
export async function loadStoredSession() {
  const stored = await chrome.storage.local.get(SUPABASE_SESSION_KEY);
  const session = stored[SUPABASE_SESSION_KEY];
  if (!session || typeof session !== "object") return null;
  if (!session.access_token || !session.refresh_token) return null;
  return /** @type {SupabaseSession} */ (session);
}

/**
 * @param {SupabaseSession | null} session
 * @returns {Promise<void>}
 */
export async function saveStoredSession(session) {
  if (!session) {
    await chrome.storage.local.remove(SUPABASE_SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({ [SUPABASE_SESSION_KEY]: withExpiry(session) });
}

/**
 * @param {Response} response
 * @returns {Promise<never>}
 */
async function throwAuthError(response) {
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    message =
      body.msg ||
      body.error_description ||
      body.message ||
      body.error ||
      message;
  } catch {
    // ignore parse errors
  }
  throw new Error(String(message));
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function authFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SUPABASE_ANON_KEY);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${AUTH_BASE}${path}`, {
    ...init,
    headers,
  });
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<SupabaseSession>}
 */
export async function signUp(email, password) {
  const response = await authFetch("/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) await throwAuthError(response);

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(
      "Account created but email confirmation is required. Turn off Confirm email in Supabase Auth settings, then sign in."
    );
  }

  const session = withExpiry(/** @type {SupabaseSession} */ (data));
  await saveStoredSession(session);
  return session;
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<SupabaseSession>}
 */
export async function signIn(email, password) {
  const response = await authFetch("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) await throwAuthError(response);

  const session = withExpiry(/** @type {SupabaseSession} */ (await response.json()));
  await saveStoredSession(session);
  return session;
}

/**
 * @param {string} refreshToken
 * @returns {Promise<SupabaseSession>}
 */
export async function refreshSession(refreshToken) {
  const response = await authFetch("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) await throwAuthError(response);

  const session = withExpiry(/** @type {SupabaseSession} */ (await response.json()));
  await saveStoredSession(session);
  return session;
}

/**
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * @param {string} accessToken
 * @returns {boolean}
 */
function shouldRefreshAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return true;

  const now = Math.floor(Date.now() / 1000);
  const issuedAt = Number(payload.iat || 0);
  const expiresAt = Number(payload.exp || 0);

  if (expiresAt && expiresAt - now <= 60) return true;
  // Token looks issued in the future — common when the device clock was ahead.
  if (issuedAt && issuedAt - now > 10) return true;
  return false;
}

/**
 * @param {string} message
 * @param {number} [status]
 */
export function isRecoverableAuthError(message, status = 0) {
  const text = String(message || "").toLowerCase();
  return (
    status === 401 ||
    text.includes("jwt") ||
    (text.includes("token") && text.includes("expired")) ||
    text.includes("issued at future") ||
    text.includes("invalid claim")
  );
}

/**
 * @returns {Promise<SupabaseSession | null>}
 */
export async function forceRefreshSession() {
  const stored = await loadStoredSession();
  if (!stored?.refresh_token) {
    await saveStoredSession(null);
    return null;
  }

  try {
    return await refreshSession(stored.refresh_token);
  } catch {
    await saveStoredSession(null);
    return null;
  }
}
/**
 * @returns {Promise<SupabaseSession | null>}
 */
export async function getSession() {
  const stored = await loadStoredSession();
  if (!stored) return null;

  const expiresAt = Number(stored.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);
  const needsRefresh =
    expiresAt - now <= 60 || shouldRefreshAccessToken(stored.access_token);

  if (!needsRefresh) return stored;

  return forceRefreshSession();
}

/**
 * @returns {Promise<void>}
 */
export async function signOut() {
  const stored = await loadStoredSession();
  if (stored?.access_token) {
    try {
      await authFetch("/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stored.access_token}`,
        },
      });
    } catch {
      // Clear local session even if remote logout fails.
    }
  }
  await saveStoredSession(null);
}

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}
