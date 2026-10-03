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
PS_ONE_LINER="[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; irm $PS1_URL | iex"

# Stop Git Bash / MSYS2 rewriting arguments such as `/c` into Windows paths.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

# PowerShell takes -EncodedCommand as base64 UTF-16LE, which survives cmd.exe and WSL without quoting trouble.
encode() { printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\r\n'; }

# Ways to start Windows PowerShell, most direct first. cmd.exe lets Windows resolve the path itself.
runners() {
  echo powershell.exe
  for drive in /mnt/c /c /cygdrive/c; do echo "$drive/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"; done
  echo cmd.exe
  echo pwsh.exe
}

run_ps() {
  local runner=$1
  shift
  if [ "$runner" = cmd.exe ]; then cmd.exe /c powershell.exe "$@"; else "$runner" "$@"; fi
}

# Wrapped in a function so a partial download cannot run half a script.
main() {
  if ! command -v cmd.exe >/dev/null 2>&1 && ! command -v powershell.exe >/dev/null 2>&1; then
    echo "This is not a Windows shell. Run it on the Windows server, in Git Bash or WSL." >&2
    exit 1
  fi
  if ! command -v iconv >/dev/null 2>&1; then
    echo "iconv is missing. Install it, or run this in PowerShell as Administrator instead:" >&2
    echo "  $PS_ONE_LINER" >&2
    exit 1
  fi

  # Start from a Windows folder so cmd.exe does not warn about Linux paths under WSL.
  for dir in /mnt/c /c /cygdrive/c; do [ -d "$dir" ] && cd "$dir" && break; done

  local check runner found="" probe errors=""
  check=$(encode "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')) { 'elevated' } else { 'not-elevated' }")
  for runner in $(runners); do
    case $runner in
      /*) [ -e "$runner" ] || continue ;;
      *) command -v "$runner" >/dev/null 2>&1 || continue ;;
    esac
    if probe=$(run_ps "$runner" -NoProfile -NonInteractive -EncodedCommand "$check" </dev/null 2>&1) &&
      [[ $probe == *elevated* ]]; then
      found=$runner
      break
    fi
    errors+="  $runner: $(printf '%s' "$probe" | tr -d '\r' | head -3)"$'\n'
  done

  if [ -z "$found" ]; then
    echo "Could not start PowerShell from this shell:" >&2
    printf '%s' "$errors" >&2
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo "This looks like WSL. In an Administrator PowerShell run 'wsl --shutdown', then reopen WSL as Administrator and retry." >&2
    fi
    echo "Or skip bash: open PowerShell as Administrator and run:" >&2
    echo "  $PS_ONE_LINER" >&2
    exit 1
  fi
  if [[ $probe == *not-elevated* ]]; then
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

  echo "==> Starting the installer with $found"
  # </dev/null keeps PowerShell from reading the rest of the piped script.
  run_ps "$found" -NoProfile -ExecutionPolicy Bypass -EncodedCommand "$(encode "$cmd")" </dev/null
}

main "$@"
