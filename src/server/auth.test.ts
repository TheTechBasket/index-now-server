import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const SECRET = 'test-secret-that-is-long-enough-12345'

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET
  process.env.AUTH_ENABLED = 'true'
  process.env.ADMIN_EMAIL = 'admin@test.com'
  process.env.ADMIN_PASSWORD = 'a-strong-password-123!'
  // Re-import with fresh env
  vi.resetModules()
})

afterEach(() => {
  delete process.env.AUTH_SECRET
  delete process.env.AUTH_ENABLED
  delete process.env.ADMIN_EMAIL
  delete process.env.ADMIN_PASSWORD
})

async function loadAuth() {
  return await import('./auth.ts')
}

describe('authEnabled', () => {
  it('is true when enabled and admin creds set', async () => {
    const a = await loadAuth()
    expect(a.authEnabled).toBe(true)
  })

  it('is false when AUTH_ENABLED=false', async () => {
    process.env.AUTH_ENABLED = 'false'
    const a = await loadAuth()
    expect(a.authEnabled).toBe(false)
  })

  it('is false when admin creds are empty', async () => {
    process.env.ADMIN_EMAIL = ''
    process.env.ADMIN_PASSWORD = ''
    const a = await loadAuth()
    expect(a.authEnabled).toBe(false)
  })
})

describe('checkCredentials', () => {
  it('accepts matching admin email/password', async () => {
    const a = await loadAuth()
    expect(a.checkCredentials('admin@test.com', 'a-strong-password-123!')).toBe(true)
  })

  it('rejects wrong password', async () => {
    const a = await loadAuth()
    expect(a.checkCredentials('admin@test.com', 'wrong')).toBe(false)
  })

  it('rejects wrong email', async () => {
    const a = await loadAuth()
    expect(a.checkCredentials('nope@test.com', 'a-strong-password-123!')).toBe(false)
  })

  it('always passes when auth is disabled', async () => {
    process.env.AUTH_ENABLED = 'false'
    const a = await loadAuth()
    expect(a.checkCredentials('anything', 'anything')).toBe(true)
  })
})

describe('session cookie', () => {
  it('reads back a valid issued session', async () => {
    const a = await loadAuth()
    const token = a.issueSession('admin@test.com')
    expect(a.readSession(`${a.COOKIE_NAME}=${token}`)).toBe('admin@test.com')
  })

  it('rejects a tampered token', async () => {
    const a = await loadAuth()
    const token = a.issueSession('admin@test.com')
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')
    expect(a.readSession(`${a.COOKIE_NAME}=${tampered}`)).toBeNull()
  })

  it('returns null for a missing cookie', async () => {
    const a = await loadAuth()
    expect(a.readSession(undefined)).toBeNull()
    expect(a.readSession('other=1')).toBeNull()
  })
})
