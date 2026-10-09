.DEFAULT_GOAL := package

.PHONY: package

# Builds the extension and creates a VSIX using the version in package.json.
package:
	npx --yes @vscode/vsce@latest package --no-dependencies
