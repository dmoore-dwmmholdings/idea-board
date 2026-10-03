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
PS_ONE_LINER="[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; iwr $PS1_URL -OutFile \$env:TEMP\\idea-board-install.ps1 -UseBasicParsing; powershell -NoProfile -ExecutionPolicy RemoteSigned -File \$env:TEMP\\idea-board-install.ps1"

# Stop Git Bash / MSYS2 rewriting arguments such as `/c` into Windows paths.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
# That can also stop TEMP/TMP being converted, leaving Windows programs with TEMP=/tmp. Hand them real paths.
if command -v cygpath >/dev/null 2>&1; then
  TEMP=$(cygpath -w "${TMPDIR:-/tmp}")
  export TEMP TMP=$TEMP
fi

# PowerShell takes -EncodedCommand as base64 UTF-16LE, which survives cmd.exe and WSL without quoting trouble.
# Used only for the small probes below, never to download and run code.
encode() { printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\r\n'; }

# Ways to start Windows PowerShell, most direct first. cmd.exe lets Windows resolve the path itself.
runners() {
  echo powershell.exe
  for drive in /mnt/c /c /cygdrive/c; do echo "$drive/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"; done
  echo cmd.exe
  echo pwsh.exe
}

to_win() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else wslpath -w "$1"; fi; }

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

  # Download with curl and run it as a file. Defender blocks `powershell -EncodedCommand "irm ... | iex"`
  # (a download cradle) at process start, which shows up here as "Permission denied".
  local tmp_dir script_win status=0
  tmp_dir=$(mktemp -d)
  if ! curl -fsSL "$PS1_URL" -o "$tmp_dir/install.ps1"; then
    echo "Could not download $PS1_URL to $tmp_dir/install.ps1" >&2
    exit 1
  fi
  script_win=$(to_win "$tmp_dir/install.ps1")

  # Git Bash passes env vars to Windows programs as is; WSL only passes the ones named in WSLENV.
  export WSLENV="${WSLENV:+$WSLENV:}BOARD_PORT:BOARD_ALLOW_FROM:BOARD_UNINSTALL:NSSM_URL"

  echo "==> Running $script_win with $found"
  # Bypass, not RemoteSigned: under WSL the file is on a \\wsl.localhost share, which PowerShell treats as remote.
  # </dev/null keeps PowerShell from reading the rest of the piped script.
  run_ps "$found" -NoProfile -ExecutionPolicy Bypass -File "$script_win" </dev/null || status=$?
  rm -rf "$tmp_dir"
  exit "$status"
}

main "$@"
