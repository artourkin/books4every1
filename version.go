package folio

import (
	_ "embed"
	"strings"
)

//go:embed VERSION
var sourceVersion string

// Release builds set these with linker flags; source builds use VERSION.
var releaseVersion string
var Revision = "unknown"
var BuiltAt = "unknown"

func Version() string {
	if releaseVersion != "" {
		return releaseVersion
	}
	return strings.TrimSpace(sourceVersion)
}
