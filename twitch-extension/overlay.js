// ── PD2 Armory Twitch Extension Video Overlay ────────────────────────────────
// Adapted from panel.js for full-screen video overlay

// ── Configuration ────────────────────────────────────────────────────────────
const EBS_URL = 'https://ebs.bmberirl.com';
const POLL_INTERVAL = 120000; // 120 seconds

// ── State ────────────────────────────────────────────────────────────────────
let characters = [];
let currentChar = null;
let showMerc = false;
let channelId = null;
let pollTimer = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
var $ = function(sel) { return document.querySelector(sel); };
var $$ = function(sel) { return document.querySelectorAll(sel); };

var elToggleBtn = $('#toggle-btn');
var elCloseBtn = $('#close-btn');
var elOverlayPanel = $('#overlay-panel');
var elLoading = $('#loading');
var elNoData = $('#no-data');
var elCharView = $('#char-view');
var elDropdown = $('#char-dropdown');
var elCharName = $('#char-name');
var elCharClass = $('#char-class');
var elCharLevel = $('#char-level');
var elCharFlags = $('#char-flags');
var elSkillsList = $('#skills-list');
var elNoSkills = $('#no-skills');
var elTooltip = $('#tooltip');
var elBtnPlayer = $('#btn-player');
var elBtnMerc = $('#btn-merc');

// ── Toggle / Close ───────────────────────────────────────────────────────────

elToggleBtn.addEventListener('click', function() {
  elOverlayPanel.style.display = '';
  document.body.classList.add('overlay-open');
});

elCloseBtn.addEventListener('click', function() {
  elOverlayPanel.style.display = 'none';
  document.body.classList.remove('overlay-open');
  hideTooltip();
});

// ── Twitch Extension Init ────────────────────────────────────────────────────

if (window.Twitch && window.Twitch.ext) {
  window.Twitch.ext.onAuthorized(function(auth) {
    channelId = auth.channelId;
    fetchData();
    pollTimer = setInterval(fetchData, POLL_INTERVAL);
  });
}

// ── Data Fetching ────────────────────────────────────────────────────────────

function fetchData() {
  if (!channelId) return;

  var url = EBS_URL + '/data?channel_id=' + encodeURIComponent(channelId);
  fetch(url)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      elLoading.style.display = 'none';
      if (!data || !Array.isArray(data) || data.length === 0) {
        elNoData.style.display = '';
        elCharView.style.display = 'none';
        return;
      }

      characters = data;
      elNoData.style.display = 'none';
      elCharView.style.display = '';

      populateDropdown();

      // Auto-select first character if none selected
      if (!currentChar && characters.length > 0) {
        currentChar = characters[0];
        elDropdown.value = characters[0].name;
        renderCharacter();
      } else if (currentChar) {
        // Refresh current character data
        var updated = characters.find(function(c) { return c.name === currentChar.name; });
        if (updated) {
          currentChar = updated;
          renderCharacter();
        }
      }
    })
    .catch(function(err) {
      console.error('Fetch error:', err);
      elLoading.style.display = 'none';
      if (!currentChar) {
        elNoData.style.display = '';
      }
    });
}

// ── Dropdown ─────────────────────────────────────────────────────────────────

function populateDropdown() {
  var prev = elDropdown.value;
  elDropdown.innerHTML = '';

  if (characters.length <= 1) {
    elDropdown.style.display = 'none';
    return;
  }

  elDropdown.style.display = '';
  for (var i = 0; i < characters.length; i++) {
    var c = characters[i];
    var opt = document.createElement('option');
    opt.value = c.name;
    var label = c.name + ' \u2014 Lv' + c.level + ' ' + c.class;
    if (c.hardcore) label += ' [HC]';
    opt.textContent = label;
    elDropdown.appendChild(opt);
  }

  if (prev && characters.some(function(c) { return c.name === prev; })) {
    elDropdown.value = prev;
  }
}

elDropdown.addEventListener('change', function() {
  var name = elDropdown.value;
  var char = characters.find(function(c) { return c.name === name; });
  if (char) {
    currentChar = char;
    renderCharacter();
  }
});

// ── View Toggle ──────────────────────────────────────────────────────────────

elBtnPlayer.addEventListener('click', function() {
  showMerc = false;
  elBtnPlayer.classList.add('active');
  elBtnMerc.classList.remove('active');
  if (currentChar) renderEquipment();
});

