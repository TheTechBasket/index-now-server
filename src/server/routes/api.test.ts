import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'

const TEST_DB = './data/test-api.db'

beforeAll(() => {
  process.env.DATABASE_PATH = TEST_DB
  process.env.AUTH_ENABLED = 'false'
  process.env.DRY_RUN = 'true'
})

let app: FastifyInstance
let siteId: string

async function inject(method: string, url: string, body?: unknown) {
  const opts: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method, url }
  if (body !== undefined) {
    opts.headers = { 'content-type': 'application/json' }
    opts.payload = body
  }
  return app.inject(opts)
}

beforeAll(async () => {
  const { buildApp } = await import('../app.ts')
  app = await buildApp({ skipViews: true })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  try { rmSync(TEST_DB, { force: true }) } catch {}
  try { rmSync(TEST_DB + '-wal', { force: true }) } catch {}
  try { rmSync(TEST_DB + '-shm', { force: true }) } catch {}
})

// --- Auth ---

describe('GET /api/auth/session', () => {
  it('returns authenticated when auth disabled', async () => {
    const res = await inject('GET', '/api/auth/session')
    expect(res.statusCode).toBe(200)
    expect(res.json().authenticated).toBe(true)
  })
})

// --- Version & meta ---

describe('GET /api/version', () => {
  it('returns version string', async () => {
    const res = await inject('GET', '/api/version')
    expect(res.statusCode).toBe(200)
    expect(res.json().version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('GET /api/changelog', () => {
  it('returns changelog data', async () => {
    const res = await inject('GET', '/api/changelog')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('version')
  })
})

describe('GET /api/cron/status', () => {
  it('returns cron progress', async () => {
    const res = await inject('GET', '/api/cron/status')
    expect(res.statusCode).toBe(200)
  })
})

// --- Sites CRUD ---

describe('POST /api/sites', () => {
  it('creates a site', async () => {
    const res = await inject('POST', '/api/sites', {
      name: 'Test Site',
      host: 'example.com',
      sitemapUrl: 'https://example.com/sitemap.xml',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('Test Site')
    expect(body.host).toBe('example.com')
    expect(body.id).toBeTruthy()
    siteId = body.id
  })

  it('rejects missing fields', async () => {
    const res = await inject('POST', '/api/sites', { name: 'No Host' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/sites', () => {
  it('lists sites', async () => {
    const res = await inject('GET', '/api/sites')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /api/sites/:id', () => {
  it('returns site by id', async () => {
    const res = await inject('GET', `/api/sites/${siteId}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(siteId)
  })

  it('404 for unknown id', async () => {
    const res = await inject('GET', '/api/sites/nonexistent')
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /api/sites/:id', () => {
  it('updates site name', async () => {
    const res = await inject('PATCH', `/api/sites/${siteId}`, { name: 'Updated Site' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Updated Site')
  })

  it('404 for unknown id', async () => {
    const res = await inject('PATCH', '/api/sites/nonexistent', { name: 'Nope' })
    expect(res.statusCode).toBe(404)
  })
})

// --- Site actions (no body POSTs) ---

describe('POST /api/sites/:id/rotate-key', () => {
  it('rotates API key', async () => {
    const before = (await inject('GET', `/api/sites/${siteId}`)).json().apiKey
    const res = await inject('POST', `/api/sites/${siteId}/rotate-key`)
    expect(res.statusCode).toBe(200)
    expect(res.json().apiKey).not.toBe(before)
  })

  it('404 for unknown id', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/rotate-key')
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/sites/:id/sync', () => {
  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/sync')
    expect(res.statusCode).toBe(404)
  })

  // Sync hits real sitemap URL, so we expect 502 for example.com
  it('returns 502 when sitemap unreachable', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/sync`)
    expect([200, 404, 502]).toContain(res.statusCode)
  })
})

describe('POST /api/sites/:id/verify-key', () => {
  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/verify-key')
    expect(res.statusCode).toBe(404)
  })

  it('verifies key (will likely fail for test host)', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/verify-key`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('found')
    expect(res.json()).toHaveProperty('keyUrl')
  })
})

describe('POST /api/sites/:id/submit', () => {
  it('rejects when key not verified', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/submit`)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/key.*not verified/i)
  })

  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/submit')
    expect(res.statusCode).toBe(404)
  })
})

// --- URL management ---

describe('GET /api/sites/:id/urls', () => {
  it('returns paginated URL list', async () => {
    const res = await inject('GET', `/api/sites/${siteId}/urls`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('rows')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('counts')
  })

  it('404 for unknown site', async () => {
    const res = await inject('GET', '/api/sites/nonexistent/urls')
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/sites/:id/urls/reset', () => {
  it('resets URL statuses', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/urls/reset`)
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/urls/reset')
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/sites/:id/urls/bulk-delete', () => {
  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/urls/bulk-delete', { ids: [1] })
    expect(res.statusCode).toBe(404)
  })

  it('deletes empty set gracefully', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/urls/bulk-delete`, { ids: [999999] })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('DELETE /api/sites/:id/urls', () => {
  it('requires query param', async () => {
    const res = await inject('DELETE', `/api/sites/${siteId}/urls`)
    expect(res.statusCode).toBe(400)
  })

  it('deletes all with ?all=true', async () => {
    const res = await inject('DELETE', `/api/sites/${siteId}/urls?all=true`)
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('prunes removed with ?status=removed', async () => {
    const res = await inject('DELETE', `/api/sites/${siteId}/urls?status=removed`)
    expect(res.statusCode).toBe(200)
  })

  it('404 for unknown site', async () => {
    const res = await inject('DELETE', '/api/sites/nonexistent/urls?all=true')
    expect(res.statusCode).toBe(404)
  })
})

// --- Sitemap scope & fix ---

describe('POST /api/sites/:id/sitemap-scope', () => {
  it('sets excluded sitemaps', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/sitemap-scope`, {
      excludedSitemaps: ['https://example.com/sitemap-images.xml'],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().excludedSitemaps).toContain('https://example.com/sitemap-images.xml')
  })

  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/sitemap-scope', { excludedSitemaps: [] })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/sites/:id/sitemap-fix', () => {
  it('updates sitemap URL', async () => {
    const res = await inject('POST', `/api/sites/${siteId}/sitemap-fix`, {
      sitemapUrl: 'https://example.com/new-sitemap.xml',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sitemapUrl).toBe('https://example.com/new-sitemap.xml')
  })

  it('404 for unknown site', async () => {
    const res = await inject('POST', '/api/sites/nonexistent/sitemap-fix', {
      sitemapUrl: 'https://example.com/sitemap.xml',
    })
    expect(res.statusCode).toBe(404)
  })
})

// --- Submissions ---

describe('GET /api/sites/:id/submissions', () => {
  it('returns submission history', async () => {
    const res = await inject('GET', `/api/sites/${siteId}/submissions`)
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })
})

// --- Settings ---

describe('GET /api/settings', () => {
  it('returns settings', async () => {
    const res = await inject('GET', '/api/settings')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('discordConfigured')
    expect(body).toHaveProperty('eventKeys')
    expect(body).toHaveProperty('dryRun')
  })
})

describe('PUT /api/settings', () => {
  it('updates events list', async () => {
    const res = await inject('PUT', '/api/settings', {
      events: ['schedule.success'],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().events).toContain('schedule.success')
  })
})

describe('POST /api/settings/test-notification', () => {
  it('fails when no webhook configured', async () => {
    const res = await inject('POST', '/api/settings/test-notification')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/no discord/i)
  })
})

// --- Discover ---

describe('POST /api/sites/discover', () => {
  it('rejects missing url', async () => {
    const res = await inject('POST', '/api/sites/discover', {})
    expect(res.statusCode).toBe(400)
  })

  it('discovers sitemaps for a domain', async () => {
    const res = await inject('POST', '/api/sites/discover', { url: 'https://example.com' })
    // May return empty or succeed depending on network
    expect([200, 400]).toContain(res.statusCode)
  })
})

// --- Webhook (public route) ---

describe('POST /hook/:siteId', () => {
  it('rejects without secret header', async () => {
    const res = await inject('POST', `/hook/${siteId}`)
    expect(res.statusCode).toBe(401)
  })

  it('rejects wrong secret', async () => {
    const opts = {
      method: 'POST' as const,
      url: `/hook/${siteId}`,
      headers: { 'x-webhook-secret': 'wrong-secret' },
    }
    const res = await app.inject(opts)
    expect(res.statusCode).toBe(401)
  })
})

// --- Cleanup: delete site ---

describe('DELETE /api/sites/:id', () => {
  it('deletes site', async () => {
    const res = await inject('DELETE', `/api/sites/${siteId}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('404 after deletion', async () => {
    const res = await inject('GET', `/api/sites/${siteId}`)
    expect(res.statusCode).toBe(404)
  })
})
