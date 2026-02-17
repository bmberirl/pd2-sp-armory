const express = require('express');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const SAVES_DIR = process.env.SAVES_DIR || path.join(__dirname, 'saves');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ── Twitch Cloud Push (optional) ────────────────────────────────────────────
const TWITCH_CHANNEL_ID = process.env.TWITCH_CHANNEL_ID || '';
const TWITCH_PUSH_SECRET = process.env.TWITCH_PUSH_SECRET || '';
const TWITCH_EBS_URL = process.env.TWITCH_EBS_URL || '';
const TWITCH_ENABLED = !!(TWITCH_CHANNEL_ID && TWITCH_PUSH_SECRET && TWITCH_EBS_URL);

// ── State ──────────────────────────────────────────────────────────────────────
const characters = new Map(); // name -> parsed character data
let d2sRead = null;
let d2sConstants = null;
let uniqueNames = [];  // index -> unique item name (from UniqueItems.txt)
let setItemNames = []; // index -> set item name (from SetItems.txt)
let vanillaConstants = null; // kept around for name lookups
let classStats = {};          // className -> { toHitFactor, lifePerVit, manaPerEne, ... }
let difficultyPenalties = {}; // 'Normal'|'Nightmare'|'Hell' -> { resistPenalty }
let experienceTable = [];     // level index -> cumulative XP needed for that level

// ── D2S Library Initialization ─────────────────────────────────────────────────
const CLASS_NAMES = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin'];

const BODY_LOCATIONS = {
  1: 'head', 2: 'neck', 3: 'torso', 4: 'rArm', 5: 'lArm',
  6: 'rRing', 7: 'lRing', 8: 'belt', 9: 'feet', 10: 'hands',
  11: 'rArmSwitch', 12: 'lArmSwitch'
};

const STAT_IDS = {
  0: 'strength', 1: 'energy', 2: 'dexterity', 3: 'vitality',
  4: 'statPoints', 5: 'skillPoints',
  7: 'life', 9: 'mana', 11: 'stamina',
  12: 'level', 13: 'experience', 14: 'gold', 15: 'goldStash'
};

// Bit sizes for character stats (CSvBits from ItemStatCost.txt defaults)
const STAT_BITS = {
  0: 10, 1: 10, 2: 10, 3: 10, 4: 10, 5: 8,
  6: 21, 7: 21, 8: 21, 9: 21, 10: 21, 11: 21,
  12: 7, 13: 32, 14: 25, 15: 25
};

// Number of skills per class in PD2 (vanilla D2 has 30)
const PD2_SKILLS_PER_CLASS = 33;

// PD2 stacked gem/skull/misc type codes → display names
const PD2_ITEM_NAMES = {
  // Stacked gems (code + 's')
  gcvs:'Chipped Amethyst',gfvs:'Flawed Amethyst',gsvs:'Amethyst',gzvs:'Flawless Amethyst',glvs:'Flawless Amethyst',gpvs:'Perfect Amethyst',
  gcws:'Chipped Diamond',gfws:'Flawed Diamond',gsws:'Diamond',gzws:'Flawless Diamond',glws:'Flawless Diamond',gpws:'Perfect Diamond',
  gcgs:'Chipped Emerald',gfgs:'Flawed Emerald',gsgs:'Emerald',gzgs:'Flawless Emerald',glgs:'Flawless Emerald',gpgs:'Perfect Emerald',
  gcrs:'Chipped Ruby',gfrs:'Flawed Ruby',gsrs:'Ruby',gzrs:'Flawless Ruby',glrs:'Flawless Ruby',gprs:'Perfect Ruby',
  gcbs:'Chipped Sapphire',gfbs:'Flawed Sapphire',gsbs:'Sapphire',gzbs:'Flawless Sapphire',glbs:'Flawless Sapphire',gpbs:'Perfect Sapphire',
  gcys:'Chipped Topaz',gfys:'Flawed Topaz',gsys:'Topaz',gzys:'Flawless Topaz',glys:'Flawless Topaz',gpys:'Perfect Topaz',
  skcs:'Chipped Skull',skfs:'Flawed Skull',skus:'Skull',skzs:'Flawless Skull',skls:'Perfect Skull',skps:'Perfect Skull',
  // PD2 quiver tiers (not in vanilla constants)
  aqv2:'Sharp Arrows',aqv3:'Razor Arrows',
  cqv2:'Heavy Bolts',cqv3:'War Bolts',
  // Stacked runes (code + 's')
  r01s:'El Rune',r02s:'Eld Rune',r03s:'Tir Rune',r04s:'Nef Rune',r05s:'Eth Rune',r06s:'Ith Rune',r07s:'Tal Rune',
  r08s:'Ral Rune',r09s:'Ort Rune',r10s:'Thul Rune',r11s:'Amn Rune',r12s:'Sol Rune',r13s:'Shael Rune',r14s:'Dol Rune',
  r15s:'Hel Rune',r16s:'Io Rune',r17s:'Lum Rune',r18s:'Ko Rune',r19s:'Fal Rune',r20s:'Lem Rune',r21s:'Pul Rune',
  r22s:'Um Rune',r23s:'Mal Rune',r24s:'Ist Rune',r25s:'Gul Rune',r26s:'Vex Rune',r27s:'Ohm Rune',r28s:'Lo Rune',
  r29s:'Sur Rune',r30s:'Ber Rune',r31s:'Jah Rune',r32s:'Cham Rune',r33s:'Zod Rune',
};

// ── Parse name arrays from TXT files ────────────────────────────────────────
function parseTxtNames(filePath, nameCol = 'index') {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const col = header.indexOf(nameCol);
  if (col < 0) return [];
  const names = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const name = cells[col]?.trim();
    if (!name || name === 'Expansion') continue;
    names.push(name);
  }
  return names;
}

// Parse Skills.txt to build skill ID -> name map for PD2-specific skills
function parseSkillNames(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const nameCol = header.indexOf('skill');
  const idCol = header.findIndex(h => h === 'Id' || h === '*Id');
  if (nameCol < 0 || idCol < 0) return {};
  const skills = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const id = parseInt(cells[idCol]);
    const name = cells[nameCol]?.trim();
    if (!isNaN(id) && name) {
      skills[id] = name;
    }
  }
  return skills;
}

// Parse CharStats.txt → class-specific constants (ToHitFactor, life/mana per stat, etc.)
function parseCharStatsFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const col = (name) => header.indexOf(name);
  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const cls = cells[col('class')]?.trim();
    if (!cls || cls === 'Expansion') continue;
    result[cls] = {
      toHitFactor: parseInt(cells[col('ToHitFactor')]) || 0,
      lifePerLevel: (parseInt(cells[col('LifePerLevel')]) || 0) / 4,
      manaPerLevel: (parseInt(cells[col('ManaPerLevel')]) || 0) / 4,
      staminaPerLevel: (parseInt(cells[col('StaminaPerLevel')]) || 0) / 4,
      lifePerVit: (parseInt(cells[col('LifePerVitality')]) || 0) / 4,
      manaPerEne: (parseInt(cells[col('ManaPerMagic')]) || 0) / 4,
      staminaPerVit: (parseInt(cells[col('StaminaPerVitality')]) || 0) / 4,
      baseStr: parseInt(cells[col('str')]) || 0,
      baseDex: parseInt(cells[col('dex')]) || 0,
      baseVit: parseInt(cells[col('vit')]) || 0,
      baseEne: parseInt(cells[col('int')]) || 0,
      baseLife: parseInt(cells[col('hpadd')]) || 0,
      baseStamina: parseInt(cells[col('stamina')]) || 0,
      blockFactor: parseInt(cells[col('BlockFactor')]) || 0,
    };
  }
  return result;
}

// Parse DifficultyLevels.txt → resist penalty per difficulty
function parseDifficultyFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const nameCol = header.indexOf('Name');
  const resCol = header.indexOf('ResistPenalty');
  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const name = cells[nameCol]?.trim();
    if (!name) continue;
    result[name] = { resistPenalty: parseInt(cells[resCol]) || 0 };
  }
  return result;
}

// Parse Experience.txt → array of cumulative XP per level
function parseExperienceFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const table = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const level = parseInt(cells[0]);
    if (isNaN(level) || cells[0] === 'MaxLvl') continue;
    // All classes have the same XP table; use Amazon (column 1)
    table[level] = parseInt(cells[1]) || 0;
  }
  return table;
}

// ── PD2 Wiki Image URL Helper ─────────────────────────────────────────────
// MediaWiki hash-based image URLs:
// https://static.wikitide.net/projectdiablo2wiki/{md5[0]}/{md5[0:2]}/{Filename}.png

// Set of all image filenames available on the wiki (populated at startup)
let wikiImageSet = new Set();
// Normalized name → actual filename lookup (lowercase, no spaces/underscores)
let wikiImageLookup = {};

