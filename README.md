# PD2 SP Armory

Web-based character viewer for Project Diablo 2 singleplayer. Drop your `.d2s` save files in and browse your characters — equipment, inventory, stats, and skills — with Diablo II-styled item tooltips and wiki item images.

![PD2 Armory Screenshot](https://github.com/user-attachments/assets/placeholder.png)

## Windows Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Project Diablo 2](https://www.projectdiablo2.com/) installed

### Setup

```bash
git clone https://github.com/houd1ni/pd2-sp-armory.git
cd pd2-sp-armory
npm install
```

### Copy PD2 Data Files

The armory needs PD2's TXT data files to parse items correctly. Copy them from your PD2 install:

**Source:** `<PD2 Install>/ProjectD2/data/global/excel/`

Copy these files into the `data/` folder:

| File | Purpose |
|------|---------|
| `ItemStatCost.txt` | Stat definitions and display |
| `Armor.txt` | Armor base items |
| `Weapons.txt` | Weapon base items |
| `Misc.txt` | Misc items (rings, charms, gems, runes) |
| `UniqueItems.txt` | Unique item names |
| `SetItems.txt` | Set item names |
| `Skills.txt` | Skill names |
| `Properties.txt` | Item property definitions |
| `string.txt` | String table |

### Download Wiki Images (Optional)

Download item images from the PD2 wiki for rich tooltips:

```bash
node download-wiki-images.js
```

This fetches ~1100 PNG images into `public/img/wiki/`. Only needs to run once — it skips existing files on re-run.

### Run

Point `SAVES_DIR` at your PD2 save folder and start the server:

```bash
# Windows Command Prompt
set SAVES_DIR=C:\Program Files (x86)\Diablo II\Save
node server.js

# PowerShell
$env:SAVES_DIR = "C:\Program Files (x86)\Diablo II\Save"
node server.js
```

Or simply copy/symlink your `.d2s` files into the `saves/` folder and run without setting `SAVES_DIR`:

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

This installs the armory to `/opt/pd2-armory`, sets up a systemd service, and installs npm dependencies. After setup:

1. Copy PD2 data TXT files to `/opt/pd2-armory/data/`
2. Start: `sudo systemctl start pd2-armory`
3. View logs: `journalctl -u pd2-armory -f`

### Syncing Saves from Windows

Use the included sync scripts to copy `.d2s` files from your Windows PC to the Linux server via SCP:

- **`sync-saves.bat`** — One-shot sync (double-click or schedule via Task Scheduler)
- **`sync-saves.ps1`** — PowerShell with `-Watch` mode for continuous sync
- **`sync-saves.vbs`** — Silent wrapper for `sync-saves.bat` (no console window)

Edit the scripts to set your server IP and save directory before use.
