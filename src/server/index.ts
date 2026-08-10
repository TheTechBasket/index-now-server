import './env.ts'
import { resolve } from 'node:path'
import FastifyVite from '@fastify/vite'
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

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3020)

const server = Fastify({
  logger: { level: 'warn' },
})

await server.register(FastifyVite, {
  root: resolve(import.meta.dirname, '../..'),
  dev,
  spa: true,
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

server.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/hook')) {
    return reply.code(404).send({ error: 'Not found' })
  }
  const accept = req.headers.accept ?? ''
  if (accept.includes('text/html')) {
    return reply.html()
  }
  return reply.code(404).send({ error: 'Not found' })
})

await server.vite.ready()
startCron()

await server.listen({ port, host: '0.0.0.0' })

const address = server.addresses()[0]
const host = address.address === '0.0.0.0' || address.address === '::' ? 'localhost' : address.address
console.log(c.green('IndexNow Server running at') + ` http://${host}:${address.port}\n`)
