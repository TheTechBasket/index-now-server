import { Copy, Download, FileText, Check, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Props = {
  host: string
  apiKey: string
  /** Compact layout (single row) vs detailed (stacked). Default: detailed. */
  compact?: boolean
  /** Optional className on the outer wrapper. */
  className?: string
}

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error('Clipboard unavailable'),
  )
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.success(`Downloaded ${filename}`)
}

/**
 * Surfaces the exact IndexNow key file content for copy-paste / download.
 * File: <apiKey>.txt  containing only the apiKey string.
 */
export function KeyFileHelper({ host, apiKey, compact = false, className }: Props) {
  const filename = `${apiKey}.txt`
  const content = apiKey // IndexNow spec: file body is exactly the key
  const keyUrl = `https://${host}/${filename}`
  const [copiedFile, setCopiedFile] = useState(false)

  async function copyFile() {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedFile(true)
      toast.success('Key file content copied — paste into a new file')
      setTimeout(() => setCopiedFile(false), 1500)
    } catch {
      toast.error('Clipboard unavailable')
    }
  }

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
        <Button size="sm" variant="outline" onClick={copyFile}>
          {copiedFile ? <Check aria-hidden /> : <Copy aria-hidden />} Copy .txt content
        </Button>
        <Button size="sm" variant="outline" onClick={() => download(filename, content)}>
          <Download aria-hidden /> Download
        </Button>
      </div>
    )
  }

  return (
    <div className={`grid gap-3 ${className ?? ''}`}>
      <div className="grid gap-1.5 min-w-0">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium truncate font-mono text-xs" title={filename}>{filename}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs shrink-0"
            onClick={() => copy(filename, 'Filename')}
          >
            <Copy className="mr-1 size-3" aria-hidden /> Name
          </Button>
        </div>
        <p className="text-xs text-muted-foreground break-all">
          Host at <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] break-all">{keyUrl}</code>
        </p>
      </div>

      <div className="grid gap-2">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
            <span className="text-xs font-semibold text-muted-foreground">File Content</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={copyFile}
              >
                {copiedFile ? <CheckCheck className="size-3.5 text-emerald-500" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {copiedFile ? 'Copied' : 'Copy'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => download(filename, content)}
              >
                <Download className="size-3.5" aria-hidden /> Download
              </Button>
            </div>
          </div>
          <pre className="break-all whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground select-all">
            {content}
          </pre>
        </div>
        <p className="text-[11px] text-muted-foreground">
          File body must contain <strong>only</strong> the key string (no newlines, no HTML or quotes).
        </p>
      </div>
    </div>
  )
}
