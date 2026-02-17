// ── State ──────────────────────────────────────────────────────────────────────
let characters = [];
let currentChar = null;
let showMerc = false;
let ws = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elDropdown = $('#char-dropdown');
const elCharView = $('#char-view');
const elNoChars = $('#no-chars');
const elCharName = $('#char-name');
const elCharClass = $('#char-class');
const elCharLevel = $('#char-level');
const elCharFlags = $('#char-flags');
const elParseNotice = $('#parse-notice');
const elSkillsList = $('#skills-list');
const elNoSkills = $('#no-skills');
const elTooltip = $('#tooltip');
const elWsStatus = $('#ws-status');
const elBtnPlayer = $('#btn-player');
const elBtnMerc = $('#btn-merc');

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchCharacterList() {
  try {
    const res = await fetch('/api/characters');
    characters = await res.json();
    populateDropdown();
  } catch (err) {
    console.error('Failed to fetch character list:', err);
  }
}

async function fetchCharacter(name) {
  try {
    const res = await fetch(`/api/character/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentChar = await res.json();
    renderCharacter();
  } catch (err) {
    console.error('Failed to fetch character:', err);
  }
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

function populateDropdown() {
  // Keep current selection
  const prev = elDropdown.value;
  elDropdown.innerHTML = '<option value="">Select Character</option>';

  for (const c of characters) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} — Lv${c.level} ${c.class}`;
    if (c.hardcore) opt.textContent += ' [HC]';
    elDropdown.appendChild(opt);
  }

  if (characters.length === 0) {
    elNoChars.style.display = '';
    elCharView.style.display = 'none';
    return;
  }

  elNoChars.style.display = 'none';

  // Restore or auto-select
  if (prev && characters.some(c => c.name === prev)) {
    elDropdown.value = prev;
  } else if (!currentChar && characters.length > 0) {
    elDropdown.value = characters[0].name;
    fetchCharacter(characters[0].name);
  }
}

elDropdown.addEventListener('change', () => {
  const name = elDropdown.value;
  if (name) fetchCharacter(name);
});

// ── View Toggle ───────────────────────────────────────────────────────────────

elBtnPlayer.addEventListener('click', () => {
  showMerc = false;
  elBtnPlayer.classList.add('active');
  elBtnMerc.classList.remove('active');
  if (currentChar) renderEquipment();
});

elBtnMerc.addEventListener('click', () => {
  showMerc = true;
  elBtnMerc.classList.add('active');
  elBtnPlayer.classList.remove('active');
  if (currentChar) renderEquipment();
});

// ── Render Character ──────────────────────────────────────────────────────────

function renderCharacter() {
  if (!currentChar) return;
  elCharView.style.display = '';

  // Info bar
  elCharName.textContent = currentChar.name;
  elCharClass.textContent = currentChar.class;
  elCharLevel.textContent = currentChar.level;

  // Flags
  elCharFlags.innerHTML = '';
  if (currentChar.expansion) addFlag('EXP', 'flag-exp');
  if (currentChar.hardcore) addFlag('HC', 'flag-hc');
  if (currentChar.dead) addFlag('DEAD', 'flag-dead');

  // Parse notice
  if (currentChar._notice) {
    elParseNotice.textContent = currentChar._notice;
    elParseNotice.style.display = '';
  } else {
    elParseNotice.style.display = 'none';
  }

  renderStats();
  renderSkills();
  renderEquipment();
  renderInventory();
}

function addFlag(text, cls) {
  const el = document.createElement('span');
  el.className = `flag ${cls}`;
  el.textContent = text;
  elCharFlags.appendChild(el);
}

// ── Render Stats ──────────────────────────────────────────────────────────────

function renderStats() {
  const s = currentChar.stats || {};
  const d = currentChar.derivedStats || {};

  // Show total attributes (base + item bonuses) with green color when boosted
  setStat('#stat-str', d.totalStr ?? s.strength ?? 0, d.itemStr);
  setStat('#stat-dex', d.totalDex ?? s.dexterity ?? 0, d.itemDex);
  setStat('#stat-vit', d.totalVit ?? s.vitality ?? 0, d.itemVit);
  setStat('#stat-ene', d.totalEne ?? s.energy ?? 0, d.itemEne);

  // Life, Mana, Stamina from derived stats (includes item bonuses)
  $('#stat-life').textContent = d.totalLife ?? s.life ?? 0;
  $('#stat-mana').textContent = d.totalMana ?? s.mana ?? 0;
  $('#stat-stamina').textContent = d.stamina ?? '--';

  $('#stat-exp').textContent = (s.experience || 0).toLocaleString();
  $('#stat-gold').textContent = ((s.gold || 0) + (s.goldStash || 0)).toLocaleString();
  $('#stat-statpts').textContent = s.statPoints || 0;
  $('#stat-skillpts').textContent = s.skillPoints || 0;

  // Derived stats
  $('#stat-defense').textContent = d.defense ?? '--';
  $('#stat-fire-res').textContent = d.fireRes ?? '--';
  $('#stat-cold-res').textContent = d.coldRes ?? '--';
  $('#stat-ltng-res').textContent = d.ltngRes ?? '--';
  $('#stat-pois-res').textContent = d.poisRes ?? '--';

  const elAR = $('#stat-attack-rating');
  if (elAR) elAR.textContent = d.attackRating ?? '--';

  // Next Level: show total XP threshold (matching in-game display)
  const elNextLvl = $('#stat-next-level');
  if (elNextLvl) {
    elNextLvl.textContent = d.nextLevelExp != null
      ? d.nextLevelExp.toLocaleString() : '--';
  }
}

// Set stat value with green color when boosted by items
function setStat(selector, value, bonus) {
  const el = $(selector);
  if (!el) return;
  el.textContent = value;
  if (bonus && bonus > 0) {
    el.style.color = '#5aff5a';
  } else {
    el.style.color = '';
  }
}

// ── Render Skills ─────────────────────────────────────────────────────────────

function renderSkills() {
  const skills = currentChar.skills || [];
  elSkillsList.innerHTML = '';

  if (skills.length === 0) {
    elNoSkills.style.display = '';
    return;
  }
  elNoSkills.style.display = 'none';

  // Sort by points descending
  const sorted = [...skills].sort((a, b) => b.points - a.points);
  for (const sk of sorted) {
    const el = document.createElement('div');
    el.className = 'skill-entry';
    const iconHtml = sk.imageUrl
      ? `<img class="skill-icon" src="${esc(sk.imageUrl)}" alt="" onerror="this.style.display='none'">`
      : '';
    el.innerHTML = `<span class="skill-name">${iconHtml}${esc(sk.name)}</span><span class="skill-points">${sk.points}</span>`;
    elSkillsList.appendChild(el);
  }
}

// ── Render Equipment ──────────────────────────────────────────────────────────

// Map of slot CSS class suffixes to preserve during re-render
const SLOT_CLASS_RE = /\bslot-\S+/;

function renderEquipment() {
  const items = showMerc ? (currentChar.mercenary?.items || {}) : (currentChar.equipped || {});
  const slots = $$('.doll-slot');

  for (const slotEl of slots) {
    const slotKey = slotEl.dataset.slot;
    const label = slotEl.dataset.label;
    const item = items[slotKey];

    // Preserve the slot-* positioning class
    const posClass = (slotEl.className.match(SLOT_CLASS_RE) || [''])[0];
    slotEl.className = `doll-slot ${posClass}`;
    slotEl.innerHTML = '';

    if (!item) {
      slotEl.classList.add('empty');
      slotEl.innerHTML = `<span class="slot-label">${esc(label)}</span>`;
      slotEl.onmouseenter = null;
      slotEl.onmouseleave = null;
      slotEl.onmousemove = null;
      continue;
    }

    // Quality class
    const qClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
    slotEl.classList.add(`q-${qClass}`);

    if (item.imageUrl) {
      // Image-only: img fills the slot, text fallback on error
      const textQClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
      slotEl.innerHTML = `<img class="slot-img" src="${esc(item.imageUrl)}" alt="${esc(item.name)}" onerror="this.outerHTML='<span class=\\'slot-item-name q-text-${textQClass}\\'>${esc(item.name)}</span>'">`;
    } else {
      // No image: show compact text name
      const textQClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
      slotEl.innerHTML = `<span class="slot-item-name q-text-${textQClass}">${esc(item.name)}</span>`;
    }

    // Tooltip events
    slotEl.onmouseenter = (e) => showTooltip(item, e);
    slotEl.onmousemove = (e) => moveTooltip(e);
    slotEl.onmouseleave = () => hideTooltip();
  }
}

// ── Render Inventory Grid ────────────────────────────────────────────────────

function renderInventory() {
  const grid = $('#inv-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Create 10x8 background cells
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 10; col++) {
      const cell = document.createElement('div');
      cell.className = 'inv-cell' + (row >= 4 ? ' charm-row' : '');
      cell.style.gridColumn = (col + 1);
      cell.style.gridRow = (row + 1);
      grid.appendChild(cell);
    }
  }

  // Place actual inventory items
  const items = currentChar?.inventory || [];
  for (const item of items) {
    const el = document.createElement('div');
    const qClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
    el.className = `inv-item q-${qClass}`;

    // CSS grid placement (1-indexed)
    el.style.gridColumn = `${item.x + 1} / ${item.x + 1 + item.w}`;
    el.style.gridRow = `${item.y + 1} / ${item.y + 1 + item.h}`;

    if (item.imageUrl) {
      el.innerHTML = `<img src="${esc(item.imageUrl)}" alt="${esc(item.name)}" onerror="this.outerHTML='<span class=\\'inv-item-name q-text-${qClass}\\'>${esc(item.name)}</span>'">`;
    } else {
      el.innerHTML = `<span class="inv-item-name q-text-${qClass}">${esc(item.name)}</span>`;
    }

    // Tooltip events
    el.onmouseenter = (e) => showTooltip(item, e);
    el.onmousemove = (e) => moveTooltip(e);
    el.onmouseleave = () => hideTooltip();

    grid.appendChild(el);
  }
}