// Manual overrides: item display name → wiki image filename (without .png)
// For items where the wiki uses a completely different image filename
const WIKI_IMAGE_OVERRIDES = {
  // Helms
  'The Face of Horror': 'Mask_D2',
  'Peasant Crown': 'Cap_D2',
  'Stealskull': 'Coif_of_Glory',
  "Blackhorn's Face": 'Mask_D2',
  'Valkyrie Wing': 'Great_Helm',
  "Andariel's Visage": 'Mask_D2',
  'Veil of Steel': 'Veil_of_Steel_D1',
  "Arreat's Face": 'Avenger_Guard',
  'Wolfhowl': 'Fanged_Helm',
  "Demonhorn's Edge": 'Horned_Helm',
  "Halaberd's Reign": 'Assault_Helmet',
  "Jalal's Mane": 'Spirit_Mask',
  'Spirit Keeper': 'Antlers',
  // Swords
  'Bloodletter': "Rixot's_Keen",
  'Coldsteel Eye': 'Blood_Crescent',
  'Crainte Vomir': 'Shadowfang',
  'Bing Sz Wang': 'Claymore',
  'Cloudcrack': 'Blacktongue',
  'Djinn Slayer': 'Blood_Crescent',
  'Azurewrath': 'Crystal_Sword',
  // Belts
  'String of Ears': 'Sash',
  'Razortail': 'Light_Belt',
  "Gloom's Trap": 'Belt',
  'Snowclash': 'Heavy_Belt',
  "Thundergod's Vigor": 'Plated_Belt',
  "Nosferatu's Coil": 'Light_Belt',
  // Boots
  'Infernostride': 'Boots',
  'Waterwalk': 'Heavy_Boots',
  'Silkweave': 'Chain_Boots',
  'War Traveler': 'Light_Plated_Boots',
  'Gore Rider': 'Greaves',
  'Sandstorm Trek': 'Heavy_Boots',
  'Marrowwalk': 'Chain_Boots',
  // Gloves
  'Venom Grip': 'Leather_Gloves',
  'Gravepalm': 'Heavy_Gloves',
  'Ghoulhide': 'Chain_Gloves',
  'Lava Gout': 'Light_Gauntlets',
  'Hellmouth': 'Gauntlets',
  "Titan's Grip": 'Invbramble',
  'Steelrend': 'Gauntlets',
  // Shields
  'Visceratuant': 'Pelta_Lunata',
  "Tiamat's Rebuke": 'Steelclash',
  "Gerke's Sanctuary": 'Bverrit_Keep',
  "Radament's Sphere": 'The_Ward',
  'Blackoak Shield': 'Umbral_Disk',
  'Spike Thorn': 'Swordback_Hold',
  'Stormshield': 'Steelclash',
  "Head Hunter's Glory": 'Wall_of_the_Eyeless',
  "Medusa's Gaze": 'Bverrit_Keep',
  'Spirit Ward': 'The_Ward',
  'Homunculus': 'Demon_Head',
  'Boneflame': 'Gargoyle_Head',
  'Darkforce Spawn': 'Demon_Head',
  'Herald of Zakarum': 'Aerin_Shield',
  'Alma Negra': 'Rondache',
  'Dragonscale': 'Aerin_Shield',
  // Axes
  'Rakescar': 'War_Axe',
  'Axe of Fechmar': 'Large_Axe',
  'Goreshovel': 'Broad_Axe',
  'Islestrike': 'Double_Axe',
  'Guardian Naga': 'War_Axe',
  'Boneslayer Blade': 'Brainhew',
  "Razor's Edge": 'The_Gnasher',
  'Cranebeak': 'Skull_Splitter',
  'Death Cleaver': 'War_Axe',
  "Executioner's Justice": 'Humongous',
  // Maces
  'Dark Clan Crusher': 'Felloak',
  'Fleshrender': 'Stoutnail',
  'Sureshrill Frost': 'Crushflange',
  'Moonfall': 'Bloodrise',
  "Baezil's Vortex": "The_General's_Tan_Do_Li_Ga",
  'Earthshaker': 'War_Hammer',
  'Bloodtree Stump': 'Maul',
  "Nord's Tenderizer": 'Felloak',
  'Demon Limb': 'Stoutnail',
  "Baranar's Star": 'Bloodrise',
  "Horizon's Tornado": "The_General's_Tan_Do_Li_Ga",
  'Stormlash': "The_General's_Tan_Do_Li_Ga",
  'Stone Crusher': 'War_Hammer',
  "Schaefer's Hammer": 'Ironstone',
  'Earth Shifter': 'Steeldriver',
  'The Cranium Basher': 'Great_Maul',
  // Polearms
  "Dimoak's Hew": 'Bardiche_D2',
  'The Battlebranch': 'Poleaxe',
  'Woestave': 'Halberd_D2',
  'The Grim Reaper': 'War_Scythe',
  'Blackleach Blade': 'Voulge',
  'Pierre Tombale Couant': 'Poleaxe',
  'Husoldal Evo': 'Halberd_D2',
  "Grim's Burning Dead": 'War_Scythe',
  "The Reaper's Toll": 'Scythe',
  'Tomb Reaver': 'Poleaxe',
  'Stormspire': 'War_Scythe',
  // Spears
  'Kelpie Snare': 'Razortine',
  'Hone Sundan': 'Lance_of_Yaggai',
  "Arioc's Needle": 'Spear',
  'Steel Pillar': 'Pike',
  // Bows
  'Blastbark': 'Long_War_Bow',
  'Skystrike': 'Short_Bow',
  'Endlesshail': "Rogue's_Bow",
  'Cliffkiller': 'Long_Battle_Bow',
  'Magewrath': 'Hellclap',
  // Crossbows
  'Buriza-Do Kyanon': 'Hellcast',
  'Hellrack': 'Hellcast',
  'Pus Spiter': 'Pus_Spitter',
  'Pus Spitter': 'Pus_Spitter',
  // Staves
  'Razorswitch': 'Short_Staff',
  'Chromatic Ire': 'Spire_of_Lazarus',
  "Ondal's Wisdom": 'Spire_of_Lazarus',
  // Wands
  'Suicide Branch': 'Wand_D2',
  'Arm of King Leoric': 'Gravenspine',
  'Boneshade': 'Gravenspine',
  // Scepters
  'Knell Striker': 'Scepter',
  'Rusthandle': 'Grand_Scepter',
  'Stormeye': 'War_Scepter',
  "Zakarum's Hand": 'Scepter',
  'The Fetid Sprinkler': 'Grand_Scepter',
  'Hand of Blessed Light': 'War_Scepter',
  "Heaven's Light": 'Scepter',
  'The Redeemer': 'Scepter',
  "Astreon's Iron Ward": 'War_Scepter',
  // Daggers
  'Gull': 'Dagger_D2',
  'Spineripper': 'Dagger_D2',
  'Heart Carver': 'The_Diggler',
  "Blackbog's Sharp": 'The_Jade_Tan_Do',
  'Wizardspike': 'Dagger_D2',
  'Fleshripper': 'The_Jade_Tan_Do',
  // Throwing
  'Deathbit': 'Throwing_Knife',
  'The Scalper': 'Throwing_Axe',
  'Gimmershred': 'Throwing_Axe',
  // Orbs / Class Weapons
  "Lycander's Aim": 'Reflex_Bow',
  "Lycander's Flank": 'Maiden_Pike',
  'Stoneraven': 'Maiden_Spear',
  "Titan's Revenge": 'Maiden_Javelin',
  'Thunderstroke': 'Maiden_Javelin',
  "Bartuc's Cut-Throat": 'Blade_Talons',
  'Jade Talon': 'Wrist_Blade',
  "Firelizard's Talons": 'Claws',
  'Tempest': 'Tempest_orb',
  'The Oculus': "Jared's_Stone",
  "Eschuta's Temper": 'Sacred_Globe',
  "Death's Fathom": "Jared's_Stone",

  // ── Base item overrides (normal items with _D2 suffix, generic, exceptional/elite → normal) ──

  // Generic
  'Ring': 'Ring_1',
  'Amulet': 'Amulet_1',

  // Charms and misc inventory items
  'Small Charm': 'Small_Charm_1',
  'Large Charm': 'Large_Charm_1',
  'Grand Charm': 'Grand_Charm_1',
  'Jewel': 'Jewel_blue',
  'Glowing Orb': 'Eagle_Orb',

  // Potions — healing (all tiers use Super image)
  'Minor Healing Potion': 'Super_Healing_Potion', 'Light Healing Potion': 'Super_Healing_Potion',
  'Healing Potion': 'Super_Healing_Potion', 'Greater Healing Potion': 'Super_Healing_Potion',
  'Super Healing Potion': 'Super_Healing_Potion',
  // Potions — mana (all tiers use Super image)
  'Minor Mana Potion': 'Super_Mana_Potion', 'Light Mana Potion': 'Super_Mana_Potion',
  'Mana Potion': 'Super_Mana_Potion', 'Greater Mana Potion': 'Super_Mana_Potion',
  'Super Mana Potion': 'Super_Mana_Potion',
  // Potions — rejuvenation, utility
  'Rejuvenation Potion': '/img/rejuv_small.gif', 'Full Rejuvenation Potion': '/img/rejuv.gif',
  'Antidote Potion': 'Antidote_Potion', 'Thawing Potion': 'Thawing_Potion',
  'Stamina Potion': 'Stamina_Potion', 'Chilling Potion': 'Chilling_Potion',
  // Potions — throwing
  'Strangling Gas Potion': 'Strangling_Gas_Potion', 'Choking Gas Potion': 'Choking_Gas_Potion',
  'Rancid Gas Potion': 'Rancid_Gas_Potion', 'Fulminating Potion': 'Fulminating_Potion',
  'Exploding Potion': 'Exploding_Potion', 'Oil Potion': 'Oil_Potion',

  // Ammo
  'Arrows': 'Arrows', 'Crude Arrows': 'Arrows', 'Sharp Arrows': 'Arrows', 'Razor Arrows': 'Arrows',
  'Bolts': 'Bolts', 'Light Bolts': 'Bolts', 'Heavy Bolts': 'Bolts', 'War Bolts': 'Bolts',

  // Gems
  'Chipped Amethyst': 'Gem_Chipped_Amethyst', 'Flawed Amethyst': 'Gem_Flawed_Amethyst', 'Amethyst': 'Gem_Amethyst', 'Flawless Amethyst': 'Gem_Flawless_Amethyst', 'Perfect Amethyst': 'Gem_Perfect_Amethyst',
  'Chipped Diamond': 'Gem_Chipped_Diamond', 'Flawed Diamond': 'Gem_Flawed_Diamond', 'Diamond': 'Gem_Diamond', 'Flawless Diamond': 'Gem_Flawless_Diamond', 'Perfect Diamond': 'Gem_Perfect_Diamond',
  'Chipped Emerald': 'Gem_Chipped_Emerald', 'Flawed Emerald': 'Gem_Flawed_Emerald', 'Emerald': 'Gem_Emerald', 'Flawless Emerald': 'Gem_Flawless_Emerald', 'Perfect Emerald': 'Gem_Perfect_Emerald',
  'Chipped Ruby': 'Gem_Chipped_Ruby', 'Flawed Ruby': 'Gem_Flawed_Ruby', 'Ruby': 'Gem_Ruby', 'Flawless Ruby': 'Gem_Flawless_Ruby', 'Perfect Ruby': 'Gem_Perfect_Ruby',
  'Chipped Sapphire': 'Gem_Chipped_Sapphire', 'Flawed Sapphire': 'Gem_Flawed_Sapphire', 'Sapphire': 'Gem_Sapphire', 'Flawless Sapphire': 'Gem_Flawless_Sapphire', 'Perfect Sapphire': 'Gem_Perfect_Sapphire',
  'Chipped Topaz': 'Gem_Chipped_Topaz', 'Flawed Topaz': 'Gem_Flawed_Topaz', 'Topaz': 'Gem_Topaz', 'Flawless Topaz': 'Gem_Flawless_Topaz', 'Perfect Topaz': 'Gem_Perfect_Topaz',
  'Chipped Skull': 'Gem_Chipped_Skull', 'Flawed Skull': 'Gem_Flawed_Skull', 'Skull': 'Gem_Skull', 'Flawless Skull': 'Gem_Flawless_Skull', 'Perfect Skull': 'Gem_Perfect_Skull',

  // Runes
  'El Rune': 'RuneEl', 'Eld Rune': 'RuneEld', 'Tir Rune': 'RuneTir', 'Nef Rune': 'RuneNef', 'Eth Rune': 'RuneEth',
  'Ith Rune': 'RuneIth', 'Tal Rune': 'RuneTal', 'Ral Rune': 'RuneRal', 'Ort Rune': 'RuneOrt', 'Thul Rune': 'RuneThul',
  'Amn Rune': 'RuneAmn', 'Sol Rune': 'RuneSol', 'Shael Rune': 'RuneShael', 'Dol Rune': 'RuneDol', 'Hel Rune': 'RuneHel',
  'Io Rune': 'RuneIo', 'Lum Rune': 'RuneLum', 'Ko Rune': 'RuneKo', 'Fal Rune': 'RuneFal', 'Lem Rune': 'RuneLem',
  'Pul Rune': 'RunePul', 'Um Rune': 'RuneUm', 'Mal Rune': 'RuneMal', 'Ist Rune': 'RuneIst', 'Gul Rune': 'RuneGul',
  'Vex Rune': 'RuneVex', 'Ohm Rune': 'RuneOhm', 'Lo Rune': 'RuneLo', 'Sur Rune': 'RuneSur', 'Ber Rune': 'RuneBer',
  'Jah Rune': 'RuneJah', 'Cham Rune': 'RuneCham', 'Zod Rune': 'RuneZod',

  // Skills with _D2 suffix on wiki (name conflicts with non-D2 concepts)
  'Armageddon': 'Armageddon_D2', 'Bash': 'Bash_D2', 'Blizzard': 'Blizzard_D2',
  'Charge': 'Charge_D2', 'Concentration': 'Concentration_D2', 'Conversion': 'Conversion_D2',
  'Dodge': 'Dodge_D2', 'Lightning': 'Lightning_D2', 'Meditation': 'Meditation_D2',
  'Meteor': 'Meteor_D2', 'Nova': 'Nova_D2', 'Prayer': 'Prayer_D2',
  'Teeth': 'Teeth_D2', 'Teleport': 'Teleport_D2', 'Terror': 'Terror_D2',
  'Thorns': 'Thorns_D2', 'Volcano': 'Volcano_D2', 'Maul': 'Maul_D2',
  // Skills with no exact wiki match — map to closest available image
  'Frozen Armor': 'Chilling_Armor',
  'Sword Mastery': 'Polearm_and_Spear_Mastery', 'Axe Mastery': 'Polearm_and_Spear_Mastery',
  'Mace Mastery': 'Polearm_and_Spear_Mastery', 'Polearm Mastery': 'Polearm_and_Spear_Mastery',
  'Spear Mastery': 'Polearm_and_Spear_Mastery', 'Bow and Crossbow Mastery': 'Polearm_and_Spear_Mastery',

  // Normal helms with wiki _D2 suffix
  'Cap': 'Cap_D2',
  'Helm': 'Helm_D2',
  'Crown': 'Crown_D2',
  'Mask': 'Mask_D2',
  'Coronet': 'Coronet_D2',
  'Tiara': 'Tiara_D2',
  // Exceptional helms → normal wiki images
  'War Hat': 'Cap_D2',
  'Sallet': 'Skull_Cap',
  'Casque': 'Helm_D2',
  'Basinet': 'Full_Helm',
  'Winged Helm': 'Great_Helm',
  'Grand Crown': 'Crown_D2',
  'Death Mask': 'Mask_D2',
  'Grim Helm': 'Bone_Helm',
  // Elite helms → normal wiki images
  'Shako': 'Cap_D2',
  'Hydraskull': 'Skull_Cap',
  'Armet': 'Helm_D2',
  'Giant Conch': 'Full_Helm',
  'Spired Helm': 'Great_Helm',
  'Corona': 'Crown_D2',
  'Demonhead': 'Mask_D2',
  'Bone Visage': 'Bone_Helm',

  // Druid pelts → closest helm
  'Jawbone Visor': 'Jawbone_Cap',
  'Lion Helm': 'Jawbone_Cap',
  'Rage Mask': 'Fanged_Helm',
  'Savage Helmet': 'Assault_Helmet',
  'Slayer Guard': 'Avenger_Guard',
  'Fury Visor': 'Jawbone_Cap',
  'Destroyer Helm': 'Jawbone_Cap',
  'Conqueror Crown': 'Fanged_Helm',
  'Guardian Crown': 'Assault_Helmet',
  // Barbarian helms
  'Carnage Helm': 'Horned_Helm',
  'Blood Spirit': 'Spirit_Mask',
  'Sun Spirit': 'Spirit_Mask',
  'Earth Spirit': 'Spirit_Mask',
  'Sky Spirit': 'Spirit_Mask',
  'Dream Spirit': 'Spirit_Mask',
  'Totemic Mask': 'Hawk_Helm',
  'Alpha Helm': 'Wolf_Head',
  'Blood Helm': 'Hawk_Helm',
  'Minion Skull': 'Hawk_Helm',

  // Normal weapons with wiki _D2 suffix
  'Bardiche': 'Bardiche_D2',
  'Halberd': 'Halberd_D2',
  'Dagger': 'Dagger_D2',
  'Dirk': 'Dirk_D2',
  'Blade': 'Blade_D2',
  'Mace': 'Mace_D2',
  'Glaive': 'Glaive_D2',
  'Flamberge': 'Flamberge_D2',
  'Trident': 'Trident_D2',
  'Wand': 'Wand_D2',

  // Exceptional swords → normal wiki images
  'Gladius': 'Short_Sword',
  'Cutlass': 'Scimitar',
  'Shamshir': 'Sabre',
  'Tulwar': 'Falchion',
  'Dimensional Blade': 'Crystal_Sword',
  'Battle Sword': 'Broad_Sword',
  'Rune Sword': 'Long_Sword',
  'Ancient Sword': 'Bastard_Sword',
  'Espandon': 'Two-Handed_Sword',
  'Dacian Falx': 'Flamberge_D2',
  'Tusk Sword': 'Claymore',
  'Gothic Sword': 'Giant_Sword',
  'Zweihander': 'Great_Sword',
  // Elite swords → normal wiki images
  'Falcata': 'Short_Sword',
  'Ataghan': 'Scimitar',
  'Elegant Blade': 'Sabre',
  'Hydra Edge': 'Falchion',
  'Phase Blade': 'Crystal_Sword',
  'Conquest Sword': 'Broad_Sword',
  'Cryptic Sword': 'Long_Sword',
  'Mythical Sword': 'Bastard_Sword',
  'Legend Sword': 'Two-Handed_Sword',
  'Highland Blade': 'Flamberge_D2',
  'Balrog Blade': 'Claymore',
  'Champion Sword': 'Giant_Sword',
  'Colossus Sword': 'Great_Sword',
  'Colossus Blade': 'Giant_Sword',
  'Mithril Point': 'Dirk_D2',
  'Fanged Knife': 'Dagger_D2',

  // Exceptional axes → normal wiki images
  'Hatchet': 'Hand_Axe',
  'Cleaver': 'Axe',
  'Twin Axe': 'Double_Axe',
  'Military Axe': 'Large_Axe',
  'Tabar': 'Broad_Axe',
  'Gothic Axe': 'Great_Axe',
  'Ancient Axe': 'Giant_Axe',
  'Naga': 'War_Axe',
  'Crowbill': 'Military_Pick',
  // Elite axes → normal wiki images
  'Tomahawk': 'Hand_Axe',
  'Small Crescent': 'Axe',
  'Ettin Axe': 'Double_Axe',
  'War Spike': 'Military_Pick',
  'Berserker Axe': 'War_Axe',
  'Feral Axe': 'Large_Axe',
  'Silver-Edged Axe': 'Broad_Axe',
  'Decapitator': 'Great_Axe',
  'Champion Axe': 'Giant_Axe',
  'Glorious Axe': 'Giant_Axe',

  // Exceptional maces → normal wiki images
  'Cudgel': 'Club',
  'Barbed Club': 'Spiked_Club',
  'Flanged Mace': 'Mace_D2',
  'Jagged Star': 'Morning_Star',
  'Knout': 'Flail',
  'Battle Hammer': 'War_Hammer',
  'War Club': 'Maul',
  'Martel de Fer': 'Great_Maul',
  // Elite maces → normal wiki images
  'Tyrant Club': 'Club',
  'Devil Star': 'Morning_Star',
  'Scourge': 'Flail',
  'Legendary Mallet': 'War_Hammer',
  'Ogre Maul': 'Maul',
  'Thunder Maul': 'Great_Maul',
  'Reinforced Mace': 'Mace_D2',
  'Winged Hatchet': 'Throwing_Axe',

  // Exceptional polearms → normal wiki images
  'Lochaber Axe': 'Bardiche_D2',
  'Bill': 'Voulge',
  'Battle Scythe': 'Scythe',
  'Partizan': 'Poleaxe',
  'Bec-de-Corbin': 'Halberd_D2',
  'Grim Scythe': 'War_Scythe',
  // Elite polearms → normal wiki images
  'Ogre Axe': 'Bardiche_D2',
  'Colossus Voulge': 'Voulge',
  'Thresher': 'Scythe',
  'Cryptic Axe': 'Poleaxe',
  'Great Poleaxe': 'Halberd_D2',
  'Giant Thresher': 'War_Scythe',

  // Exceptional spears → normal wiki images
  'War Spear': 'Spear',
  'Fuscina': 'Trident_D2',
  'War Fork': 'Brandistock',
  'Yari': 'Spetum',
  'Lance': 'Pike',
  // Elite spears → normal wiki images
  'Hyperion Spear': 'Spear',
  'Stygian Pike': 'Trident_D2',
  'Mancatcher': 'Brandistock',
  'Ghost Spear': 'Spetum',
  'War Pike': 'Pike',

  // Exceptional scepters → normal wiki images
  'Mighty Scepter': 'Scepter',
  'Seraph Rod': 'Grand_Scepter',
  'Caduceus': 'War_Scepter',
  // Elite scepters → normal wiki images
  'Divine Scepter': 'Scepter',
  'Holy Water Sprinkler': 'Grand_Scepter',

  // Exceptional wands → normal wiki images
  'Burnt Wand': 'Wand_D2',
  'Petrified Wand': 'Yew_Wand',
  'Tomb Wand': 'Bone_Wand',
  'Grave Wand': 'Grim_Wand',
  // Elite wands → normal wiki images
  'Polished Wand': 'Wand_D2',
  'Ghost Wand': 'Yew_Wand',
  'Lich Wand': 'Bone_Wand',
  'Unearthed Wand': 'Grim_Wand',

  // Exceptional staves → normal wiki images
  'Jo Staff': 'Short_Staff',
  'Quarterstaff': 'Long_staff',
  'Cedar Staff': 'Gnarled_Staff',
  'Gothic Staff': 'Battle_Staff',
  'Rune Staff': 'War_Staff',
  // Elite staves → normal wiki images
  'Walking Stick': 'Short_Staff',
  'Stalagmite': 'Long_staff',
  'Elder Staff': 'Gnarled_Staff',
  'Shillelagh': 'Battle_Staff',
  'Archon Staff': 'War_Staff',

  // Exceptional bows → normal wiki images
  'Edge Bow': 'Short_Bow',
  'Razor Bow': 'Hunter\'s_Bow',
  'Cedar Bow': 'Long_Bow',
  'Double Bow': 'Composite_Bow',
  'Short Siege Bow': 'Short_Battle_Bow',
  'Large Siege Bow': 'Long_Battle_Bow',
  'Rune Bow': 'Short_War_Bow',
  'Gothic Bow': 'Long_War_Bow',
  // Elite bows → normal wiki images
  'Spider Bow': 'Short_Bow',
  'Blade Bow': 'Hunter\'s_Bow',
  'Shadow Bow': 'Long_Bow',
  'Great Bow': 'Composite_Bow',
  'Diamond Bow': 'Short_Battle_Bow',
  'Crusader Bow': 'Long_Battle_Bow',
  'Ward Bow': 'Short_War_Bow',
  'Hydra Bow': 'Long_War_Bow',

  // Exceptional crossbows → normal wiki images
  'Arbalest': 'Light_Crossbow',
  'Siege Crossbow': 'Crossbow',
  'Ballista': 'Heavy_Crossbow',
  'Chu-Ko-Nu': 'Repeating_Crossbow',
  // Elite crossbows → normal wiki images
  'Pellet Bow': 'Light_Crossbow',
  'Gorgon Crossbow': 'Crossbow',
  'Colossus Crossbow': 'Heavy_Crossbow',
  'Demon Crossbow': 'Repeating_Crossbow',

  // Exceptional armor → normal wiki images
  'Ghost Armor': 'Quilted_Armor',
  'Serpentskin Armor': 'Leather_Armor',
  'Demonhide Armor': 'Hard_Leather_Armor',
  'Trellised Armor': 'Studded_Leather',
  'Linked Mail': 'Ring_Mail',
  'Tigulated Mail': 'Scale_Mail',
  'Mesh Armor': 'Chain_Mail',
  'Cuirass': 'Breast_Plate',
  'Russet Armor': 'Splint_Mail',
  'Templar Coat': 'Light_Plate',
  'Sharktooth Armor': 'Plate_Mail',
  'Embossed Plate': 'Field_Plate',
  'Chaos Armor': 'Gothic_Plate',
  'Ornate Plate': 'Full_Plate_Mail',
  'Mage Plate': 'Ancient_Armor',
  // Elite armor → normal wiki images
  'Dusk Shroud': 'Quilted_Armor',
  'Wyrmhide': 'Leather_Armor',
  'Scarab Husk': 'Hard_Leather_Armor',
  'Wire Fleece': 'Studded_Leather',
  'Diamond Mail': 'Ring_Mail',
  'Loricated Mail': 'Scale_Mail',
  'Boneweave': 'Chain_Mail',
  'Great Hauberk': 'Breast_Plate',
  'Balrog Skin': 'Splint_Mail',
  'Hellforge Plate': 'Light_Plate',
  'Kraken Shell': 'Plate_Mail',
  'Lacquered Plate': 'Field_Plate',
  'Shadow Plate': 'Gothic_Plate',
  'Sacred Armor': 'Full_Plate_Mail',
  'Archon Plate': 'Ancient_Armor',

  // Exceptional shields → normal wiki images
  'Defender': 'Buckler',
  'Round Shield': 'Small_Shield',
  'Scutum': 'Large_Shield',
  'Dragon Shield': 'Kite_Shield',
  'Barbed Shield': 'Spiked_Shield',
  'Pavise': 'Tower_Shield',
  'Ancient Shield': 'Gothic_Shield',
  'Grim Shield': 'Bone_Shield',
  // Elite shields → normal wiki images
  'Heater': 'Buckler',
  'Luna': 'Small_Shield',
  'Hyperion': 'Large_Shield',
  'Monarch': 'Kite_Shield',
  'Blade Barrier': 'Spiked_Shield',
  'Aegis': 'Tower_Shield',
  'Ward': 'Gothic_Shield',
  'Troll Nest': 'Bone_Shield',

  // Paladin shields - exceptional
  'Gilded Shield': 'Heraldic_Shield',
  'Royal Shield': 'Aerin_Shield',
  'Sacred Targe': 'Targe',
  'Sacred Rondache': 'Rondache',
  'Kurast Shield': 'Crown_Shield',
  'Zakarum Shield': 'Aerin_Shield',
  'Vortex Shield': 'Aerin_Shield',
  'Protector Shield': 'Heraldic_Shield',
  'Akaran Targe': 'Targe',
  'Akaran Rondache': 'Rondache',

  // Necro heads - exceptional/elite
  'Mummified Trophy': 'Preserved_Head',
  'Fetish Trophy': 'Zombie_Head',
  'Sexton Trophy': 'Unraveller_Head',
  'Cantor Trophy': 'Gargoyle_Head',
  'Hierophant Trophy': 'Demon_Head',
  'Minion Skull': 'Preserved_Head',
  'Hellspawn Skull': 'Zombie_Head',
  'Overseer Skull': 'Unraveller_Head',
  'Succubus Skull': 'Gargoyle_Head',
  'Bloodlord Skull': 'Demon_Head',

  // Exceptional boots → normal wiki images
  'Demonhide Boots': 'Boots',
  'Sharkskin Boots': 'Heavy_Boots',
  'Mesh Boots': 'Chain_Boots',
  'Battle Boots': 'Light_Plated_Boots',
  'War Boots': 'Greaves',
  // Elite boots → normal wiki images
  'Wyrmhide Boots': 'Boots',
  'Scarabshell Boots': 'Heavy_Boots',
  'Boneweave Boots': 'Chain_Boots',
  'Mirrored Boots': 'Light_Plated_Boots',
  'Myrmidon Greaves': 'Greaves',

  // Exceptional gloves → normal wiki images
  'Demonhide Gloves': 'Leather_Gloves',
  'Sharkskin Gloves': 'Heavy_Gloves',
  'Heavy Bracers': 'Chain_Gloves',
  'Vambraces': 'Light_Gauntlets',
  'Crusader Gauntlets': 'Gauntlets',
  // Elite gloves → normal wiki images
  'Bramble Mitts': 'Leather_Gloves',
  'Vampirebone Gloves': 'Heavy_Gloves',
  'Ogre Gauntlets': 'Chain_Gloves',
  'Immortal King\'s Forge': 'Gauntlets',
  'Battle Gauntlets': 'Gauntlets',

  // Exceptional belts → normal wiki images
  'Demonhide Sash': 'Sash',
  'Sharkskin Belt': 'Light_Belt',
  'Mesh Belt': 'Belt',
  'Battle Belt': 'Heavy_Belt',
  'War Belt': 'Plated_Belt',
  // Elite belts → normal wiki images
  'Spiderweb Sash': 'Sash',
  'Vampirefang Belt': 'Light_Belt',
  'Mithril Coil': 'Belt',
  'Troll Belt': 'Heavy_Belt',
  'Colossus Girdle': 'Plated_Belt',

  // Amazon weapons - exceptional/elite
  'Ceremonial Bow': 'Stag_Bow',
  'Ceremonial Pike': 'Maiden_Pike',
  'Ceremonial Spear': 'Maiden_Spear',
  'Ceremonial Javelin': 'Maiden_Javelin',
  'Matriarchal Bow': 'Reflex_Bow',
  'Matriarchal Pike': 'Maiden_Pike',
  'Matriarchal Spear': 'Maiden_Spear',
  'Matriarchal Javelin': 'Maiden_Javelin',
  'Grand Matron Bow': 'Reflex_Bow',

  // Assassin claws - exceptional/elite
  'Quhab': 'Katar',
  'Wrist Spike': 'Wrist_Blade',
  'Fascia': 'Claws',
  'Hand Scythe': 'Blade_Talons',
  'Greater Claws': 'Scissors_Katar',
  'Greater Talons': 'Scissors_Katar',
  'Scissors Quhab': 'Scissors_Katar',
  'Suwayyah': 'Katar',
  'Wrist Sword': 'Wrist_Blade',
  'War Fist': 'Cestus',
  'Battle Cestus': 'Cestus',
  'Feral Claws': 'Claws',
  'Runic Talons': 'Blade_Talons',
  'Scissors Suwayyah': 'Scissors_Katar',

  // Sorceress orbs - exceptional/elite
  'Swirling Crystal': 'Clasped_Orb',
  'Crystalline Globe': 'Eagle_Orb',
  'Cloudy Sphere': 'Smoked_Sphere',
  'Sparkling Ball': 'Sacred_Globe',
  'Heavenly Stone': 'Horadrim_Orb',
  'Eldritch Orb': 'Clasped_Orb',
  'Demon Heart': 'Eagle_Orb',
  'Vortex Orb': 'Smoked_Sphere',
  'Dimensional Shard': 'Sacred_Globe',
};

