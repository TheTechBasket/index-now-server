import './env.ts'
import { resolve } from 'node:path'
import compress from '@fastify/compress'
import fastifyView from '@fastify/view'
import ejs from 'ejs'
import Fastify from 'fastify'
import {
  authEnabled,
  c,
  checkCredentials,
  clearSessionCookie,
  issueSession,
  readSession,
  sessionCookie,
} from './auth.ts'
import { startCron } from './cron.ts'
import { apiRoutes, publicRoutes } from './routes/api.ts'
import { pageRoutes } from './routes/pages.ts'

const port = Number(process.env.PORT ?? 3020)

const server = Fastify({
  logger: { level: 'warn' },
})

await server.register(compress)

const dev = process.env.NODE_ENV !== 'production'
const viewsDir = resolve(import.meta.dirname, 'views')
await server.register(fastifyView, {
  engine: { ejs },
  root: viewsDir,
  layout: 'layouts/main.ejs',
  defaultContext: {},
  options: { cache: !dev },
})

// Simple env-gate auth: login/logout. When authEnabled is false these are inert.
const secure = process.env.NODE_ENV === 'production'
server.post('/api/auth/login', async (req, reply) => {
  if (!authEnabled) return reply.code(403).send({ error: 'Auth is disabled' })
  const body = req.body as { email?: string; password?: string }
  if (!checkCredentials(body?.email ?? '', body?.password ?? '')) {
    return reply.code(401).send({ error: 'Invalid email or password' })
  }
  reply.header('set-cookie', sessionCookie(issueSession(body.email!), secure))
  return { ok: true }
})

server.post('/api/auth/logout', async (_req, reply) => {
  reply.header('set-cookie', clearSessionCookie(secure))
  return { ok: true }
})

server.get('/api/auth/session', async (req, reply) => {
  const email = readSession(req.headers.cookie)
  if (!authEnabled) return { authenticated: true, email: null, authEnabled: false }
  if (!email) return reply.code(401).send({ authenticated: false, email: null, authEnabled: true })
  return { authenticated: true, email, authEnabled: true }
})

await server.register(apiRoutes, { prefix: '/api' })
await server.register(publicRoutes)
await server.register(pageRoutes)

server.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/hook')) {
    return reply.code(404).send({ error: 'Not found' })
  }
  const accept = req.headers.accept ?? ''
  if (accept.includes('text/html')) {
    const { getGithubStats } = await import('./github.ts')
    const { appVersion } = await import('./version.ts')
    const { DRY_RUN } = await import('./indexnow.ts')
    return reply.code(404).view('pages/not-found.ejs', {
      title: 'Not Found',
      version: appVersion,
      gh: await getGithubStats(),
      authEnabled,
      devMode: dev,
      dryRun: DRY_RUN,
    } as Record<string, unknown>)
  }
  return reply.code(404).send({ error: 'Not found' })
})

startCron()

await server.listen({ port, host: '0.0.0.0' })

const address = server.addresses()[0]
const host = address.address === '0.0.0.0' || address.address === '::' ? 'localhost' : address.address
console.log(c.green('IndexNow Server running at') + ` http://${host}:${address.port}\n`)