// ── Tooltip System ────────────────────────────────────────────────────────────

function showTooltip(item, e) {
  const lines = [];

  // Item image at top of tooltip
  if (item.imageUrl) {
    lines.push(`<div class="tt-item-img-wrap"><img class="tt-item-img" src="${esc(item.imageUrl)}" alt="" onerror="this.parentElement.style.display='none'"></div>`);
  }

  // Item name (color-coded by quality)
  const qClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
  lines.push(`<div class="tt-name q-text-${qClass}">${esc(item.name)}</div>`);

  // Base name (shown in grey below the item name)
  if (item.baseName) {
    lines.push(`<div class="tt-base">${esc(item.baseName)}</div>`);
  }

  lines.push('<div class="tt-separator"></div>');

  // Defense (white text like in-game)
  if (item.defense != null) {
    lines.push(`<div class="tt-stat">Defense: <span class="tt-white">${item.defense}</span></div>`);
  }

  // Damage
  if (item.twoHandMin != null && item.twoHandMax != null) {
    lines.push(`<div class="tt-stat">Two-Hand Damage: <span class="tt-white">${item.twoHandMin} to ${item.twoHandMax}</span></div>`);
  } else if (item.minDamage != null && item.maxDamage != null) {
    lines.push(`<div class="tt-stat">One-Hand Damage: <span class="tt-white">${item.minDamage} to ${item.maxDamage}</span></div>`);
  }

  // Requirements
  if (item.reqStr > 0) {
    lines.push(`<div class="tt-stat req">Required Strength: ${item.reqStr}</div>`);
  }
  if (item.reqDex > 0) {
    lines.push(`<div class="tt-stat req">Required Dexterity: ${item.reqDex}</div>`);
  }
  if (item.reqLevel > 0) {
    lines.push(`<div class="tt-stat req">Required Level: ${item.reqLevel}</div>`);
  }

  // Ethereal
  if (item.ethereal) {
    lines.push(`<div class="tt-stat ethereal">Ethereal (Cannot Be Repaired)</div>`);
  }

  // Magic properties (blue text like in-game)
  if (item.properties && item.properties.length > 0) {
    lines.push('<div class="tt-separator"></div>');
    for (const prop of item.properties) {
      const desc = prop.description || formatStat(prop.stat, prop.values);
      if (desc) {
        lines.push(`<div class="tt-stat magic">${esc(desc)}</div>`);
      }
    }
  }

  // Set item partial bonuses (green text)
  if (item.setProperties && item.setProperties.length > 0) {
    lines.push('<div class="tt-separator"></div>');
    for (const prop of item.setProperties) {
      const desc = prop.description || formatStat(prop.stat, prop.values);
      if (desc) {
        lines.push(`<div class="tt-stat set-bonus">${esc(desc)}</div>`);
      }
    }
  }

  // Sockets
  if (item.numSockets > 0) {
    lines.push('<div class="tt-separator"></div>');
    lines.push(`<div class="tt-stat socketed">Socketed (${item.numSockets})</div>`);
    if (item.sockets) {
      for (const s of item.sockets) {
        lines.push(`<div class="tt-socket">${esc(s.name)}</div>`);
      }
    }
  }

  elTooltip.innerHTML = lines.join('');
  elTooltip.style.display = '';
  moveTooltip(e);
}

