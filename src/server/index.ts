import './env.ts'
import { c } from './auth.ts'
import { startCron } from './cron.ts'
import { buildApp } from './app.ts'

const port = Number(process.env.PORT ?? 3020)

const server = await buildApp()

const dev = process.env.NODE_ENV !== 'production'
server.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/hook')) {
    return reply.code(404).send({ error: 'Not found' })
  }
  const accept = req.headers.accept ?? ''
  if (accept.includes('text/html')) {
    const { getGithubStats } = await import('./github.ts')
    const { appVersion } = await import('./version.ts')
    const { DRY_RUN } = await import('./indexnow.ts')
    const { authEnabled } = await import('./auth.ts')
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
