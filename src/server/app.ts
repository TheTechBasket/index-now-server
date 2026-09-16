import { resolve } from 'node:path'
import compress from '@fastify/compress'
import fastifyView from '@fastify/view'
import ejs from 'ejs'
import Fastify from 'fastify'
import {
  authEnabled,
  checkCredentials,
  clearSessionCookie,
  issueSession,
  readSession,
  sessionCookie,
} from './auth.ts'
import { apiRoutes, publicRoutes } from './routes/api.ts'
import { pageRoutes } from './routes/pages.ts'

export async function buildApp(opts: { skipViews?: boolean } = {}) {
  const server = Fastify({ logger: { level: 'warn' } })

  await server.register(compress)

  if (!opts.skipViews) {
    const dev = process.env.NODE_ENV !== 'production'
    const viewsDir = resolve(import.meta.dirname, 'views')
    await server.register(fastifyView, {
      engine: { ejs },
      root: viewsDir,
      layout: 'layouts/main.ejs',
      defaultContext: {},
      options: { cache: !dev },
    })
  }

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
  if (!opts.skipViews) await server.register(pageRoutes)

  return server
}
