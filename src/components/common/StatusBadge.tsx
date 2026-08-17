import type { ProjectStatus } from '@/lib/types'

const labels: Record<ProjectStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
  abandoned: 'Abandoned',
  archived: 'Archived',
}

interface StatusBadgeProps {
  status: ProjectStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${status}`}>{labels[status]}</span>
}
