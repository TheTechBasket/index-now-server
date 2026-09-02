import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CHANGELOG_PATH = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url))

export type ChangelogSection = { heading: string; items: string[] }
export type ChangelogVersion = { version: string; date: string; sections: ChangelogSection[] }

/** Parses CHANGELOG.md's Keep-a-Changelog format (## [x.y.z] - date, ### Heading, - item). */
export function readChangelog(): ChangelogVersion[] {
  let raw: string
  try {
    raw = readFileSync(CHANGELOG_PATH, 'utf-8')
  } catch {
    return []
  }

  const versions: ChangelogVersion[] = []
  for (const block of raw.split(/^## \[/m).slice(1)) {
    const header = block.match(/^([^\]]+)\]\s*-\s*(.+)$/m)
    if (!header) continue
    const sections: ChangelogSection[] = []
    for (const sectionBlock of block.split(/^### /m).slice(1)) {
      const [headingLine, ...rest] = sectionBlock.split('\n')
      const items = rest
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
      if (items.length > 0) sections.push({ heading: headingLine.trim(), items })
    }
    versions.push({ version: header[1].trim(), date: header[2].trim(), sections })
  }
  return versions
}

const CURATED_HEADINGS = new Set(['fixed', 'performance', 'perf', 'added'])

/** Fixes, performance, and new-feature items only — no Changed/Docs/Chore noise. */
export function curatedChangelog(): { version: string; date: string; sections: ChangelogSection[] }[] {
  return readChangelog()
    .map((v) => ({
      version: v.version,
      date: v.date,
      sections: v.sections.filter((s) => CURATED_HEADINGS.has(s.heading.toLowerCase())),
    }))
    .filter((v) => v.sections.length > 0)
}
