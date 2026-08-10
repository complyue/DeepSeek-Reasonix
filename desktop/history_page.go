package main

// historyPageFromMessages builds a paged HistoryPage from display messages.
// Unlike the provider-transcript path it has no planner/checkpoint overlays;
// preview and event-record sessions use it.
func historyPageFromMessages(messages []HistoryMessage, beforeTurn, limit int) HistoryPage {
	limit = normalizeHistoryPageLimit(limit)
	totalTurns := 0
	for _, msg := range messages {
		if msg.Role == "user" {
			totalTurns++
		}
	}
	if beforeTurn <= 0 || beforeTurn > totalTurns {
		beforeTurn = totalTurns
	}
	startTurn := max(beforeTurn-limit, 0)
	page := HistoryPage{
		StartTurn:  startTurn,
		EndTurn:    beforeTurn,
		TotalTurns: totalTurns,
		HasOlder:   startTurn > 0,
	}
	if len(messages) == 0 || startTurn >= beforeTurn {
		page.Messages = []HistoryMessage{}
		return page
	}
	page.Messages = historyMessagesForTurnRange(messages, startTurn, beforeTurn)
	page.EstimatedTokens = estimateHistoryTokens(messages)
	return page
}

func historyMessagesForTurnRange(messages []HistoryMessage, startTurn, endTurn int) []HistoryMessage {
	out := make([]HistoryMessage, 0, len(messages))
	turn := -1
	for _, msg := range messages {
		if msg.Role == "user" {
			turn++
		}
		if turn < 0 {
			if startTurn == 0 {
				out = append(out, msg)
			}
			continue
		}
		if turn >= startTurn && turn < endTurn {
			out = append(out, msg)
		}
	}
	return out
}
