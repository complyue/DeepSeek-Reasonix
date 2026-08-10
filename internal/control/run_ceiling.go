package control

import (
	"context"

	"reasonix/internal/agent"
	"reasonix/internal/tool"
)

// chatRunRoundLimit bounds one ordinary chat Run. Crossing it yields one
// tool-free summary and a resumable pause. 0 disables the default ceiling
// entirely (the run loop only caps when runMaxSteps > 0), which this
// personal dev build uses to avoid mid-task pauses.
const (
	chatRunRoundLimit = 0
	chatRunRoundKey   = "chat model rounds"
)

// bindTurnScope installs the turn's Run ceiling and, for a Goal turn, the usage
// recorder whose span stays active until the FSM commits. Ordinary chat had no
// ceiling: max_steps was retired, and the adaptive guards cannot stand in —
// they escalate on repetition and stay silent while a loop keeps finding
// something new. An explicit max_steps still owns either turn.
func (c *Controller) bindTurnScope(ctx context.Context, continuation *goalContinuationSnapshot) context.Context {
	goalScopeID, goalScoped := c.goals.goalScopeIDForTurn(continuation)
	if !goalScoped {
		return agent.WithDefaultRunStepLimit(ctx, chatRunRoundLimit, chatRunRoundKey)
	}
	ctx = agent.WithDefaultRunStepLimit(ctx, goalRunRoundLimit, goalRunRoundKey)
	recorder := c.goals.newTurnRecorder(goalScopeID, c.goals.continuationToken())
	c.goalUsageTee.setActiveRecorder(recorder)
	return tool.WithGoalTurnRecorder(ctx, recorder)
}
