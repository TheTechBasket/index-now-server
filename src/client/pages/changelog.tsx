import { Bug, Plus, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Layout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type ChangelogResponse } from '@/lib/api'

const SECTION_ICON: Record<string, typeof Bug> = {
  fixed: Bug,
  performance: Zap,
  perf: Zap,
  added: Plus,
}

const SECTION_LABEL: Record<string, string> = {
  fixed: 'Fixed',
  performance: 'Performance',
  perf: 'Performance',
  added: 'Added',
}

function highlight(item: string) {
  return /docker/i.test(item) ? `🐳 ${item}` : item
}

export function ChangelogPage() {
  const [data, setData] = useState<ChangelogResponse | null>(null)

  useEffect(() => {
    api<ChangelogResponse>('/changelog')
      .then(setData)
      .catch((err) => toast.error(err.message))
  }, [])

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Changelog</h1>
        <p className="text-sm text-muted-foreground">Fixes, performance improvements, and new features, release by release.</p>
      </div>

      {data && data.curated.length === 0 && (
        <p className="text-sm text-muted-foreground">No fix, performance, or feature entries yet.</p>
      )}

      <div className="space-y-4">
        {data?.curated.map((entry) => (
          <Card key={entry.version}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                v{entry.version}
                {entry.version === data.version && (
                  <Badge variant="default" className="h-4 px-1.5 text-[10px] font-normal">current</Badge>
                )}
              </CardTitle>
              <span className="text-xs text-muted-foreground">{entry.date}</span>
            </CardHeader>
            <CardContent className="space-y-3">
              {entry.sections.map((section) => {
                const key = section.heading.toLowerCase()
                const Icon = SECTION_ICON[key] ?? Plus
                return (
                  <div key={section.heading}>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Icon className="size-3.5" aria-hidden />
                      {SECTION_LABEL[key] ?? section.heading}
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {section.items.map((item) => (
                        <li key={item}>{highlight(item)}</li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  )
}
