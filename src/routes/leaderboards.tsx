import { createFileRoute } from '@tanstack/react-router'

import { SkillMcpLeaderboards } from '#/components/SkillMcpLeaderboards'

export const Route = createFileRoute('/leaderboards')({
  component: LeaderboardsPage,
})

function LeaderboardsPage() {
  return (
    <div className="hud-page flex flex-1 flex-col gap-6 py-14">
      <SkillMcpLeaderboards />
    </div>
  )
}
