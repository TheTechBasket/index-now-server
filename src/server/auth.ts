import { createHmac, timingSafeEqual } from 'node:crypto'

// Colored console helpers — no emoji
export const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

export const COOKIE_NAME = 'indexnow.session'
const SESSION_TTL_MS = 30 * 86_400_000 // 30 days
const WEAK_PASSWORD_MIN_LEN = 12

/**
 * Auth is a simple env-gate: a single admin defined by ADMIN_EMAIL/ADMIN_PASSWORD
 * in .env. Optional — set AUTH_ENABLED=false (or leave both admin vars empty) to
 * disable the login gate entirely.
 *
 * Data is deliberately not tied to any user, so changing ADMIN_EMAIL in .env never
 * touches your sites/URLs — you just pick a new login.
 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim() ?? ''
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

export const authEnabled =
  process.env.AUTH_ENABLED !== 'false' && !!ADMIN_EMAIL && !!ADMIN_PASSWORD

const secret = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET

if (authEnabled && !secret) {
  throw new Error(
    'AUTH_SECRET is required when auth is enabled. Generate one with:\n' +
    '  openssl rand -base64 32',
  )
}

// ---- Weak-password check: warn loudly, never block -------------------------

if (authEnabled && ADMIN_PASSWORD.length < WEAK_PASSWORD_MIN_LEN) {
  console.warn(
    c.yellow('WARNING:') +
      ` Your ADMIN_PASSWORD seems too weak (${ADMIN_PASSWORD.length} chars).\n` +
      `   Use at least ${WEAK_PASSWORD_MIN_LEN} characters with a mix of letters, numbers and symbols.\n` +
      '   We won\'t stop you, but a weak password leaves a public dashboard exposed.\n',
  )
}

// ---- Stateless signed cookie session ---------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', secret!).update(payload).digest('base64url')
}

export function issueSession(email: string): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS })),
  )
  return `${payload}.${sign(payload)}`
}

function verifySafe(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Returns the admin email if the session cookie is valid, else null. */
export function readSession(cookieHeader?: string | null): string | null {
  const match = cookieHeader?.split(';').map((s) => s.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
  if (!match) return null
  const token = match.slice(COOKIE_NAME.length + 1)
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  if (!verifySafe(sig, sign(payload))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email: string
      exp: number
    }
    if (!data.email || data.exp < Date.now()) return null
    return data.email
  } catch {
    return null
  }
}

/** Constant-time email+password check against the .env admin. */
export function checkCredentials(email: string, password: string): boolean {
  if (!authEnabled) return true
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false
  const emailOk = verifySafe(email, ADMIN_EMAIL)
  const passOk = verifySafe(password, ADMIN_PASSWORD)
  return emailOk && passOk
}

// ---- HTTP bits --------------------------------------------------------------

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000),
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

export const clearSessionCookie = (secure: boolean) =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`