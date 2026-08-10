import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api, type Site, type Submission } from '@/lib/api'

const statusVariant = {
  success: 'default',
  no_changes: 'secondary',
  error: 'destructive',
} as const

export function LogDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const [rows, setRows] = useState<Submission[] | null>(null)

  useEffect(() => {
    if (!site) return
    setRows(null)
    api<Submission[]>(`/sites/${site.id}/submissions`).then(setRows).catch(() => setRows([]))
  }, [site])

  return (
    <Dialog open={!!site} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-w-3xl">
        <DialogHeader>
          <DialogTitle>Submission Log — {site?.name}</DialogTitle>
          <DialogDescription>Last 50 submission runs for {site?.host}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[28rem] overflow-y-auto rounded-md border">
          {rows?.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-44 text-xs font-semibold">When</TableHead>
                  <TableHead className="w-24 text-xs font-semibold">Trigger</TableHead>
                  <TableHead className="w-16 text-xs font-semibold">URLs</TableHead>
                  <TableHead className="w-28 text-xs font-semibold">Status</TableHead>
                  <TableHead className="text-xs font-semibold">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows?.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs font-medium capitalize">{row.trigger}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{row.urlCount}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[row.status]} className="text-[10px] font-semibold uppercase">
                        {row.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={row.detail ?? ''}>
                      {row.detail ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
