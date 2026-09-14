import { resolve } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { authEnabled, readSession } from '../auth.ts'
import { curatedChangelog } from '../changelog.ts'
import { getCronProgress, nextRunFor } from '../cron.ts'
import { db } from '../db/index.ts'
import { settings, sites, siteUrls, submissions } from '../db/schema.ts'
import { getGithubStats } from '../github.ts'
import {
  DRY_RUN,
  latestSubmissionsForSites,
  mismatchCountsForSites,
  urlCountsForSites,
} from '../indexnow.ts'
import { EVENT_KEYS } from '../notify.ts'
import { appVersion } from '../version.ts'
import { eq, sql } from 'drizzle-orm'

const dev = process.env.NODE_ENV !== 'production'

async function layoutLocals() {
  const gh = await getGithubStats()
  return {
    version: appVersion,
    gh,
    authEnabled,
    devMode: dev,
    dryRun: DRY_RUN,
  }
}

function getDashboardData() {
  const all = db.select().from(sites).all()
  const ids = all.map((s) => s.id)
  const lastBySite = latestSubmissionsForSites(ids)
  const countsBySite = urlCountsForSites(ids)
  const mismatchBySite = mismatchCountsForSites(ids)
  const enriched = all.map((site) => ({
    ...site,
    lastSubmission: lastBySite.get(site.id) ?? null,
    urlCounts: countsBySite.get(site.id) ?? { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 },
    nextRunAt: site.submissionLevel === 'scheduled' ? nextRunFor(site.cronInterval) : null,
    mismatchedCount: mismatchBySite.get(site.id) ?? 0,
  }))
  const cron = getCronProgress()
  const stats = {
    total: enriched.length,
    verified: enriched.filter((s) => s.keyVerified).length,
    unverified: enriched.filter((s) => !s.keyVerified).length,
    pending: enriched.reduce((sum, s) => sum + s.urlCounts.pending, 0),
    urls: enriched.reduce((sum, s) => sum + s.urlCounts.total, 0),
    errors: enriched.filter((s) => s.lastSubmission?.status === 'error').length,
  }
  return { sites: enriched, cron: cron.interval ? cron : null, stats }
}

function getSettingsData() {
  const row = db.select().from(settings).get()
  return {
    discordConfigured: !!row?.discordWebhookUrl,
    discordWebhookUrl: row?.discordWebhookUrl ?? '',
    events: row?.events ?? [],
    eventKeys: EVENT_KEYS,
    webhookSecret: row?.webhookSecret ?? null,
  }
}

export async function pageRoutes(app: FastifyInstance) {
  const distDir = resolve(import.meta.dirname, '../../..', 'dist')
  const clientAssetsDir = resolve(import.meta.dirname, '../../client/assets')
  await app.register(fastifyStatic, {
    root: [distDir, clientAssetsDir],
    prefix: '/assets/',
    decorateReply: false,
  })

  function requireAuth(req: { headers: { cookie?: string } }): string | null {
    if (!authEnabled) return null
    const email = readSession(req.headers.cookie)
    if (!email) return '/login'
    return null
  }

  app.get('/', async (req, reply) => {
    const redirect = requireAuth(req)
    if (redirect) return reply.redirect(redirect)
    const locals = await layoutLocals()
    const dashboard = getDashboardData()
    return reply.view('pages/dashboard.ejs', {
      ...locals,
      title: 'Sites',
      sites: dashboard.sites,
      cron: dashboard.cron,
      stats: dashboard.stats,
    })
  })

  app.get('/site/:id', async (req, reply) => {
    const redirect = requireAuth(req)
    if (redirect) return reply.redirect(redirect)
    const locals = await layoutLocals()
    const { id } = req.params as { id: string }
    const site = db.select().from(sites).where(eq(sites.id, id)).get()
    if (!site) return reply.code(404).view('pages/not-found.ejs', { ...locals, title: 'Not Found' })
    return reply.view('pages/site-urls.ejs', { ...locals, title: site.name, siteId: id, siteName: site.name })
  })

  app.get('/settings', async (req, reply) => {
    const redirect = requireAuth(req)
    if (redirect) return reply.redirect(redirect)
    const locals = await layoutLocals()
    const settingsData = getSettingsData()
    return reply.view('pages/settings.ejs', { ...locals, title: 'Settings', settings: settingsData })
  })

  app.get('/changelog', async (req, reply) => {
    const redirect = requireAuth(req)
    if (redirect) return reply.redirect(redirect)
    const locals = await layoutLocals()
    const changelog = curatedChangelog()
    return reply.view('pages/changelog.ejs', { ...locals, title: 'Changelog', changelog })
  })

  app.get('/login', async (req, reply) => {
    if (!authEnabled) return reply.redirect('/')
    const email = readSession(req.headers.cookie)
    if (email) return reply.redirect('/')
    return reply.view('pages/login.ejs', {
      version: appVersion,
      gh: null,
      authEnabled: false,
      devMode: dev,
      dryRun: DRY_RUN,
      title: 'Sign in',
    })
  })
}