elBtnMerc.addEventListener('click', function() {
  showMerc = true;
  elBtnMerc.classList.add('active');
  elBtnPlayer.classList.remove('active');
  if (currentChar) renderEquipment();
});

// ── Render Character ─────────────────────────────────────────────────────────

function renderCharacter() {
  if (!currentChar) return;

  elCharName.textContent = currentChar.name;
  elCharClass.textContent = currentChar.class;
  elCharLevel.textContent = 'Level ' + currentChar.level;

  // Flags
  elCharFlags.innerHTML = '';
  if (currentChar.expansion) addFlag('EXP', 'flag-exp');
  if (currentChar.hardcore) addFlag('HC', 'flag-hc');
  if (currentChar.dead) addFlag('DEAD', 'flag-dead');

  renderStats();
  renderSkills();
  renderEquipment();
  renderInventory();
}

function addFlag(text, cls) {
  var el = document.createElement('span');
  el.className = 'flag ' + cls;
  el.textContent = text;
  elCharFlags.appendChild(el);
}

// ── Stat Helpers ─────────────────────────────────────────────────────────────

function setStat(selector, value, bonus) {
  var el = $(selector);
  if (!el) return;
  el.textContent = value;
  if (bonus > 0) {
    el.classList.add('boosted');
  } else {
    el.classList.remove('boosted');
  }
}

function setResStat(selector, value) {
  var el = $(selector);
  if (!el) return;
  el.textContent = value;
  if (value < 0) {
    el.classList.add('res-negative');
  } else {
    el.classList.remove('res-negative');
  }
}

// ── Render Stats ─────────────────────────────────────────────────────────────

function renderStats() {
  var d = currentChar.derivedStats || {};
  var s = currentChar.stats || {};

  // Attributes — use derived totals with green when boosted by items
  setStat('#stat-str', d.totalStr || s.strength || 0, d.itemStr || 0);
  setStat('#stat-dex', d.totalDex || s.dexterity || 0, d.itemDex || 0);
  setStat('#stat-vit', d.totalVit || s.vitality || 0, d.itemVit || 0);
  setStat('#stat-ene', d.totalEne || s.energy || 0, d.itemEne || 0);

  // Life / Mana / Stamina
  $('#stat-life').textContent = d.totalLife || s.life || 0;
  $('#stat-mana').textContent = d.totalMana || s.mana || 0;
  $('#stat-stamina').textContent = d.stamina || 0;

  // Defense & Attack Rating
  $('#stat-defense').textContent = d.defense || 0;
  $('#stat-ar').textContent = d.attackRating || 0;

  // Resistances
  setResStat('#stat-fire-res', d.fireRes != null ? d.fireRes : 0);
  setResStat('#stat-cold-res', d.coldRes != null ? d.coldRes : 0);
  setResStat('#stat-ltng-res', d.ltngRes != null ? d.ltngRes : 0);
  setResStat('#stat-poison-res', d.poisRes != null ? d.poisRes : 0);

  // Difficulty
  var diffEl = $('#stat-difficulty');
  var diff = d.difficulty || 'Normal';
  diffEl.textContent = diff;
  diffEl.className = 'stat-value';
  if (diff === 'Hell') diffEl.classList.add('diff-hell');
  else if (diff === 'Nightmare') diffEl.classList.add('diff-nightmare');
  else diffEl.classList.add('diff-normal');

  // Gold
  $('#stat-gold').textContent = ((s.gold || 0) + (s.goldStash || 0)).toLocaleString();
}

// ── Render Skills ────────────────────────────────────────────────────────────

function renderSkills() {
  var skills = currentChar.skills || [];
  elSkillsList.innerHTML = '';

  if (skills.length === 0) {
    elNoSkills.style.display = '';
    return;
  }
  elNoSkills.style.display = 'none';

  // Sort by total (base + bonus) descending
  var sorted = skills.slice().sort(function(a, b) { return (b.points + (b.bonus || 0)) - (a.points + (a.bonus || 0)); });
  for (var i = 0; i < sorted.length; i++) {
    var sk = sorted[i];
    var el = document.createElement('div');
    el.className = 'skill-entry';

    var iconHtml = sk.imageUrl
      ? '<img class="skill-icon" src="' + esc(sk.imageUrl) + '" alt="">'
      : '';
    var bonusHtml = sk.bonus > 0
      ? '<span class="skill-points">' + sk.points + '<span class="skill-bonus">+' + sk.bonus + '</span></span>'
      : '<span class="skill-points">' + sk.points + '</span>';
    el.innerHTML = '<span class="skill-name">' + iconHtml + esc(sk.name) + '</span>' + bonusHtml;

    // Remove broken skill icons gracefully
    var img = el.querySelector('.skill-icon');
    if (img) {
      img.addEventListener('error', function() { this.style.display = 'none'; });
    }

    elSkillsList.appendChild(el);
  }
}

