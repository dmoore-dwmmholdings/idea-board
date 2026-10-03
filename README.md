# Idea Board

A private, locally hosted board for product ideas. No accounts, no cloud, no dependencies.

```sh
npm start
# → http://localhost:4321
```

Needs Node 18 or later. Ideas are stored in `data/ideas.json`. To use a different port, run `PORT=5000 npm start`.

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` / `N` | New idea |
| `/` | Search |
| `Enter` | Save the idea (from the title field) |
| `⌘Enter` | Save the idea (from any field) |
| `Esc` | Close |

The full spec is in [SPEC.md](SPEC.md).

## Run it on a Windows server

On the Windows server, open Git Bash or WSL as Administrator and run:

```bash
curl -fsSL https://raw.githubusercontent.com/dmoore-dwmmholdings/idea-board/main/install.sh | bash
```

Or open PowerShell as Administrator and run:

```powershell
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; iwr https://raw.githubusercontent.com/dmoore-dwmmholdings/idea-board/main/install.ps1 -OutFile $env:TEMP\idea-board-install.ps1 -UseBasicParsing; powershell -NoProfile -ExecutionPolicy RemoteSigned -File $env:TEMP\idea-board-install.ps1
```

`install.sh` downloads `install.ps1`, which does the work, and runs it as a file. Avoid `irm ... | iex`: Windows Defender can block it as a download cradle, which Git Bash reports as `powershell.exe: Permission denied`.

The installer:

- installs Node.js LTS if Node 18 or later is not installed
- downloads [NSSM](https://nssm.cc) and registers an `IdeaBoard` service that starts on boot and restarts if it crashes
- opens TCP 4321 in Windows Firewall for the local subnet only

It then prints the URLs to open from your machine. It is safe to re-run, so re-run it to update the app. Your ideas are kept.

| Path on the server | Contents |
| --- | --- |
| `C:\Program Files\IdeaBoard` | App and `nssm.exe` |
| `C:\ProgramData\IdeaBoard\data\ideas.json` | Your ideas |
| `C:\ProgramData\IdeaBoard\logs\service.log` | Service output (rotates at 1 MB) |

Settings (set them before you run the one-liner; in bash, use `curl ... | BOARD_PORT=5000 bash`): `$env:BOARD_PORT = 5000`, `$env:BOARD_ALLOW_FROM = '10.0.0.0/8'` (or `Any`), and `$env:BOARD_UNINSTALL = 1` to remove it (your data is kept).

> The board has no login. Anyone who can reach the port can read and edit your ideas. Keep the firewall rule tight.

`server.js` reads `HOST` (default `127.0.0.1`) and `DATA_DIR` (default `./data`) from the environment. The installer sets both.

### Changing the installer

`install.ps1` is generated from `scripts/install.template.ps1` with the app files embedded. After you change the app or the template, run `npm run installer` and commit `install.ps1`.

To copy your current ideas to a new server, serve the installer from this machine instead: `npm run installer:serve -- --seed`, then run the `irm` line it prints. Seed data never goes into the committed `install.ps1`.
