// Benchmark driver for IndexNow Server. Plain Node, zero dependencies.
// Talks to an already-running server over HTTP.
//
// Usage:
//   node bench/bench.mjs --base http://127.0.0.1:3020 --out bench/results/baseline.json \
//     [--label pi-1cpu-1gb] [--scale 1]

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const base = arg('base')
const outPath = arg('out')
const label = arg('label', 'unlabeled')
const scale = Number(arg('scale', '1'))
if (!base || !outPath) {
  console.error('usage: node bench/bench.mjs --base URL --out FILE [--label L] [--scale N]')
  process.exit(2)
}

// ---------- HTTP helpers ----------

async function api(urlPath, init = {}) {
  const res = await fetch(base + urlPath, init)
  return res
}

async function apiJson(urlPath) {
  const res = await api(urlPath)
  if (!res.ok) throw new Error(`${urlPath}: HTTP ${res.status}`)
  return res.json()
}

// ---------- measurement ----------

const phases = []

function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

async function phase(name, n, fn, { concurrency = 1 } = {}) {
  const samples = []
  let errors = 0
  const startedEpochMs = Date.now()
  const started = process.hrtime.bigint()
  if (concurrency === 1) {
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime.bigint()
      try {
        await fn(i)
      } catch (e) {
        errors++
        if (errors > n * 0.05) throw new Error(`phase ${name}: >5% errors, last: ${e.message}`)
      }
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
  } else {
    let next = 0
    async function worker() {
      while (next < n) {
        const i = next++
        const t0 = process.hrtime.bigint()
        try {
          await fn(i)
        } catch {
          errors++
        }
        samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  }
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6
  samples.sort((a, b) => a - b)
  const row = {
    name,
    count: n,
    concurrency,
    errors,
    start_epoch_ms: startedEpochMs,
    end_epoch_ms: Date.now(),
    total_ms: Math.round(totalMs * 10) / 10,
    ops_per_sec: Math.round((n / totalMs) * 1000 * 10) / 10,
    avg_ms: Math.round((totalMs / n) * 100) / 100,
    p50_ms: Math.round(percentile(samples, 50) * 100) / 100,
    p95_ms: Math.round(percentile(samples, 95) * 100) / 100,
    p99_ms: Math.round(percentile(samples, 99) * 100) / 100,
    max_ms: Math.round(samples[samples.length - 1] * 100) / 100,
  }
  phases.push(row)
  console.error(`  ${name}: ${row.ops_per_sec} ops/s, avg ${row.avg_ms}ms, p50 ${row.p50_ms}ms, p95 ${row.p95_ms}ms, p99 ${row.p99_ms}ms, errors ${errors}`)
  return row
}

function expectOk(res) {
  if (!res.ok) throw new Error(`unexpected status ${res.status}`)
  return res
}

async function probeEndpoint(urlPath) {
  try {
    const res = await api(urlPath)
    return res.ok
  } catch {
    return false
  }
}

// ---------- main ----------

const N = (n) => Math.max(1, Math.round(n * scale))

async function main() {
  const t0 = Date.now()

  // Discover sites for targeted queries
  const sitesRes = await apiJson('/api/sites')
  const allSites = Array.isArray(sitesRes) ? sitesRes : []
  if (allSites.length === 0) throw new Error('No sites found, seed the database first')
  const siteId = allSites[0].id
  const biggestSite = allSites.reduce((a, b) => (b.urlCounts?.total ?? 0) > (a.urlCounts?.total ?? 0) ? b : a, allSites[0])
  console.error(`Found ${allSites.length} sites. Using "${allSites[0].name}" (id: ${siteId}) for single-site tests`)
  console.error(`Biggest site: "${biggestSite.name}" with ${biggestSite.urlCounts?.total ?? 0} URLs`)

  const hasVersion = await probeEndpoint('/api/version')
  const hasCronStatus = await probeEndpoint('/api/cron/status')
  const hasSingleSite = await probeEndpoint(`/api/sites/${siteId}`)
  const hasChangelog = await probeEndpoint('/api/changelog')

  if (hasVersion) {
    await phase('version', N(200), async () => {
      expectOk(await api('/api/version'))
    })
  }

  await phase('settings_read', N(100), async () => {
    expectOk(await api('/api/settings'))
  })

  if (hasCronStatus) {
    await phase('cron_status', N(200), async () => {
      expectOk(await api('/api/cron/status'))
    })
  }

  await phase('dashboard_load', N(50), async () => {
    expectOk(await api('/api/sites'))
  })

  if (hasSingleSite) {
    await phase('single_site', N(100), async () => {
      expectOk(await api(`/api/sites/${siteId}`))
    })
  }

  await phase('site_urls_page', N(50), async () => {
    expectOk(await api(`/api/sites/${biggestSite.id}/urls?limit=100&offset=0`))
  })

  await phase('site_urls_filtered', N(50), async () => {
    expectOk(await api(`/api/sites/${biggestSite.id}/urls?status=new&limit=100&offset=0`))
  })

  await phase('site_urls_search', N(30), async () => {
    expectOk(await api(`/api/sites/${biggestSite.id}/urls?q=bench&limit=100&offset=0`))
  })

  await phase('site_submissions', N(100), async () => {
    expectOk(await api(`/api/sites/${siteId}/submissions`))
  })

  if (hasChangelog) {
    await phase('changelog', N(50), async () => {
      expectOk(await api('/api/changelog'))
    })
  }

  await phase('concurrent_dashboard_10', N(30), async () => {
    expectOk(await api('/api/sites'))
  }, { concurrency: 10 })

  if (hasSingleSite) {
    await phase('concurrent_single_site_10', N(100), async () => {
      const s = allSites[Math.floor(Math.random() * allSites.length)]
      expectOk(await api(`/api/sites/${s.id}`))
    }, { concurrency: 10 })
  }

  await phase('site_urls_deep_page', N(20), async () => {
    expectOk(await api(`/api/sites/${biggestSite.id}/urls?limit=100&offset=50000`))
  })

  // Page render benchmarks (SSR HTML responses)
  await phase('page_dashboard', N(50), async () => {
    expectOk(await api('/'))
  })

  await phase('page_site_urls', N(50), async () => {
    expectOk(await api(`/site/${siteId}`))
  })

  await phase('page_settings', N(50), async () => {
    expectOk(await api('/settings'))
  })

  await phase('page_changelog', N(50), async () => {
    expectOk(await api('/changelog'))
  })

  const result = {
    label,
    base,
    scale,
    url_count: allSites.reduce((sum, s) => sum + (s.urlCounts?.total ?? 0), 0),
    site_count: allSites.length,
    started_at: new Date(t0).toISOString(),
    total_wall_ms: Date.now() - t0,
    driver: `node ${process.version}`,
    phases,
  }
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
  console.error(`\nwrote ${outPath} (${Math.round((Date.now() - t0) / 1000)}s wall)`)
}

main().catch((e) => {
  console.error(`bench failed: ${e.message}`)
  try {
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify({ label, base, failed: e.message, phases }, null, 2) + '\n')
  } catch {}
  process.exit(1)
})