// ── Render Equipment ─────────────────────────────────────────────────────────

var SLOT_CLASS_RE = /\bslot-\S+/;

function renderEquipment() {
  var items = showMerc ? (currentChar.mercenary && currentChar.mercenary.items || {}) : (currentChar.equipped || {});
  var slots = $$('.doll-slot');

  for (var i = 0; i < slots.length; i++) {
    var slotEl = slots[i];
    var slotKey = slotEl.dataset.slot;
    var label = slotEl.dataset.label;
    var item = items[slotKey];

    var posClass = (slotEl.className.match(SLOT_CLASS_RE) || [''])[0];
    slotEl.className = 'doll-slot ' + posClass;
    slotEl.innerHTML = '';

    if (!item) {
      slotEl.classList.add('empty');
      slotEl.innerHTML = '<span class="slot-label">' + esc(label) + '</span>';
      slotEl.onmouseenter = null;
      slotEl.onmouseleave = null;
      slotEl.onmousemove = null;
      slotEl.ontouchstart = null;
      continue;
    }

    var qClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
    slotEl.classList.add('q-' + qClass);

    if (item.imageUrl) {
      var textQClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
      var imgEl = document.createElement('img');
      imgEl.className = 'slot-img';
      imgEl.src = item.imageUrl;
      imgEl.alt = item.name;
      imgEl.addEventListener('error', (function(name, cls) {
        return function() {
          var span = document.createElement('span');
          span.className = 'slot-item-name q-text-' + cls;
          span.textContent = name;
          this.parentElement.replaceChild(span, this);
        };
      })(item.name, textQClass));
      slotEl.appendChild(imgEl);
    } else {
      var textQClass2 = item.isRuneword ? 'runeword' : (item.quality || 'normal');
      slotEl.innerHTML = '<span class="slot-item-name q-text-' + textQClass2 + '">' + esc(item.name) + '</span>';
    }

    // Tooltip events (mouse + touch)
    slotEl.onmouseenter = (function(it) { return function(e) { showTooltip(it, e); }; })(item);
    slotEl.onmousemove = function(e) { moveTooltip(e); };
    slotEl.onmouseleave = function() { hideTooltip(); };
    slotEl.ontouchstart = (function(it) { return function(e) { showTooltip(it, e.touches[0]); }; })(item);
  }
}

// ── Render Inventory ─────────────────────────────────────────────────────

function renderInventory() {
  var grid = $('#inv-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Create 10x8 background cells
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 10; col++) {
      var cell = document.createElement('div');
      cell.className = 'inv-cell' + (row >= 4 ? ' charm-row' : '');
      cell.style.gridColumn = (col + 1);
      cell.style.gridRow = (row + 1);
      grid.appendChild(cell);
    }
  }

  // Place inventory items
  var items = (currentChar && currentChar.inventory) || [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var el = document.createElement('div');
    var qClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
    el.className = 'inv-item q-' + qClass;

    el.style.gridColumn = (item.x + 1) + ' / ' + (item.x + 1 + item.w);
    el.style.gridRow = (item.y + 1) + ' / ' + (item.y + 1 + item.h);

    if (item.imageUrl) {
      var imgEl = document.createElement('img');
      imgEl.src = item.imageUrl;
      imgEl.alt = item.name;
      imgEl.addEventListener('error', (function(name, cls) {
        return function() {
          this.outerHTML = '<span class="inv-item-name q-text-' + cls + '">' + name + '</span>';
        };
      })(esc(item.name), qClass));
      el.appendChild(imgEl);
    } else {
      el.innerHTML = '<span class="inv-item-name q-text-' + qClass + '">' + esc(item.name) + '</span>';
    }

    // Tooltip events
    el.onmouseenter = (function(it) { return function(e) { showTooltip(it, e); }; })(item);
    el.onmousemove = function(e) { moveTooltip(e); };
    el.onmouseleave = function() { hideTooltip(); };
    el.ontouchstart = (function(it) { return function(e) { showTooltip(it, e.touches[0]); }; })(item);

    grid.appendChild(el);
  }
}

