$ErrorActionPreference = "Stop"

& npx vitest run tests/unit/journal-migration.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
