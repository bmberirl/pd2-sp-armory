#!/usr/bin/env node
// One-time script to download all PD2 wiki images locally.
// Usage: node download-wiki-images.js

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'public', 'img', 'wiki');

function filenameToUrl(filename) {
  const hash = crypto.createHash('md5').update(filename).digest('hex');
  return `https://static.wikitide.net/projectdiablo2wiki/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(filename)}`;
}

function fetchPage(cont) {
  return new Promise((resolve, reject) => {
    const base = 'https://wiki.projectdiablo2.com/w/api.php?action=query&list=allimages&ailimit=500&format=json';
    const urlStr = cont ? base + '&aicontinue=' + encodeURIComponent(cont) : base;
    const urlObj = new URL(urlStr);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'PD2Armory/1.0 (image download)' },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'PD2Armory/1.0 (image download)' },
    };
    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  // Fetch all image filenames from wiki API
  console.log('Fetching wiki image index...');
  const allNames = [];
  let page = await fetchPage('');
  while (page) {
    const images = page?.query?.allimages || [];
    for (const img of images) {
      if (img.name && img.name.endsWith('.png')) {
        allNames.push(img.name);
      }
    }
    if (page?.continue?.aicontinue) {
      page = await fetchPage(page.continue.aicontinue);
    } else {
      break;
    }
  }
  console.log(`Found ${allNames.length} PNG images in wiki index.`);

  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allNames.length; i++) {
    const filename = allNames[i];
    const dest = path.join(OUT_DIR, filename);

    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    const url = filenameToUrl(filename);
    try {
      await downloadFile(url, dest);
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`  Downloaded ${downloaded}/${allNames.length - skipped} (${i + 1}/${allNames.length} processed)`);
      }
    } catch (err) {
      failed++;
      console.warn(`  FAILED: ${filename} — ${err.message}`);
    }
  }

  console.log(`\nDone! Downloaded: ${downloaded}, Skipped (existing): ${skipped}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