// ── Tooltip System ───────────────────────────────────────────────────────────

function showTooltip(item, e) {
  var lines = [];

  // Item image
  if (item.imageUrl) {
    lines.push('<div class="tt-item-img-wrap"><img class="tt-item-img" src="' + esc(item.imageUrl) + '" alt=""></div>');
  }

  // Item name
  var qClass = item.isRuneword ? 'runeword' : (item.quality || 'normal');
  lines.push('<div class="tt-name q-text-' + qClass + '">' + esc(item.name) + '</div>');

  // Base name
  if (item.baseName) {
    lines.push('<div class="tt-base">' + esc(item.baseName) + '</div>');
  }

  lines.push('<div class="tt-separator"></div>');

  // Defense
  if (item.defense != null) {
    lines.push('<div class="tt-stat">Defense: <span class="tt-white">' + item.defense + '</span></div>');
  }

  // Damage
  if (item.twoHandMin != null && item.twoHandMax != null) {
    lines.push('<div class="tt-stat">Two-Hand Damage: <span class="tt-white">' + item.twoHandMin + ' to ' + item.twoHandMax + '</span></div>');
  } else if (item.minDamage != null && item.maxDamage != null) {
    lines.push('<div class="tt-stat">One-Hand Damage: <span class="tt-white">' + item.minDamage + ' to ' + item.maxDamage + '</span></div>');
  }

  // Requirements
  if (item.reqStr > 0) {
    lines.push('<div class="tt-stat req">Required Strength: ' + item.reqStr + '</div>');
  }
  if (item.reqDex > 0) {
    lines.push('<div class="tt-stat req">Required Dexterity: ' + item.reqDex + '</div>');
  }
  if (item.reqLevel > 0) {
    lines.push('<div class="tt-stat req">Required Level: ' + item.reqLevel + '</div>');
  }

  // Ethereal
  if (item.ethereal) {
    lines.push('<div class="tt-stat ethereal">Ethereal (Cannot Be Repaired)</div>');
  }

  // Magic properties
  if (item.properties && item.properties.length > 0) {
    lines.push('<div class="tt-separator"></div>');
    for (var i = 0; i < item.properties.length; i++) {
      var prop = item.properties[i];
      var desc = prop.description || formatStat(prop.stat, prop.values);
      if (desc) {
        lines.push('<div class="tt-stat magic">' + esc(desc) + '</div>');
      }
    }
  }

  // Set bonuses
  if (item.setProperties && item.setProperties.length > 0) {
    lines.push('<div class="tt-separator"></div>');
    for (var j = 0; j < item.setProperties.length; j++) {
      var sp = item.setProperties[j];
      var sdesc = sp.description || formatStat(sp.stat, sp.values);
      if (sdesc) {
        lines.push('<div class="tt-stat set-bonus">' + esc(sdesc) + '</div>');
      }
    }
  }

  // Sockets
  if (item.numSockets > 0) {
    lines.push('<div class="tt-separator"></div>');
    lines.push('<div class="tt-stat socketed">Socketed (' + item.numSockets + ')</div>');
    if (item.sockets) {
      for (var k = 0; k < item.sockets.length; k++) {
        lines.push('<div class="tt-socket">' + esc(item.sockets[k].name) + '</div>');
      }
    }
  }

  elTooltip.innerHTML = lines.join('');
  elTooltip.style.display = '';
  moveTooltip(e);
}

function moveTooltip(e) {
  var pad = 12;
  var x = (e.clientX || 0) + pad;
  var y = (e.clientY || 0) + pad;

  var rect = elTooltip.getBoundingClientRect();
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  if (x + rect.width > vw - pad) x = (e.clientX || 0) - rect.width - pad;
  if (y + rect.height > vh - pad) y = (e.clientY || 0) - rect.height - pad;

  // Clamp to viewport
  if (x < 0) x = 2;
  if (y < 0) y = 2;

  elTooltip.style.left = x + 'px';
  elTooltip.style.top = y + 'px';
}

function hideTooltip() {
  elTooltip.style.display = 'none';
}

// Hide tooltip on touch outside
document.addEventListener('touchstart', function(e) {
  if (!e.target.closest('.doll-slot')) {
    hideTooltip();
  }
});

function formatStat(stat, values) {
  if (!stat) return '';
  var v = values || [];
  var name = stat.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  if (v.length === 0) return name;
  if (v.length === 1) return name + ': ' + v[0];
  return name + ': ' + v.join('-');
}

// ── Utilities ────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
