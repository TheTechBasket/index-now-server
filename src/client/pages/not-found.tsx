import { Layout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { FileQuestion, Home } from 'lucide-react'

export function NotFoundPage() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20">
          <FileQuestion className="size-8" />
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">404 - Page Not Found</h1>
        <p className="mb-6 max-w-md text-sm text-muted-foreground">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Button asChild className="gap-2">
          <a href="/">
            <Home className="size-4" /> Return to Dashboard
          </a>
        </Button>
      </div>
    </Layout>
  )
}
