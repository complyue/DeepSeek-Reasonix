package main

import "reasonix/internal/provider"

// estimatePromptTokens approximates prompt tokens for a provider transcript.
// The resume guard uses it to warn before restoring a session that already
// exceeds the compact threshold; it is not a provider usage figure.
func estimatePromptTokens(msgs []provider.Message) int {
	chars := 0
	for _, m := range msgs {
		chars += len(m.Content) + len(m.RawContent) + len(m.ReasoningContent)
		for _, tc := range m.ToolCalls {
			chars += len(tc.Name) + len(tc.Arguments)
		}
	}
	return int(float64(chars) * 0.25)
}

// estimateHistoryTokens approximates prompt tokens for a display-message list.
func estimateHistoryTokens(messages []HistoryMessage) int {
	chars := 0
	for _, m := range messages {
		chars += len(m.Content) + len(m.Detail) + len(m.Reasoning) + len(m.Summary)
		for _, tc := range m.ToolCalls {
			chars += len(tc.Name) + len(tc.Arguments)
		}
	}
	return int(float64(chars) * 0.25)
}
