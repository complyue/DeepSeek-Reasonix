package config

// ConfigFileDefinesSnipRatio reports whether path explicitly overrides the
// stale-tool-result snip threshold, for the same source-explanation purpose as
// ConfigFileDefinesCompactRatio.
func ConfigFileDefinesSnipRatio(path string) bool {
	return tomlFileDefinesKey(path, "agent", "tool_result_snip_ratio")
}
