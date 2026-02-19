<img width="1992" height="1127" alt="image" src="https://github.com/user-attachments/assets/5fc03258-955a-47df-a65f-84bef7c2b984" />




# PD2 SP Armory

Web-based character viewer for Project Diablo 2 singleplayer. Drop your `.d2s` save files in and browse your characters — equipment, inventory, stats, and skills — with Diablo II-styled item tooltips and wiki item images.

PD2 data files and wiki images are included — just clone, install, and run.

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

## Twitch Extension

Show your PD2 characters live on your Twitch channel as a panel extension. Viewers can browse your equipped items, stats, and skills directly from your stream page.

### How It Works

1. Your PD2 Armory server watches for save file changes
2. When you Save & Exit in PD2, the server pushes character data to a cloud backend (Cloudflare Worker)
3. The Twitch panel extension fetches and displays your characters to viewers

### Setup

#### 1. Install the PD2 Armory server

Follow the [Quick Start](#quick-start) above to get the server running locally.

#### 2. Install the Twitch Extension

Go to your Twitch channel and install the **PD2 Armory Singleplayer** extension from the Extensions menu. Add it as a **Panel** under your stream.

#### 3. Connect to Twitch

Open **http://localhost:3001/setup** in your browser and click **Connect to Twitch**. This will:

1. Redirect you to Twitch to authorize the extension
2. Automatically configure your server with the correct credentials
3. Save the configuration to `twitch-config.json` (persists across restarts)

That's it — no manual environment variables needed.

#### 4. Play PD2

Save & Exit in PD2 — your characters will appear in the Twitch panel within seconds. The panel auto-refreshes every 2 minutes.

### Managing Your Connection

- Visit **http://localhost:3001/setup** to check your connection status
- Click **Disconnect** to unlink your Twitch account and clear saved credentials
- Re-connect at any time by clicking **Connect to Twitch** again

### Advanced: Manual Configuration

If you prefer to set credentials manually (e.g. on a headless Linux server), you can set environment variables instead of using the setup page:

```bash
# PowerShell
$env:TWITCH_CHANNEL_ID = "your_channel_id"
$env:TWITCH_PUSH_SECRET = "your_unique_token"
$env:TWITCH_EBS_URL = "https://ebs.bmberirl.com"
node server.js
```

Environment variables take precedence over `twitch-config.json`.

## Updating Wiki Images

To re-download or update wiki images:

```bash
node download-wiki-images.js
```

This fetches PNGs from the PD2 wiki into `public/img/wiki/`. It skips existing files, so it's safe to re-run.
