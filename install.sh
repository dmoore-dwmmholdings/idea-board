#!/usr/bin/env bash
# Idea Board - Windows installer for bash (Git Bash, MSYS2, Cygwin or WSL on the Windows server).
#
# Run from a terminal opened as Administrator:
#   curl -fsSL https://raw.githubusercontent.com/dmoore-dwmmholdings/idea-board/main/install.sh | bash
#
# It hands off to install.ps1, which does the work. BOARD_PORT, BOARD_ALLOW_FROM, BOARD_UNINSTALL and
# NSSM_URL pass through, e.g.  curl -fsSL .../install.sh | BOARD_PORT=5000 bash
set -euo pipefail

PS1_URL=https://raw.githubusercontent.com/dmoore-dwmmholdings/idea-board/main/install.ps1

# Wrapped in a function so a partial download cannot run half a script.
main() {
  if ! command -v powershell.exe >/dev/null 2>&1; then
    echo "powershell.exe not found. Run this on the Windows server (Git Bash or WSL), not on macOS or Linux." >&2
    exit 1
  fi
  if ! net.exe session >/dev/null 2>&1; then
    echo "Run this from a terminal opened as Administrator (right-click > Run as administrator)." >&2
    exit 1
  fi

  # Inline the settings so they reach PowerShell from WSL too, where env vars do not cross over by default.
  local cmd="[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 'Tls12'; "
  local name value q="'"
  for name in BOARD_PORT BOARD_ALLOW_FROM BOARD_UNINSTALL NSSM_URL; do
    value="${!name:-}"
    if [ -n "$value" ]; then
      value=${value//$q/$q$q}
      cmd+="\$env:$name = '$value'; "
    fi
  done
  cmd+="irm '$PS1_URL' | iex"

  # MSYS_NO_PATHCONV stops Git Bash rewriting the URL; </dev/null keeps PowerShell off the piped script.
  MSYS_NO_PATHCONV=1 exec powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$cmd" </dev/null
}

main "$@"