async function fetchWikiImageList() {
  const https = require('https');
  const allNames = [];
  let aicontinue = '';

  const fetchPage = (cont) => new Promise((resolve, reject) => {
    const base = 'https://wiki.projectdiablo2.com/w/api.php?action=query&list=allimages&ailimit=500&format=json';
    const urlStr = cont ? base + '&aicontinue=' + encodeURIComponent(cont) : base;
    const urlObj = new URL(urlStr);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'PD2Armory/1.0 (item image lookup)' },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed (status ' + res.statusCode + '): ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });

  try {
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

    wikiImageSet = new Set(allNames);

    // Build normalized lookup: strip extension, lowercase, remove all spaces/underscores/hyphens/apostrophes
    wikiImageLookup = {};
    for (const fn of allNames) {
      const base = fn.replace(/\.png$/i, '');
      const norm = base.toLowerCase().replace(/[_ '\-]/g, '');
      // First match wins (don't overwrite)
      if (!wikiImageLookup[norm]) {
        wikiImageLookup[norm] = fn;
      }
    }

    console.log(`[OK] Wiki image index: ${allNames.length} PNG images cached`);
  } catch (e) {
    console.warn('[WARN] Failed to fetch wiki image list:', e.message);
  }
}

function filenameToUrl(filename) {
  return '/img/wiki/' + encodeURIComponent(filename);
}

function getWikiImageUrl(name) {
  if (!name) return null;

  // 1. Check manual overrides first (handles wiki naming mismatches)
  const override = WIKI_IMAGE_OVERRIDES[name];
  if (override) {
    if (override.startsWith('/')) return override; // local asset path
    const overrideFn = override.replace(/ /g, '_') + '.png';
    return filenameToUrl(overrideFn);
  }

  // 2. Try exact filename match against wiki image index
  const exactFn = name.replace(/ /g, '_') + '.png';
  if (wikiImageSet.has(exactFn)) {
    return filenameToUrl(exactFn);
  }

  // 3. Try normalized fuzzy match (handles Steelshade vs Steel_Shade, etc.)
  const norm = name.toLowerCase().replace(/[_ '\-]/g, '');
  const matched = wikiImageLookup[norm];
  if (matched) {
    return filenameToUrl(matched);
  }

  // No match found — return null so client doesn't show broken image
  return null;
}

// ── Twitch Cloud Push Helpers ─────────────────────────────────────────────

function filenameToWikitideUrl(filename) {
  const hash = crypto.createHash('md5').update(filename).digest('hex');
  return `https://static.wikitide.net/projectdiablo2wiki/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(filename)}`;
}

function getWikiImageUrlAbsolute(name) {
  if (!name) return null;

  // 1. Check manual overrides
  const override = WIKI_IMAGE_OVERRIDES[name];
  if (override) {
    if (override.startsWith('/')) return null; // local-only asset (e.g. rejuv gifs)
    const overrideFn = override.replace(/ /g, '_') + '.png';
    return filenameToWikitideUrl(overrideFn);
  }

  // 2. Exact match
  const exactFn = name.replace(/ /g, '_') + '.png';
  if (wikiImageSet.has(exactFn)) {
    return filenameToWikitideUrl(exactFn);
  }

  // 3. Fuzzy match
  const norm = name.toLowerCase().replace(/[_ '\-]/g, '');
  const matched = wikiImageLookup[norm];
  if (matched) {
    return filenameToWikitideUrl(matched);
  }

  return null;
}

async function pushToCloud() {
  if (!TWITCH_ENABLED) return;

  try {
    // Collect all characters, shallow-copy and rewrite image URLs to absolute
    const payload = [];
    for (const [, char] of characters) {
      const copy = { ...char };

      // Rewrite equipped item image URLs
      if (copy.equipped) {
        const eq = {};
        for (const [slot, item] of Object.entries(copy.equipped)) {
          eq[slot] = { ...item, imageUrl: getWikiImageUrlAbsolute(item.name) || item.imageUrl };
        }
        copy.equipped = eq;
      }

      // Rewrite mercenary item image URLs
      if (copy.mercenary?.items) {
        const merc = { ...copy.mercenary, items: {} };
        for (const [slot, item] of Object.entries(copy.mercenary.items)) {
          merc.items[slot] = { ...item, imageUrl: getWikiImageUrlAbsolute(item.name) || item.imageUrl };
        }
        copy.mercenary = merc;
      }

      // Rewrite skill image URLs
      if (copy.skills) {
        copy.skills = copy.skills.map(sk => ({
          ...sk,
          imageUrl: getWikiImageUrlAbsolute(sk.name) || sk.imageUrl,
        }));
      }

      // Drop inventory (not shown in panel, saves bandwidth)
      delete copy.inventory;

      payload.push(copy);
    }

    const url = `${TWITCH_EBS_URL}/push?channel_id=${encodeURIComponent(TWITCH_CHANNEL_ID)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TWITCH_PUSH_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log(`[TWITCH] Pushed ${payload.length} character(s) to cloud`);
    } else {
      console.warn(`[TWITCH] Push failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[TWITCH] Push error: ${err.message}`);
  }
}

// Fallback description strings for PD2-specific stats not in vanilla
const PD2_STAT_DESCRIPTIONS = {
  'corrupted': { hidden: true }, // Just marks item as corrupted, hide the value
  'item_splashonhit': { formatFn: (vals) => `${vals[2] || 100}% Splash Damage` },
  'item_elemskill_fire': { dF: 1, dV: 1, dP: 'to Fire Skills' },
  'item_elemskill_ltng': { dF: 1, dV: 1, dP: 'to Lightning Skills' },
  'item_elemskill_cold': { dF: 1, dV: 1, dP: 'to Cold Skills' },
  'item_elemskill_pois': { dF: 1, dV: 1, dP: 'to Poison Skills' },
  'item_elemskill_mag': { dF: 1, dV: 1, dP: 'to Magic Skills' },
  'item_healafterhit': { dF: 1, dV: 1, dP: 'Life after each Hit' },
  'item_healafterkill': { dF: 1, dV: 1, dP: 'Life after each Kill' },
  'item_manaafterhit': { dF: 1, dV: 1, dP: 'Mana after each Hit' },
  'item_manaafterkill': { dF: 1, dV: 1, dP: 'Mana after each Kill' },
  'passive_mag_mastery': { dF: 4, dV: 1, dP: 'to Magic Skill Damage' },
  'passive_mag_pierce': { dF: 20, dV: 1, dP: 'to Enemy Magic Resistance' },
  'item_pierce_cold': { dF: 20, dV: 1, dP: 'to Enemy Cold Resistance' },
  'item_pierce_fire': { dF: 20, dV: 1, dP: 'to Enemy Fire Resistance' },
  'item_pierce_ltng': { dF: 20, dV: 1, dP: 'to Enemy Lightning Resistance' },
  'item_pierce_pois': { dF: 20, dV: 1, dP: 'to Enemy Poison Resistance' },
  // Skill-proc stats missing from vanilla
  'item_skilloncast': { dF: 15, dP: '%d%% Chance to cast level %d %s on casting' },
  'item_skillonblock': { dF: 15, dP: '%d%% Chance to cast level %d %s when blocking' },
  'item_skilloncrit': { dF: 15, dP: '%d%% Chance to cast level %d %s on critical hit' },
  'item_skillonpierce': { dF: 15, dP: '%d%% Chance to cast level %d %s on piercing' },
  // PD2 misc stats
  'item_maxdeadlystrike': { dF: 4, dV: 1, dP: 'to Maximum Deadly Strike' },
  'desecrated': { hidden: true },
  'desecrator': { hidden: true },
};

// Display name overrides for PD2 skills with ugly internal names
const PD2_SKILL_NAME_OVERRIDES = {
  445: 'Life Tap',
  446: 'Decrepify',
  447: 'Lower Resist',
  358: 'Splash Damage',
};

async function initD2S() {
  try {
    const d2s = require('@dschu012/d2s');
    const { readConstantData } = require('@dschu012/d2s/lib/data/parser');
    d2sRead = d2s.read;

    // Patch the skills module to read PD2's 33 skills instead of vanilla's 30
    // PD2 stores 33 bytes per class: 30 vanilla (contiguous) + 3 new (high IDs)
    const skillsModule = require('@dschu012/d2s/lib/d2/skills');
    skillsModule.readSkills = async function(char, reader, constants) {
      const SkillOffset = {
        Amazon: 6, Sorceress: 36, Necromancer: 66, Paladin: 96,
        Barbarian: 126, Druid: 221, Assassin: 251,
      };
      // PD2 extra skill IDs (bytes 31-33 in the save) — NOT contiguous with vanilla
      const PD2ExtraSkills = {
        Amazon: [365, 372, 379],
        Sorceress: [369, 376, 383],
        Necromancer: [367, 374, 381],
        Paladin: [364, 371, 378],
        Barbarian: [368, 375, 382],
        Druid: [370, 377, 384],
        Assassin: [366, 373, 380],
      };
      char.skills = [];
      const offset = SkillOffset[char.header.class];
      const extraIds = PD2ExtraSkills[char.header.class] || [];
      const header = reader.ReadString(2);
      if (header !== 'if') {
        if (char.header.level === 1) return;
        throw new Error("Skills header 'if' not found at position " + (reader.offset - 2 * 8));
      }
      for (let i = 0; i < PD2_SKILLS_PER_CLASS; i++) {
        const id = i < 30 ? offset + i : extraIds[i - 30];
        const points = reader.ReadUInt8();
        const skillInfo = constants.skills[id];
        char.skills.push({
          id,
          points,
          name: (skillInfo && skillInfo.s) ? skillInfo.s : `Skill ${id}`,
        });
      }
    };
    console.log(`[OK] Patched skills reader for PD2 (${PD2_SKILLS_PER_CLASS} skills/class)`);

    // Disable the attribute enhancer entirely — it crashes without string tables
    // because PD2 stats have no description strings. Items/stats are still parsed fine,
    // we just won't get auto-generated description text (we handle that ourselves).
    const enhancerModule = require('@dschu012/d2s/lib/d2/attribute_enhancer');
    enhancerModule.enhanceAttributes = async function() { /* no-op for PD2 */ };
    enhancerModule.enhanceItems = async function(items) { return items; };
    enhancerModule.enhancePlayerAttributes = async function() { };
    console.log('[OK] Disabled attribute enhancer (not needed with PD2 data)');

    // Load vanilla constants bundle as a base (for string/name lookups)
    const bundlePath = path.join(DATA_DIR, 'constants_96.bundle.js');
    if (fs.existsSync(bundlePath)) {
      try {
        const vm = require('vm');
        const sandbox = {};
        vm.runInNewContext(fs.readFileSync(bundlePath, 'utf8'), sandbox);
        vanillaConstants = sandbox.constants_96.constants;
        console.log('[OK] Loaded vanilla constants bundle (for name lookups)');
      } catch (e) {
        console.warn('[WARN] Failed to load vanilla bundle:', e.message);
      }
    }

    // Build name lookup arrays from PD2 TXT files
    uniqueNames = parseTxtNames(path.join(DATA_DIR, 'UniqueItems.txt'));
    setItemNames = parseTxtNames(path.join(DATA_DIR, 'SetItems.txt'));
    const pd2SkillNames = parseSkillNames(path.join(DATA_DIR, 'Skills.txt'));
    console.log(`[OK] Name lookups: ${uniqueNames.length} unique, ${setItemNames.length} set, ${Object.keys(pd2SkillNames).length} skills`);

    // Parse game data tables for derived stat computation
    classStats = parseCharStatsFile(path.join(DATA_DIR, 'CharStats.txt'));
    difficultyPenalties = parseDifficultyFile(path.join(DATA_DIR, 'DifficultyLevels.txt'));
    experienceTable = parseExperienceFile(path.join(DATA_DIR, 'Experience.txt'));
    console.log(`[OK] Game data: ${Object.keys(classStats).length} classes, ${experienceTable.length - 1} XP levels, ${Object.keys(difficultyPenalties).length} difficulties`);

    // Load PD2 TXT data files
    if (fs.existsSync(DATA_DIR)) {
      const txtFiles = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.txt'));
      if (txtFiles.length > 0) {
        const txtData = {};
        for (const file of txtFiles) {
          txtData[file] = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
        }
        console.log(`[OK] Loaded ${txtFiles.length} PD2 TXT data files`);

        // Provide empty string tables if missing — this forces TXT mode in the parser
        // so it uses PD2's ItemStatCost.txt (correct bit widths for PD2 stats)
        // Names will be empty but we merge them from the vanilla bundle below
        if (!txtData['strings.txt'] && !txtData['string.txt']) {
          txtData['string.txt'] = 'Key\tValue\n';
        }
        if (!txtData['strings.txt']) {
          txtData['strings.txt'] = txtData['string.txt'];
        }
        if (!txtData['expansionstring.txt'] && !txtData['ExpansionString.txt']) {
          txtData['expansionstring.txt'] = 'Key\tValue\n';
        }
        if (!txtData['patchstring.txt'] && !txtData['PatchString.txt']) {
          txtData['patchstring.txt'] = 'Key\tValue\n';
        }

        try {
          d2sConstants = readConstantData(txtData);
          console.log('[OK] PD2 constants built from TXT files');

          // Merge display names from vanilla constants where PD2 has blanks
          if (vanillaConstants) {
            mergeNames(d2sConstants, vanillaConstants);
            console.log('[OK] Merged vanilla display names into PD2 constants');
          }

          // Merge PD2 skill names from Skills.txt + fallback names
          if (d2sConstants.skills) {
            let merged = 0;
            for (const [id, name] of Object.entries(pd2SkillNames)) {
              const idx = parseInt(id);
              if (d2sConstants.skills[idx] && !d2sConstants.skills[idx].s) {
                d2sConstants.skills[idx].s = name;
                merged++;
              } else if (!d2sConstants.skills[idx]) {
                d2sConstants.skills[idx] = { s: name };
                merged++;
              }
            }
            // Apply display name overrides for skills with ugly internal names
            for (const [id, name] of Object.entries(PD2_SKILL_NAME_OVERRIDES)) {
              const idx = parseInt(id);
              if (!d2sConstants.skills[idx]) {
                d2sConstants.skills[idx] = { s: name };
              } else {
                d2sConstants.skills[idx].s = name;
              }
              merged++;
            }
            console.log(`[OK] Merged ${merged} PD2 skill names from Skills.txt`);
          }

          // Apply PD2 fallback stat descriptions
          if (d2sConstants.magical_properties) {
            let patched = 0;
            for (let i = 0; i < d2sConstants.magical_properties.length; i++) {
              const mp = d2sConstants.magical_properties[i];
              if (!mp) continue;
              const fb = PD2_STAT_DESCRIPTIONS[mp.s];
              if (fb) {
                if (fb.hidden) { mp._hidden = true; patched++; continue; }
                if (fb.dP && !mp.dP) { mp.dP = fb.dP; mp.dN = fb.dP; patched++; }
                if (fb.dF && !mp.dF) { mp.dF = fb.dF; patched++; }
                if (fb.dV !== undefined && mp.dV === undefined) { mp.dV = fb.dV; patched++; }
                if (fb.format) { mp._customFormat = fb.format; patched++; }
                if (fb.formatFn) { mp._customFormatFn = fb.formatFn; patched++; }
              }
            }
            console.log(`[OK] Patched ${patched} PD2-specific stat descriptions`);
          }
        } catch (e) {
          console.warn('[WARN] PD2 constant loading failed:', e.message);
          // Fall back to vanilla constants
          if (vanillaConstants) {
            d2sConstants = vanillaConstants;
            console.log('[OK] Fell back to vanilla constants (PD2 items may not parse)');
          }
        }
      }
    }

    if (!d2sConstants && vanillaConstants) {
      d2sConstants = vanillaConstants;
      console.log('[OK] Using vanilla constants only');
    }

    if (d2sConstants) {
      const { setConstantData } = require('@dschu012/d2s');
      setConstantData(96, d2sConstants);
    } else {
      console.warn('[WARN] No constant data available.');
    }

    console.log('[OK] @dschu012/d2s library loaded');
  } catch (err) {
    console.warn('[WARN] @dschu012/d2s library not available:', err.message);
    console.warn('       Run: npm install @dschu012/d2s');
    console.warn('       Using basic fallback parser (header info only).');
  }
}

// Merge display names from vanilla constants into PD2 constants
// PD2 constants have correct stat bit widths but empty names (no string tables)
function mergeNames(pd2, vanilla) {
  // Merge item names
  for (const category of ['armor_items', 'weapon_items', 'other_items']) {
    if (vanilla[category] && pd2[category]) {
      for (const code of Object.keys(pd2[category])) {
        if (!pd2[category][code].n && vanilla[category][code]?.n) {
          pd2[category][code].n = vanilla[category][code].n;
        }
      }
    }
  }
  // Merge unique/set item names
  for (const category of ['unq_items', 'set_items']) {
    if (vanilla[category] && pd2[category]) {
      for (let i = 0; i < pd2[category].length; i++) {
        if (pd2[category][i] && !pd2[category][i].n && vanilla[category][i]?.n) {
          pd2[category][i].n = vanilla[category][i].n;
        }
      }
    }
  }
  // Merge skill names
  if (vanilla.skills && pd2.skills) {
    for (let i = 0; i < pd2.skills.length; i++) {
      if (pd2.skills[i] && !pd2.skills[i].s && vanilla.skills[i]?.s) {
        pd2.skills[i].s = vanilla.skills[i].s;
      }
    }
  }
  // Merge runeword names
  if (vanilla.runewords && pd2.runewords) {
    for (let i = 0; i < pd2.runewords.length; i++) {
      if (pd2.runewords[i] && !pd2.runewords[i].n && vanilla.runewords[i]?.n) {
        pd2.runewords[i].n = vanilla.runewords[i].n;
      }
    }
  }
  // Merge stat descriptions
  if (vanilla.magical_properties && pd2.magical_properties) {
    for (let i = 0; i < pd2.magical_properties.length; i++) {
      if (pd2.magical_properties[i] && vanilla.magical_properties[i]) {
        const pd2p = pd2.magical_properties[i];
        const vp = vanilla.magical_properties[i];
        if (!pd2p.dP && vp.dP) pd2p.dP = vp.dP;
        if (!pd2p.dN && vp.dN) pd2p.dN = vp.dN;
        if (!pd2p.d2 && vp.d2) pd2p.d2 = vp.d2;
        if (!pd2p.dR && vp.dR) pd2p.dR = vp.dR;
        if (!pd2p.dE && vp.dE) pd2p.dE = vp.dE;
      }
    }
  }
  // Merge class names and skill tab strings
  if (vanilla.classes && pd2.classes) {
    for (let i = 0; i < pd2.classes.length; i++) {
      if (pd2.classes[i] && vanilla.classes[i]) {
        if (!pd2.classes[i].n) pd2.classes[i].n = vanilla.classes[i].n;
        if (!pd2.classes[i].as) pd2.classes[i].as = vanilla.classes[i].as;
        if (!pd2.classes[i].co) pd2.classes[i].co = vanilla.classes[i].co;
        // Merge tab strings - PD2 may have [null, null, null]
        if (vanilla.classes[i].ts) {
          if (!pd2.classes[i].ts) {
            pd2.classes[i].ts = vanilla.classes[i].ts;
          } else {
            for (let t = 0; t < vanilla.classes[i].ts.length; t++) {
              if (!pd2.classes[i].ts[t] && vanilla.classes[i].ts[t]) {
                pd2.classes[i].ts[t] = vanilla.classes[i].ts[t];
              }
            }
          }
        }
        if (!pd2.classes[i].c && vanilla.classes[i].c) pd2.classes[i].c = vanilla.classes[i].c;
      }
    }
  }
  // Merge magic prefix/suffix names
  for (const category of ['magic_prefixes', 'magic_suffixes', 'rare_names']) {
    if (vanilla[category] && pd2[category]) {
      for (let i = 0; i < pd2[category].length; i++) {
        if (pd2[category][i] && !pd2[category][i]?.n && vanilla[category][i]?.n) {
          pd2[category][i].n = vanilla[category][i].n;
        }
      }
    }
  }
}

// ── D2S Parsing ────────────────────────────────────────────────────────────────

async function parseCharacter(filePath) {
  const buffer = fs.readFileSync(filePath);
  const name = path.basename(filePath, '.d2s');

  // Validate D2S magic number
  if (buffer.length < 335 || buffer.readUInt32LE(0) !== 0xAA55AA55) {
    console.warn(`[WARN] Invalid D2S file: ${filePath}`);
    return null;
  }

  // Try full parsing with d2s library
  if (d2sRead && d2sConstants) {
    try {
      const data = await d2sRead(buffer, d2sConstants);
      return transformD2SData(data, name);
    } catch (err) {
      console.warn(`[WARN] d2s library failed for ${name}: ${err.message}`);
      console.warn('       Falling back to basic parser.');
    }
  }

  // Fallback: basic header + stats parsing
  return parseBasic(buffer, name);
}

// ── Derived Stats Computation ───────────────────────────────────────────────
// Sums specific stat IDs from an item's magic_attributes (including sockets & runewords)
function sumItemStatId(item, statId) {
  let total = 0;
  const sources = [
    item.magic_attributes,
    item.runeword_attributes,
  ];
  // Include socketed item attributes
  if (item.socketed_items) {
    for (const si of item.socketed_items) {
      if (si.magic_attributes) sources.push(si.magic_attributes);
    }
  }
  // Include active set bonuses
  if (item.set_attributes) {
    for (const setAttrs of item.set_attributes) {
      if (Array.isArray(setAttrs)) sources.push(setAttrs);
    }
  }
  for (const attrs of sources) {
    if (!Array.isArray(attrs)) continue;
    for (const attr of attrs) {
      if (attr && attr.id === statId) {
        const v = attr.values;
        total += v[v.length - 1] ?? 0;
      }
    }
  }
  return total;
}

// Determine current difficulty from d2s header
function getCurrentDifficulty(header) {
  if (header.difficulty) {
    if (header.difficulty.Hell & 0x80) return 'Hell';
    if (header.difficulty.Nightmare & 0x80) return 'Nightmare';
  }
  return 'Normal';
}

// Compute derived character stats from raw d2s data
function computeCharDerivedStats(d2sData) {
  const header = d2sData.header || d2sData;
  const attrs = d2sData.attributes || {};
  const className = typeof header.class === 'string' ? header.class
    : (CLASS_NAMES[header.class] || 'Amazon');
  const cs = classStats[className] || {};

  const baseStr = attrs.strength ?? 0;
  const baseDex = attrs.dexterity ?? 0;
  const baseVit = attrs.vitality ?? 0;
  const baseEne = attrs.energy ?? 0;
  const baseLife = attrs.max_hp ?? 0;
  const baseMana = attrs.max_mana ?? 0;
  const level = attrs.level ?? header.level ?? 1;

  // Gather all equipped items (raw, pre-transform)
  const playerItems = Array.isArray(d2sData.items) ? d2sData.items : [];
  const equippedItems = playerItems.filter(it => it.location_id === 1 && it.equipped_id > 0 && it.equipped_id <= 12);
  // Inventory items (charms provide passive bonuses)
  const inventoryItems = playerItems.filter(it => it.location_id === 0 && it.alt_position_id === 1);

  // All items that contribute stats (equipped + inventory charms)
  const allStatItems = [...equippedItems, ...inventoryItems];

  // ── Sum item stat bonuses ──
  let itemStr = 0, itemDex = 0, itemVit = 0, itemEne = 0;
  let itemLife = 0, itemMana = 0, itemStamina = 0;
  let flatDefense = 0, flatAR = 0, pctAR = 0;
  let fireRes = 0, coldRes = 0, ltngRes = 0, poisRes = 0;
  let pctLife = 0, pctMana = 0, pctStamina = 0;
  let lifePerLevel = 0, manaPerLevel = 0, arPerLevel = 0, staminaPerLevelItem = 0;

  for (const item of allStatItems) {
    itemStr += sumItemStatId(item, 0);    // +strength
    itemEne += sumItemStatId(item, 1);    // +energy
    itemDex += sumItemStatId(item, 2);    // +dexterity
    itemVit += sumItemStatId(item, 3);    // +vitality
    itemLife += sumItemStatId(item, 7);   // +life
    itemMana += sumItemStatId(item, 9);   // +mana
    itemStamina += sumItemStatId(item, 11); // +stamina
    flatDefense += sumItemStatId(item, 31); // flat +defense
    flatAR += sumItemStatId(item, 19);    // flat +attack rating
    pctAR += sumItemStatId(item, 119);    // % attack rating
    fireRes += sumItemStatId(item, 39);   // fire resist
    ltngRes += sumItemStatId(item, 41);   // lightning resist
    coldRes += sumItemStatId(item, 43);   // cold resist
    poisRes += sumItemStatId(item, 45);   // poison resist
    pctLife += sumItemStatId(item, 76);   // % max life
    pctMana += sumItemStatId(item, 77);   // % max mana
    lifePerLevel += sumItemStatId(item, 216);  // life per level (÷8)
    manaPerLevel += sumItemStatId(item, 217);  // mana per level (÷8)
    arPerLevel += sumItemStatId(item, 224);    // AR per level (÷2)
    pctStamina += sumItemStatId(item, 12);     // % max stamina
    staminaPerLevelItem += sumItemStatId(item, 215); // stamina per level (÷8)
  }

  // ── Total attributes (base + item bonuses) ──
  const totalStr = baseStr + itemStr;
  const totalDex = baseDex + itemDex;
  const totalVit = baseVit + itemVit;
  const totalEne = baseEne + itemEne;

  // Life/Mana: base + item flat + vit/ene scaling + per-level + % bonus
  const lifeFromLevels = Math.floor(lifePerLevel * level / 8);
  const rawLife = baseLife + itemLife + itemVit * (cs.lifePerVit || 0) + lifeFromLevels;
  const totalLife = Math.floor(rawLife * (1 + pctLife / 100));

  const manaFromLevels = Math.floor(manaPerLevel * level / 8);
  const rawMana = baseMana + itemMana + itemEne * (cs.manaPerEne || 0) + manaFromLevels;
  const totalMana = Math.floor(rawMana * (1 + pctMana / 100));

  // ── Stamina (uses attrs.max_stamina from d2s, same pattern as life/mana) ──
  const baseStamina = attrs.max_stamina ?? 0;
  const staminaItemLevels = Math.floor(staminaPerLevelItem * level / 8);
  const rawStamina = baseStamina + itemStamina + itemVit * (cs.staminaPerVit || 0) + staminaItemLevels;
  const stamina = Math.floor(rawStamina * (1 + pctStamina / 100));

  // ── Defense (uses total dex) ──
  let totalDefense = Math.floor(totalDex / 4) + flatDefense;
  for (const item of equippedItems) {
    if (d2sConstants?.armor_items?.[item.type]) {
      const details = d2sConstants.armor_items[item.type];
      let baseDef = item.defense_rating || details.maxac || 0;
      if (item.ethereal && !item.defense_rating) baseDef = Math.floor(baseDef * 1.5);
      // Apply Enhanced Defense % (stat 16) from item's own attributes
      const edPct = sumItemStatId(item, 16);
      totalDefense += Math.floor(baseDef * (1 + edPct / 100));
    }
  }
  // Defense per level (stat 214): floor(value * level / 8)
  let defPerLevel = 0;
  for (const item of allStatItems) {
    defPerLevel += sumItemStatId(item, 214);
  }
  totalDefense += Math.floor(defPerLevel * level / 8);

  // ── Resistances (with difficulty penalty) ──
  const difficulty = getCurrentDifficulty(header);
  const resPenalty = difficultyPenalties[difficulty]?.resistPenalty || 0;
  fireRes += resPenalty;
  coldRes += resPenalty;
  ltngRes += resPenalty;
  poisRes += resPenalty;

  // ── Attack Rating (uses total dex) ──
  const arFromLevels = Math.floor(arPerLevel * level / 2);
  const baseAR = (totalDex - 7) * 5 + (cs.toHitFactor || 0) + flatAR + arFromLevels;
  const attackRating = Math.max(0, Math.floor(baseAR * (1 + pctAR / 100)));

  // ── Next Level XP ──
  let nextLevelExp = null;
  if (level < 99 && experienceTable[level]) {
    nextLevelExp = experienceTable[level];
  }

  return {
    // Total attributes (base + items)
    totalStr, totalDex, totalVit, totalEne,
    // Item bonuses (for green color display)
    itemStr, itemDex, itemVit, itemEne,
    totalLife, totalMana, stamina,
    defense: totalDefense,
    fireRes, coldRes, ltngRes, poisRes,
    attackRating,
    difficulty,
    nextLevelExp,
  };
}

function transformD2SData(d2s, filename) {
  const header = d2s.header || d2s;

  // Extract equipped items organized by body location
  // Items with equipped_id > 0 are worn on the character
  const equipped = {};
  const mercItems = {};
  const playerItems = Array.isArray(d2s.items) ? d2s.items : [];
  const mercItemList = Array.isArray(d2s.merc_items) ? d2s.merc_items : [];

  for (const item of playerItems) {
    // location_id 1 = equipped on body
    if (item.location_id !== 1) continue;
    const equipSlot = item.equipped_id;
    if (equipSlot && equipSlot > 0 && equipSlot <= 12) {
      const slotName = BODY_LOCATIONS[equipSlot];
      if (slotName) {
        equipped[slotName] = transformItem(item);
      }
    }
  }

  for (const item of mercItemList) {
    const equipSlot = item.equipped_id;
    if (equipSlot && equipSlot > 0 && equipSlot <= 12) {
      const slotName = BODY_LOCATIONS[equipSlot];
      if (slotName) {
        mercItems[slotName] = transformItem(item);
      }
    }
  }

  // Extract inventory items (location_id=0, alt_position_id=1)
  // Rows 0-3 = regular inventory, rows 4-7 = PD2 charm inventory
  const inventory = [];
  for (const item of playerItems) {
    if (item.location_id === 0 && item.alt_position_id === 1) {
      const details = d2sConstants?.armor_items?.[item.type]
        || d2sConstants?.weapon_items?.[item.type]
        || d2sConstants?.other_items?.[item.type];
      const transformed = transformItem(item);
      transformed.x = item.position_x ?? 0;
      transformed.y = item.position_y ?? 0;
      transformed.w = details?.iw || 1;
      transformed.h = details?.ih || 1;
      inventory.push(transformed);
    }
  }

  // Extract stats - the d2s library returns attribute names directly
  const attrs = d2s.attributes || {};
  const stats = {
    strength: attrs.strength ?? 0,
    dexterity: attrs.dexterity ?? 0,
    vitality: attrs.vitality ?? 0,
    energy: attrs.energy ?? 0,
    statPoints: attrs.unused_stats ?? 0,
    skillPoints: attrs.unused_skill_points ?? 0,
    life: attrs.max_hp ?? 0,
    mana: attrs.max_mana ?? 0,
    level: attrs.level ?? header.level ?? 0,
    experience: attrs.experience ?? 0,
    gold: attrs.gold ?? 0,
    goldStash: attrs.stashed_gold ?? 0,
  };

  // Extract skills (only those with points allocated)
  const skills = [];
  const skillData = d2s.skills || [];
  for (const skill of skillData) {
    if (skill && skill.points > 0) {
      const skillName = skill.name || `Skill ${skill.id ?? '?'}`;
      skills.push({
        id: skill.id ?? 0,
        name: skillName,
        points: skill.points,
        imageUrl: getWikiImageUrl(skillName),
      });
    }
  }

  // header.class is a string (e.g., "Amazon"), header.status is an object
  const className = typeof header.class === 'string' ? header.class
    : (CLASS_NAMES[header.class] || `Class ${header.class}`);
  const status = header.status || {};

  // Compute derived stats from raw item data
  const derivedStats = computeCharDerivedStats(d2s);

  return {
    name: header.name || filename,
    class: className,
    classId: header.class,
    level: stats.level || header.level || 0,
    hardcore: typeof status === 'object' ? !!status.hardcore : !!(status & 0x04),
    expansion: typeof status === 'object' ? !!status.expansion : !!(status & 0x20),
    dead: typeof status === 'object' ? !!status.died : !!(status & 0x08),
    lastPlayed: header.last_played ? new Date(header.last_played * 1000).toISOString() : null,
    stats,
    skills,
    equipped,
    inventory,
    mercenary: {
      items: mercItems,
    },
    derivedStats,
    _parseMethod: 'full',
  };
}

// ── Stat Description Formatter ───────────────────────────────────────────────
// Replicates the D2 attribute_enhancer.js logic for formatting stat descriptions

function _sprintf(str, ...args) {
  let i = 0;
  if (!str) return args.join(' ');
  return str
    .replace(/%\+?d|%\+?s/gi, (m) => {
      const v = args[i++];
      if (v === undefined) return '';
      const s = v.toString();
      return m.indexOf('+') >= 0 ? '+' + s : s;
    })
    .replace('%%', '%');
}

function formatStatDescription(attr, constants) {
  if (!constants?.magical_properties) return null;
  const prop = constants.magical_properties[attr.id];
  if (!prop) return null;

  // Hidden stats (like "corrupted") - skip entirely
  if (prop._hidden) return null;

  // Custom format function (for PD2-specific stats)
  if (prop._customFormatFn) {
    return prop._customFormatFn(attr.values || []);
  }

  // Custom format string (for PD2-specific stats)
  if (prop._customFormat) {
    const values = attr.values || [];
    const v = values[values.length - 1] ?? 0;
    let ci = 0;
    return prop._customFormat.replace(/%d/gi, () => values[ci++] ?? v);
  }

  const values = attr.values || [];
  const v = values[values.length - 1] ?? 0;

  // Handle grouped damage properties (np = number of props to group)
  if (prop.np) {
    let descString = prop.dR;
    if (prop.s === 'poisonmindam') {
      const min = Math.floor((values[0] * values[2]) / 256);
      const max = Math.floor((values[1] * values[2]) / 256);
      const seconds = Math.floor(values[2] / 25);
      const vals = [min, max, seconds];
      let ci = 0;
      return (descString || '').replace(/%d/gi, () => vals[ci++]);
    }
    if (values[0] === values[1]) {
      descString = prop.dE;
      if (prop.s === 'item_maxdamage_percent') {
        descString = '+%d% ' + (descString || '').replace(/}/gi, '').replace(/%\+?d%%/gi, '');
      }
    }
    let ci = 0;
    return (descString || '').replace(/%d/gi, () => values[ci++]);
  }

  const descFunc = prop.dF;
  if (!descFunc) return null;

  const descString = v >= 0 ? prop.dP : (prop.dN || prop.dP);
  // For resist stats, always use positive string
  const isResist = [39, 41, 43, 45].includes(attr.id);
  const ds = isResist ? prop.dP : descString;
  const descVal = prop.dV;
  const desc2 = prop.d2;
  const sign = v >= 0 ? '+' : '';
  let value = null;
  let description = null;
  const desc2Present = descFunc >= 6 && descFunc <= 10;

  switch (descFunc) {
    case 1: case 6: case 12:
      value = `${sign}${v}`;
      break;
    case 2: case 7:
      value = `${v}%`;
      break;
    case 3: case 9:
      value = `${v}`;
      break;
    case 4: case 8:
      value = `${sign}${v}%`;
      break;
    case 5: case 10:
      if (ds && ds.indexOf('%%') < 0) {
        value = `${Math.floor(v * 100 / 128)}%`;
      } else {
        value = `${Math.floor(v * 100 / 128)}`;
      }
      break;
    case 11:
      description = (ds || '').replace(/%d/, (v / 100).toString());
      break;
    case 13: {
      const clazz = constants.classes?.[values[0]];
      description = `${sign}${v} ${clazz?.as || 'to Skills'}`;
      break;
    }
    case 14: {
      const clazz = constants.classes?.[values[1]];
      const tabStr = clazz?.ts?.[values[0]];
      if (tabStr) {
        description = _sprintf(tabStr, v) + ' ' + (clazz.co || '');
      } else {
        description = `+${v} to Skill Tab`;
      }
      break;
    }
    case 15: {
      const skillName = constants.skills?.[values[1]]?.s || `Skill ${values[1]}`;
      description = _sprintf(ds, values[2], values[0], skillName);
      break;
    }
    case 16: {
      description = (ds || '').replace(/%d/, v.toString()).replace(/%s/, constants.skills?.[values[0]]?.s || `Skill ${values[0]}`);
      break;
    }
    case 17:
      description = `${v} ${ds || ''} (Increases near [time])`;
      break;
    case 18:
      description = `${v}% ${ds || ''} (Increases near [time])`;
      break;
    case 19:
      description = _sprintf(ds, v.toString());
      break;
    case 20:
      value = `${v * -1}%`;
      break;
    case 21:
      value = `${v * -1}`;
      break;
    case 22:
      description = `${v}% ${ds || ''} [montype]`;
      break;
    case 23:
      description = `${v}% ${ds || ''} [monster]`;
      break;
    case 24: {
      if (ds && ds.indexOf('(') === 0) {
        let ci = 0;
        const charges = (ds || '').replace(/%d/gi, () => values[2 + ci++]?.toString() || '0');
        description = `Level ${values[0]} ${constants.skills?.[values[1]]?.s || 'Skill'} ${charges}`;
      } else {
        description = _sprintf(ds, values[0], constants.skills?.[values[1]]?.s || 'Skill', values[2], values[3]);
      }
      break;
    }
    case 27: {
      const skill = constants.skills?.[values[0]];
      const clazz = skill?.c ? constants.classes?.find(c => c?.c === skill.c) : null;
      if (ds) {
        description = _sprintf(ds, v, skill?.s, clazz?.co);
      } else {
        description = `${sign}${v} to ${skill?.s || 'Skill'} ${clazz?.co || ''}`;
      }
      break;
    }
    case 28: {
      const skill = constants.skills?.[values[0]];
      description = `${sign}${v} to ${skill?.s || 'Skill'}`;
      break;
    }
    case 29:
      description = _sprintf(ds, v.toString());
      break;
    default:
      // Unknown descFunc - basic fallback
      if (ds) return `${ds}: ${v}`;
      // Generate a readable name from the stat name
      const readableName = (attr.name || 'stat_' + attr.id)
        .replace(/^item_/, '').replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return `${sign}${v} ${readableName}`;
  }

  // If we computed a value string, format it with descVal positioning
  if (value !== null) {
    switch (descVal || 0) {
      case 0: description = _sprintf(ds, value); break;
      case 1: description = `${value} ${ds || ''}`; break;
      case 2: description = `${ds || ''} ${value}`; break;
      default: description = `${value} ${ds || ''}`; break;
    }
  }

  // Append desc2 for descFunc 6-10
  if (desc2Present && desc2) {
    description = (description || '') + ' ' + desc2;
  }

  return description?.trim() || null;
}

// Format all magic attributes on an item, grouping combined properties
function formatItemProperties(item, constants) {
  const attrs = item.magic_attributes || [];
  const runeAttrs = item.runeword_attributes || [];
  const socketAttrs = [];
  if (item.socketed_items) {
    for (const si of item.socketed_items) {
      if (si.magic_attributes) {
        socketAttrs.push(...si.magic_attributes);
      }
    }
  }

  // Combine all attributes
  const allAttrs = [...attrs, ...runeAttrs, ...socketAttrs];

  // Group identical stat IDs (sum values)
  const grouped = [];
  for (const attr of allAttrs) {
    if (!attr) continue;
    const prop = constants?.magical_properties?.[attr.id];
    const existing = grouped.find(g => {
      if (g.id !== attr.id) return false;
      // Skills and special props need param matching
      if (prop?.dF === 15 || prop?.dF === 16 || prop?.dF === 24 || prop?.dF === 27 || prop?.dF === 28) {
        return g.values[0] === attr.values[0] && g.values[1] === attr.values[1];
      }
      if (prop?.e === 3) {
        return g.values[0] === attr.values[0] && g.values[1] === attr.values[1];
      }
      return true;
    });
    if (existing && prop) {
      if (prop.np) {
        existing.values[0] += attr.values[0];
        existing.values[1] += attr.values[1];
      } else {
        const numValues = prop.e === 3 ? 2 : 1;
        for (let j = 1; j <= numValues; j++) {
          const idx = existing.values.length - j;
          if (idx >= 0) existing.values[idx] += attr.values[idx];
        }
      }
    } else {
      grouped.push({ id: attr.id, values: [...attr.values], name: attr.name });
    }
  }

  // Format descriptions and deduplicate
  const results = [];
  const seen = new Set();
  for (const attr of grouped) {
    const desc = formatStatDescription(attr, constants);
    if (desc && !seen.has(desc)) {
      seen.add(desc);
      results.push({
        stat: attr.name || `stat_${attr.id}`,
        values: attr.values,
        description: desc,
      });
    }
  }
  return results;
}

// ── Item Transformation ─────────────────────────────────────────────────────

function transformItem(item) {
  const qualityNames = {
    1: 'low', 2: 'normal', 3: 'superior', 4: 'magic',
    5: 'set', 6: 'rare', 7: 'unique', 8: 'crafted', 9: 'tempered'
  };

  // Get base item details from constants
  const details = d2sConstants?.armor_items?.[item.type]
    || d2sConstants?.weapon_items?.[item.type]
    || d2sConstants?.other_items?.[item.type];

  // Base name from constants, with PD2 stacked item fallback
  const baseName = details?.n || PD2_ITEM_NAMES[item.type] || item.type_name || item.type || 'Unknown';

  // Build display name based on quality
  let displayName = baseName;
  if (item.given_runeword) {
    // Runeword: look up by runeword_id if available
    displayName = item.given_runeword;
    if (d2sConstants?.runewords?.[item.runeword_id]?.n) {
      displayName = d2sConstants.runewords[item.runeword_id].n;
    }
  } else if (item.quality === 7 && item.unique_id !== undefined) {
    // Unique item: look up in our name array from UniqueItems.txt
    displayName = uniqueNames[item.unique_id] || d2sConstants?.unq_items?.[item.unique_id]?.n || baseName;
  } else if (item.quality === 5 && item.set_id !== undefined) {
    // Set item: look up in our name array from SetItems.txt
    displayName = setItemNames[item.set_id] || d2sConstants?.set_items?.[item.set_id]?.n || baseName;
  } else if (item.quality === 6) {
    // Rare item: combine rare name prefix + suffix
    const rn1 = d2sConstants?.rare_names?.[item.rare_name_id]?.n || '';
    const rn2 = d2sConstants?.rare_names?.[item.rare_name_id2]?.n || '';
    displayName = [rn1, rn2].filter(Boolean).join(' ') || baseName;
  } else if (item.quality === 4) {
    // Magic item: prefix + base + suffix
    const prefix = item.magic_prefix ? d2sConstants?.magic_prefixes?.[item.magic_prefix]?.n : '';
    const suffix = item.magic_suffix ? d2sConstants?.magic_suffixes?.[item.magic_suffix]?.n : '';
    displayName = [prefix, baseName, suffix].filter(Boolean).join(' ');
  } else if (item.quality === 8) {
    // Crafted: use rare name style if available
    const rn1 = d2sConstants?.rare_names?.[item.rare_name_id]?.n || '';
    const rn2 = d2sConstants?.rare_names?.[item.rare_name_id2]?.n || '';
    displayName = [rn1, rn2].filter(Boolean).join(' ') || baseName;
  } else if (item.quality === 3) {
    displayName = 'Superior ' + baseName;
  }

  // Format magic properties with D2-style descriptions
  const props = formatItemProperties(item, d2sConstants);

  // Set item bonus properties (partial set bonuses)
  const setProps = [];
  if (item.set_attributes) {
    for (const setAttrList of item.set_attributes) {
      if (Array.isArray(setAttrList)) {
        for (const attr of setAttrList) {
          const desc = formatStatDescription(attr, d2sConstants);
          if (desc) {
            setProps.push({ stat: attr.name, values: attr.values, description: desc });
          }
        }
      }
    }
  }

  // Socket fillers
  const sockets = [];
  const socketedItems = item.socketed_items || [];
  for (const si of socketedItems) {
    const siDetails = d2sConstants?.other_items?.[si.type];
    sockets.push({
      name: siDetails?.n || si.type_name || si.type || 'Unknown',
      code: si.type || '',
    });
  }

  // Base stats from item details
  let defense = null, minDamage = null, maxDamage = null, twoHandMin = null, twoHandMax = null;
  let reqStr = details?.rs || 0;
  let reqDex = details?.rd || 0;
  let reqLevel = item.level || 0;

  if (d2sConstants?.armor_items?.[item.type]) {
    defense = item.defense_rating || details.maxac || null;
    if (defense && item.ethereal && !item.defense_rating) {
      defense = Math.floor(defense * 1.5);
    }
  } else if (d2sConstants?.weapon_items?.[item.type]) {
    if (item.ethereal) {
      minDamage = details.mind ? Math.floor(details.mind * 1.5) : null;
      maxDamage = details.maxd ? Math.floor(details.maxd * 1.5) : null;
      twoHandMin = details.min2d ? Math.floor(details.min2d * 1.5) : null;
      twoHandMax = details.max2d ? Math.floor(details.max2d * 1.5) : null;
    } else {
      minDamage = details.mind || null;
      maxDamage = details.maxd || null;
      twoHandMin = details.min2d || null;
      twoHandMax = details.max2d || null;
    }
  }

  return {
    name: displayName,
    baseName: (displayName !== baseName) ? baseName : '',
    code: item.type || '',
    quality: qualityNames[item.quality] || 'normal',
    qualityId: item.quality || 2,
    identified: item.identified !== false,
    ethereal: !!item.ethereal,
    socketed: !!item.socketed,
    numSockets: item.nr_of_items_in_sockets || 0,
    sockets,
    reqLevel,
    reqStr,
    reqDex,
    defense,
    minDamage,
    maxDamage,
    twoHandMin,
    twoHandMax,
    properties: props,
    setProperties: setProps.length > 0 ? setProps : undefined,
    isRuneword: !!item.given_runeword,
    imageUrl: getWikiImageUrl(displayName) || getWikiImageUrl(baseName),
  };
}

// ── Basic D2S Fallback Parser ──────────────────────────────────────────────────

function parseBasic(buffer, filename) {
  const version = buffer.readUInt32LE(4);
  const nameBytes = buffer.subarray(20, 36);
  const name = nameBytes.toString('ascii').replace(/\0+$/, '') || filename;
  const status = buffer.readUInt8(36);
  const classId = buffer.readUInt8(40);
  const level = buffer.readUInt8(43);

  // Try to read stats from the stats section
  const stats = parseBasicStats(buffer);
  stats.level = stats.level || level;

  return {
    name,
    class: CLASS_NAMES[classId] || `Class ${classId}`,
    classId,
    level: stats.level,
    hardcore: !!(status & 0x04),
    expansion: !!(status & 0x20),
    dead: !!(status & 0x08),
    lastPlayed: buffer.length >= 52 ? new Date(buffer.readUInt32LE(48) * 1000).toISOString() : null,
    stats,
    skills: parseBasicSkills(buffer, classId),
    equipped: {},
    mercenary: { items: {} },
    _parseMethod: 'basic',
    _notice: 'Install @dschu012/d2s and add PD2 data TXT files for full item parsing.',
  };
}

function parseBasicStats(buffer) {
  // Find stats section marker "gf" (0x67 0x66)
  let offset = -1;
  for (let i = 175; i < Math.min(buffer.length - 2, 1000); i++) {
    if (buffer[i] === 0x67 && buffer[i + 1] === 0x66) {
      offset = i + 2;
      break;
    }
  }

  const stats = {
    strength: 0, dexterity: 0, vitality: 0, energy: 0,
    statPoints: 0, skillPoints: 0,
    life: 0, mana: 0, level: 0,
    experience: 0, gold: 0, goldStash: 0,
  };

  if (offset === -1) return stats;

  // Read stats as a bit stream
  let bitPos = 0;
  const readBits = (numBits) => {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const byteIndex = offset + Math.floor((bitPos + i) / 8);
      const bitIndex = (bitPos + i) % 8;
      if (byteIndex < buffer.length) {
        value |= ((buffer[byteIndex] >> bitIndex) & 1) << i;
      }
    }
    bitPos += numBits;
    return value;
  };

  // Read stat entries: 9-bit ID followed by variable-length value
  for (let safety = 0; safety < 32; safety++) {
    const statId = readBits(9);
    if (statId === 0x1FF) break; // End of stats

    const bits = STAT_BITS[statId];
    if (bits === undefined) break; // Unknown stat, can't continue

    let value = readBits(bits);
    const statName = STAT_IDS[statId];
    if (!statName) continue;

    // Life/mana values are fixed-point (/256)
    if (statId >= 6 && statId <= 11) {
      value = Math.floor(value / 256);
    }

    stats[statName] = value;
  }

  return stats;
}

// Skill names per class (PD2 ordering, 30 skills each)
const CLASS_SKILLS = {
  0: [ // Amazon
    'Magic Arrow','Fire Arrow','Inner Sight','Critical Strike','Jab','Cold Arrow','Multiple Shot',
    'Dodge','Power Strike','Poison Javelin','Exploding Arrow','Slow Missiles','Avoid','Impale',
    'Lightning Bolt','Ice Arrow','Guided Arrow','Penetrate','Charged Strike','Plague Javelin',
    'Strafe','Immolation Arrow','Decoy','Evade','Fend','Freezing Arrow','Valkyrie','Pierce',
    'Lightning Strike','Lightning Fury'
  ],
  1: [ // Sorceress
    'Fire Bolt','Warmth','Charged Bolt','Ice Bolt','Frozen Armor','Inferno','Static Field',
    'Telekinesis','Frost Nova','Lightning','Blaze','Shiver Armor','Fire Ball','Nova',
    'Thunder Storm','Energy Shield','Blizzard','Chilling Armor','Fire Wall','Chain Lightning',
    'Meteor','Glacial Spike','Teleport','Hydra','Frozen Orb','Lightning Mastery',
    'Fire Mastery','Cold Mastery','Ice Barrage','Combustion'
  ],
  2: [ // Necromancer
    'Amplify Damage','Teeth','Bone Armor','Skeleton Mastery','Raise Skeleton','Dim Vision',
    'Weaken','Poison Dagger','Corpse Explosion','Clay Golem','Iron Maiden','Terror',
    'Bone Wall','Golem Mastery','Raise Skeletal Mage','Confuse','Life Tap','Poison Explosion',
    'Bone Spear','Blood Golem','Attract','Decrepify','Bone Prison','Summon Resist',
    'Iron Golem','Lower Resist','Poison Nova','Bone Spirit','Fire Golem','Revive'
  ],
  3: [ // Paladin
    'Sacrifice','Smite','Might','Prayer','Resist Fire','Holy Bolt','Holy Fire','Thorns',
    'Defiance','Resist Cold','Zeal','Charge','Blessed Aim','Cleansing','Resist Lightning',
    'Vengeance','Blessed Hammer','Concentration','Holy Freeze','Vigor','Conversion',
    'Holy Shield','Holy Shock','Sanctuary','Meditation','Fist of the Heavens',
    'Fanaticism','Conviction','Redemption','Salvation'
  ],
  4: [ // Barbarian
    'Bash','Sword Mastery','Axe Mastery','Mace Mastery','Howl','Find Potion','Leap',
    'Double Swing','Polearm Mastery','Throwing Mastery','Shout','Taunt','Stun',
    'Double Throw','Increased Stamina','Find Item','Leap Attack','Battle Cry',
    'Frenzy','Increased Speed','Iron Skin','Battle Command','Natural Resistance',
    'War Cry','Berserk','Whirlwind','Battle Orders','Grim Ward','Concentrate',
    'Bear Form'
  ],
  5: [ // Druid
    'Raven','Poison Creeper','Werewolf','Lycanthropy','Firestorm','Oak Sage',
    'Summon Spirit Wolf','Werebear','Molten Boulder','Arctic Blast','Carrion Vine',
    'Feral Rage','Maul','Fissure','Cyclone Armor','Heart of Wolverine','Summon Dire Wolf',
    'Rabies','Fire Claws','Twister','Solar Creeper','Hunger','Shock Wave','Volcano',
    'Tornado','Spirit of Barbs','Summon Grizzly','Fury','Armageddon','Hurricane'
  ],
  6: [ // Assassin
    'Fire Blast','Claw Mastery','Psychic Hammer','Tiger Strike','Dragon Talon','Shock Web',
    'Blade Sentinel','Burst of Speed','Fists of Fire','Dragon Claw','Charged Bolt Sentry',
    'Wake of Fire','Weapon Block','Cloak of Shadows','Cobra Strike','Blade Fury',
    'Fade','Shadow Warrior','Claws of Thunder','Dragon Tail','Lightning Sentry',
    'Wake of Inferno','Mind Blast','Blades of Ice','Dragon Flight','Death Sentry',
    'Blade Shield','Venom','Shadow Master','Phoenix Strike'
  ],
};

function parseBasicSkills(buffer, classId) {
  // Find skills section marker "if" (0x69 0x66)
  let offset = -1;
  for (let i = 175; i < Math.min(buffer.length - 2, 2000); i++) {
    if (buffer[i] === 0x69 && buffer[i + 1] === 0x66) {
      offset = i + 2;
      break;
    }
  }

  if (offset === -1 || offset + 30 > buffer.length) return [];

  const skills = [];
  const names = CLASS_SKILLS[classId] || [];
  for (let i = 0; i < 30; i++) {
    const points = buffer[offset + i];
    if (points > 0) {
      skills.push({
        id: i,
        name: names[i] || `Skill ${i + 1}`,
        points,
      });
    }
  }
  return skills;
}

// ── Express & WebSocket Server ─────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: List all characters
app.get('/api/characters', (req, res) => {
  const list = [];
  for (const [name, char] of characters) {
    list.push({
      name: char.name,
      class: char.class,
      level: char.level,
      hardcore: char.hardcore,
      dead: char.dead,
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

// API: Get single character
app.get('/api/character/:name', (req, res) => {
  const char = characters.get(req.params.name.toLowerCase());
  if (!char) {
    return res.status(404).json({ error: 'Character not found' });
  }
  res.json(char);
});

// WebSocket connections
const wsClients = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

// ── File Watcher ───────────────────────────────────────────────────────────────

async function loadCharacter(filePath) {
  try {
    const char = await parseCharacter(filePath);
    if (char) {
      const key = char.name.toLowerCase();
      characters.set(key, char);
      console.log(`[OK] Loaded: ${char.name} (Lv${char.level} ${char.class}) [${char._parseMethod}]`);
      broadcast('character_update', char);
      pushToCloud();
    }
  } catch (err) {
    console.error(`[ERR] Failed to parse ${filePath}:`, err.message);
  }
}

async function loadAllCharacters() {
  if (!fs.existsSync(SAVES_DIR)) {
    fs.mkdirSync(SAVES_DIR, { recursive: true });
    console.log(`[OK] Created saves directory: ${SAVES_DIR}`);
  }

  const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.d2s'));
  console.log(`[OK] Found ${files.length} save file(s) in ${SAVES_DIR}`);

  for (const file of files) {
    await loadCharacter(path.join(SAVES_DIR, file));
  }
}

// ── Startup ────────────────────────────────────────────────────────────────────

async function start() {
  console.log('──────────────────────────────────────────');
  console.log('  PD2 Singleplayer Character Armory');
  console.log('──────────────────────────────────────────');

  if (TWITCH_ENABLED) {
    console.log(`[TWITCH] Cloud push enabled → ${TWITCH_EBS_URL} (channel ${TWITCH_CHANNEL_ID})`);
  }

  await initD2S();
  await fetchWikiImageList();
  await loadAllCharacters();

  // Watch for save file changes
  const watcher = chokidar.watch(SAVES_DIR, {
    ignoreInitial: true,
    usePolling: true,
    interval: 2000,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: 0,
  });

  watcher.on('ready', () => {
    console.log('[OK] File watcher ready');
  });
  watcher.on('error', (err) => {
    console.error('[WATCH] Error:', err.message);
  });
  watcher.on('add', (fp) => {
    if (!fp.endsWith('.d2s')) return;
    console.log(`[FILE] New save: ${path.basename(fp)}`);
    loadCharacter(fp);
  });
  watcher.on('change', (fp) => {
    if (!fp.endsWith('.d2s')) return;
    console.log(`[FILE] Updated save: ${path.basename(fp)}`);
    loadCharacter(fp);
  });
  watcher.on('unlink', (fp) => {
    if (!fp.endsWith('.d2s')) return;
    const name = path.basename(fp, '.d2s').toLowerCase();
    if (characters.delete(name)) {
      console.log(`[FILE] Removed: ${name}`);
      broadcast('character_removed', { name });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[OK] Server running at http://0.0.0.0:${PORT}`);
    console.log(`[OK] Watching: ${SAVES_DIR}`);
    console.log(`[OK] Data dir: ${DATA_DIR}`);
    if (!d2sConstants) {
      console.log('\n[!] Running without full d2s parsing.');
      console.log('    For full item data, install @dschu012/d2s and add PD2 TXT files to data/');
    }
    console.log('');
  });
}

start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
