# PD2 SP Armory

Web-based character viewer for Project Diablo 2 singleplayer. Drop your `.d2s` save files in and browse your characters — equipment, inventory, stats, and skills — with Diablo II-styled item tooltips and wiki item images.

PD2 data files and wiki images are included — just clone, install, and run.

![PD2 Armory Screenshot](https://github.com/user-attachments/assets/placeholder.png)

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+

### Install & Run

```bash
git clone https://github.com/bmberirl/pd2-sp-armory.git
cd pd2-sp-armory
npm install
```

Point `SAVES_DIR` at your PD2 save folder and start the server:

```bash
# Windows Command Prompt
set SAVES_DIR=C:\Program Files (x86)\Diablo II\Save
node server.js

# PowerShell
$env:SAVES_DIR = "C:\Program Files (x86)\Diablo II\Save"
node server.js
```

Or simply copy your `.d2s` files into the `saves/` folder and run:

```bash
node server.js
```

Open **http://localhost:3001** in your browser. Characters appear automatically and update live via WebSocket when save files change.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `SAVES_DIR` | `./saves` | Directory containing `.d2s` save files |
| `DATA_DIR` | `./data` | Directory containing PD2 TXT data files |

## Linux Server Deployment

For running the armory on a separate Linux machine (e.g. always-on home server):

```bash
chmod +x setup.sh
sudo ./setup.sh
```

This installs the armory to `/opt/pd2-armory`, sets up a systemd service, and installs npm dependencies. Then start it:

```bash
sudo systemctl start pd2-armory
journalctl -u pd2-armory -f   # view logs
```

### Syncing Saves from Windows

Use the included sync scripts to copy `.d2s` files from your Windows PC to the Linux server via SCP:

- **`sync-saves.bat`** — One-shot sync (double-click or schedule via Task Scheduler)
- **`sync-saves.ps1`** — PowerShell with `-Watch` mode for continuous sync
- **`sync-saves.vbs`** — Silent wrapper for `sync-saves.bat` (no console window)

Edit the scripts to set your server IP and save directory before use.

## Updating Wiki Images

To re-download or update wiki images:

```bash
node download-wiki-images.js
```

This fetches PNGs from the PD2 wiki into `public/img/wiki/`. It skips existing files, so it's safe to re-run.
