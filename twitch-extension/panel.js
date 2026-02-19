// ── PD2 Armory Twitch Extension Panel ────────────────────────────────────────
// Adapted from public/app.js for 318px Twitch panel

// ── Configuration ────────────────────────────────────────────────────────────
// Replace with your deployed Cloudflare Worker URL
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
}

function addFlag(text, cls) {
  var el = document.createElement('span');
  el.className = 'flag ' + cls;
  el.textContent = text;
  elCharFlags.appendChild(el);
}

// ── Render Stats ─────────────────────────────────────────────────────────────

function renderStats() {
  var s = currentChar.stats || {};
  $('#stat-str').textContent = s.strength || 0;
  $('#stat-dex').textContent = s.dexterity || 0;
  $('#stat-vit').textContent = s.vitality || 0;
  $('#stat-ene').textContent = s.energy || 0;
  $('#stat-life').textContent = s.life || 0;
  $('#stat-mana').textContent = s.mana || 0;
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

  // Sort by points descending
  var sorted = skills.slice().sort(function(a, b) { return b.points - a.points; });
  for (var i = 0; i < sorted.length; i++) {
    var sk = sorted[i];
    var el = document.createElement('div');
    el.className = 'skill-entry';

    var iconHtml = sk.imageUrl
      ? '<img class="skill-icon" src="' + esc(sk.imageUrl) + '" alt="">'
      : '';
    el.innerHTML = '<span class="skill-name">' + iconHtml + esc(sk.name) + '</span><span class="skill-points">' + sk.points + '</span>';

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

    // Tooltip events (mouse + touch for mobile/panel)
    slotEl.onmouseenter = (function(it) { return function(e) { showTooltip(it, e); }; })(item);
    slotEl.onmousemove = function(e) { moveTooltip(e); };
    slotEl.onmouseleave = function() { hideTooltip(); };
    slotEl.ontouchstart = (function(it) { return function(e) { showTooltip(it, e.touches[0]); }; })(item);
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
  var vw = window.innerWidth || 318;
  var vh = window.innerHeight || 496;

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