function moveTooltip(e) {
  const pad = 16;
  let x = e.clientX + pad;
  let y = e.clientY + pad;

  // Keep tooltip in viewport
  const rect = elTooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (x + rect.width > vw - pad) x = e.clientX - rect.width - pad;
  if (y + rect.height > vh - pad) y = e.clientY - rect.height - pad;

  elTooltip.style.left = x + 'px';
  elTooltip.style.top = y + 'px';
}

function hideTooltip() {
  elTooltip.style.display = 'none';
}

function formatStat(stat, values) {
  if (!stat) return '';
  const v = values || [];
  // Simple formatting: replace underscores, capitalize, append values
  const name = stat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (v.length === 0) return name;
  if (v.length === 1) return `${name}: ${v[0]}`;
  return `${name}: ${v.join('-')}`;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    elWsStatus.className = 'connected';
    elWsStatus.title = 'Live updates connected';
  };

  ws.onclose = () => {
    elWsStatus.className = 'disconnected';
    elWsStatus.title = 'Reconnecting...';
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch (err) {
      console.error('WS message parse error:', err);
    }
  };
}

function handleWSMessage(msg) {
  if (msg.type === 'character_update') {
    const char = msg.data;
    // Update character list
    const idx = characters.findIndex(c => c.name === char.name);
    const summary = { name: char.name, class: char.class, level: char.level, hardcore: char.hardcore, dead: char.dead };
    if (idx >= 0) {
      characters[idx] = summary;
    } else {
      characters.push(summary);
      characters.sort((a, b) => a.name.localeCompare(b.name));
    }
    populateDropdown();

    // If this is the currently viewed character, update it
    if (currentChar && currentChar.name === char.name) {
      currentChar = char;
      renderCharacter();
    }
  }

  if (msg.type === 'character_removed') {
    characters = characters.filter(c => c.name !== msg.data.name);
    populateDropdown();
    if (currentChar && currentChar.name === msg.data.name) {
      currentChar = null;
      elCharView.style.display = 'none';
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Init ──────────────────────────────────────────────────────────────────────

renderInventory();
fetchCharacterList();
connectWebSocket();
