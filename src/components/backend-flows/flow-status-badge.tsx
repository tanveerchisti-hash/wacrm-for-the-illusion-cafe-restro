import { Badge } from '@/components/ui/badge'
import type { BackendFlowStatus } from '@/lib/backend-flows/types'

interface FlowStatusBadgeProps {
  status: BackendFlowStatus
  version?: number | null
}

export function FlowStatusBadge({ status, version }: FlowStatusBadgeProps) {
  switch (status) {
    case 'published':
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium"
        >
          Published {version ? `v${version}` : ''}
        </Badge>
      )
    case 'draft':
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-400 font-medium"
        >
          Draft
        </Badge>
      )
    case 'archived':
      return (
        <Badge
          variant="outline"
          className="border-border bg-muted/60 text-muted-foreground font-medium"
        >
          Archived
        </Badge>
      )
  }
}
