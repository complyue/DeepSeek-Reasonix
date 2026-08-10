package cli

import (
	"errors"
	"flag"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"

	"reasonix/internal/config"
	"reasonix/internal/i18n"
)

func configSnipRatioCommand(args []string) int {
	fs := flag.NewFlagSet("config snip-ratio", flag.ContinueOnError)
	local := fs.Bool("local", false, "write ./reasonix.toml instead of the user config")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	rest := fs.Args()
	if len(rest) > 1 {
		configSnipRatioUsage()
		return 2
	}
	if len(rest) == 0 {
		cfg, err := config.LoadForRootReadOnly(".")
		if err != nil {
			fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
			return 1
		}
		fmt.Printf("tool_result_snip_ratio = %s (%s)\n", formatCompactRatioPercent(cfg.Agent.ToolResultSnipRatio), snipRatioSource())
		return 0
	}
	percent, err := strconv.ParseFloat(strings.TrimSpace(rest[0]), 64)
	if err != nil || math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 5 || percent > 95 {
		fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, "tool result snip ratio must be a percentage between 5 and 95")
		return 2
	}
	ratio := percent / 100
	path := config.UserConfigPath()
	scope := "user"
	if *local {
		path = "reasonix.toml"
		scope = "project"
	}
	if path == "" {
		fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, "cannot resolve config path")
		return 1
	}
	unlock, err := config.LockConfigFileEdits(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
		return 1
	}
	defer unlock()
	if *local {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			saved, err := config.SaveMinimalProjectSnipRatio(path, ratio)
			if err != nil {
				fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
				return 1
			}
			fmt.Printf("tool_result_snip_ratio = %s (%s: %s)\n", formatCompactRatioPercent(saved), scope, displayPath(path))
			return 0
		} else if err != nil {
			fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
			return 1
		}
	}
	cfg, err := config.LoadForEditReadOnlyStrict(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
		return 1
	}
	if err := cfg.SetToolResultSnipRatio(ratio); err != nil {
		fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
		return 2
	}
	if err := cfg.SaveTo(path); err != nil {
		fmt.Fprintln(os.Stderr, i18n.M.ErrorPrefix, err)
		return 1
	}
	fmt.Printf("tool_result_snip_ratio = %s (%s: %s)\n", formatCompactRatioPercent(cfg.Agent.ToolResultSnipRatio), scope, displayPath(path))
	return 0
}

func snipRatioSource() string {
	if config.ConfigFileDefinesSnipRatio("reasonix.toml") {
		return "project: " + displayPath("reasonix.toml")
	}
	if path := config.UserConfigPath(); path != "" && config.ConfigFileDefinesSnipRatio(path) {
		return "user: " + displayPath(path)
	}
	return "built-in default"
}

func configSnipRatioUsage() {
	fmt.Print(`Usage:
  reasonix config snip-ratio [--local] [5..95]
`)
}

func configCompactRatioUsage() {
	fmt.Print(`Usage:
  reasonix config compact-ratio [--local] [10..95]
`)
}
