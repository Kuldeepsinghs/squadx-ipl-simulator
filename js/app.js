import { IPL_TEAMS, ANY_TEAM_OPTION, WHEEL_SEGMENTS, WHEEL_COLORS, IPL_PLAYERS, SQUAD_SIZE, MAX_PER_TEAM, MAX_FOREIGN, FOREIGN_PLAYERS, ROLE_BASE, ROLE_GROUPS, FORM_PLAYERS, PLAYER_RECORD_CAPS, DEFAULT_MAX_RUNS, DEFAULT_MAX_WICKETS, PLAYER_STATS_STORAGE_KEY, PLAYER_STATS_META_STORAGE_KEY, PLAYER_SYNC_BATCH_SIZE, COMPETITION_WEIGHTS, BAT_SR_PROFILES, OPENER_SPECIALISTS, MIDDLE_ORDER_SPECIALISTS, FINISHER_SPECIALISTS, BOWL_ECON_PROFILES, BOWL_WICKET_SKILL } from "./constants.js";

import { watchGuestAuth, ensureGuestSession, getCurrentGuestUser, createRoom, joinRoom, subscribeToRoom, updateRoomSettings, updateRoomGameState, updateRoomPresence, transferRoomHost, sendRoomChatMessage } from "./firebase.js";

function clamp(value, min, max){
      return Math.max(min, Math.min(max, value));
    }
    function toSafeNumber(value){
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    function normalizeRecentList(values){
      if(!Array.isArray(values)) return [];
      return values.map(v=>toSafeNumber(v)).filter(v=>Number.isFinite(v));
    }
    function roundStat(value){
      return Math.round(value * 100) / 100;
    }
    function getWeightedAverage(sum, weight){
      return weight > 0 ? sum / weight : null;
    }
    function normalizeCompetitionStats(rawComp){
      if(!rawComp || typeof rawComp !== "object") return null;
      const batting = rawComp.batting && typeof rawComp.batting === "object" ? {
        runs: toSafeNumber(rawComp.batting.runs),
        average: toSafeNumber(rawComp.batting.average),
        strikeRate: toSafeNumber(rawComp.batting.strikeRate),
        highest: toSafeNumber(rawComp.batting.highest),
        recentScores: normalizeRecentList(rawComp.batting.recentScores)
      } : null;
      const bowling = rawComp.bowling && typeof rawComp.bowling === "object" ? {
        wickets: toSafeNumber(rawComp.bowling.wickets),
        economy: toSafeNumber(rawComp.bowling.economy),
        bestWickets: toSafeNumber(rawComp.bowling.bestWickets),
        recentWickets: normalizeRecentList(rawComp.bowling.recentWickets)
      } : null;
      if(!batting && !bowling) return null;
      return {
        matches: Math.max(0, toSafeNumber(rawComp.matches)),
        batting,
        bowling
      };
    }
    function normalizePlayerStatsPayload(rawPayload){
      if(!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return {};
      const normalized = {};
      Object.entries(rawPayload).forEach(([name, rawEntry])=>{
        if(!name || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return;
        const comps = rawEntry.competitions && typeof rawEntry.competitions === "object" ? rawEntry.competitions : rawEntry;
        const normalizedEntry = {};
        Object.entries(comps).forEach(([competitionName, competitionStats])=>{
          const normalizedComp = normalizeCompetitionStats(competitionStats);
          if(normalizedComp) normalizedEntry[String(competitionName).toLowerCase()] = normalizedComp;
        });
        if(Object.keys(normalizedEntry).length > 0) normalized[name] = normalizedEntry;
      });
      return normalized;
    }
    function loadStoredJson(key, fallbackValue){
      try{
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallbackValue;
      }catch(err){
        return fallbackValue;
      }
    }
    function loadStoredPlayerStats(){
      return normalizePlayerStatsPayload(loadStoredJson(PLAYER_STATS_STORAGE_KEY, {}));
    }
    function saveStoredPlayerStats(statsMap){
      try{
        window.localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(statsMap));
      }catch(err){
        // Ignore storage errors so the game stays playable.
      }
    }
    function loadStoredStatsMeta(){
      const raw = loadStoredJson(PLAYER_STATS_META_STORAGE_KEY, {});
      return raw && typeof raw === "object" ? raw : {};
    }
    function saveStoredStatsMeta(meta){
      try{
        window.localStorage.setItem(PLAYER_STATS_META_STORAGE_KEY, JSON.stringify(meta || {}));
      }catch(err){
        // Ignore storage errors so the game stays playable.
      }
    }
    function getTrackedPlayerMap(){
      const tracked = new Map();
      Object.entries(IPL_PLAYERS).forEach(([team, squad])=>{
        (squad || []).forEach(player=>{
          if(!player || !player.name) return;
          if(!tracked.has(player.name)){
            tracked.set(player.name, { name: player.name, role: player.role, team });
          }
        });
      });
      return tracked;
    }
    function getDerivedCompetitionWeights(entry){
      const names = Object.keys(entry || {});
      if(names.length === 0) return [];
      const totalWeight = names.reduce((acc, name)=> acc + (COMPETITION_WEIGHTS[name] ?? 0.35), 0);
      return names.map(name=>({
        name,
        stats: entry[name],
        weight: totalWeight > 0 ? (COMPETITION_WEIGHTS[name] ?? 0.35) / totalWeight : 1 / names.length
      }));
    }
    function getImportedPlayerProfile(name, role){
      const cacheKey = `${name}::${role || ""}`;
      if(Object.prototype.hasOwnProperty.call(derivedPlayerProfileCache, cacheKey)) return derivedPlayerProfileCache[cacheKey];
      const entry = importedPlayerStats[name];
      if(!entry){
        derivedPlayerProfileCache[cacheKey] = null;
        return null;
      }
      const weightedCompetitions = getDerivedCompetitionWeights(entry);
      if(weightedCompetitions.length === 0){
        derivedPlayerProfileCache[cacheKey] = null;
        return null;
      }
      let battingWeight = 0;
      let bowlingWeight = 0;
      let battingMatches = 0;
      let bowlingMatches = 0;
      let battingRuns = 0;
      let battingAverage = 0;
      let battingStrikeRate = 0;
      let battingHighest = 0;
      let recentRuns = 0;
      let recentRunsWeight = 0;
      let bowlingWickets = 0;
      let bowlingEconomy = 0;
      let bowlingBest = 0;
      let recentWickets = 0;
      let recentWicketsWeight = 0;
      weightedCompetitions.forEach(comp=>{
        const matches = Math.max(1, toSafeNumber(comp.stats.matches));
        if(comp.stats.batting){
          battingWeight += comp.weight;
          battingMatches += matches * comp.weight;
          battingRuns += comp.stats.batting.runs * comp.weight;
          battingAverage += (comp.stats.batting.average || (comp.stats.batting.runs / matches)) * comp.weight;
          battingStrikeRate += (comp.stats.batting.strikeRate || DEFAULT_BAT_SR[getBaseRole(role)] || 132) * comp.weight;
          battingHighest = Math.max(battingHighest, comp.stats.batting.highest || 0);
          if(comp.stats.batting.recentScores.length){
            recentRuns += (comp.stats.batting.recentScores.reduce((acc, value)=>acc + value, 0) / comp.stats.batting.recentScores.length) * comp.weight;
            recentRunsWeight += comp.weight;
          }
        }
        if(comp.stats.bowling){
          bowlingWeight += comp.weight;
          bowlingMatches += matches * comp.weight;
          bowlingWickets += comp.stats.bowling.wickets * comp.weight;
          bowlingEconomy += (comp.stats.bowling.economy || DEFAULT_BOWL_ECON[getBaseRole(role)] || 8.8) * comp.weight;
          bowlingBest = Math.max(bowlingBest, comp.stats.bowling.bestWickets || 0);
          if(comp.stats.bowling.recentWickets.length){
            recentWickets += (comp.stats.bowling.recentWickets.reduce((acc, value)=>acc + value, 0) / comp.stats.bowling.recentWickets.length) * comp.weight;
            recentWicketsWeight += comp.weight;
          }
        }
      });
      const batting = battingWeight > 0 ? {
        runs: roundStat(battingRuns),
        average: roundStat(getWeightedAverage(battingAverage, battingWeight) || 0),
        strikeRate: roundStat(getWeightedAverage(battingStrikeRate, battingWeight) || 0),
        highest: battingHighest,
        recentAverage: roundStat(getWeightedAverage(recentRuns, recentRunsWeight) || 0),
        runsPerMatch: roundStat(battingRuns / Math.max(1, battingMatches))
      } : null;
      const bowling = bowlingWeight > 0 ? {
        wickets: roundStat(bowlingWickets),
        economy: roundStat(getWeightedAverage(bowlingEconomy, bowlingWeight) || 0),
        bestWickets: bowlingBest,
        recentAverage: roundStat(getWeightedAverage(recentWickets, recentWicketsWeight) || 0),
        wicketsPerMatch: roundStat(bowlingWickets / Math.max(1, bowlingMatches))
      } : null;
      const baseRole = getBaseRole(role);
      const battingSkill = batting
        ? clamp((batting.average - 20) / 20, -0.2, 1.2)
          + clamp((batting.strikeRate - 128) / 38, -0.2, 1.0)
          + clamp((batting.runsPerMatch - 24) / 18, -0.15, 0.8)
          + clamp((batting.recentAverage - 26) / 30, -0.25, 0.85)
          + clamp((batting.highest - 45) / 90, 0, 0.35)
        : 0;
      const bowlingSkill = bowling
        ? clamp((bowling.wicketsPerMatch - 0.8) / 0.85, -0.15, 1.0)
          + clamp((8.7 - bowling.economy) / 2.2, -0.2, 1.0)
          + clamp((bowling.recentAverage - 1.0) / 1.6, -0.2, 0.8)
          + clamp((bowling.bestWickets - 2) / 3, 0, 0.3)
        : 0;
      let ratingAdj = 0;
      if(baseRole === "BAT" || baseRole === "WK") ratingAdj = battingSkill * 0.95 + bowlingSkill * 0.08;
      else if(baseRole === "BOWL") ratingAdj = bowlingSkill * 1.08 + battingSkill * 0.05;
      else ratingAdj = battingSkill * 0.58 + bowlingSkill * 0.7;
      const formBoost = clamp(
        (batting ? (batting.recentAverage - Math.max(18, batting.average * 0.72)) / 32 + Math.max(0, batting.strikeRate - 145) / 120 : 0)
        + (bowling ? (bowling.recentAverage - 1.05) * 0.18 + (8.2 - bowling.economy) * 0.06 : 0),
        -0.25,
        1.25
      );
      const profile = {
        batting,
        bowling,
        ratingAdj: roundStat(ratingAdj),
        formBoost: roundStat(formBoost),
        inForm: formBoost >= 0.14 || (batting && batting.recentAverage >= Math.max(30, batting.average * 0.8)) || (bowling && bowling.recentAverage >= 1.5)
      };
      derivedPlayerProfileCache[cacheKey] = profile;
      return profile;
    }
    function getCurrentFormScore(name, role){
      const importedProfile = getImportedPlayerProfile(name, role);
      if(!importedProfile){
        return FORM_PLAYERS.has(name) ? 0.72 : 0.45;
      }
      const batting = importedProfile.batting;
      const bowling = importedProfile.bowling;
      const battingForm = batting
        ? clamp(
            (batting.recentAverage - 18) / 38
            + (batting.strikeRate - 130) / 80
            + (batting.runsPerMatch - 20) / 32,
            0,
            1.8
          )
        : 0;
      const bowlingForm = bowling
        ? clamp(
            (bowling.recentAverage - 0.6) / 2
            + (8.8 - bowling.economy) / 4
            + (bowling.wicketsPerMatch - 0.5) / 1.4,
            0,
            1.8
          )
        : 0;
      const baseRole = getBaseRole(role);
      if(baseRole === "BAT" || baseRole === "WK") return roundStat(clamp(battingForm + bowlingForm * 0.12, 0.1, 2.2));
      if(baseRole === "BOWL") return roundStat(clamp(bowlingForm + battingForm * 0.08, 0.1, 2.2));
      return roundStat(clamp(battingForm * 0.6 + bowlingForm * 0.75, 0.1, 2.2));
    }
    function isPlayerInForm(name, role){
      const importedProfile = getImportedPlayerProfile(name, role);
      return importedProfile ? getCurrentFormScore(name, role) >= 0.78 || !!importedProfile.inForm : FORM_PLAYERS.has(name);
    }
    const POWERPLAY_SPECIALISTS = {
      "Jasprit Bumrah": 2.0, "Trent Boult": 1.6, "Josh Hazlewood": 1.5, "Bhuvneshwar Kumar": 1.5,
      "Arshdeep Singh": 1.7,  "Mohammad Siraj": 1.2, "Mohammed Siraj": 1.2, "Mohammed Shami": 1.0, "Mohammad Shami": 1.0, "Axar Patel":1.1,
      "Mohammad Shami": 1.3, "Mitchell Starc": 1.1, "Deepak Chahar": 0.85, "Prasidh Krishna": 0.7,
      "Khaleel Ahmed": 0.75, "Pat Cummins": 0.75, "Yash Dayal": 0.65,"Noor Ahmad": 0.5,"Varun Chakaravarthy": 0.7, "Varun Chakravarthy": 0.7,
    };
    const MIDDLE_OVERS_SPECIALISTS = {
      "Rashid Khan": 1.6, "Sunil Narine": 1.2, "Varun Chakaravarthy": 1.25, "Kuldeep Yadav": 1.2,
      "Noor Ahmad": 1.05, "Ravi Bishnoi": 1.1, "Yuzvendra Chahal": 1.15,
      "Ravindra Jadeja": 0.95, "Sai Kishore": 0.9, "Rahul Chahar": 0.9,
      "Jasprit Bumrah": 0.9, "Mohammad Shami": 0.75, "Mohammed Shami": 0.75, "Josh Hazlewood": 0.75,
      "Bhuvneshwar Kumar": 0.72, "Pat Cummins": 0.6, "Avesh Khan": 0.55
    };
    const DEATH_SPECIALISTS = {
      "Jasprit Bumrah": 1.8, "Mitchell Starc": 1.6, "Arshdeep Singh": 1.15, "T Natarajan": 1.7,
      "Pat Cummins": 1.0, "Mohammad Siraj": 0.95, "Mohammed Siraj": 0.95, "Josh Hazlewood": 1.5,
      "Matheesha Pathirana": 1.2, "Harshal Patel": 0.95, "Avesh Khan": 0.85, "Prasidh Krishna": 0.8,
      "Trent Boult": 0.65, "Kuldeep Yadav": -0.15, "Varun Chakaravarthy": -0.2, "Varun Chakravarthy": -0.2, "Rashid Khan": -0.1,
      "Sunil Narine": -0.2, "Noor Ahmad": -0.1
    };
    const DEFAULT_BAT_SR = { BAT: 136, WK: 138, AR: 144, BOWL: 119 };
    const DEFAULT_BOWL_ECON = { BOWL: 8.2, AR: 8.6, BAT: 9.2, WK: 9.2 };
    const DEFAULT_WICKET_SKILL = { BOWL: 1.0, AR: 0.78, BAT: 0.35, WK: 0.35 };
    const VENUE_PROFILES = [
      { name: "Mumbai", boundary: "small", pitch: "flat", dewBias: 0.72, runAdj: 8 },
      { name: "Chennai", boundary: "normal", pitch: "spin", dewBias: 0.42, runAdj: -4 },
      { name: "Kolkata", boundary: "small", pitch: "balanced", dewBias: 0.58, runAdj: 5 },
      { name: "Hyderabad", boundary: "small", pitch: "flat", dewBias: 0.55, runAdj: 10 },
      { name: "Bangalore", boundary: "small", pitch: "flat", dewBias: 0.66, runAdj: 11 },
      { name: "Delhi", boundary: "normal", pitch: "pace", dewBias: 0.38, runAdj: 2 },
      { name: "Ahmedabad", boundary: "large", pitch: "pace", dewBias: 0.5, runAdj: -2 },
      { name: "Jaipur", boundary: "large", pitch: "spin", dewBias: 0.35, runAdj: -5 },
      { name: "Lucknow", boundary: "normal", pitch: "spin", dewBias: 0.45, runAdj: -3 }
    ];
    const SPIN_BOWLERS = new Set(["Rashid Khan","Sunil Narine","Varun Chakaravarthy","Varun Chakravarthy","Kuldeep Yadav","Noor Ahmad","Ravi Bishnoi","Yuzvendra Chahal","Ravindra Jadeja","Rahul Chahar","Sai Kishore"]);
    const PACE_BOWLERS = new Set(["Jasprit Bumrah","Trent Boult","Mitchell Starc","Mohammed Siraj","Mohammad Siraj","Josh Hazlewood","Arshdeep Singh","Pat Cummins","Prasidh Krishna","Avesh Khan","Bhuvneshwar Kumar","T Natarajan","Matheesha Pathirana","Mohammad Shami","Mohammed Shami"]);
    function getBaseRole(role){
      return ROLE_GROUPS[role] || role || "BAT";
    }
    function isBowlingRole(role){
      const baseRole = getBaseRole(role);
      return baseRole === "BOWL" || baseRole === "AR";
    }
    function isSpecialistBowlingRole(role){
      return getBaseRole(role) === "BOWL";
    }
    function isAllRounderRole(role){
      return getBaseRole(role) === "AR";
    }
    function isSpinBowlingRole(role, name){
      return role === "SPIN_BOWL" || role === "SPIN_AR" || SPIN_BOWLERS.has(name);
    }
    function isPaceBowlingRole(role, name){
      return role === "PACE_BOWL" || role === "PACE_AR" || PACE_BOWLERS.has(name);
    }
    function formatRole(role){
      return String(role || "").replaceAll("_", " ");
    }
    function getPlayerCaps(name, role){
      const importedProfile = getImportedPlayerProfile(name, role);
      if(importedProfile){
        return {
          maxRuns: Math.max(1, importedProfile.batting && importedProfile.batting.highest ? Math.round(importedProfile.batting.highest) : (DEFAULT_MAX_RUNS[getBaseRole(role)] ?? 55)),
          maxWickets: Math.max(0, importedProfile.bowling && importedProfile.bowling.bestWickets ? Math.round(importedProfile.bowling.bestWickets) : (DEFAULT_MAX_WICKETS[getBaseRole(role)] ?? 2))
        };
      }
      const baseRole = getBaseRole(role);
      const fromMap = PLAYER_RECORD_CAPS[name];
      if(fromMap) return fromMap;
      return {
        maxRuns: DEFAULT_MAX_RUNS[baseRole] ?? 55,
        maxWickets: DEFAULT_MAX_WICKETS[baseRole] ?? 2
      };
    }
    function getBatStrikeRate(name, role){
      const importedProfile = getImportedPlayerProfile(name, role);
      if(importedProfile && importedProfile.batting && importedProfile.batting.strikeRate){
        return importedProfile.batting.strikeRate;
      }
      return BAT_SR_PROFILES[name] ?? DEFAULT_BAT_SR[getBaseRole(role)] ?? 132;
    }
    function getBowlingEconomy(name, role){
      const importedProfile = getImportedPlayerProfile(name, role);
      if(importedProfile && importedProfile.bowling && importedProfile.bowling.economy){
        const wicketsPerMatch = importedProfile.bowling.wicketsPerMatch || 0;
        const recentWickets = importedProfile.bowling.recentAverage || 0;
        const economyAdj = wicketsPerMatch * 0.22 + recentWickets * 0.12 + (importedProfile.inForm ? 0.18 : 0);
        return clamp(roundStat(importedProfile.bowling.economy - economyAdj), 5.4, 10.8);
      }
      return BOWL_ECON_PROFILES[name] ?? DEFAULT_BOWL_ECON[getBaseRole(role)] ?? 8.8;
    }
    function getWicketSkill(name, role){
      const importedProfile = getImportedPlayerProfile(name, role);
      if(importedProfile && importedProfile.bowling){
        const effectiveEconomy = getBowlingEconomy(name, role);
        return clamp(
          importedProfile.bowling.wicketsPerMatch * 1.15
          + importedProfile.bowling.recentAverage * 0.28
          + (8.5 - effectiveEconomy) * 0.46
          + importedProfile.bowling.bestWickets * 0.12,
          0.45,
          2.85
        );
      }
      return BOWL_WICKET_SKILL[name] ?? DEFAULT_WICKET_SKILL[getBaseRole(role)] ?? 0.6;
    }
    function createEmptySeasonStats(){
      return {
        batting: {},
        bowling: {},
        team: {},
        meta: { matches: 0, totalRuns: 0, totalBalls: 0, totalBoundaries: 0, totalDots: 0, powerplayRuns: 0, powerplayOvers: 0, deathRuns: 0, deathOvers: 0 }
      };
    }
    function ensureDynamicState(name){
      if(!dynamicPlayerState[name]){
        dynamicPlayerState[name] = { form: 0, fatigue: 0, injuryGames: 0, streak: 0 };
      }
      return dynamicPlayerState[name];
    }
    function getDynamicAvailability(name){
      const st = ensureDynamicState(name);
      return st.injuryGames > 0 ? 0 : 1;
    }
    function getDynamicFormModifier(name){
      const st = ensureDynamicState(name);
      return st.form * 0.22 - st.fatigue * 0.12 + (st.streak > 0 ? 0.08 * Math.min(4, st.streak) : 0);
    }

    function getPlayerRating(name, role){
      const base = ROLE_BASE[getBaseRole(role)]||7.2;
      const importedProfile = getImportedPlayerProfile(name, role);
      const formBase = importedProfile ? 0 : (FORM_PLAYERS.has(name) ? 1.0 : 0);
      const currentForm = getCurrentFormScore(name, role);
      const importedAdj = importedProfile
        ? importedProfile.ratingAdj * 0.35 + importedProfile.formBoost * 1.65 + currentForm * 1.35
        : 0;
      const dyn = getDynamicFormModifier(name);
      return importedProfile
        ? Math.max(4.8, base * 0.55 + importedAdj + dyn)
        : Math.max(4.8, base + formBase + importedAdj + dyn);
    }
    function getRoleCounts(squad){ const c={BAT:0,BOWL:0,AR:0,WK:0}; (squad||[]).forEach(p=>{ const baseRole = getBaseRole(p.role); if(c[baseRole]!==undefined) c[baseRole]++; }); return c; }
    function getBalanceScore(counts,total){ if(total===0) return 0; const target={BAT:5,BOWL:5,AR:3,WK:2}; let pen=0; ["BAT","BOWL","AR","WK"].forEach(r=>pen+=Math.abs((counts[r]||0)-target[r])*1.3); let s=12-pen; if(s>10)s=10; if(s<-10)s=-10; return s; }
    function getVarietyScore(squad){ if(!squad||squad.length===0) return 0; const set=new Set(squad.map(p=>p.team)); let sc=(set.size-4); if(sc<0) sc=0; if(sc>6) sc=6; return sc; }
    function getForeignCount(squad){ return (squad||[]).filter(p=>FOREIGN_PLAYERS.has(p.playerName)).length; }
    function formatPlayerName(name){ return FOREIGN_PLAYERS.has(name) ? `${name} (F)` : name; }
    function getInFormCount(squad){ return (squad||[]).filter(p=>isPlayerInForm(p.playerName, p.role)).length; }
    function getSquadStrength(squad){ if(!squad||squad.length===0) return 0; let sum=0; squad.forEach(p=>sum+=getPlayerRating(p.playerName,p.role)); const counts=getRoleCounts(squad); const bal=getBalanceScore(counts,squad.length); const varS=getVarietyScore(squad); return Math.round((sum+bal+varS)*10)/10; }
    function getEffectiveSquad(playerObj){ if (playerObj.playing && Array.isArray(playerObj.playing.xi) && playerObj.playing.xi.length===11 && playerObj.playing.impact){ const names=new Set([...playerObj.playing.xi, playerObj.playing.impact]); return playerObj.squad.filter(p=>names.has(p.playerName)); } return playerObj.squad; }

    // -----------------------
    // STATE
    // -----------------------
    let players = [];
    let currentPlayerIndex = 0;
    let gameStarted = false;
    let isSpinning = false;
    let currentRotation = 0;
    let selectedTeamName = null;
    let lastSpin = { playerIndex: null, team: null };
    let lastWheelIndex = -1;
    let fallbackRngState = 0;
    let dynamicPlayerState = {};
    let importedPlayerStats = loadStoredPlayerStats();
    let importedPlayerStatsMeta = loadStoredStatsMeta();
    let derivedPlayerProfileCache = {};
    let seasonStats = createEmptySeasonStats();
    let rivalryStats = {};
    let leagueFlow = null;
    let latestPicks = [];
    let auctionState = null;
    let auctionTimerInterval = null;
    let auctionSaleTimeout = null;
    let presenceInterval = null;
    let maxPlayersPerTeam = MAX_PER_TEAM;
    let currentGameMode = "spin";
    let currentRoomId = "";
    let currentRoomUnsubscribe = null;
    let currentRoomData = null;
    let lastAppliedRoomGameStateJson = "";
    let applyingRemoteRoomState = false;
    let activeXIEditorState = null;
    let pendingRoomGameStateWhileEditing = null;
    let statsSyncVersion = 0;

    // DOM refs
    const wheelEl = document.getElementById("wheel");
    const spinButton = document.getElementById("spinButton");
    const spinInfo = document.getElementById("spinInfo");
    const setupForm = document.getElementById("setup-form");
    const playersList = document.getElementById("playersList");
    const gameStatus = document.getElementById("gameStatus");
    const bestSquadEl = document.getElementById("bestSquad");
    const turnOwnerBanner = document.getElementById("turnOwnerBanner");
    const latestPickFeed = document.getElementById("latestPickFeed");
    const pickForm = document.getElementById("pickForm");
    const pickedTeamLabel = document.getElementById("pickedTeamLabel");
    const playerSelect = document.getElementById("playerSelect");
    const pickMessage = document.getElementById("pickMessage");
    const pickSearch = document.getElementById("pickSearch");
    const showTeamRemain = document.getElementById("showTeamRemain");
    const draftCard = document.getElementById("draftCard");
    const modeRulesText = document.getElementById("modeRulesText");

    const numPlayersInput = document.getElementById("numPlayers");
    const playerNamesTextarea = document.getElementById("playerNames");
    const maxPerTeamInput = document.getElementById("maxPerTeamInput");
    const gameModeSelect = document.getElementById("gameModeSelect");
    const statsImportStatus = document.getElementById("statsImportStatus");
    const firebaseAuthStatus = document.getElementById("firebaseAuthStatus");
    const onlinePlayerNameInput = document.getElementById("onlinePlayerName");
    const roomCodeInput = document.getElementById("roomCodeInput");
    const createRoomBtn = document.getElementById("createRoomBtn");
    const joinRoomBtn = document.getElementById("joinRoomBtn");
    const onlineRoomStatus = document.getElementById("onlineRoomStatus");
    const onlineRoomMembers = document.getElementById("onlineRoomMembers");
    const syncStatsBtn = document.getElementById("syncStatsBtn");
    const testStatsApiBtn = document.getElementById("testStatsApiBtn");
    const clearStatsBtn = document.getElementById("clearStatsBtn");
    const statsDebugOutput = document.getElementById("statsDebugOutput");
    const downloadBtn = document.getElementById("downloadBtn");
    const teamASelect = document.getElementById("teamASelect");
    const teamBSelect = document.getElementById("teamBSelect");
    const editTeamAXIBtn = document.getElementById("editTeamAXI");
    const editTeamBXIBtn = document.getElementById("editTeamBXI");
    const tossCallerSelect = document.getElementById("tossCallerSelect");
    const tossCallSelect = document.getElementById("tossCallSelect");
    const tossDecisionSelect = document.getElementById("tossDecisionSelect");
    const venueSelect = document.getElementById("venueSelect");
    const tossResultLine = document.getElementById("tossResultLine");
    const simulateBtn = document.getElementById("simulateBtn");
    const simResult = document.getElementById("simResult");
    const tournamentBtn = document.getElementById("tournamentBtn");
    const playNextMatchBtn = document.getElementById("playNextMatchBtn");
    const tournamentResult = document.getElementById("tournamentResult");
    const statsDashboard = document.getElementById("statsDashboard");
    const rivalryBoard = document.getElementById("rivalryBoard");
    const clearScoreboards = document.getElementById("clearScoreboards");
    const auctionSetSelect = document.getElementById("auctionSetSelect");
    const auctionSetOrderSelect = document.getElementById("auctionSetOrderSelect");
    const auctionNextSetBtn = document.getElementById("auctionNextSetBtn");
    const auctionInitBtn = document.getElementById("auctionInitBtn");
    const auctionStartBtn = document.getElementById("auctionStartBtn");
    const auctionPauseBtn = document.getElementById("auctionPauseBtn");
    const auctionNextBtn = document.getElementById("auctionNextBtn");
    const auctionEndBtn = document.getElementById("auctionEndBtn");
    const auctionStatusLine = document.getElementById("auctionStatusLine");
    const auctionPlayerAvatar = document.getElementById("auctionPlayerAvatar");
    const auctionSetBadge = document.getElementById("auctionSetBadge");
    const auctionPlayerName = document.getElementById("auctionPlayerName");
    const auctionPlayerMeta = document.getElementById("auctionPlayerMeta");
    const auctionBasePrice = document.getElementById("auctionBasePrice");
    const auctionCurrentBid = document.getElementById("auctionCurrentBid");
    const auctionHighestBidder = document.getElementById("auctionHighestBidder");
    const auctionTimer = document.getElementById("auctionTimer");
    const auctionBidAsSelect = document.getElementById("auctionBidAsSelect");
    const auctionBidBtn = document.getElementById("auctionBidBtn");
    const auctionBid10Btn = document.getElementById("auctionBid10Btn");
    const auctionBid25Btn = document.getElementById("auctionBid25Btn");
    const auctionBid50Btn = document.getElementById("auctionBid50Btn");
    const auctionBid100Btn = document.getElementById("auctionBid100Btn");
    const auctionBidHint = document.getElementById("auctionBidHint");
    const auctionSaleBanner = document.getElementById("auctionSaleBanner");
    const auctionPlayerProfile = document.getElementById("auctionPlayerProfile");
    const auctionBidHistory = document.getElementById("auctionBidHistory");
    const auctionLotHistory = document.getElementById("auctionLotHistory");
    const auctionUnsoldSelect = document.getElementById("auctionUnsoldSelect");
    const auctionRebidBtn = document.getElementById("auctionRebidBtn");
    const auctionLeaderboard = document.getElementById("auctionLeaderboard");
    const auctionTeamsBoard = document.getElementById("auctionTeamsBoard");
    const auctionPresence = document.getElementById("auctionPresence");
    const hostTransferSelect = document.getElementById("hostTransferSelect");
    const hostTransferBtn = document.getElementById("hostTransferBtn");
    const auctionChatList = document.getElementById("auctionChatList");
    const auctionChatInput = document.getElementById("auctionChatInput");
    const auctionChatSendBtn = document.getElementById("auctionChatSendBtn");
    const tradeTeamASelect = document.getElementById("tradeTeamASelect");
    const tradePlayerASelect = document.getElementById("tradePlayerASelect");
    const tradeTeamBSelect = document.getElementById("tradeTeamBSelect");
    const tradePlayerBSelect = document.getElementById("tradePlayerBSelect");
    const tradeSwapBtn = document.getElementById("tradeSwapBtn");
    const tradeStatus = document.getElementById("tradeStatus");
    let promptedTradeRequestId = "";

    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanels = {
      setup: document.getElementById("tab-setup"),
      squads: document.getElementById("tab-squads"),
      auction: document.getElementById("tab-auction"),
      sim: document.getElementById("tab-sim"),
      stats: document.getElementById("tab-stats")
    };

    function switchToTab(tab){
      tabButtons.forEach(b=>b.classList.remove("active"));
      Object.values(tabPanels).forEach(p=>p.classList.remove("active"));
      const btn = Array.from(tabButtons).find(b=>b.dataset.tab === tab);
      if(btn) btn.classList.add("active");
      if(tabPanels[tab]) tabPanels[tab].classList.add("active");
    }
    tabButtons.forEach(btn=>{ btn.addEventListener("click", ()=> switchToTab(btn.dataset.tab)); });

    function resetImportedProfileCache(){
      derivedPlayerProfileCache = {};
    }
    function updateStatsImportStatus(message, type = ""){
      if(!statsImportStatus) return;
      statsImportStatus.className = `small-text stats-import-status${type ? ` ${type}` : ""}`;
      statsImportStatus.textContent = message;
    }
    function setStatsDebugOutput(text){
      if(!statsDebugOutput) return;
      statsDebugOutput.style.display = text ? "block" : "none";
      statsDebugOutput.textContent = text || "";
    }
    function setFirebaseStatus(message, type = ""){
      if(!firebaseAuthStatus) return;
      firebaseAuthStatus.className = `small-text stats-import-status${type ? ` ${type}` : ""}`;
      firebaseAuthStatus.textContent = message;
    }
    function collectSetupSettings(){
      const playerCount = parseInt(numPlayersInput.value, 10);
      const teamCap = parseInt(maxPerTeamInput.value, 10);
      const playerNames = String(playerNamesTextarea.value || "").split(",").map(value=>value.trim()).filter(Boolean);
      return {
        gameMode: gameModeSelect ? gameModeSelect.value : "spin",
        numPlayers: Number.isFinite(playerCount) ? playerCount : 2,
        maxPlayersPerTeam: Number.isFinite(teamCap) ? teamCap : MAX_PER_TEAM,
        playerNames
      };
    }
    function applyRoomSettingsToForm(settings){
      if(!settings || typeof settings !== "object") return;
      if(typeof settings.gameMode === "string" && gameModeSelect) gameModeSelect.value = settings.gameMode;
      if(Number.isFinite(settings.numPlayers)) numPlayersInput.value = String(settings.numPlayers);
      if(Number.isFinite(settings.maxPlayersPerTeam)) maxPerTeamInput.value = String(settings.maxPlayersPerTeam);
      if(Array.isArray(settings.playerNames)) playerNamesTextarea.value = settings.playerNames.join(", ");
      applyModeUI();
    }
    function renderOnlineRoomState(){
      if(!onlineRoomStatus || !onlineRoomMembers) return;
      if(!currentRoomData || !currentRoomId){
        onlineRoomStatus.textContent = "No room connected yet.";
        onlineRoomMembers.textContent = "";
        renderAuctionPresence();
        renderAuctionChat();
        return;
      }
      const viewerUid = getCurrentGuestUser() && getCurrentGuestUser().uid;
      const isHost = viewerUid && currentRoomData.hostUid === viewerUid;
      const roomState = currentRoomData.gameState || null;
      const memberNames = getOrderedRoomMembers().map(member => `${member.name}${member.uid === currentRoomData.hostUid ? " (Host)" : ""}${isRoomMemberOnline(member) ? " online" : " away"}`);
      const settings = currentRoomData.settings || {};
      const turnName = roomState && roomState.gameStarted && Array.isArray(roomState.players) && roomState.players[roomState.currentPlayerIndex]
        ? roomState.players[roomState.currentPlayerIndex].name
        : "";
      onlineRoomStatus.textContent = `Room ${currentRoomId} connected. Role: ${isHost ? "Host" : "Player"}. Status: ${currentRoomData.status || "lobby"}. Setup: ${settings.numPlayers || "-"} players, max ${settings.maxPlayersPerTeam || "-"} per team.${turnName ? ` Turn: ${turnName}.` : ""}`;
      onlineRoomMembers.textContent = memberNames.length ? `Players in room: ${memberNames.join(", ")}` : "No players in room yet.";
      renderAuctionPresence();
      renderAuctionChat();
    }
    function isRoomMemberOnline(member){
      const lastSeen = Date.parse((member && member.lastSeenAt) || (member && member.joinedAt) || "") || 0;
      return Date.now() - lastSeen < 45000;
    }
    function renderAuctionPresence(){
      if(!auctionPresence) return;
      auctionPresence.innerHTML = "";
      if(!currentRoomData || !currentRoomId){
        auctionPresence.innerHTML = '<div class="empty-state">Join a room to see devices.</div>';
        if(hostTransferSelect) hostTransferSelect.innerHTML = "";
        if(hostTransferBtn) hostTransferBtn.disabled = true;
        return;
      }
      const members = getOrderedRoomMembers();
      members.forEach(member=>{
        const row = document.createElement("div");
        row.className = "auction-item";
        row.innerHTML = `<strong>${member.name}${member.uid === currentRoomData.hostUid ? " (Host)" : ""}</strong><div>${isRoomMemberOnline(member) ? "Online" : "Away"}${member.uid ? ` | ${member.uid.slice(0, 8)}` : ""}</div>`;
        auctionPresence.appendChild(row);
      });
      if(hostTransferSelect){
        const prev = hostTransferSelect.value;
        hostTransferSelect.innerHTML = "";
        members.forEach(member=>{
          const opt = document.createElement("option");
          opt.value = member.uid || "";
          opt.textContent = member.name || "Player";
          hostTransferSelect.appendChild(opt);
        });
        if(Array.from(hostTransferSelect.options).some(opt=>opt.value === prev)) hostTransferSelect.value = prev;
      }
      if(hostTransferBtn) hostTransferBtn.disabled = !isCurrentUserHost() || members.length < 2;
    }
    function renderAuctionChat(){
      if(!auctionChatList) return;
      auctionChatList.innerHTML = "";
      const messages = currentRoomData && Array.isArray(currentRoomData.chatMessages) ? currentRoomData.chatMessages.slice(-30) : [];
      if(!messages.length){
        auctionChatList.innerHTML = '<div class="empty-state">No messages yet.</div>';
        return;
      }
      messages.forEach(message=>{
        const row = document.createElement("div");
        row.className = "auction-chat-msg";
        row.innerHTML = `<strong>${message.name || "Player"}</strong>: ${String(message.text || "").replace(/[<>&]/g, ch=>({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]))}`;
        auctionChatList.appendChild(row);
      });
      auctionChatList.scrollTop = auctionChatList.scrollHeight;
    }
    function touchRoomPresence(){
      if(!currentRoomId) return;
      updateRoomPresence(currentRoomId, getOnlineIdentityName()).catch(()=>{});
    }
    function startPresenceLoop(){
      if(presenceInterval) return;
      presenceInterval = window.setInterval(touchRoomPresence, 20000);
    }
    function isCurrentUserHost(){
      const viewerUid = getCurrentGuestUser() && getCurrentGuestUser().uid;
      return !!(currentRoomData && viewerUid && currentRoomData.hostUid === viewerUid);
    }
    function getOrderedRoomMembers(){
      const members = currentRoomData && Array.isArray(currentRoomData.members) ? currentRoomData.members.slice() : [];
      return members.sort((a, b)=>{
        if((a && a.uid) === (currentRoomData && currentRoomData.hostUid)) return -1;
        if((b && b.uid) === (currentRoomData && currentRoomData.hostUid)) return 1;
        const aTime = Date.parse((a && a.joinedAt) || "") || 0;
        const bTime = Date.parse((b && b.joinedAt) || "") || 0;
        return aTime - bTime;
      });
    }
    function getOnlineIdentityName(){
      return String((onlinePlayerNameInput && onlinePlayerNameInput.value) || "").trim();
    }
    function canCurrentDeviceControlTurn(){
      if(!currentRoomId) return true;
      if(isCurrentUserHost()) return true;
      const currentPlayer = players[currentPlayerIndex];
      const viewerUid = getCurrentGuestUser() && getCurrentGuestUser().uid;
      if(currentPlayer && currentPlayer.ownerUid && viewerUid){
        return currentPlayer.ownerUid === viewerUid;
      }
      const identityName = getOnlineIdentityName();
      return !!(currentPlayer && identityName && currentPlayer.name.toLowerCase() === identityName.toLowerCase());
    }
    function canCurrentDeviceControlMatches(){
      if(!currentRoomId) return true;
      return isCurrentUserHost();
    }
    function canCurrentDeviceControlAuctionAdmin(){
      if(!currentRoomId) return true;
      return isCurrentUserHost();
    }
    function getActiveSquadLimit(){
      return currentGameMode === "auction" ? 18 : SQUAD_SIZE;
    }
    function getMinimumSquadSizeForPlay(){
      return currentGameMode === "auction" ? 15 : SQUAD_SIZE;
    }
    function isAuctionMode(){
      return currentGameMode === "auction";
    }
    function applyModeUI(){
      if(gameModeSelect && typeof gameModeSelect.value === "string"){
        currentGameMode = gameModeSelect.value;
      }
      if(modeRulesText){
        modeRulesText.textContent = isAuctionMode()
          ? "Auction mode: build squads of 15-18 players through live bidding, then set XI, impact, and bowling plan."
          : "Rules: 12 players, team cap uses your setup value, max 4 foreign, each player unique globally.";
      }
      if(draftCard){
        draftCard.classList.toggle("mode-hidden", isAuctionMode());
      }
      if(maxPerTeamInput){
        maxPerTeamInput.disabled = isAuctionMode();
      }
      if(spinButton){
        spinButton.disabled = isAuctionMode() || !gameStarted || !canCurrentDeviceControlTurn();
      }
      if(pickForm && isAuctionMode()){
        pickForm.style.display = "none";
      }
    }
    function serializeRoomGameState(){
      return {
        players: JSON.parse(JSON.stringify(players || [])),
        currentPlayerIndex,
        gameStarted,
        selectedTeamName,
        lastSpin: { ...lastSpin },
        maxPlayersPerTeam: getMaxPlayersPerTeam(),
        gameMode: currentGameMode,
        spinInfoHtml: spinInfo ? spinInfo.innerHTML : "",
        pickFormVisible: pickForm ? pickForm.style.display !== "none" : false,
        pickSearchValue: pickSearch ? pickSearch.value : "",
        wheelRotation: currentRotation,
        simResultHtml: simResult ? simResult.innerHTML : "",
        tournamentResultHtml: tournamentResult ? tournamentResult.innerHTML : "",
        tossResultText: tossResultLine ? tossResultLine.textContent : "",
        seasonStats: JSON.parse(JSON.stringify(seasonStats || createEmptySeasonStats())),
        rivalryStats: JSON.parse(JSON.stringify(rivalryStats || {})),
        latestPicks: JSON.parse(JSON.stringify(latestPicks || [])),
        auctionState: auctionState ? JSON.parse(JSON.stringify(auctionState)) : null,
        leagueFlow: leagueFlow ? JSON.parse(JSON.stringify(leagueFlow)) : null,
        statsSyncVersion,
        teamAValue: teamASelect ? teamASelect.value : "",
        teamBValue: teamBSelect ? teamBSelect.value : "",
        venueValue: venueSelect ? venueSelect.value : ""
      };
    }
    function markStatsSyncUpdated(reason = "stats-update"){
      statsSyncVersion = Date.now();
      if(currentRoomId && !applyingRemoteRoomState){
        syncRoomGameState(reason);
      }
    }
    async function refreshStatsFromServer(reason = "", silent = false){
      try{
        const cache = await loadCachedStatsFromServer();
        if(cache && Object.keys(cache).length){
          importedPlayerStats = { ...importedPlayerStats, ...cache };
          importedPlayerStatsMeta = {
            ...(importedPlayerStatsMeta || {}),
            syncedAt: new Date().toISOString()
          };
          saveStoredPlayerStats(importedPlayerStats);
          saveStoredStatsMeta(importedPlayerStatsMeta);
          resetImportedProfileCache();
          renderImportedStatsSummary();
          renderPlayers();
          updateBestSquadSummary();
          if(!silent){
            updateStatsImportStatus(`Loaded ${Object.keys(cache).length} cached player profiles${reason ? ` (${reason})` : ""}.`, "success");
          }
        }
      }catch(err){
        if(!silent){
          updateStatsImportStatus(`Could not load server cache: ${err.message}`, "error");
        }
      }
    }
    function syncRoomGameState(reason = ""){
      if(!currentRoomId || applyingRemoteRoomState) return;
      const outgoingState = serializeRoomGameState();
      lastAppliedRoomGameStateJson = JSON.stringify(outgoingState);
      updateRoomGameState(currentRoomId, outgoingState).catch((err)=>{
        setFirebaseStatus(`Room sync failed${reason ? ` during ${reason}` : ""}: ${err.message}`, "error");
      });
    }
    function applyRoomGameState(roomState){
      if(!roomState || typeof roomState !== "object") return;
      const incomingStateJson = JSON.stringify(roomState);
      if(incomingStateJson === lastAppliedRoomGameStateJson) return;
      lastAppliedRoomGameStateJson = incomingStateJson;
      applyingRemoteRoomState = true;
      const incomingStatsSyncVersion = Number(roomState.statsSyncVersion) || 0;
      const shouldRefreshStatsFromRemote = !!(incomingStatsSyncVersion && incomingStatsSyncVersion !== statsSyncVersion);
      try{
        players = Array.isArray(roomState.players) ? roomState.players : [];
        currentPlayerIndex = Number.isFinite(roomState.currentPlayerIndex) ? roomState.currentPlayerIndex : 0;
        gameStarted = !!roomState.gameStarted;
        currentGameMode = roomState.gameMode || currentGameMode || "spin";
        if(gameModeSelect) gameModeSelect.value = currentGameMode;
        selectedTeamName = roomState.selectedTeamName || null;
        lastSpin = roomState.lastSpin && typeof roomState.lastSpin === "object" ? roomState.lastSpin : { playerIndex: null, team: null };
        if(Number.isFinite(roomState.maxPlayersPerTeam)){
          maxPlayersPerTeam = roomState.maxPlayersPerTeam;
          if(maxPerTeamInput) maxPerTeamInput.value = String(roomState.maxPlayersPerTeam);
        }
        if(Number.isFinite(roomState.wheelRotation)){
          currentRotation = roomState.wheelRotation;
          wheelEl.style.transform = `rotate(${currentRotation}deg)`;
        }
        if(pickSearch) pickSearch.value = roomState.pickSearchValue || "";
        if(spinInfo) spinInfo.innerHTML = roomState.spinInfoHtml || (gameStarted && players[currentPlayerIndex] ? `${players[currentPlayerIndex].name}, it's your turn. Tap Spin.` : "Game not started yet. Use Setup tab first.");
        if(pickForm){
          pickForm.style.display = roomState.pickFormVisible ? "block" : "none";
          if(roomState.pickFormVisible && selectedTeamName && players[currentPlayerIndex]){
            pickedTeamLabel.textContent = selectedTeamName;
            populatePlayerSelect(selectedTeamName, players[currentPlayerIndex], roomState.pickSearchValue || "");
          }
        }
        seasonStats = roomState.seasonStats && typeof roomState.seasonStats === "object" ? roomState.seasonStats : createEmptySeasonStats();
        rivalryStats = roomState.rivalryStats && typeof roomState.rivalryStats === "object" ? roomState.rivalryStats : {};
        latestPicks = Array.isArray(roomState.latestPicks) ? roomState.latestPicks : [];
        auctionState = roomState.auctionState && typeof roomState.auctionState === "object" ? roomState.auctionState : null;
        leagueFlow = roomState.leagueFlow && typeof roomState.leagueFlow === "object" ? roomState.leagueFlow : null;
        if(incomingStatsSyncVersion){
          statsSyncVersion = incomingStatsSyncVersion;
        }
        if(teamASelect && typeof roomState.teamAValue === "string") teamASelect.value = roomState.teamAValue;
        if(teamBSelect && typeof roomState.teamBValue === "string") teamBSelect.value = roomState.teamBValue;
        if(venueSelect && typeof roomState.venueValue === "string") venueSelect.value = roomState.venueValue;
        if(simResult) simResult.innerHTML = roomState.simResultHtml || "";
        if(tournamentResult) tournamentResult.innerHTML = roomState.tournamentResultHtml || "";
        if(tossResultLine) tossResultLine.textContent = roomState.tossResultText || "";
        downloadBtn.disabled = !gameStarted;
        simulateBtn.disabled = !gameStarted || !canCurrentDeviceControlMatches();
        tournamentBtn.disabled = !gameStarted || !canCurrentDeviceControlMatches();
        playNextMatchBtn.disabled = !leagueFlow || leagueFlow.phase === "done" || !canCurrentDeviceControlMatches();
        applyModeUI();
        renderPlayers();
        renderGlobalSummary();
        updateBestSquadSummary();
        populateSimSelects();
        updateGameStatus();
        updateActivePlayerHighlight();
        renderLatestPickFeed();
        renderAuctionState();
        renderStatsDashboard();
        renderRivalryBoard();
      } finally {
        applyingRemoteRoomState = false;
      }
      if(shouldRefreshStatsFromRemote){
        refreshStatsFromServer("room sync", true);
      }
    }
    function deferOrApplyRoomGameState(roomState){
      if(!roomState || typeof roomState !== "object") return;
      if(activeXIEditorState){
        pendingRoomGameStateWhileEditing = roomState;
        return;
      }
      applyRoomGameState(roomState);
    }
    function flushPendingRoomGameState(){
      if(activeXIEditorState || !pendingRoomGameStateWhileEditing) return;
      const queuedState = pendingRoomGameStateWhileEditing;
      pendingRoomGameStateWhileEditing = null;
      applyRoomGameState(queuedState);
    }
    function subscribeToCurrentRoom(roomId){
      if(currentRoomUnsubscribe){
        currentRoomUnsubscribe();
        currentRoomUnsubscribe = null;
      }
      currentRoomId = roomId || "";
      currentRoomData = null;
      lastAppliedRoomGameStateJson = "";
      pendingRoomGameStateWhileEditing = null;
      if(roomCodeInput) roomCodeInput.value = currentRoomId;
      if(!currentRoomId){
        renderOnlineRoomState();
        return;
      }
      currentRoomUnsubscribe = subscribeToRoom(currentRoomId, (roomData)=>{
        currentRoomData = roomData;
        if(roomData && roomData.settings) applyRoomSettingsToForm(roomData.settings);
        if(roomData && roomData.gameState) deferOrApplyRoomGameState(roomData.gameState);
        renderOnlineRoomState();
      });
    }

    function toggleCollapsibleFromClick(event){
      const header = event.target.closest(".collapsible");
      if(!header) return;
      const block = header.closest(".match-block");
      if(!block) return;
      const panelCandidates = Array.from(block.children).filter(child => child !== header && child.tagName === "DIV");
      const panel = panelCandidates[panelCandidates.length - 1];
      if(!panel) return;
      if(panel.style.display === "none"){
        panel.style.display = "";
        syncRoomGameState("scoreboard-open");
      }
    }

    function getStoredApiCount(){
      return Object.keys(importedPlayerStats || {}).length;
    }
    function getSyncCandidates(){
      const trackedPlayers = Array.from(getTrackedPlayerMap().values());
      return trackedPlayers.filter(player=>!importedPlayerStats[player.name]);
    }
    function getSyncCursor(){
      const raw = importedPlayerStatsMeta && Number(importedPlayerStatsMeta.nextSyncIndex);
      return Number.isFinite(raw) && raw >= 0 ? raw : 0;
    }
    function getPendingPlayersFromCursor(){
      const trackedPlayers = Array.from(getTrackedPlayerMap().values());
      const cursor = getSyncCursor();
      const remaining = trackedPlayers.slice(cursor).filter(player=>!importedPlayerStats[player.name]);
      if(remaining.length > 0) return remaining;
      return trackedPlayers.filter(player=>!importedPlayerStats[player.name]);
    }
    async function loadCachedStatsFromServer(){
      const nonce = Date.now();
      const response = await fetch(`/api/cached-player-stats?v=${nonce}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      });
      if(response.ok){
        const payload = await response.json();
        if(!payload.ok) throw new Error(payload.error || "Could not load cached stats");
        return payload.stats || {};
      }
      if(response.status === 404){
        const staticResponse = await fetch(`/data/player-stats-public.json?v=${nonce}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" }
        });
        if(!staticResponse.ok) throw new Error(`Hosted snapshot returned HTTP ${staticResponse.status}`);
        return normalizePlayerStatsPayload(await staticResponse.json());
      }
      throw new Error(`Local server returned HTTP ${response.status}`);
    }
    function renderImportedStatsSummary(){
      const importedCount = getStoredApiCount();
      const syncedAt = importedPlayerStatsMeta && importedPlayerStatsMeta.syncedAt
        ? new Date(importedPlayerStatsMeta.syncedAt).toLocaleString()
        : "";
      const pendingCount = Array.from(getTrackedPlayerMap().values()).filter(player=>!importedPlayerStats[player.name]).length;
      updateStatsImportStatus(
        importedCount > 0
          ? `${importedCount} player profiles cached from the local official-IPL sync.${syncedAt ? ` Last sync: ${syncedAt}.` : ""}${pendingCount ? ` Pending sync: ${pendingCount}.` : ""} Synced players now drive form, strength, strike rate, economy, and wicket skill where available.`
          : "No cached official IPL stats loaded yet. Start the local server and click Sync Next Batch to fetch player profiles.",
        importedCount > 0 ? "success" : ""
      );
    }
    async function syncAllPlayerStatsFromApi(){
      const trackedPlayers = Array.from(getTrackedPlayerMap().values());
      const pendingPlayers = getPendingPlayersFromCursor();
      if(pendingPlayers.length === 0){
        importedPlayerStatsMeta = {
          ...(importedPlayerStatsMeta || {}),
          nextSyncIndex: 0
        };
        saveStoredStatsMeta(importedPlayerStatsMeta);
        renderImportedStatsSummary();
        updateStatsImportStatus("No pending players left to sync. Cached players will keep using API data for everyone already synced.", "success");
        return;
      }
      const batch = pendingPlayers.slice(0, PLAYER_SYNC_BATCH_SIZE);
      const startCursor = getSyncCursor();
      const fallbackStartIndex = trackedPlayers.findIndex(player=>player.name === batch[0]?.name);
      const effectiveStartIndex = startCursor < trackedPlayers.length ? startCursor : Math.max(0, fallbackStartIndex);
      if(syncStatsBtn) syncStatsBtn.disabled = true;
      updateStatsImportStatus(`Sync started for ${batch.length} players in this batch. Remaining before batch: ${pendingPlayers.length}.`, "success");
      const response = await fetch("/api/sync-official-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          players: trackedPlayers,
          offset: effectiveStartIndex,
          limit: PLAYER_SYNC_BATCH_SIZE
        })
      });
      if(!response.ok){
        if(response.status === 404){
          const hostedSnapshot = await loadCachedStatsFromServer();
          importedPlayerStats = { ...importedPlayerStats, ...hostedSnapshot };
          importedPlayerStatsMeta = {
            syncedAt: new Date().toISOString(),
            totalPlayers: trackedPlayers.length,
            foundPlayers: Object.keys(importedPlayerStats).length,
            missingPlayers: [],
            failedPlayers: [],
            pendingPlayers: [],
            nextSyncIndex: 0
          };
          saveStoredPlayerStats(importedPlayerStats);
          saveStoredStatsMeta(importedPlayerStatsMeta);
          resetImportedProfileCache();
          renderImportedStatsSummary();
          renderPlayers();
          updateBestSquadSummary();
          markStatsSyncUpdated("stats-load-cached");
          if(syncStatsBtn) syncStatsBtn.disabled = false;
          updateStatsImportStatus(`Hosted site loaded ${Object.keys(importedPlayerStats).length} bundled player profiles. Fresh live re-sync still needs the local Node server/backend.`, "success");
          return;
        }
        if(syncStatsBtn) syncStatsBtn.disabled = false;
        throw new Error(`Local server returned HTTP ${response.status}`);
      }
      const payload = await response.json();
      if(!payload.ok){
        if(syncStatsBtn) syncStatsBtn.disabled = false;
        throw new Error(payload.error || "Official IPL sync failed");
      }
      const syncedMap = payload.synced || {};
      importedPlayerStats = { ...importedPlayerStats, ...syncedMap };
      const missing = Array.isArray(payload.notFound) ? payload.notFound.map(item=>item.name) : [];
      const failed = Array.isArray(payload.errors) ? payload.errors.map(item=>`${item.name} (${item.reason})`) : [];
      const firstFailure = failed[0] || "";
      const nextSyncIndex = Number.isFinite(payload.nextOffset) ? payload.nextOffset : Math.min(trackedPlayers.length, effectiveStartIndex + batch.length);
      importedPlayerStatsMeta = {
        syncedAt: new Date().toISOString(),
        totalPlayers: trackedPlayers.length,
        foundPlayers: Object.keys(importedPlayerStats).length,
        missingPlayers: missing,
        failedPlayers: failed,
        pendingPlayers: trackedPlayers.slice(nextSyncIndex).filter(player=>!importedPlayerStats[player.name]).map(player=>player.name),
        nextSyncIndex: nextSyncIndex >= trackedPlayers.length ? 0 : nextSyncIndex
      };
      saveStoredPlayerStats(importedPlayerStats);
      saveStoredStatsMeta(importedPlayerStatsMeta);
      resetImportedProfileCache();
      renderImportedStatsSummary();
      renderPlayers();
      updateBestSquadSummary();
      markStatsSyncUpdated("stats-sync-batch");
      if(syncStatsBtn) syncStatsBtn.disabled = false;
      const missingPreview = missing.length ? ` Not found: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ` +${missing.length - 12} more.` : "."}` : "";
      if(failed.length || missing.length){
        updateStatsImportStatus(`Synced ${Object.keys(importedPlayerStats).length}/${trackedPlayers.length} players.${missing.length ? ` Not found in this batch: ${missing.length}.` : ""}${failed.length ? ` Failed in this batch: ${failed.length}.` : ""}${firstFailure ? ` First error: ${firstFailure}.` : ""}${missingPreview}${nextSyncIndex < trackedPlayers.length ? ` Click Sync Next Batch to continue.` : ""}`, failed.length ? "error" : "success");
        return;
      }
      updateStatsImportStatus(nextSyncIndex < trackedPlayers.length ? `Batch complete. Synced ${Object.keys(importedPlayerStats).length}/${trackedPlayers.length} players so far. Click Sync Next Batch to continue.` : `Sync complete for all ${trackedPlayers.length} tracked players.`, "success");
    }

    // wheel labels
    function applyWheelBackground(){
      const seg = 360 / WHEEL_SEGMENTS.length;
      const stops = WHEEL_COLORS.map((color, i)=>{
        const from = (i * seg).toFixed(2);
        const to = ((i + 1) * seg).toFixed(2);
        return `${color} ${from}deg ${to}deg`;
      }).join(",");
      wheelEl.style.background = `conic-gradient(${stops})`;
    }

    (function createWheelLabels(){
      wheelEl.querySelectorAll(".wheel-label").forEach(el=>el.remove());
      applyWheelBackground();
      const seg = 360 / WHEEL_SEGMENTS.length;
      const radiusPx = 120;
      WHEEL_SEGMENTS.forEach((team, i)=>{
        const lbl = document.createElement("div");
        lbl.className = "wheel-label";
        const angle = i * seg + seg / 2;
        lbl.style.transform = `translate(-50%,-50%) rotate(${angle}deg) translate(0,-${radiusPx}px) rotate(${-angle}deg)`;
        lbl.textContent = team;
        wheelEl.appendChild(lbl);
      });
    })();

    // ---------- UI helpers ----------
    function getGlobalPickedNameSet(){ const s=new Set(); players.forEach(p=>p.squad.forEach(x=>s.add(x.playerName))); return s; }
    function getGlobalPickedDetailed(){ const arr=[]; players.forEach(p=>p.squad.forEach(x=>arr.push({owner:p.name,playerName:x.playerName,role:x.role,team:x.team}))); return arr; }
    function renderGlobalSummary(){ /* global picks tab removed */ }
    function renderLatestPickFeed(){
      if(!latestPickFeed) return;
      latestPickFeed.innerHTML = "";
      if(!latestPicks || latestPicks.length === 0){
        latestPickFeed.textContent = "No picks yet.";
        return;
      }
      latestPicks.slice().reverse().forEach(pick=>{
        const chip = document.createElement("div");
        chip.className = "pick-chip";
        chip.innerHTML = `<strong>${pick.owner || "Player"}</strong> picked ${formatPlayerName(pick.playerName || "-")} (${pick.team || "-"})`;
        latestPickFeed.appendChild(chip);
      });
    }
    function updateTurnOwnerBanner(){
      if(!turnOwnerBanner){
        return;
      }
      if(!gameStarted || !players[currentPlayerIndex]){
        turnOwnerBanner.textContent = "Waiting for setup...";
        return;
      }
      const cur = players[currentPlayerIndex];
      const ownerText = cur && cur.ownerUid ? " | Remote turn synced" : "";
      turnOwnerBanner.textContent = `Turn: ${cur.name}${ownerText}`;
    }
    function addLatestPick(owner, playerName, team){
      latestPicks.push({
        owner: owner || "Player",
        playerName: playerName || "",
        team: team || "",
        at: new Date().toISOString()
      });
      renderLatestPickFeed();
    }
    function getAuctionRoleBucket(role){
      const baseRole = getBaseRole(role);
      if(baseRole === "WK") return "WK";
      if(baseRole === "AR") return "AR";
      if(baseRole === "BOWL") return "BOWL";
      return "BAT";
    }
    function formatAuctionPrice(valueLakhs){
      const amount = Number(valueLakhs) || 0;
      if(amount >= 100){
        const crore = amount / 100;
        return `₹${Number.isInteger(crore) ? crore : crore.toFixed(2)} Cr`;
      }
      return `₹${amount} L`;
    }
    function getAuctionTimerRemaining(){
      if(!auctionState || !auctionState.currentLot || !auctionState.endAt) return 0;
      return Math.max(0, Math.ceil((auctionState.endAt - Date.now()) / 1000));
    }
    function getAuctionControlledTeam(){
      if(!players || !Array.isArray(players)) return null;
      const viewerUid = getCurrentGuestUser() && getCurrentGuestUser().uid;
      const selectedBidder = auctionBidAsSelect ? auctionBidAsSelect.value : "";
      if(selectedBidder && (!currentRoomId || isCurrentUserHost())){
        return players.find(team=>team && team.name === selectedBidder) || null;
      }
      const identityName = getOnlineIdentityName().toLowerCase();
      return players.find(team=>{
        if(viewerUid && team.ownerUid && team.ownerUid === viewerUid) return true;
        return identityName && team.name && team.name.toLowerCase() === identityName;
      }) || null;
    }
    function renderAuctionBidAsSelect(){
      if(!auctionBidAsSelect) return;
      const previous = auctionBidAsSelect.value;
      auctionBidAsSelect.innerHTML = "";
      (players || []).forEach(team=>{
        const opt = document.createElement("option");
        opt.value = team.name;
        opt.textContent = team.name;
        auctionBidAsSelect.appendChild(opt);
      });
      const canUseSharedDevice = !currentRoomId || isCurrentUserHost();
      auctionBidAsSelect.disabled = !canUseSharedDevice || !players || players.length === 0;
      if(Array.from(auctionBidAsSelect.options).some(opt=>opt.value === previous)){
        auctionBidAsSelect.value = previous;
      } else {
        const controlled = players.find(team=>{
          const uid = getCurrentGuestUser() && getCurrentGuestUser().uid;
          return uid && team.ownerUid === uid;
        });
        if(controlled) auctionBidAsSelect.value = controlled.name;
      }
    }
    function getAuctionBidIncrement(currentBid){
      const bid = Number(currentBid) || 0;
      if(bid >= 200) return 50;
      if(bid >= 100) return 25;
      return 10;
    }
    function shuffleArray(items){
      const arr = items.slice();
      for(let i=arr.length - 1; i>0; i--){
        const j = getRandomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    function getAuctionAvatar(name){
      return String(name || "IPL").split(" ").map(part=>part[0] || "").join("").slice(0, 3).toUpperCase();
    }
    function isCappedAuctionPlayer(name, role){
      return FORM_PLAYERS.has(name) ||
        PLAYER_RECORD_CAPS[name] ||
        BAT_SR_PROFILES[name] ||
        BOWL_ECON_PROFILES[name] ||
        BOWL_WICKET_SKILL[name] ||
        POWERPLAY_SPECIALISTS[name] ||
        MIDDLE_OVERS_SPECIALISTS[name] ||
        DEATH_SPECIALISTS[name] ||
        FOREIGN_PLAYERS.has(name) ||
        getPlayerRating(name, role) >= 8.2;
    }
    function getAuctionBasePrice(setType, rating){
      if(setType === "Marquee Players") return rating >= 9 ? 200 : 150;
      if(setType === "All-Rounders") return rating >= 8.5 ? 150 : 100;
      if(setType === "Wicketkeepers") return rating >= 8.5 ? 125 : 75;
      if(setType === "Capped Batsmen") return rating >= 8.5 ? 125 : 75;
      if(setType === "Capped Bowlers") return rating >= 8.5 ? 125 : 75;
      return rating >= 7.8 ? 40 : 20;
    }
    function getAuctionSetNames(){
      return ["Marquee Players", "Wicketkeepers", "Capped Batsmen", "Capped Bowlers", "All-Rounders", "Uncapped Players"];
    }
    function getManualAuctionSetOrder(){
      const raw = auctionSetOrderSelect ? auctionSetOrderSelect.value : "";
      const valid = new Set(getAuctionSetNames());
      const order = String(raw || "").split(",").map(value=>value.trim()).filter(value=>valid.has(value));
      return order.length ? order : getAuctionSetNames();
    }
    function getSelectedAuctionSet(){
      const selected = auctionSetSelect ? auctionSetSelect.value : "All Sets";
      return selected || "All Sets";
    }
    function buildAuctionLots(selectedSet = "All Sets", excludedNames = new Set()){
      const seen = new Set();
      const buckets = {
        "Marquee Players": [],
        "Wicketkeepers": [],
        "Capped Batsmen": [],
        "Capped Bowlers": [],
        "All-Rounders": [],
        "Uncapped Players": []
      };
      Object.entries(IPL_PLAYERS).forEach(([teamCode, squad])=>{
        (squad || []).forEach(player=>{
          if(seen.has(player.name)) return;
          if(excludedNames.has(player.name)) return;
          seen.add(player.name);
          const roleBucket = getAuctionRoleBucket(player.role);
          const rating = getPlayerRating(player.name, player.role);
          const capped = isCappedAuctionPlayer(player.name, player.role);
          let setType = "Uncapped Players";
          if(FORM_PLAYERS.has(player.name) || rating >= 8.9){
            setType = "Marquee Players";
          } else if(roleBucket === "WK"){
            setType = "Wicketkeepers";
          } else if(roleBucket === "AR"){
            setType = "All-Rounders";
          } else if(capped && roleBucket === "BAT"){
            setType = "Capped Batsmen";
          } else if(capped && roleBucket === "BOWL"){
            setType = "Capped Bowlers";
          }
          buckets[setType].push({
            id: `${teamCode}-${player.name}`.replace(/\s+/g, "-"),
            name: player.name,
            role: player.role,
            roleBucket,
            capped,
            basePrice: getAuctionBasePrice(setType, rating),
            setType,
            team: teamCode,
            isOverseas: FOREIGN_PLAYERS.has(player.name)
          });
        });
      });
      const setNames = getAuctionSetNames();
      if(selectedSet && selectedSet !== "All Sets" && buckets[selectedSet]){
        return shuffleArray(buckets[selectedSet]);
      }
      return setNames.flatMap(setName=>shuffleArray(buckets[setName]));
    }
    function getAuctionTeamCounts(squad){
      return (squad || []).reduce((acc, player)=>{
        const bucket = getAuctionRoleBucket(player.role);
        acc[bucket] = (acc[bucket] || 0) + 1;
        if(player.isOverseas) acc.overseas += 1;
        return acc;
      }, { BAT: 0, BOWL: 0, AR: 0, WK: 0, overseas: 0 });
    }
    function canAuctionTeamAddPlayer(team, lot, bidAmount){
      if(!team || !lot) return { ok: false, reason: "Team not found." };
      if((team.purse || 0) < bidAmount) return { ok: false, reason: "Not enough purse." };
      if((team.squad || []).length >= 18) return { ok: false, reason: "Squad already has 18 players." };
      const counts = getAuctionTeamCounts(team.squad || []);
      if(lot.isOverseas && counts.overseas >= 8) return { ok: false, reason: "Overseas limit reached." };
      const nextCounts = { ...counts };
      nextCounts[lot.roleBucket] = (nextCounts[lot.roleBucket] || 0) + 1;
      if(lot.isOverseas) nextCounts.overseas += 1;
      const slotsLeft = 18 - ((team.squad || []).length + 1);
      const missing = Math.max(0, 4 - nextCounts.BAT) + Math.max(0, 5 - nextCounts.BOWL) + Math.max(0, 2 - nextCounts.AR) + Math.max(0, 1 - nextCounts.WK);
      if(missing > slotsLeft){
        return { ok: false, reason: "This bid would make the minimum squad balance impossible." };
      }
      return { ok: true, reason: "" };
    }
    function getAuctionCompletedPlayerNames(existingState = auctionState){
      const names = new Set();
      (players || []).forEach(team=>{
        (team.squad || []).forEach(player=>{
          if(player && (player.playerName || player.name)) names.add(player.playerName || player.name);
        });
      });
      if(existingState){
        (existingState.soldLots || []).forEach(lot=>{ if(lot && lot.name) names.add(lot.name); });
        (existingState.unsoldLots || []).forEach(lot=>{ if(lot && lot.name) names.add(lot.name); });
      }
      return names;
    }
    function createInitialAuctionState(selectedSet = "All Sets", previousState = null){
      const excludedNames = previousState ? getAuctionCompletedPlayerNames(previousState) : new Set();
      const lots = buildAuctionLots(selectedSet, excludedNames);
      const setOrder = getManualAuctionSetOrder();
      return {
        status: "idle",
        selectedSet,
        setOrder,
        setOrderIndex: Math.max(0, setOrder.indexOf(selectedSet)),
        availableSets: getAuctionSetNames(),
        lots,
        currentIndex: -1,
        currentLot: null,
        currentBid: 0,
        highestBidder: "",
        highestBidderUid: "",
        bidHistory: [],
        soldLots: previousState && Array.isArray(previousState.soldLots) ? previousState.soldLots : [],
        unsoldLots: previousState && Array.isArray(previousState.unsoldLots) ? previousState.unsoldLots : [],
        pendingTrade: previousState && previousState.pendingTrade ? previousState.pendingTrade : null,
        endAt: 0,
        timerSeconds: 55
      };
    }
    function findAuctionLotByName(playerName){
      const name = String(playerName || "");
      if(!name) return null;
      const allLots = buildAuctionLots("All Sets", new Set());
      return allLots.find(lot=>lot.name === name) || null;
    }
    function normalizeUnsoldLot(lot){
      if(!lot || !lot.name) return null;
      const fullLot = lot.role && lot.roleBucket && lot.team ? lot : findAuctionLotByName(lot.name);
      if(!fullLot) return null;
      return {
        id: fullLot.id || `${fullLot.team || "UNSOLD"}-${fullLot.name}`.replace(/\s+/g, "-"),
        name: fullLot.name,
        role: fullLot.role,
        roleBucket: fullLot.roleBucket || getAuctionRoleBucket(fullLot.role),
        capped: !!fullLot.capped,
        basePrice: Number(lot.basePrice || fullLot.basePrice) || 20,
        setType: fullLot.setType || "Unsold Players",
        team: fullLot.team,
        isOverseas: !!fullLot.isOverseas,
        rebid: true
      };
    }
    function getAvailableUnsoldLots(){
      const squadNames = new Set();
      (players || []).forEach(team=>{
        (team.squad || []).forEach(player=>{
          if(player && (player.playerName || player.name)) squadNames.add(player.playerName || player.name);
        });
      });
      return (auctionState && Array.isArray(auctionState.unsoldLots) ? auctionState.unsoldLots : [])
        .map(normalizeUnsoldLot)
        .filter(lot=>lot && !squadNames.has(lot.name));
    }
    function startUnsoldRebid(){
      if(!auctionState || !canCurrentDeviceControlAuctionAdmin()) return;
      const selectedName = auctionUnsoldSelect ? auctionUnsoldSelect.value : "";
      const lot = getAvailableUnsoldLots().find(item=>item.name === selectedName);
      if(!lot){
        if(auctionStatusLine) auctionStatusLine.textContent = "Choose an unsold player to rebid.";
        return;
      }
      if(auctionSaleTimeout){
        window.clearTimeout(auctionSaleTimeout);
        auctionSaleTimeout = null;
      }
      auctionState.unsoldLots = (auctionState.unsoldLots || []).filter(item=>item && item.name !== lot.name);
      auctionState.currentLot = lot;
      auctionState.currentBid = 0;
      auctionState.highestBidder = "";
      auctionState.highestBidderUid = "";
      auctionState.bidHistory = [];
      auctionState.saleMessage = "";
      auctionState.endAt = Date.now() + ((auctionState.timerSeconds || 55) * 1000);
      auctionState.status = "running";
      renderAuctionState();
      syncRoomGameState("auction-unsold-rebid");
    }
    function startAuctionTimerLoop(){
      if(auctionTimerInterval) return;
      auctionTimerInterval = window.setInterval(()=>{
        if(!auctionState || !auctionTimer) return;
        auctionTimer.textContent = String(getAuctionTimerRemaining()).padStart(2, "0");
        if(canCurrentDeviceControlAuctionAdmin() && auctionState.status === "running" && auctionState.currentLot && getAuctionTimerRemaining() <= 0){
          finalizeAuctionLot("timer");
        }
      }, 500);
    }
    function moveToNextAuctionLot(autoStart = true){
      if(!auctionState) return;
      if(auctionSaleTimeout){
        window.clearTimeout(auctionSaleTimeout);
        auctionSaleTimeout = null;
      }
      const nextIndex = (Number.isFinite(auctionState.currentIndex) ? auctionState.currentIndex : -1) + 1;
      const nextLot = Array.isArray(auctionState.lots) ? auctionState.lots[nextIndex] : null;
      auctionState.currentIndex = nextIndex;
      auctionState.currentLot = nextLot || null;
      auctionState.currentBid = 0;
      auctionState.highestBidder = "";
      auctionState.highestBidderUid = "";
      auctionState.bidHistory = [];
      auctionState.endAt = nextLot && autoStart ? Date.now() + ((auctionState.timerSeconds || 55) * 1000) : 0;
      auctionState.status = nextLot ? (autoStart ? "running" : "paused") : "completed";
      renderAuctionState();
      syncRoomGameState("auction-next-lot");
    }
    function finalizeAuctionLot(reason = "timer"){
      if(!auctionState || !auctionState.currentLot) return;
      const lot = auctionState.currentLot;
      let saleMessage = `${lot.name} is unsold at ${formatAuctionPrice(lot.basePrice)}.`;
      if(auctionState.highestBidder){
        const team = (players || []).find(entry=>entry.name === auctionState.highestBidder);
        if(team){
          team.squad.push({
            playerName: lot.name,
            team: lot.team,
            role: lot.role,
            price: auctionState.currentBid,
            setType: lot.setType,
            isOverseas: lot.isOverseas
          });
          team.purse = Math.max(0, (team.purse || 12000) - auctionState.currentBid);
          team.totalSpent = (team.totalSpent || 0) + auctionState.currentBid;
          if(team.squad.length >= getMinimumSquadSizeForPlay() && !team.playing){
            team.playing = null;
          }
          addLatestPick(team.name, lot.name, lot.setType);
          auctionState.soldLots.push({
            name: lot.name,
            team: team.name,
            price: auctionState.currentBid,
            reason
          });
          saleMessage = `SOLD: ${lot.name} to ${team.name} for ${formatAuctionPrice(auctionState.currentBid)}.`;
        }
      } else {
        auctionState.unsoldLots = (auctionState.unsoldLots || []).filter(item=>item && item.name !== lot.name);
        auctionState.unsoldLots.push({
          id: lot.id,
          name: lot.name,
          role: lot.role,
          roleBucket: lot.roleBucket,
          capped: !!lot.capped,
          basePrice: lot.basePrice,
          setType: lot.setType,
          team: lot.team,
          isOverseas: !!lot.isOverseas,
          reason
        });
      }
      auctionState.status = "sold-animation";
      auctionState.saleMessage = saleMessage;
      auctionState.endAt = 0;
      renderAuctionState();
      syncRoomGameState("auction-sale");
      if(canCurrentDeviceControlAuctionAdmin()){
        auctionSaleTimeout = window.setTimeout(()=>moveToNextAuctionLot(true), 2400);
      }
    }
    function placeAuctionBid(customIncrement = null){
      if(!auctionState || !auctionState.currentLot || auctionState.status !== "running") return;
      const team = getAuctionControlledTeam();
      if(!team){
        if(auctionBidHint) auctionBidHint.textContent = "Bid from the device linked to that team name.";
        return;
      }
      const bidAmount = auctionState.currentBid > 0
        ? auctionState.currentBid + (customIncrement || getAuctionBidIncrement(auctionState.currentBid))
        : auctionState.currentLot.basePrice;
      const canBid = canAuctionTeamAddPlayer(team, auctionState.currentLot, bidAmount);
      if(!canBid.ok){
        if(auctionBidHint) auctionBidHint.textContent = canBid.reason;
        return;
      }
      const viewerUid = getCurrentGuestUser() && getCurrentGuestUser().uid;
      auctionState.currentBid = bidAmount;
      auctionState.highestBidder = team.name;
      auctionState.highestBidderUid = viewerUid || "";
      auctionState.endAt = Date.now() + ((auctionState.timerSeconds || 55) * 1000);
      auctionState.bidHistory.push({
        team: team.name,
        amount: bidAmount,
        at: new Date().toISOString()
      });
      if(auctionBidHint) auctionBidHint.textContent = `${team.name} is leading at ${formatAuctionPrice(bidAmount)}.`;
      renderAuctionState();
      syncRoomGameState("auction-bid");
    }
    function renderAuctionPlayerProfile(lot){
      if(!auctionPlayerProfile) return;
      if(!lot){
        auctionPlayerProfile.className = "auction-profile empty-state";
        auctionPlayerProfile.textContent = "Player profile appears when a lot is active.";
        return;
      }
      const rating = getPlayerRating(lot.name, lot.role);
      const form = getCurrentFormScore(lot.name, lot.role);
      const tags = [
        formatRole(lot.role),
        lot.team,
        lot.isOverseas ? "Overseas" : "Indian",
        lot.capped ? "Capped" : "Uncapped",
        isPlayerInForm(lot.name, lot.role) ? "In form" : "Steady"
      ];
      const imported = getImportedPlayerProfile(lot.name, lot.role);
      const batting = imported && imported.batting ? `Bat avg ${imported.batting.average}, SR ${imported.batting.strikeRate}` : "Bat profile estimated";
      const bowling = imported && imported.bowling ? `Bowl econ ${imported.bowling.economy}, WPM ${imported.bowling.wicketsPerMatch}` : "Bowl profile estimated";
      auctionPlayerProfile.className = "auction-profile";
      auctionPlayerProfile.innerHTML = `<strong>Profile</strong><div class="auction-team-stats">${tags.map(tag=>`<span class="auction-mini-chip">${tag}</span>`).join("")}</div><div class="small-text">Rating ${rating.toFixed(1)} | Form ${form}</div><div class="small-text">${batting} | ${bowling}</div>`;
    }
    function renderAuctionState(){
      if(!auctionStatusLine) return;
      startAuctionTimerLoop();
      if(!auctionState){
        renderAuctionBidAsSelect();
        auctionStatusLine.textContent = "Create teams in Setup, then initialize auction.";
        if(auctionPlayerName) auctionPlayerName.textContent = "No current player";
        if(auctionPlayerMeta) auctionPlayerMeta.textContent = "Current lot details will appear here.";
        if(auctionSetBadge) auctionSetBadge.textContent = "Auction not started";
        if(auctionPlayerAvatar) auctionPlayerAvatar.textContent = "IPL";
        if(auctionBasePrice) auctionBasePrice.textContent = "-";
        if(auctionCurrentBid) auctionCurrentBid.textContent = "-";
        if(auctionHighestBidder) auctionHighestBidder.textContent = "-";
        if(auctionTimer) auctionTimer.textContent = "00";
        if(auctionBidHistory) auctionBidHistory.innerHTML = '<div class="empty-state">No bids yet.</div>';
        if(auctionLotHistory) auctionLotHistory.innerHTML = '<div class="empty-state">Auction history will appear here.</div>';
        if(auctionUnsoldSelect) auctionUnsoldSelect.innerHTML = '<option value="">No unsold players</option>';
        if(auctionRebidBtn) auctionRebidBtn.disabled = true;
        if(auctionLeaderboard) auctionLeaderboard.innerHTML = '<div class="empty-state">Initialize auction to view teams.</div>';
        if(auctionTeamsBoard) auctionTeamsBoard.innerHTML = '<div class="empty-state">Auction squads will appear here.</div>';
        if(auctionBidBtn) auctionBidBtn.disabled = true;
        [auctionBid10Btn, auctionBid25Btn, auctionBid50Btn, auctionBid100Btn].forEach(btn=>{ if(btn) btn.disabled = true; });
        if(auctionEndBtn) auctionEndBtn.disabled = true;
        if(auctionSaleBanner) auctionSaleBanner.style.display = "none";
        renderAuctionPlayerProfile(null);
        if(auctionSetSelect) auctionSetSelect.disabled = false;
        if(auctionSetOrderSelect) auctionSetOrderSelect.disabled = false;
        renderTradeWindow();
        return;
      }
      const lot = auctionState.currentLot;
      renderAuctionBidAsSelect();
      if(auctionSetSelect){
        auctionSetSelect.value = auctionState.selectedSet || "All Sets";
        auctionSetSelect.disabled = auctionState.status === "running";
      }
      if(auctionSetOrderSelect) auctionSetOrderSelect.disabled = auctionState.status === "running";
      if(auctionSaleBanner){
        if(auctionState.saleMessage && (auctionState.status === "sold-animation" || auctionState.status === "ended")){
          auctionSaleBanner.textContent = auctionState.saleMessage;
          auctionSaleBanner.style.display = "block";
        } else {
          auctionSaleBanner.style.display = "none";
        }
      }
      auctionStatusLine.textContent = lot
        ? (lot.rebid
          ? `Status: ${auctionState.status}. Unsold rebid: ${lot.name}.`
          : `Status: ${auctionState.status}. ${auctionState.selectedSet || "All Sets"} lot ${Math.max(1, auctionState.currentIndex + 1)} of ${(auctionState.lots || []).length}.`)
        : `Status: ${auctionState.status}. Sold ${auctionState.soldLots.length}, Unsold ${auctionState.unsoldLots.length}.`;
      if(auctionPlayerAvatar) auctionPlayerAvatar.textContent = lot ? getAuctionAvatar(lot.name) : "DONE";
      if(auctionSetBadge) auctionSetBadge.textContent = lot ? lot.setType : "Auction complete";
      if(auctionPlayerName) auctionPlayerName.textContent = lot ? lot.name : "No current player";
      if(auctionPlayerMeta) auctionPlayerMeta.textContent = lot ? `${formatRole(lot.role)} | ${lot.capped ? "Capped" : "Uncapped"} | ${lot.isOverseas ? "Overseas" : "Indian"} | Team: ${lot.team}` : "All lots processed.";
      if(auctionBasePrice) auctionBasePrice.textContent = lot ? formatAuctionPrice(lot.basePrice) : "-";
      if(auctionCurrentBid) auctionCurrentBid.textContent = auctionState.currentBid ? formatAuctionPrice(auctionState.currentBid) : "No bid";
      if(auctionHighestBidder) auctionHighestBidder.textContent = auctionState.highestBidder || "-";
      if(auctionTimer) auctionTimer.textContent = String(getAuctionTimerRemaining()).padStart(2, "0");
      renderAuctionPlayerProfile(lot);
      const controlledTeam = getAuctionControlledTeam();
      if(auctionBidBtn){
        auctionBidBtn.disabled = !(lot && auctionState.status === "running" && controlledTeam);
        const nextBid = lot ? (auctionState.currentBid > 0 ? auctionState.currentBid + getAuctionBidIncrement(auctionState.currentBid) : lot.basePrice) : 0;
        auctionBidBtn.textContent = lot ? `Bid ${formatAuctionPrice(nextBid)}` : "Auction Closed";
      }
      [auctionBid10Btn, auctionBid25Btn, auctionBid50Btn, auctionBid100Btn].forEach(btn=>{
        if(btn) btn.disabled = !(lot && auctionState.status === "running" && controlledTeam);
      });
      if(auctionBidHint){
        if(!controlledTeam) auctionBidHint.textContent = currentRoomId && !isCurrentUserHost() ? "This device can bid only for its joined team." : "Choose a team in Bid as to play auction from one device.";
        else if(lot) auctionBidHint.textContent = `${controlledTeam.name} purse: ${formatAuctionPrice(controlledTeam.purse)}. Change Bid as for pass-and-play.`;
        else auctionBidHint.textContent = "Auction complete.";
      }
      if(auctionBidHistory){
        auctionBidHistory.innerHTML = "";
        const items = (auctionState.bidHistory || []).slice().reverse();
        if(items.length === 0){
          auctionBidHistory.innerHTML = '<div class="empty-state">No bids yet.</div>';
        } else {
          items.forEach(item=>{
            const row = document.createElement("div");
            row.className = "auction-item";
            row.innerHTML = `<strong>${item.team}</strong><div>${formatAuctionPrice(item.amount)}</div>`;
            auctionBidHistory.appendChild(row);
          });
        }
      }
      if(auctionLotHistory){
        auctionLotHistory.innerHTML = "";
        const sold = (auctionState.soldLots || []).slice(-10).reverse().map(item=>({
          label: `${item.name} sold to ${item.team}`,
          meta: formatAuctionPrice(item.price)
        }));
        const unsold = (auctionState.unsoldLots || []).slice(-10).reverse().map(item=>({
          label: `${item.name} unsold`,
          meta: formatAuctionPrice(item.basePrice)
        }));
        const allLots = [...sold, ...unsold].slice(0, 14);
        if(allLots.length === 0){
          auctionLotHistory.innerHTML = '<div class="empty-state">Auction history will appear here.</div>';
        } else {
          allLots.forEach(item=>{
            const row = document.createElement("div");
            row.className = "auction-item";
            row.innerHTML = `<strong>${item.label}</strong><div>${item.meta}</div>`;
            auctionLotHistory.appendChild(row);
          });
        }
      }
      if(auctionUnsoldSelect){
        const previousUnsold = auctionUnsoldSelect.value;
        const unsoldLots = getAvailableUnsoldLots();
        auctionUnsoldSelect.innerHTML = "";
        if(unsoldLots.length === 0){
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "No unsold players";
          auctionUnsoldSelect.appendChild(opt);
        } else {
          unsoldLots.forEach(item=>{
            const opt = document.createElement("option");
            opt.value = item.name;
            opt.textContent = `${item.name} (${formatRole(item.role)} | ${formatAuctionPrice(item.basePrice)})`;
            auctionUnsoldSelect.appendChild(opt);
          });
          if(Array.from(auctionUnsoldSelect.options).some(opt=>opt.value === previousUnsold)) auctionUnsoldSelect.value = previousUnsold;
        }
      }
      if(auctionRebidBtn){
        const canRebid = canCurrentDeviceControlAuctionAdmin()
          && getAvailableUnsoldLots().length > 0
          && auctionState.status !== "running"
          && auctionState.status !== "sold-animation";
        auctionRebidBtn.disabled = !canRebid;
      }
      const sortedTeams = (players || []).slice().sort((a, b)=>{
        const sizeDiff = (b.squad || []).length - (a.squad || []).length;
        if(sizeDiff !== 0) return sizeDiff;
        return (b.purse || 0) - (a.purse || 0);
      });
      if(auctionLeaderboard){
        auctionLeaderboard.innerHTML = "";
        sortedTeams.forEach(team=>{
          const counts = getAuctionTeamCounts(team.squad || []);
          const row = document.createElement("div");
          row.className = "auction-team-card";
          row.innerHTML = `<div class="auction-team-top"><strong>${team.name}</strong><span>${formatAuctionPrice(team.purse)}</span></div><div class="auction-team-stats"><span class="auction-mini-chip">${(team.squad || []).length}/18</span><span class="auction-mini-chip">BAT ${counts.BAT}</span><span class="auction-mini-chip">WK ${counts.WK}</span><span class="auction-mini-chip">BOWL ${counts.BOWL}</span><span class="auction-mini-chip">AR ${counts.AR}</span><span class="auction-mini-chip">OS ${counts.overseas}/8</span></div>`;
          auctionLeaderboard.appendChild(row);
        });
      }
      if(auctionTeamsBoard){
        auctionTeamsBoard.innerHTML = "";
        sortedTeams.forEach(team=>{
          const counts = getAuctionTeamCounts(team.squad || []);
          const row = document.createElement("div");
          row.className = "auction-team-card";
          const squadList = (team.squad || []).slice(-8).reverse().map(player=>`<div>${player.playerName || player.name} <span class="small-text">(${formatRole(player.role)} | ${formatAuctionPrice(player.price)})</span></div>`).join("");
          row.innerHTML = `<div class="auction-team-top"><strong>${team.name}</strong><span>${formatAuctionPrice(team.totalSpent || 0)} spent</span></div><div class="auction-team-stats"><span class="auction-mini-chip">Purse ${formatAuctionPrice(team.purse)}</span><span class="auction-mini-chip">BAT ${counts.BAT}</span><span class="auction-mini-chip">WK ${counts.WK}</span><span class="auction-mini-chip">BOWL ${counts.BOWL}</span><span class="auction-mini-chip">AR ${counts.AR}</span><span class="auction-mini-chip">Overseas ${counts.overseas}</span></div><div class="auction-squad-list">${squadList || '<div class="small-text">No players yet.</div>'}</div>`;
          auctionTeamsBoard.appendChild(row);
        });
      }
      if(auctionInitBtn) auctionInitBtn.disabled = !(players && players.length >= 2);
      if(auctionNextSetBtn) auctionNextSetBtn.disabled = !canCurrentDeviceControlAuctionAdmin() || !auctionState || auctionState.status === "running" || auctionState.status === "sold-animation";
      if(auctionStartBtn) auctionStartBtn.disabled = !canCurrentDeviceControlAuctionAdmin() || !lot || auctionState.status === "running" || auctionState.status === "sold-animation";
      if(auctionPauseBtn) auctionPauseBtn.disabled = !canCurrentDeviceControlAuctionAdmin() || auctionState.status !== "running";
      if(auctionNextBtn) auctionNextBtn.disabled = !canCurrentDeviceControlAuctionAdmin() || auctionState.status === "sold-animation" || (!lot && auctionState.status === "completed");
      if(auctionEndBtn) auctionEndBtn.disabled = !canCurrentDeviceControlAuctionAdmin() || !auctionState || auctionState.status === "ended";
      renderTradeWindow();
    }
    function fillTradePlayerSelect(teamSelect, playerSelect){
      if(!teamSelect || !playerSelect) return;
      const idx = parseInt(teamSelect.value, 10);
      const team = players[idx];
      const prev = playerSelect.value;
      playerSelect.innerHTML = "";
      if(!team || !Array.isArray(team.squad) || team.squad.length === 0){
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No players";
        playerSelect.appendChild(opt);
        return;
      }
      team.squad.forEach((player, playerIndex)=>{
        const opt = document.createElement("option");
        opt.value = String(playerIndex);
        opt.textContent = `${player.playerName || player.name} (${formatRole(player.role)})`;
        playerSelect.appendChild(opt);
      });
      if(Array.from(playerSelect.options).some(opt=>opt.value === prev)) playerSelect.value = prev;
    }
    function renderTradeWindow(){
      if(!tradeTeamASelect || !tradeTeamBSelect || !tradePlayerASelect || !tradePlayerBSelect) return;
      const prevA = tradeTeamASelect.value;
      const prevB = tradeTeamBSelect.value;
      tradeTeamASelect.innerHTML = "";
      tradeTeamBSelect.innerHTML = "";
      (players || []).forEach((team, idx)=>{
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = team.name;
        tradeTeamASelect.appendChild(opt);
        tradeTeamBSelect.appendChild(opt.cloneNode(true));
      });
      if(Array.from(tradeTeamASelect.options).some(opt=>opt.value === prevA)) tradeTeamASelect.value = prevA;
      if(Array.from(tradeTeamBSelect.options).some(opt=>opt.value === prevB)) tradeTeamBSelect.value = prevB;
      if(!tradeTeamBSelect.value && players[1]) tradeTeamBSelect.value = "1";
      fillTradePlayerSelect(tradeTeamASelect, tradePlayerASelect);
      fillTradePlayerSelect(tradeTeamBSelect, tradePlayerBSelect);
      const idxA = parseInt(tradeTeamASelect.value, 10);
      const hasPendingTrade = !!(auctionState && auctionState.pendingTrade);
      if(tradeSwapBtn){
        tradeSwapBtn.disabled = !canCurrentDeviceRequestTrade(idxA) || !players || players.length < 2 || hasPendingTrade;
        tradeSwapBtn.textContent = hasPendingTrade ? "Trade Pending" : "Request Trade";
      }
      if(tradeStatus && hasPendingTrade){
        const request = auctionState.pendingTrade;
        tradeStatus.textContent = `${request.fromTeam} offered ${request.fromPlayer} for ${request.toTeam}'s ${request.toPlayer}. Waiting for acceptance.`;
      }
      maybePromptTradeAcceptance();
    }
    function getTradeControlledTeam(){
      if(!players || !Array.isArray(players)) return null;
      const viewerUid = getCurrentGuestUser() && getCurrentGuestUser().uid;
      const identityName = getOnlineIdentityName().toLowerCase();
      return players.find(team=>{
        if(viewerUid && team.ownerUid && team.ownerUid === viewerUid) return true;
        return identityName && team.name && team.name.toLowerCase() === identityName;
      }) || null;
    }
    function canCurrentDeviceRequestTrade(teamIndex){
      if(!currentRoomId) return true;
      if(isCurrentUserHost()) return true;
      const controlledTeam = getTradeControlledTeam();
      return !!(controlledTeam && players[teamIndex] && controlledTeam.name === players[teamIndex].name);
    }
    function canCurrentDeviceAcceptTrade(request){
      if(!request) return false;
      if(!currentRoomId) return true;
      const controlledTeam = getTradeControlledTeam();
      return !!(controlledTeam && controlledTeam.name === request.toTeam);
    }
    function applyTradeRequest(request){
      if(!request) return false;
      const teamA = (players || []).find(team=>team && team.name === request.fromTeam);
      const teamB = (players || []).find(team=>team && team.name === request.toTeam);
      if(!teamA || !teamB) return false;
      const squadA = teamA.squad || [];
      const squadB = teamB.squad || [];
      const playerAIdx = squadA.findIndex(player=>(player.playerName || player.name) === request.fromPlayer);
      const playerBIdx = squadB.findIndex(player=>(player.playerName || player.name) === request.toPlayer);
      if(playerAIdx < 0 || playerBIdx < 0) return false;
      const a = squadA[playerAIdx];
      const b = squadB[playerBIdx];
      squadA[playerAIdx] = b;
      squadB[playerBIdx] = a;
      teamA.playing = null;
      teamB.playing = null;
      if(auctionState) auctionState.pendingTrade = null;
      if(tradeStatus) tradeStatus.textContent = `${a.playerName || a.name} swapped with ${b.playerName || b.name}.`;
      renderPlayers();
      renderAuctionState();
      populateSimSelects();
      syncRoomGameState("trade-accepted");
      return true;
    }
    function maybePromptTradeAcceptance(){
      const request = auctionState && auctionState.pendingTrade;
      if(!request || request.id === promptedTradeRequestId || !canCurrentDeviceAcceptTrade(request)) return;
      promptedTradeRequestId = request.id;
      window.setTimeout(()=>{
        if(!auctionState || !auctionState.pendingTrade || auctionState.pendingTrade.id !== request.id) return;
        const accepted = window.confirm(`${request.fromTeam} wants to trade ${request.fromPlayer} for your ${request.toPlayer}. Accept trade?`);
        if(accepted){
          applyTradeRequest(request);
        } else {
          auctionState.pendingTrade = null;
          if(tradeStatus) tradeStatus.textContent = "Trade request declined.";
          renderAuctionState();
          syncRoomGameState("trade-declined");
        }
      }, 50);
    }
    function swapTradePlayers(){
      const idxA = parseInt(tradeTeamASelect.value, 10);
      const idxB = parseInt(tradeTeamBSelect.value, 10);
      const playerAIdx = parseInt(tradePlayerASelect.value, 10);
      const playerBIdx = parseInt(tradePlayerBSelect.value, 10);
      if(!canCurrentDeviceRequestTrade(idxA)) return;
      if(!players[idxA] || !players[idxB] || idxA === idxB){
        if(tradeStatus) tradeStatus.textContent = "Choose two different teams.";
        return;
      }
      const squadA = players[idxA].squad || [];
      const squadB = players[idxB].squad || [];
      if(!squadA[playerAIdx] || !squadB[playerBIdx]){
        if(tradeStatus) tradeStatus.textContent = "Choose one player from each team.";
        return;
      }
      const a = squadA[playerAIdx];
      const b = squadB[playerBIdx];
      const request = {
        id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromTeam: players[idxA].name,
        toTeam: players[idxB].name,
        fromPlayer: a.playerName || a.name,
        toPlayer: b.playerName || b.name,
        requestedAt: new Date().toISOString()
      };
      if(!currentRoomId){
        if(window.confirm(`${request.toTeam}, accept trade: ${request.fromPlayer} for ${request.toPlayer}?`)){
          applyTradeRequest(request);
        } else if(tradeStatus){
          tradeStatus.textContent = "Trade request declined.";
        }
        return;
      }
      if(!auctionState){
        if(tradeStatus) tradeStatus.textContent = "Initialize auction before sending trade requests.";
        return;
      }
      auctionState.pendingTrade = request;
      promptedTradeRequestId = "";
      if(tradeStatus) tradeStatus.textContent = `Trade request sent to ${request.toTeam}.`;
      renderAuctionState();
      syncRoomGameState("trade-request");
    }
    function updateBestSquadSummary(){ if(!players||players.length===0){ bestSquadEl.textContent=""; return; } let best=null, bestScore=-Infinity; players.forEach(p=>{ if(!p.squad||p.squad.length===0) return; const eff=getEffectiveSquad(p); const sc=getSquadStrength(eff); if(sc>bestScore){bestScore=sc;best=p.name;} }); if(!best) bestSquadEl.textContent="No squads rated yet."; else bestSquadEl.textContent=`Current best ${isAuctionMode() ? "auction squad" : "squad"} (based on XI if set): ${best} (${bestScore} pts)`; }

    function renderPlayers(){ playersList.innerHTML=""; players.forEach((p,idx)=>{ const card=document.createElement("div"); card.className="player-card"; card.dataset.playerIndex=idx; if(idx===currentPlayerIndex && !isAuctionMode()) card.classList.add("active"); const header=document.createElement("div"); header.className="player-card-header"; const name=document.createElement("div"); name.textContent=p.name; const count=document.createElement("div"); count.className="badge"; count.textContent=`${p.squad.length} / ${getActiveSquadLimit()}`; header.appendChild(name); header.appendChild(count); card.appendChild(header);
      const meta=document.createElement("div"); meta.className="player-card-meta"; if(p.ownerUid && currentRoomData && Array.isArray(currentRoomData.members)){ const member = currentRoomData.members.find(m=>m && m.uid === p.ownerUid); if(member){ const ownerBadge=document.createElement("div"); ownerBadge.className="owner-badge"; ownerBadge.textContent=`Device: ${member.name}`; meta.appendChild(ownerBadge); } } if(meta.childElementCount) card.appendChild(meta);
      const eff=getEffectiveSquad(p); const counts=getRoleCounts(eff), strength=getSquadStrength(eff), foreign=getForeignCount(eff), inForm=getInFormCount(eff);
      const roles=document.createElement("div"); roles.className="roles"; roles.textContent=`BAT ${counts.BAT} | BOWL ${counts.BOWL} | AR ${counts.AR} | WK ${counts.WK}`; card.appendChild(roles);
      const foreignEl=document.createElement("div"); foreignEl.className="foreign-count"; foreignEl.textContent=`Foreign (used): ${foreign} / ${MAX_FOREIGN}${isAuctionMode() ? " | Purse: " + formatAuctionPrice(p.purse || 12000) : ""}`; card.appendChild(foreignEl);
      const inFormEl=document.createElement("div"); inFormEl.className="in-form"; inFormEl.textContent=`In-form (used): ${inForm}`; card.appendChild(inFormEl);
      const strengthEl=document.createElement("div"); strengthEl.className="strength"; strengthEl.textContent=`Strength (used): ${strength} pts`; card.appendChild(strengthEl);
      const xiStatus=document.createElement("div"); xiStatus.className="roles"; xiStatus.textContent= (p.playing && p.playing.xi && p.playing.xi.length===11 && p.playing.impact) ? `Playing XI + Impact: SET${(p.playing.bowlingPlan && p.playing.bowlingPlan.length===20) ? " | Bowling Plan: SET" : ""}${(p.playing.superOver && p.playing.superOver.bowler && Array.isArray(p.playing.superOver.batters) && p.playing.superOver.batters.length===3) ? " | Super Over: SET" : ""}` : "Playing XI + Impact: not set"; card.appendChild(xiStatus);
      const ul=document.createElement("ul"); ul.className="squad-list"; p.squad.forEach((s,i)=>{ const li=document.createElement("li"); const left=document.createElement("span"); left.textContent=`${i+1}. ${formatPlayerName(s.playerName)} (${formatRole(s.role)})`; const teamSpan=document.createElement("span"); teamSpan.className="team"; teamSpan.textContent=s.team; li.appendChild(left); li.appendChild(teamSpan); ul.appendChild(li); }); card.appendChild(ul);
      if(p.squad.length>=getMinimumSquadSizeForPlay()){ const xiBtn=document.createElement("button"); xiBtn.type="button"; xiBtn.textContent="Set Playing XI + Impact"; xiBtn.className="set-xi-btn"; xiBtn.style.marginTop="4px"; card.appendChild(xiBtn); }
      playersList.appendChild(card); });
      updateBestSquadSummary();
      updateTurnOwnerBanner();
      renderLatestPickFeed();
      if(activeXIEditorState && Number.isFinite(activeXIEditorState.playerIndex)){
        const idx = activeXIEditorState.playerIndex;
        const team = players[idx];
        if(team && Array.isArray(team.squad) && team.squad.length >= getMinimumSquadSizeForPlay()){
          openPlayingXIEditor(idx);
        } else {
          activeXIEditorState = null;
          flushPendingRoomGameState();
        }
      }
    }

    function updateActivePlayerHighlight(){ document.querySelectorAll(".player-card").forEach(c=>c.classList.remove("active")); const card=document.querySelector(`.player-card[data-player-index='${currentPlayerIndex}']`); if(card) card.classList.add("active"); }
    function getMaxPlayersPerTeam(){
      return Math.max(1, Math.min(SQUAD_SIZE, Number(maxPlayersPerTeam) || MAX_PER_TEAM));
    }
    function updateGameStatus(msg){ if(!gameStarted){ gameStatus.textContent="Go to Setup tab and start."; updateTurnOwnerBanner(); return; } const base = isAuctionMode() ? `Auction mode. Squads: 15-18 players, max ${MAX_FOREIGN} foreign, live bidding room enabled.` : `Current turn: ${players[currentPlayerIndex].name}. Rules: ${SQUAD_SIZE} players, max ${getMaxPlayersPerTeam()} per IPL team, max ${MAX_FOREIGN} foreign.`; gameStatus.textContent = msg ? base + " " + msg : base; updateTurnOwnerBanner(); }

    function getRandomInt(maxExclusive){
      if(maxExclusive<=1) return 0;
      if(window.crypto && window.crypto.getRandomValues){
        const arr = new Uint32Array(1);
        const maxUint = 0xFFFFFFFF;
        const limit = maxUint - ((maxUint + 1) % maxExclusive);
        let val = 0;
        do{
          window.crypto.getRandomValues(arr);
          val = arr[0];
        } while(val > limit);
        return val % maxExclusive;
      }
      if(fallbackRngState === 0){
        const perf = (window.performance && window.performance.now) ? window.performance.now() : 0;
        fallbackRngState = ((Date.now() ^ Math.floor(perf * 1000) ^ 0x9E3779B9) >>> 0) || 0xA341316C;
      }
      // xorshift32 fallback to avoid repeated startup patterns.
      fallbackRngState ^= (fallbackRngState << 13) >>> 0;
      fallbackRngState ^= (fallbackRngState >>> 17) >>> 0;
      fallbackRngState ^= (fallbackRngState << 5) >>> 0;
      return (fallbackRngState >>> 0) % maxExclusive;
    }

    function pickWheelIndex(){
      const total = WHEEL_SEGMENTS.length;
      if(total<=1) return 0;
      let idx = getRandomInt(total);
      if(idx===lastWheelIndex){
        idx = (idx + 1 + getRandomInt(total - 1)) % total;
      }
      lastWheelIndex = idx;
      return idx;
    }

    function getEligiblePlayersForSelection(team, currentPlayer){
      const global = getGlobalPickedNameSet();
      const foreignCount = getForeignCount(currentPlayer.squad);
      const teamCounts = {};
      currentPlayer.squad.forEach(s=>{ teamCounts[s.team] = (teamCounts[s.team] || 0) + 1; });

      if(team === ANY_TEAM_OPTION){
        const all = [];
        IPL_TEAMS.forEach(t=>{
          if((teamCounts[t] || 0) >= getMaxPlayersPerTeam()) return;
          (IPL_PLAYERS[t] || []).forEach(p=>{
            if(global.has(p.name)) return;
            if(foreignCount >= MAX_FOREIGN && FOREIGN_PLAYERS.has(p.name)) return;
            all.push({name:p.name, role:p.role, team:t});
          });
        });
        return all;
      }

      let list = (IPL_PLAYERS[team] || []).filter(p=>!global.has(p.name)).map(p=>({name:p.name, role:p.role, team}));
      if(foreignCount >= MAX_FOREIGN) list = list.filter(p=>!FOREIGN_PLAYERS.has(p.name));
      return list;
    }

    function populatePlayerSelect(team, currentPlayer, filterText=""){
      playerSelect.innerHTML="";
      const ph=document.createElement("option");
      ph.value="";
      ph.textContent="-- Choose player --";
      playerSelect.appendChild(ph);

      const list = getEligiblePlayersForSelection(team, currentPlayer);
      const f = (filterText || "").trim().toLowerCase();
      const filtered = list.filter(p=>{
        if(!f) return true;
        return p.name.toLowerCase().includes(f) || p.role.toLowerCase().includes(f) || p.team.toLowerCase().includes(f);
      });

      filtered.forEach(p=>{
        const o=document.createElement("option");
        o.value=JSON.stringify({team:p.team,name:p.name});
        o.textContent = team === ANY_TEAM_OPTION ? `${formatPlayerName(p.name)} (${formatRole(p.role)}) - ${p.team}` : `${formatPlayerName(p.name)} (${formatRole(p.role)})`;
        playerSelect.appendChild(o);
      });

      if(playerSelect.options.length===1){
        const no=document.createElement("option");
        no.value="";
        no.textContent="No eligible players (spin again)";
        playerSelect.appendChild(no);
      }
    }

    // ---------- Setup / Draft behavior ----------
    if(syncStatsBtn){
      syncStatsBtn.addEventListener("click", async ()=>{
        try{
          setStatsDebugOutput("");
          await syncAllPlayerStatsFromApi();
        }catch(err){
          if(syncStatsBtn) syncStatsBtn.disabled = false;
          updateStatsImportStatus(`API sync failed: ${err.message}`, "error");
        }
      });
    }
    if(testStatsApiBtn){
      testStatsApiBtn.addEventListener("click", async ()=>{
        try{
          const cache = await loadCachedStatsFromServer();
          importedPlayerStats = cache;
          saveStoredPlayerStats(importedPlayerStats);
          resetImportedProfileCache();
          renderImportedStatsSummary();
          renderPlayers();
          updateBestSquadSummary();
          markStatsSyncUpdated("stats-load-cached");
          setStatsDebugOutput(JSON.stringify(Object.keys(cache).slice(0, 12), null, 2));
          updateStatsImportStatus(`Loaded ${Object.keys(cache).length} cached player profiles from the local server.`, "success");
        }catch(err){
          setStatsDebugOutput(`Could not load server cache: ${err.message}`);
          updateStatsImportStatus(`Could not load server cache: ${err.message}. Start the app with "node server.js".`, "error");
        }
      });
    }
    if(clearStatsBtn){
      clearStatsBtn.addEventListener("click", async ()=>{
        importedPlayerStats = {};
        importedPlayerStatsMeta = {};
        resetImportedProfileCache();
        saveStoredPlayerStats(importedPlayerStats);
        saveStoredStatsMeta(importedPlayerStatsMeta);
        setStatsDebugOutput("");
        try{
          await fetch("/api/reset-official-stats", { method: "POST" });
        }catch(err){
          // Ignore local reset errors and still clear browser cache.
        }
        renderImportedStatsSummary();
        renderPlayers();
        updateBestSquadSummary();
      });
    }
    watchGuestAuth((user)=>{
      if(user) setFirebaseStatus(`Online guest ready: ${user.uid.slice(0, 8)}`, "success");
      else setFirebaseStatus("Connecting online guest session...", "");
    });
    ensureGuestSession().catch((err)=>{
      setFirebaseStatus(`Firebase sign-in failed: ${err.message}`, "error");
    });
    if(createRoomBtn){
      createRoomBtn.addEventListener("click", async ()=>{
        try{
          createRoomBtn.disabled = true;
          const roomId = await createRoom({
            hostName: onlinePlayerNameInput && onlinePlayerNameInput.value,
            settings: collectSetupSettings()
          });
          subscribeToCurrentRoom(roomId);
          touchRoomPresence();
          startPresenceLoop();
          setFirebaseStatus(`Room ${roomId} created. Share this code with other players.`, "success");
        }catch(err){
          setFirebaseStatus(`Could not create room: ${err.message}`, "error");
        }finally{
          createRoomBtn.disabled = false;
        }
      });
    }
    if(joinRoomBtn){
      joinRoomBtn.addEventListener("click", async ()=>{
        try{
          joinRoomBtn.disabled = true;
          const roomId = await joinRoom(roomCodeInput && roomCodeInput.value, onlinePlayerNameInput && onlinePlayerNameInput.value);
          subscribeToCurrentRoom(roomId);
          touchRoomPresence();
          startPresenceLoop();
          setFirebaseStatus(`Joined room ${roomId}.`, "success");
        }catch(err){
          setFirebaseStatus(`Could not join room: ${err.message}`, "error");
        }finally{
          joinRoomBtn.disabled = false;
        }
      });
    }
    if(onlinePlayerNameInput){
      onlinePlayerNameInput.addEventListener("input", ()=>{
        if(currentRoomId && !applyingRemoteRoomState){
          touchRoomPresence();
          spinButton.disabled = !gameStarted || !canCurrentDeviceControlTurn();
          updateGameStatus();
          renderOnlineRoomState();
          renderAuctionState();
        }
      });
    }
    if(gameModeSelect){
      gameModeSelect.addEventListener("change", ()=>{
        applyModeUI();
      });
    }
    if(auctionSetSelect){
      auctionSetSelect.addEventListener("change", ()=>{
        if(auctionState && auctionState.status === "running"){
          auctionSetSelect.value = auctionState.selectedSet || "All Sets";
          return;
        }
        if(auctionStatusLine){
          auctionStatusLine.textContent = `Selected set: ${getSelectedAuctionSet()}. Initialize auction to load those players in random order.`;
        }
      });
    }
    if(auctionSetOrderSelect){
      auctionSetOrderSelect.addEventListener("change", ()=>{
        if(auctionState && auctionState.status === "running") return;
        if(auctionStatusLine) auctionStatusLine.textContent = "Set order updated. Use Load Next Set or Initialize Auction.";
      });
    }
    function loadAuctionSet(selectedSet, preserveAuction = true){
      if(!players || players.length < 2){
        if(auctionStatusLine) auctionStatusLine.textContent = "Create at least 2 teams first.";
        return;
      }
      if(!canCurrentDeviceControlAuctionAdmin()) return;
      currentGameMode = "auction";
      if(gameModeSelect) gameModeSelect.value = "auction";
      const previousAuctionState = preserveAuction ? auctionState : null;
      if(!previousAuctionState){
        players.forEach(team=>{
          team.squad = [];
          team.playing = null;
          team.purse = 12000;
          team.totalSpent = 0;
        });
        latestPicks = [];
      }
      auctionState = createInitialAuctionState(selectedSet, previousAuctionState);
      moveToNextAuctionLot(false);
      renderPlayers();
      populateSimSelects();
      applyModeUI();
      renderAuctionState();
      syncRoomGameState("auction-init");
    }
    function loadNextManualAuctionSet(){
      const order = getManualAuctionSetOrder();
      const current = auctionState && auctionState.selectedSet ? auctionState.selectedSet : null;
      const currentIdx = current ? order.indexOf(current) : -1;
      const nextSet = order[(currentIdx + 1 + order.length) % order.length];
      if(auctionSetSelect) auctionSetSelect.value = nextSet;
      loadAuctionSet(nextSet, true);
    }
    if(auctionInitBtn){
      auctionInitBtn.addEventListener("click", ()=>{
        loadAuctionSet(getSelectedAuctionSet(), !!auctionState);
      });
    }
    if(auctionNextSetBtn){
      auctionNextSetBtn.addEventListener("click", ()=>loadNextManualAuctionSet());
    }
    if(auctionStartBtn){
      auctionStartBtn.addEventListener("click", ()=>{
        if(!auctionState || !auctionState.currentLot || !canCurrentDeviceControlAuctionAdmin()) return;
        auctionState.status = "running";
        auctionState.endAt = Date.now() + ((auctionState.timerSeconds || 55) * 1000);
        renderAuctionState();
        syncRoomGameState("auction-start");
      });
    }
    if(auctionPauseBtn){
      auctionPauseBtn.addEventListener("click", ()=>{
        if(!auctionState || !canCurrentDeviceControlAuctionAdmin()) return;
        auctionState.status = "paused";
        auctionState.endAt = 0;
        renderAuctionState();
        syncRoomGameState("auction-pause");
      });
    }
    if(auctionEndBtn){
      auctionEndBtn.addEventListener("click", ()=>{
        if(!auctionState || !canCurrentDeviceControlAuctionAdmin()) return;
        if(auctionSaleTimeout){
          window.clearTimeout(auctionSaleTimeout);
          auctionSaleTimeout = null;
        }
        auctionState.status = "ended";
        auctionState.currentLot = null;
        auctionState.endAt = 0;
        auctionState.saleMessage = "Auction ended. Squads are ready for XI selection, trades, and matches.";
        renderAuctionState();
        syncRoomGameState("auction-end");
      });
    }
    if(auctionNextBtn){
      auctionNextBtn.addEventListener("click", ()=>{
        if(!auctionState || !canCurrentDeviceControlAuctionAdmin()) return;
        if(auctionState.currentLot){
          finalizeAuctionLot("manual");
        } else {
          moveToNextAuctionLot(false);
        }
      });
    }
    if(auctionBidBtn){
      auctionBidBtn.addEventListener("click", ()=> placeAuctionBid());
    }
    if(auctionRebidBtn){
      auctionRebidBtn.addEventListener("click", ()=>startUnsoldRebid());
    }
    if(auctionBidAsSelect){
      auctionBidAsSelect.addEventListener("change", ()=>renderAuctionState());
    }
    if(auctionBid10Btn) auctionBid10Btn.addEventListener("click", ()=>placeAuctionBid(10));
    if(auctionBid25Btn) auctionBid25Btn.addEventListener("click", ()=>placeAuctionBid(25));
    if(auctionBid50Btn) auctionBid50Btn.addEventListener("click", ()=>placeAuctionBid(50));
    if(auctionBid100Btn) auctionBid100Btn.addEventListener("click", ()=>placeAuctionBid(100));
    if(hostTransferBtn){
      hostTransferBtn.addEventListener("click", async ()=>{
        try{
          if(!currentRoomId || !hostTransferSelect || !hostTransferSelect.value) return;
          await transferRoomHost(currentRoomId, hostTransferSelect.value);
          setFirebaseStatus("Host transferred.", "success");
        }catch(err){
          setFirebaseStatus(`Host transfer failed: ${err.message}`, "error");
        }
      });
    }
    async function sendAuctionChat(text){
      try{
        if(!currentRoomId){
          if(auctionChatList) auctionChatList.innerHTML = '<div class="empty-state">Join a room to chat.</div>';
          return;
        }
        await sendRoomChatMessage(currentRoomId, text);
        if(auctionChatInput) auctionChatInput.value = "";
      }catch(err){
        setFirebaseStatus(`Chat failed: ${err.message}`, "error");
      }
    }
    if(auctionChatSendBtn){
      auctionChatSendBtn.addEventListener("click", ()=>sendAuctionChat(auctionChatInput && auctionChatInput.value));
    }
    if(auctionChatInput){
      auctionChatInput.addEventListener("keydown", event=>{
        if(event.key === "Enter"){
          event.preventDefault();
          sendAuctionChat(auctionChatInput.value);
        }
      });
    }
    document.querySelectorAll(".auction-reaction-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>sendAuctionChat(btn.dataset.message || btn.textContent));
    });
    [tradeTeamASelect, tradeTeamBSelect].forEach(sel=>{
      if(sel) sel.addEventListener("change", ()=>renderTradeWindow());
    });
    if(tradeSwapBtn) tradeSwapBtn.addEventListener("click", ()=>swapTradePlayers());

    setupForm.addEventListener("submit", e=>{
      e.preventDefault();
      let n = parseInt(numPlayersInput.value,10);
      if(isNaN(n)||n<2){ alert("Enter at least 2 players."); return; }
      currentGameMode = gameModeSelect ? gameModeSelect.value : "spin";
      const parsedMaxPerTeam = parseInt(maxPerTeamInput && maxPerTeamInput.value, 10);
      if(!isAuctionMode() && (Number.isNaN(parsedMaxPerTeam) || parsedMaxPerTeam < 1 || parsedMaxPerTeam > SQUAD_SIZE)){
        alert(`Max players from one team must be between 1 and ${SQUAD_SIZE}.`);
        return;
      }
      maxPlayersPerTeam = isAuctionMode() ? MAX_PER_TEAM : parsedMaxPerTeam;
      const namesText = playerNamesTextarea.value.trim();
      let names=[];
      if(currentRoomId && currentRoomData){
        const roomMembers = getOrderedRoomMembers().filter(member => member && member.uid && member.name);
        if(roomMembers.length >= 2){
          n = roomMembers.length;
          numPlayersInput.value = String(n);
          names = roomMembers.map(member=>member.name);
          playerNamesTextarea.value = names.join(", ");
        }
      }
      if(names.length===0 && namesText) names = namesText.split(",").map(s=>s.trim()).filter(Boolean);
      if(names.length===0){
        for(let i=0;i<n;i++) names.push("Player "+(i+1));
      } else if(names.length!==n){
        alert("Number of names doesn't match.");
        return;
      }
      players = names.map((name, index)=>{
        const roomMember = currentRoomId && currentRoomData ? getOrderedRoomMembers()[index] : null;
        return {
          name,
          squad:[],
          playing:null,
          ownerUid: roomMember && roomMember.uid ? roomMember.uid : null,
          purse: 12000,
          totalSpent: 0
        };
      });
      dynamicPlayerState = {};
      seasonStats = createEmptySeasonStats();
      rivalryStats = {};
      latestPicks = [];
      auctionState = null;
      fallbackRngState = 0;
      currentPlayerIndex=0;
      gameStarted=true;
      isSpinning=false;
      currentRotation=0;
      selectedTeamName=null;
      lastSpin = { playerIndex: null, team: null };
      lastWheelIndex=-1;
      // Stir fallback RNG state differently for each new run.
      for(let i=0, n=3 + getRandomInt(7); i<n; i++){ getRandomInt(WHEEL_SEGMENTS.length); }
      wheelEl.style.transform="rotate(0deg)";
      pickForm.style.display="none";
      pickMessage.textContent="";
      downloadBtn.disabled=false;
      simulateBtn.disabled=!canCurrentDeviceControlMatches();
      tournamentBtn.disabled=!canCurrentDeviceControlMatches();
      playNextMatchBtn.disabled = true;
      spinButton.disabled = isAuctionMode() ? true : !canCurrentDeviceControlTurn();
      renderPlayers();
      renderGlobalSummary();
      updateBestSquadSummary();
      populateSimSelects();
      renderAuctionState();
      updateGameStatus();
      updateActivePlayerHighlight();
      spinInfo.textContent = isAuctionMode() ? "Auction mode active. Use the Auction tab to build squads." : players[currentPlayerIndex].name + ", tap Spin on the wheel to start!";
      simResult.innerHTML="";
      tournamentResult.textContent="";
      statsDashboard.innerHTML = "";
      rivalryBoard.innerHTML = "";
      tossResultLine.textContent = "";
      if(currentRoomId && currentRoomData && currentRoomData.hostUid === (getCurrentGuestUser() && getCurrentGuestUser().uid)){
        updateRoomSettings(currentRoomId, collectSetupSettings()).catch(()=>{});
      }
      applyModeUI();
      syncRoomGameState("setup");
    });

    spinButton.addEventListener("click", ()=>{ if(isAuctionMode() || !gameStarted||isSpinning||spinButton.disabled) return; if(!canCurrentDeviceControlTurn()){ updateGameStatus("This is not your turn on this device."); return; } const cur = players[currentPlayerIndex]; if(cur.squad.length>=getActiveSquadLimit()){ updateGameStatus("This player already has a full squad. Next player will be auto-selected."); advanceToNextPlayer(); syncRoomGameState("advance-turn"); return; } isSpinning=true; spinButton.disabled=true; pickForm.style.display="none"; pickMessage.textContent=""; spinInfo.textContent="Spinning..."; const seg = 360/WHEEL_SEGMENTS.length; const idx = pickWheelIndex(); const extra = 360*6; const target = 360 - (idx*seg + seg/2); const currentAngle = ((currentRotation % 360) + 360) % 360; const deltaToTarget = (target - currentAngle + 360) % 360; currentRotation += extra + deltaToTarget; wheelEl.style.transform = `rotate(${currentRotation}deg)`; selectedTeamName = WHEEL_SEGMENTS[idx]; syncRoomGameState("spin-start"); });

    wheelEl.addEventListener("transitionend", ()=>{
      if(!isSpinning) return;
      isSpinning=false;
      spinButton.disabled=false;
      if(!selectedTeamName) return;
      const cur = players[currentPlayerIndex];

      if(selectedTeamName !== ANY_TEAM_OPTION){
        const sameTeamCount = cur.squad.filter(s=>s.team===selectedTeamName).length;
        if(sameTeamCount>=getMaxPlayersPerTeam()){
          pickForm.style.display="none";
          spinInfo.textContent = `${cur.name}, you got ${selectedTeamName} but already have ${getMaxPlayersPerTeam()} from this team. Spin again!`;
          lastSpin = { playerIndex: null, team: null };
          syncRoomGameState("spin-invalid-team-cap");
          return;
        }
      }

      const candidates = getEligiblePlayersForSelection(selectedTeamName, cur);
      if(candidates.length===0){
        pickForm.style.display="none";
        spinInfo.textContent = `${cur.name}, you got ${selectedTeamName} but no eligible players remain. Spin again!`;
        lastSpin = { playerIndex: null, team: null };
        syncRoomGameState("spin-no-candidates");
        return;
      }
      lastSpin.playerIndex = currentPlayerIndex;
      lastSpin.team = selectedTeamName;
      spinInfo.innerHTML = "<strong>Team:</strong> <span class='highlight'>"+selectedTeamName+"</span>. Choose player.";
      pickedTeamLabel.textContent=selectedTeamName;
      populatePlayerSelect(selectedTeamName,cur);
      pickSearch.value="";
      pickForm.style.display="block";
      syncRoomGameState("spin-complete");
    });

    pickSearch.addEventListener("input", ()=> { const cur = players[currentPlayerIndex]; if(!selectedTeamName || !cur) return; populatePlayerSelect(selectedTeamName, cur, pickSearch.value); });

    // team remaining modal
    const teamModal = document.getElementById("teamModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalList = document.getElementById("modalList");
    const modalSearch = document.getElementById("modalSearch");
    const modalCount = document.getElementById("modalCount");
    const modalWarn = document.getElementById("modalWarn");
    document.getElementById("closeModal").addEventListener("click", ()=> teamModal.style.display="none");

    showTeamRemain.addEventListener("click", ()=>{ if(!selectedTeamName){ spinInfo.textContent = "You must spin to pick a team first."; return; } if(selectedTeamName === ANY_TEAM_OPTION){ spinInfo.textContent = "For ANY TEAM, pick directly from the dropdown list."; return; } if(lastSpin.playerIndex !== currentPlayerIndex || lastSpin.team !== selectedTeamName){ modalWarn.style.display = "block"; modalWarn.textContent = "Modal picks allowed ONLY immediately after a valid spin for this player & team. Spin first, then open modal."; openTeamModal(selectedTeamName, false); return; } modalWarn.style.display = "none"; openTeamModal(selectedTeamName, true); });

    function openTeamModal(team, allowPick){
      modalTitle.textContent = team + " - remaining players";
      modalList.innerHTML = "";
      const cur = players[currentPlayerIndex];
      if(!cur) return;
      const global = getGlobalPickedNameSet();
      let list = (IPL_PLAYERS[team]||[]).filter(p=>!global.has(p.name));
      if(getForeignCount(cur.squad)>=MAX_FOREIGN) list = list.filter(p=>!FOREIGN_PLAYERS.has(p.name));
      modalCount.textContent = list.length + " available";
      list.forEach(p=>{
        const row=document.createElement("div");
        row.style.display="flex"; row.style.justifyContent="space-between"; row.style.padding="6px"; row.style.borderBottom="1px solid rgba(255,255,255,.03)";
        const left=document.createElement("div"); left.innerHTML = `<strong>${formatPlayerName(p.name)}</strong><div class="small-text">${formatRole(p.role)}</div>`;
        const btn=document.createElement("button"); btn.textContent="Pick & Close"; btn.style.marginLeft="8px";
        if(!allowPick) btn.disabled = true;
        btn.addEventListener("click", ()=>{
          if(!allowPick){ return; }
          if(!canCurrentDeviceControlTurn()){ alert("This is not your turn on this device."); return; }
          const sameTeamCount = cur.squad.filter(s=>s.team===team).length;
          if(sameTeamCount >= getMaxPlayersPerTeam()){ alert(`You already have ${getMaxPlayersPerTeam()} players from ${team}. Cannot pick.`); return; }
          const globalNow = getGlobalPickedNameSet();
          if(globalNow.has(p.name)){ alert(`${p.name} was just picked by someone else.`); return; }
          if(FOREIGN_PLAYERS.has(p.name) && getForeignCount(cur.squad) >= MAX_FOREIGN){ alert(`Foreign limit (${MAX_FOREIGN}) reached.`); return; }
          cur.squad.push({ playerName: p.name, team: team, role: p.role });
          addLatestPick(cur.name, p.name, team);
          Array.from(modalList.querySelectorAll("button")).forEach(b => b.disabled = true);
          renderPlayers(); renderGlobalSummary(); populateSimSelects();
          lastSpin.playerIndex = null; lastSpin.team = null;
          syncRoomGameState("modal-pick");
          setTimeout(()=> { teamModal.style.display = "none"; }, 220);
          const allComplete = players.every(pl=>pl.squad.length>=getActiveSquadLimit());
          if(allComplete){ spinButton.disabled=true; spinInfo.textContent="All squads completed!"; updateGameStatus("All players have full squads."); return; }
          setTimeout(()=> advanceToNextPlayer(), 260);
        });
        row.appendChild(left); row.appendChild(btn); modalList.appendChild(row);
      });
      modalSearch.value="";
      modalSearch.oninput = function(){ const q=modalSearch.value.trim().toLowerCase(); Array.from(modalList.children).forEach(r=>{ r.style.display = q ? (r.innerText.toLowerCase().includes(q) ? "" : "none") : ""; }); };
      teamModal.style.display = "flex";
    }

    // pick from normal form
    pickForm.addEventListener("submit", e=>{ e.preventDefault(); pickMessage.textContent=""; if(isAuctionMode()){ pickMessage.textContent="Auction mode is active. Use the Auction tab."; pickMessage.className="error"; return; } if(!canCurrentDeviceControlTurn()){ pickMessage.textContent="This is not your turn on this device."; pickMessage.className="error"; return; } const selected = playerSelect.value; if(!selected){ pickMessage.textContent="Please select a player."; pickMessage.className="error"; return; } const cur = players[currentPlayerIndex]; if(cur.squad.length>=getActiveSquadLimit()){ pickMessage.textContent="Squad full."; pickMessage.className="error"; advanceToNextPlayer(); syncRoomGameState("advance-turn"); return; }
      let chosenTeam = selectedTeamName;
      let chosenPlayerName = selected;
      try {
        const parsed = JSON.parse(selected);
        if(parsed && parsed.team && parsed.name){ chosenTeam = parsed.team; chosenPlayerName = parsed.name; }
      } catch(err){ /* keep fallback values */ }
      const sameTeamCount = cur.squad.filter(s=>s.team===chosenTeam).length;
      if(sameTeamCount>=getMaxPlayersPerTeam()){ pickMessage.textContent=`Already ${getMaxPlayersPerTeam()} from ${chosenTeam}`; pickMessage.className="error"; pickForm.style.display="none"; return; } const global = getGlobalPickedNameSet(); if(global.has(chosenPlayerName)){ pickMessage.textContent=`${chosenPlayerName} already picked`; pickMessage.className="error"; populatePlayerSelect(selectedTeamName,cur); return; } const teamArr = IPL_PLAYERS[chosenTeam]||[]; const pObj = teamArr.find(x=>x.name===chosenPlayerName) || {name:chosenPlayerName,role:"BAT"}; if(FOREIGN_PLAYERS.has(pObj.name) && getForeignCount(cur.squad)>=MAX_FOREIGN){ pickMessage.textContent=`Foreign limit reached`; pickMessage.className="error"; populatePlayerSelect(selectedTeamName,cur); return; }
      cur.squad.push({playerName:pObj.name,team:chosenTeam,role:pObj.role});
      addLatestPick(cur.name, pObj.name, chosenTeam);
      renderPlayers(); renderGlobalSummary(); populateSimSelects(); pickMessage.textContent=`${formatPlayerName(pObj.name)} added to ${cur.name}`; pickMessage.className="success"; pickForm.style.display="none";
      lastSpin.playerIndex = null; lastSpin.team = null;
      syncRoomGameState("draft-pick");
      const allComplete = players.every(pl=>pl.squad.length>=getActiveSquadLimit());
      if(allComplete){ spinButton.disabled=true; spinInfo.textContent="All squads completed! Draft finished ✅"; updateGameStatus("All players have full squads."); return; }
      advanceToNextPlayer();
    });

    function advanceToNextPlayer(){ let attempts=0; const total=players.length; do{ currentPlayerIndex=(currentPlayerIndex+1)%total; attempts++; if(attempts>total) break; } while(players[currentPlayerIndex].squad.length>=getActiveSquadLimit()); updateActivePlayerHighlight(); const cur=players[currentPlayerIndex]; if(cur.squad.length>=getActiveSquadLimit()){ spinButton.disabled=true; spinInfo.textContent="All squads completed!"; updateGameStatus("All players have full squads."); } else { spinInfo.textContent = isAuctionMode() ? "Auction mode active. Use the Auction tab." : `${cur.name}, it's your turn. Tap Spin.`; updateGameStatus(); spinButton.disabled = isAuctionMode() ? true : !canCurrentDeviceControlTurn(); } syncRoomGameState("next-player"); }

    // Playing XI editor (with dropdown disabling to prevent duplicates)
    function openPlayingXIEditor(playerIndex){
      if(activeXIEditorState && Number.isFinite(activeXIEditorState.playerIndex)){
        const existing = document.querySelector(`.player-card[data-player-index='${activeXIEditorState.playerIndex}'] .xi-editor`);
        if(existing){
          activeXIEditorState.draft = {
            xi: Array.from(existing.querySelectorAll("select[name^='xi-pos-']")).map(sel=>sel.value || ""),
            impact: (existing.querySelector("select[name='impact']") || {}).value || "",
            superOverBatters: Array.from(existing.querySelectorAll("select[name^='super-over-bat-']")).map(sel=>sel.value || ""),
            superOverBowler: (existing.querySelector("select[name='super-over-bowler']") || {}).value || "",
            bowlingPlan: Array.from(existing.querySelectorAll("select[name^='bowl-ov-']")).map(sel=>sel.value || "")
          };
        }
      }
      document.querySelectorAll(".xi-editor").forEach(x=>x.remove());
      const cards = document.querySelectorAll(".player-card");
      const card = cards[playerIndex]; if(!card) return;
      const p = players[playerIndex];
      const savedDraft = activeXIEditorState && activeXIEditorState.playerIndex === playerIndex && activeXIEditorState.draft
        ? activeXIEditorState.draft
        : null;
      const editor=document.createElement("div"); editor.className="xi-editor";
      const title=document.createElement("div"); title.className="xi-editor-title"; title.textContent="Set batting order (Pos1 opener down to bowler). Choose 11 unique players then 1 different impact.";
      editor.appendChild(title);

      // create selects array
      const selects = [];
      for(let i=0;i<11;i++){
        const row=document.createElement("div"); row.className="xi-row";
        const lbl=document.createElement("span"); lbl.textContent="Pos "+(i+1);
        row.appendChild(lbl);
        const sel=document.createElement("select"); sel.name="xi-pos-"+i;
        const ph=document.createElement("option"); ph.value=""; ph.textContent="-- Select --"; sel.appendChild(ph);
        p.squad.forEach(entry=>{ const o=document.createElement("option"); o.value=entry.playerName; o.textContent=`${formatPlayerName(entry.playerName)} (${formatRole(entry.role)})`; sel.appendChild(o); });
        if(savedDraft && Array.isArray(savedDraft.xi) && typeof savedDraft.xi[i] === "string") sel.value = savedDraft.xi[i];
        else if(p.playing && p.playing.xi && p.playing.xi[i]) sel.value = p.playing.xi[i];
        selects.push(sel);
        row.appendChild(sel);
        editor.appendChild(row);
      }

      const controls=document.createElement("div"); controls.className="xi-controls";
      const impactLabel=document.createElement("div"); impactLabel.className="small-text"; impactLabel.textContent="Impact Sub (must be different)";
      const impactSelect=document.createElement("select"); impactSelect.name="impact";
      const iph=document.createElement("option"); iph.value=""; iph.textContent="-- Select impact --"; impactSelect.appendChild(iph);
      p.squad.forEach(entry=>{ const o=document.createElement("option"); o.value=entry.playerName; o.textContent=formatPlayerName(entry.playerName); impactSelect.appendChild(o); });
      if(savedDraft && typeof savedDraft.impact === "string") impactSelect.value = savedDraft.impact;
      else if(p.playing && p.playing.impact) impactSelect.value = p.playing.impact;
      const savedSuperOver = p.playing && p.playing.superOver ? p.playing.superOver : null;
      const superOverBox = document.createElement("div");
      superOverBox.className = "super-over-box";
      const superOverTitle = document.createElement("div");
      superOverTitle.className = "small-text";
      superOverTitle.textContent = "Super Over setup: choose 3 batters in order and 1 bowler. This is used automatically if the match ties.";
      superOverBox.appendChild(superOverTitle);
      const superOverGrid = document.createElement("div");
      superOverGrid.className = "super-over-grid";
      const superOverBattingSelects = [];
      for(let i=0; i<3; i++){
        const label = document.createElement("label");
        label.textContent = `SO Batter ${i + 1}`;
        const sel = document.createElement("select");
        sel.name = `super-over-bat-${i}`;
        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "-- Select batter --";
        sel.appendChild(ph);
        p.squad.forEach(entry=>{
          const o = document.createElement("option");
          o.value = entry.playerName;
          o.textContent = formatPlayerName(entry.playerName);
          sel.appendChild(o);
        });
        if(savedDraft && Array.isArray(savedDraft.superOverBatters) && typeof savedDraft.superOverBatters[i] === "string"){
          sel.value = savedDraft.superOverBatters[i];
        } else if(savedSuperOver && Array.isArray(savedSuperOver.batters) && savedSuperOver.batters[i]){
          sel.value = savedSuperOver.batters[i];
        }
        superOverBattingSelects.push(sel);
        label.appendChild(sel);
        superOverGrid.appendChild(label);
      }
      const superOverBowlerLabel = document.createElement("label");
      superOverBowlerLabel.textContent = "SO Bowler";
      const superOverBowlerSelect = document.createElement("select");
      superOverBowlerSelect.name = "super-over-bowler";
      const superOverBowlerPh = document.createElement("option");
      superOverBowlerPh.value = "";
      superOverBowlerPh.textContent = "-- Select bowler --";
      superOverBowlerSelect.appendChild(superOverBowlerPh);
      p.squad.filter(entry=>isBowlingRole(entry.role)).forEach(entry=>{
        const o = document.createElement("option");
        o.value = entry.playerName;
        o.textContent = `${formatPlayerName(entry.playerName)} (${formatRole(entry.role)})`;
        superOverBowlerSelect.appendChild(o);
      });
      if(savedDraft && typeof savedDraft.superOverBowler === "string"){
        superOverBowlerSelect.value = savedDraft.superOverBowler;
      } else if(savedSuperOver && savedSuperOver.bowler){
        superOverBowlerSelect.value = savedSuperOver.bowler;
      }
      superOverBowlerLabel.appendChild(superOverBowlerSelect);
      superOverGrid.appendChild(superOverBowlerLabel);
      superOverBox.appendChild(superOverGrid);
      const bowlPlanTitle=document.createElement("div"); bowlPlanTitle.className="small-text"; bowlPlanTitle.textContent="Bowling Plan (optional): choose bowler for each over (max 4 overs per bowler, blank = auto)";
      const bowlCandidates = p.squad.filter(x=>isBowlingRole(x.role));
      const bowlPlanWrap = document.createElement("div");
      bowlPlanWrap.style.display = "grid";
      bowlPlanWrap.style.gridTemplateColumns = "repeat(2, minmax(160px, 1fr))";
      bowlPlanWrap.style.gap = "6px";
      const bowlingSelects = [];
      for(let ov=1; ov<=20; ov++){
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.alignItems = "center";
        const lbl = document.createElement("span");
        lbl.style.width = "56px";
        lbl.textContent = `Ov ${ov}`;
        const sel = document.createElement("select");
        sel.name = `bowl-ov-${ov}`;
        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "-- auto --";
        sel.appendChild(ph);
        bowlCandidates.forEach(c=>{
          const o = document.createElement("option");
          o.value = c.playerName;
          o.textContent = `${formatPlayerName(c.playerName)} (${formatRole(c.role)})`;
          sel.appendChild(o);
        });
        if(savedDraft && Array.isArray(savedDraft.bowlingPlan) && typeof savedDraft.bowlingPlan[ov - 1] === "string"){
          sel.value = savedDraft.bowlingPlan[ov - 1];
        } else if(p.playing && Array.isArray(p.playing.bowlingPlan) && p.playing.bowlingPlan[ov - 1]){
          sel.value = p.playing.bowlingPlan[ov - 1];
        }
        bowlingSelects.push(sel);
        row.appendChild(lbl);
        row.appendChild(sel);
        bowlPlanWrap.appendChild(row);
      }

      const saveBtn=document.createElement("button"); saveBtn.type="button"; saveBtn.textContent="Save Playing XI"; saveBtn.className="xi-save-btn"; saveBtn.dataset.playerIndex=playerIndex;
      const msg=document.createElement("div"); msg.className="xi-error"; msg.style.display="none";

      controls.appendChild(impactLabel); controls.appendChild(impactSelect);
      controls.appendChild(superOverBox);
      controls.appendChild(bowlPlanTitle); controls.appendChild(bowlPlanWrap);
      controls.appendChild(saveBtn); controls.appendChild(msg);
      editor.appendChild(controls);
      card.appendChild(editor);
      activeXIEditorState = { playerIndex, draft: null };

      // helper to disable already chosen names in other selects (and impact)
      function refreshOptions(){
        const chosen = new Set(selects.map(s=>s.value).filter(Boolean));
        selects.forEach(s=>{
          Array.from(s.options).forEach(opt=>{
            if(opt.value && chosen.has(opt.value) && s.value !== opt.value) opt.disabled = true;
            else opt.disabled = false;
          });
        });
        Array.from(impactSelect.options).forEach(opt=>{
          if(opt.value && chosen.has(opt.value)) opt.disabled = true;
          else opt.disabled = false;
        });
        const overCount = {};
        bowlingSelects.forEach(s=>{
          const v = s.value || "";
          if(v) overCount[v] = (overCount[v] || 0) + 1;
        });
        bowlingSelects.forEach(s=>{
          Array.from(s.options).forEach(opt=>{
            if(!opt.value){ opt.disabled = false; return; }
            const used = overCount[opt.value] || 0;
            // Enforce max 4 overs per bowler directly in UI.
            opt.disabled = used >= 4 && s.value !== opt.value;
          });
        });
      }
      const captureDraft = ()=>{
        if(!activeXIEditorState || activeXIEditorState.playerIndex !== playerIndex) return;
        activeXIEditorState.draft = {
          xi: selects.map(sel=>sel.value || ""),
          impact: impactSelect.value || "",
          superOverBatters: superOverBattingSelects.map(sel=>sel.value || ""),
          superOverBowler: superOverBowlerSelect.value || "",
          bowlingPlan: bowlingSelects.map(sel=>sel.value || "")
        };
      };
      // attach change listeners
      selects.forEach(s=> s.addEventListener("change", ()=>{ refreshOptions(); captureDraft(); }));
      bowlingSelects.forEach(s=> s.addEventListener("change", ()=>{ refreshOptions(); captureDraft(); }));
      impactSelect.addEventListener("change", captureDraft);
      superOverBattingSelects.forEach(s=> s.addEventListener("change", captureDraft));
      superOverBowlerSelect.addEventListener("change", captureDraft);
      // initial refresh
      refreshOptions();
      captureDraft();
    }

    playersList.addEventListener("click",(e)=>{
      if(e.target.classList.contains("set-xi-btn")){
        const card = e.target.closest(".player-card");
        const idx = parseInt(card.dataset.playerIndex,10);
        openPlayingXIEditor(idx);
        return;
      }
      if(!e.target.classList.contains("xi-save-btn")) return;
      const idx = parseInt(e.target.dataset.playerIndex,10);
      const card = document.querySelector(`.player-card[data-player-index='${idx}']`);
      const p = players[idx];
      const editor = card.querySelector(".xi-editor");
      if(!editor) return;

      const selects = Array.from(editor.querySelectorAll("select[name^='xi-pos-']"));
      const xiNames = selects.map(s=>s.value).filter(Boolean);
      const msg = editor.querySelector(".xi-error");
      msg.style.display = "none";
      msg.className = "xi-error";

      if(xiNames.length !== 11){
        msg.textContent = "Select exactly 11 players.";
        msg.style.display = "block";
        return;
      }
      const uniq = new Set(xiNames);
      if(uniq.size !== 11){
        msg.textContent = "Duplicates found.";
        msg.style.display = "block";
        return;
      }
      const wkCount = xiNames.reduce((acc, name)=>{
        const entry = (p.squad || []).find(s=>s.playerName === name);
        return acc + (entry && getBaseRole(entry.role) === "WK" ? 1 : 0);
      }, 0);
      if(wkCount < 1){
        msg.textContent = "At least one wicketkeeper is compulsory in the Playing XI.";
        msg.style.display = "block";
        return;
      }
      const impactVal = editor.querySelector('select[name="impact"]').value;
      if(!impactVal){
        msg.textContent = "Select impact.";
        msg.style.display = "block";
        return;
      }
      if(uniq.has(impactVal)){
        msg.textContent = "Impact cannot be in XI.";
        msg.style.display = "block";
        return;
      }

      const superOverBatters = Array.from(editor.querySelectorAll("select[name^='super-over-bat-']")).map(sel=>sel.value).filter(Boolean);
      if(superOverBatters.length !== 3){
        msg.textContent = "Select 3 super over batters.";
        msg.style.display = "block";
        return;
      }
      if((new Set(superOverBatters)).size !== 3){
        msg.textContent = "Super over batters must be unique.";
        msg.style.display = "block";
        return;
      }
      const superOverPool = new Set([...xiNames, impactVal]);
      const invalidSuperOverBatter = superOverBatters.find(name=>!superOverPool.has(name));
      if(invalidSuperOverBatter){
        msg.textContent = `${formatPlayerName(invalidSuperOverBatter)} must be inside XI + Impact for the super over.`;
        msg.style.display = "block";
        return;
      }
      const superOverBowlerSelect = editor.querySelector('select[name="super-over-bowler"]');
      const superOverBowler = superOverBowlerSelect ? superOverBowlerSelect.value : "";
      if(!superOverBowler){
        msg.textContent = "Select a super over bowler.";
        msg.style.display = "block";
        return;
      }
      if(!superOverPool.has(superOverBowler)){
        msg.textContent = `${formatPlayerName(superOverBowler)} must be inside XI + Impact for the super over.`;
        msg.style.display = "block";
        return;
      }
      const superOverBowlerEntry = (p.squad || []).find(s=>s.playerName === superOverBowler);
      if(!superOverBowlerEntry || !isBowlingRole(superOverBowlerEntry.role)){
        msg.textContent = `${formatPlayerName(superOverBowler)} must be a bowling option for the super over.`;
        msg.style.display = "block";
        return;
      }

      const bowlPlan = Array.from(editor.querySelectorAll("select[name^='bowl-ov-']")).map(s=>s.value || "");
      const assigned = bowlPlan.filter(Boolean);
      const countMap = {};
      assigned.forEach(n=>{ countMap[n] = (countMap[n] || 0) + 1; });
      const overLimit = Object.entries(countMap).find(([,cnt])=>cnt > 4);
      if(overLimit){
        msg.textContent = `${formatPlayerName(overLimit[0])} has ${overLimit[1]} overs. Max 4.`;
        msg.style.display = "block";
        return;
      }

      const squadMap = new Map((p.squad || []).map(s=>[s.playerName, s]));
      const bowlingAllowed = new Set([...xiNames, impactVal]);
      const invalidPlanned = assigned.find(name=>{
        if(!bowlingAllowed.has(name)) return true;
        const entry = squadMap.get(name);
        const role = entry ? entry.role : "";
        return !isBowlingRole(role);
      });
      if(invalidPlanned){
        msg.textContent = `Bowling plan invalid: ${formatPlayerName(invalidPlanned)} must be a bowling role from XI+Impact.`;
        msg.style.display = "block";
        return;
      }

      p.playing = {
        xi: xiNames,
        impact: impactVal,
        bowlingPlan: bowlPlan,
        superOver: {
          batters: superOverBatters,
          bowler: superOverBowler
        }
      };
      msg.textContent = "Saved!";
      msg.className = "xi-ok";
      msg.style.display = "block";
      activeXIEditorState = null;
      pendingRoomGameStateWhileEditing = null;
      renderPlayers();
      syncRoomGameState("save-xi");
    });

    function syncTossCallerOptions(){
      if(!tossCallerSelect) return;
      tossCallerSelect.innerHTML = "";
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "Toss caller";
      tossCallerSelect.appendChild(ph);
      const idxA = parseInt(teamASelect.value, 10);
      const idxB = parseInt(teamBSelect.value, 10);
      if(Number.isNaN(idxA) || Number.isNaN(idxB) || idxA === idxB || !players[idxA] || !players[idxB]){
        return;
      }
      const optA = document.createElement("option");
      optA.value = "A";
      optA.textContent = `${players[idxA].name} calls`;
      tossCallerSelect.appendChild(optA);
      const optB = document.createElement("option");
      optB.value = "B";
      optB.textContent = `${players[idxB].name} calls`;
      tossCallerSelect.appendChild(optB);
      if(!tossCallerSelect.value){
        tossCallerSelect.value = "A";
      }
    }

    function countOutsFromBatting(batArray){
      return batArray.filter(b => (b.outDesc && b.outDesc !== "NOT OUT" && b.outDesc !== "DNB")).length;
    }
    function getSpinPaceStrength(bowlers){
      let spin = 0, pace = 0;
      bowlers.forEach(b=>{
        const nm = b.playerName || b.name;
        const rating = getPlayerRating(nm, b.role || "BOWL");
        if(isSpinBowlingRole(b.role, nm)) spin += rating;
        else if(isPaceBowlingRole(b.role, nm)) pace += rating;
        else {
          if(isSpecialistBowlingRole(b.role || "BOWL")) pace += rating * 0.6;
          else spin += rating * 0.3;
        }
      });
      return { spin, pace };
    }
    function pickMatchConditions(tossInfo, forcedVenueName = ""){
      const forcedVenue = forcedVenueName
        ? VENUE_PROFILES.find(v => v.name === forcedVenueName)
        : null;
      const venue = forcedVenue || VENUE_PROFILES[Math.floor(Math.random() * VENUE_PROFILES.length)];
      const weather = Math.random() < 0.22 ? "humid" : (Math.random() < 0.16 ? "windy" : "clear");
      const dew = Math.random() < venue.dewBias;
      const chasingBonus = dew ? 7 : 0;
      const boundaryAdj = venue.boundary === "small" ? 8 : venue.boundary === "large" ? -7 : 0;
      const weatherAdj = weather === "humid" ? 3 : weather === "windy" ? -2 : 0;
      return {
        venue: venue.name,
        pitch: venue.pitch,
        boundary: venue.boundary,
        weather,
        dew,
        baseRunAdj: venue.runAdj + boundaryAdj + weatherAdj,
        chaseAdj: chasingBonus,
        tossDecision: tossInfo ? tossInfo.decision : null
      };
    }

    function pickAutoTossDecision(idxA, idxB, forcedVenueName = ""){
      const forcedVenue = forcedVenueName
        ? VENUE_PROFILES.find(v => v.name === forcedVenueName)
        : null;
      const venue = forcedVenue || VENUE_PROFILES[Math.floor(Math.random() * VENUE_PROFILES.length)];
      const dewBias = venue && typeof venue.dewBias === "number" ? venue.dewBias : 0.4;
      const winner = players[idxA] || { squad: [] };
      const loser = players[idxB] || { squad: [] };
      const winnerBowl = getBowlingAttack(winner);
      const loserBowl = getBowlingAttack(loser);
      const winnerStyle = getSpinPaceStrength(winnerBowl);
      const loserStyle = getSpinPaceStrength(loserBowl);
      const winnerBat = getOrderedXI(winner).slice(0, 6).reduce((acc, name)=>{
        const p = (winner.squad || []).find(x=>x.playerName === name) || { role: "BAT" };
        return acc + getBatStrikeRate(name, p.role);
      }, 0) / 6;
      const loserBat = getOrderedXI(loser).slice(0, 6).reduce((acc, name)=>{
        const p = (loser.squad || []).find(x=>x.playerName === name) || { role: "BAT" };
        return acc + getBatStrikeRate(name, p.role);
      }, 0) / 6;
      let bowlScore = 0;
      if(dewBias >= 0.45) bowlScore += 0.85;
      if(venue.pitch === "spin" && winnerStyle.spin >= loserStyle.spin) bowlScore += 0.35;
      if(venue.pitch === "pace" && winnerStyle.pace >= loserStyle.pace) bowlScore += 0.35;
      if(venue.boundary === "small") bowlScore += 0.2;
      if((winnerBat - loserBat) >= 6) bowlScore += 0.22;
      if((winnerBat - loserBat) <= -6) bowlScore -= 0.2;
      bowlScore += randomNoise(0.2);
      return bowlScore >= 0.35 ? "bowl" : "bat";
    }

    function buildTossInfoForMatch(idxA, idxB, useManualControls, options = {}){
      const coinResult = Math.random() < 0.5 ? "heads" : "tails";
      const callerSide = useManualControls && tossCallerSelect.value === "B" ? "B" : "A";
      const callerIdx = callerSide === "A" ? idxA : idxB;
      const otherIdx = callerIdx === idxA ? idxB : idxA;
      const call = useManualControls ? (tossCallSelect.value || "heads") : (Math.random() < 0.5 ? "heads" : "tails");
      const tossWinnerIdx = call === coinResult ? callerIdx : otherIdx;
      const decision = useManualControls
        ? (tossDecisionSelect.value || "bat")
        : pickAutoTossDecision(tossWinnerIdx, tossWinnerIdx === idxA ? idxB : idxA, options.venueName || "");
      const battingFirstIdx = decision === "bat" ? tossWinnerIdx : (tossWinnerIdx === idxA ? idxB : idxA);
      return {
        call,
        coinResult,
        callerIdx,
        tossWinnerIdx,
        decision,
        battingFirstIdx
      };
    }

    function openXIEditorFromSim(side){
      const selectedVal = side === "A" ? teamASelect.value : teamBSelect.value;
      const idx = parseInt(selectedVal, 10);
      if(Number.isNaN(idx) || !players[idx]){
        tossResultLine.textContent = "Select valid squads first, then edit XI + Impact.";
        return;
      }
      switchToTab("squads");
      openPlayingXIEditor(idx);
      const card = document.querySelector(`.player-card[data-player-index='${idx}']`);
      if(card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    editTeamAXIBtn.addEventListener("click", ()=> openXIEditorFromSim("A"));
    editTeamBXIBtn.addEventListener("click", ()=> openXIEditorFromSim("B"));
    teamASelect.addEventListener("change", syncTossCallerOptions);
    teamBSelect.addEventListener("change", syncTossCallerOptions);

    function getPairKey(i, j){
      return i < j ? `${i}#${j}` : `${j}#${i}`;
    }
    function ensureTeamSeasonStats(idx){
      if(!seasonStats.team[idx]){
        seasonStats.team[idx] = { played: 0, won: 0, lost: 0, tied: 0, points: 0 };
      }
      return seasonStats.team[idx];
    }
    function ensureBatStats(name){
      if(!seasonStats.batting[name]) seasonStats.batting[name] = { runs: 0, balls: 0, fours: 0, sixes: 0, inns: 0 };
      return seasonStats.batting[name];
    }
    function ensureBowlStats(name){
      if(!seasonStats.bowling[name]) seasonStats.bowling[name] = { wickets: 0, runs: 0, balls: 0, inns: 0 };
      return seasonStats.bowling[name];
    }
    function recordRivalry(res){
      const key = getPairKey(res.idxA, res.idxB);
      if(!rivalryStats[key]){
        rivalryStats[key] = { idxA: Math.min(res.idxA, res.idxB), idxB: Math.max(res.idxA, res.idxB), matches: 0, winsA: 0, winsB: 0, ties: 0 };
      }
      const rec = rivalryStats[key];
      rec.matches++;
      if(res.winnerIdx === -1) rec.ties++;
      else {
        const winnerGlobalIdx = res.winnerIdx === 0 ? res.idxA : res.idxB;
        if(winnerGlobalIdx === rec.idxA) rec.winsA++; else rec.winsB++;
      }
    }
    function updateDynamicFormAfterMatch(res){
      Object.keys(dynamicPlayerState).forEach(name=>{
        const st = ensureDynamicState(name);
        st.fatigue = Math.max(0, st.fatigue - 0.06);
        if(st.injuryGames > 0) st.injuryGames--;
      });
      const allBat = [...res.details.teamA.bat, ...res.details.teamB.bat];
      const allBowl = [...res.details.teamA.bowlCard, ...res.details.teamB.bowlCard];
      allBat.forEach(p=>{
        if(p.outDesc === "DNB") return;
        const st = ensureDynamicState(p.name);
        st.fatigue = Math.min(2.5, st.fatigue + 0.18);
        if(p.runs >= 60){ st.form = Math.min(3, st.form + 0.45); st.streak = Math.min(6, st.streak + 1); }
        else if(p.runs <= 8){ st.form = Math.max(-3, st.form - 0.22); st.streak = Math.max(0, st.streak - 1); }
        else st.form = Math.max(-3, Math.min(3, st.form + randomNoise(0.06)));
        if(Math.random() < 0.008 + st.fatigue * 0.003){ st.injuryGames = Math.max(st.injuryGames, 1 + Math.floor(Math.random()*2)); }
      });
      allBowl.forEach(b=>{
        const st = ensureDynamicState(b.name);
        st.fatigue = Math.min(2.5, st.fatigue + 0.14);
        if((b.wickets || 0) >= 3){ st.form = Math.min(3, st.form + 0.4); st.streak = Math.min(6, st.streak + 1); }
        else if((b.wickets || 0) === 0 && (b.econ || 0) > 9){ st.form = Math.max(-3, st.form - 0.18); st.streak = Math.max(0, st.streak - 1); }
      });
    }
    function updateSeasonStatsFromMatch(res){
      seasonStats.meta.matches++;
      recordRivalry(res);
      const tA = ensureTeamSeasonStats(res.idxA);
      const tB = ensureTeamSeasonStats(res.idxB);
      tA.played++; tB.played++;
      if(res.winnerIdx === 0){ tA.won++; tA.points += 2; tB.lost++; }
      else if(res.winnerIdx === 1){ tB.won++; tB.points += 2; tA.lost++; }
      else { tA.tied++; tB.tied++; tA.points++; tB.points++; }

      const teamPairs = [
        { idx: res.idxA, team: res.details.teamA },
        { idx: res.idxB, team: res.details.teamB }
      ];
      teamPairs.forEach(pair=>{
        pair.team.bat.forEach(p=>{
          if(p.outDesc === "DNB") return;
          const s = ensureBatStats(p.name);
          s.inns++; s.runs += p.runs || 0; s.balls += p.balls || 0; s.fours += p.fours || 0; s.sixes += p.sixes || 0;
          seasonStats.meta.totalRuns += p.runs || 0;
          seasonStats.meta.totalBalls += p.balls || 0;
          seasonStats.meta.totalBoundaries += (p.fours || 0) + (p.sixes || 0);
          const estDots = Math.max(0, (p.balls || 0) - ((p.fours || 0) + (p.sixes || 0)) - Math.round((p.runs || 0) / 3));
          seasonStats.meta.totalDots += estDots;
        });
        const ex = pair.team.extras || null;
        if(ex && ex.total){
          seasonStats.meta.totalRuns += ex.total;
        }
        pair.team.bowlCard.forEach(b=>{
          const s = ensureBowlStats(b.name);
          const balls = Math.floor(b.overs) * 6 + (String(b.overs).includes(".") ? parseInt(String(b.overs).split(".")[1], 10) : 0);
          s.inns++; s.wickets += b.wickets || 0; s.runs += b.runs || 0; s.balls += balls || 0;
        });
      });
      if(res.live && res.live.innings){
        res.live.innings.forEach(inng=>{
          seasonStats.meta.powerplayRuns += inng.powerplayRuns || 0;
          seasonStats.meta.powerplayOvers += inng.powerplayOvers || 0;
          seasonStats.meta.deathRuns += inng.deathRuns || 0;
          seasonStats.meta.deathOvers += inng.deathOvers || 0;
        });
      } else {
        [res.details.teamA, res.details.teamB].forEach(team=>{
          const ovBalls = oversToBalls(team.overs || "20");
          const ov = Math.max(1, ovBalls / 6);
          const ppOv = Math.min(6, ov);
          const deathOv = Math.min(5, ov);
          const ppRuns = Math.round((team.score || 0) * 0.34);
          const deathRuns = Math.round((team.score || 0) * 0.29);
          seasonStats.meta.powerplayRuns += ppRuns;
          seasonStats.meta.powerplayOvers += ppOv;
          seasonStats.meta.deathRuns += deathRuns;
          seasonStats.meta.deathOvers += deathOv;
        });
      }
      updateDynamicFormAfterMatch(res);
    }
    function renderStatsDashboard(){
      if(!statsDashboard) return;
      if(seasonStats.meta.matches === 0){ statsDashboard.innerHTML = ""; return; }
      const topRuns = Object.entries(seasonStats.batting).sort((a,b)=> b[1].runs - a[1].runs).slice(0,5);
      const topWk = Object.entries(seasonStats.bowling).sort((a,b)=> b[1].wickets - a[1].wickets).slice(0,5);
      const boundaryPct = seasonStats.meta.totalBalls > 0 ? ((seasonStats.meta.totalBoundaries / seasonStats.meta.totalBalls) * 100).toFixed(1) : "0.0";
      const dotPct = seasonStats.meta.totalBalls > 0 ? ((seasonStats.meta.totalDots / seasonStats.meta.totalBalls) * 100).toFixed(1) : "0.0";
      const ppRR = seasonStats.meta.powerplayOvers > 0 ? (seasonStats.meta.powerplayRuns / seasonStats.meta.powerplayOvers).toFixed(2) : "0.00";
      const deathRR = seasonStats.meta.deathOvers > 0 ? (seasonStats.meta.deathRuns / seasonStats.meta.deathOvers).toFixed(2) : "0.00";
      const card = (title, arr, mapper)=> `<div class="dash-card"><h4>${title}</h4><ol class="dash-list">${arr.map(mapper).join("")}</ol></div>`;
      statsDashboard.innerHTML = `
        <h3>Season Stats Dashboard</h3>
        <div class="dash-grid">
          ${card("Orange Cap", topRuns, ([name,v])=>`<li>${formatPlayerName(name)} - ${v.runs} runs</li>`)}
          ${card("Purple Cap", topWk, ([name,v])=>`<li>${formatPlayerName(name)} - ${v.wickets} wkts</li>`)}
          <div class="dash-card"><h4>Team Rates</h4><ul class="dash-list"><li>Powerplay RR: ${ppRR}</li><li>Death RR: ${deathRR}</li><li>Boundary%: ${boundaryPct}</li><li>Dot-ball%: ${dotPct}</li></ul></div>
        </div>
      `;
    }
    function renderRivalryBoard(){
      if(!rivalryBoard) return;
      const rows = Object.values(rivalryStats);
      if(rows.length === 0){ rivalryBoard.innerHTML = ""; return; }
      const table = document.createElement("table");
      table.className = "score";
      table.innerHTML = `<thead><tr><th>Rivalry</th><th>M</th><th>W-L</th><th>Ties</th></tr></thead>`;
      const tb = document.createElement("tbody");
      rows.sort((a,b)=>b.matches-a.matches).forEach(r=>{
        const tr = document.createElement("tr");
        const aName = players[r.idxA] ? players[r.idxA].name : `P${r.idxA+1}`;
        const bName = players[r.idxB] ? players[r.idxB].name : `P${r.idxB+1}`;
        tr.innerHTML = `<td>${aName} vs ${bName}</td><td>${r.matches}</td><td>${r.winsA}-${r.winsB}</td><td>${r.ties}</td>`;
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      rivalryBoard.innerHTML = "<h3>Head-to-Head Rivalries</h3>";
      rivalryBoard.appendChild(table);
    }
    // ---------- SIMULATION: more realistic wickets & scoreboard ----------
    function randomNoise(r){ return (Math.random()*2-1)*r; }

    function getOrderedXI(playerObj){
      const available = playerObj.squad.filter(p=>getDynamicAvailability(p.playerName) > 0);
      const injuryFiltered = available.length >= 11 ? available : playerObj.squad.slice();
      if(playerObj.playing && playerObj.playing.xi && playerObj.playing.xi.length===11){
        const ordered = [];
        const used = new Set();
        playerObj.playing.xi.forEach(name=>{
          const inSquad = injuryFiltered.find(p=>p.playerName === name);
          if(inSquad && !used.has(name)){ ordered.push(name); used.add(name); }
        });
        if(ordered.length < 11){
          const fillers = injuryFiltered
            .filter(p=>!used.has(p.playerName))
            .sort((a,b)=>getPlayerRating(b.playerName,b.role)-getPlayerRating(a.playerName,a.role));
          fillers.forEach(p=>{
            if(ordered.length < 11){ ordered.push(p.playerName); used.add(p.playerName); }
          });
        }
        while(ordered.length<11) ordered.push("substitute");
        return ordered.slice(0,11);
      }
      const squad = injuryFiltered.slice();
      const rolePriority = {BAT:0, WK:1, AR:2, BOWL:3};
      squad.sort((a,b)=> (rolePriority[getBaseRole(a.role)] - rolePriority[getBaseRole(b.role)]) || a.playerName.localeCompare(b.playerName));
      const xi = squad.slice(0,11).map(p=>p.playerName);
      while(xi.length<11) xi.push("substitute");
      return xi;
    }

    function getBowlingAttack(opponent){
      let pool = (opponent.squad || []).slice();
      if(opponent.playing && Array.isArray(opponent.playing.xi) && opponent.playing.xi.length === 11){
        const squadMap = new Map((opponent.squad || []).map(p=>[p.playerName, p]));
        const selectedNames = [];
        opponent.playing.xi.forEach(n=>{ if(n) selectedNames.push(n); });
        if(opponent.playing.impact) selectedNames.push(opponent.playing.impact);
        const seen = new Set();
        const filtered = selectedNames
          .filter(n=> !seen.has(n) && seen.add(n))
          .map(n=> squadMap.get(n))
          .filter(Boolean);
        if(filtered.length >= 5) pool = filtered;
      }

      const specialist = pool
        .filter(p=> isSpecialistBowlingRole(p.role))
        .sort((a,b)=> getPlayerRating(b.playerName,b.role) - getPlayerRating(a.playerName,a.role));
      const allRounders = pool
        .filter(p=> isAllRounderRole(p.role))
        .sort((a,b)=> getPlayerRating(b.playerName,b.role) - getPlayerRating(a.playerName,a.role));
      const chosen = specialist.slice(0,5);
      const used = new Set(chosen.map(p=>p.playerName));

      // Add AR only when needed or when they are in strong form.
      for(const ar of allRounders){
        if(chosen.length >= 6) break;
        if(used.has(ar.playerName)) continue;
        const rating = getPlayerRating(ar.playerName, ar.role);
        if(chosen.length < 4 || isPlayerInForm(ar.playerName, ar.role) || rating >= 8.15){
          chosen.push(ar);
          used.add(ar.playerName);
        }
      }

      const planNames = opponent.playing && Array.isArray(opponent.playing.bowlingPlan)
        ? opponent.playing.bowlingPlan.filter(Boolean)
        : [];
      for(const name of planNames){
        if(chosen.length >= 6) break;
        if(used.has(name)) continue;
        const found = pool.find(p=>p.playerName === name && isBowlingRole(p.role));
        if(found){
          chosen.push(found);
          used.add(name);
        }
      }

      if(chosen.length < 5){
        const fillers = pool
          .filter(p=>!used.has(p.playerName))
          .sort((a,b)=>getPlayerRating(b.playerName,b.role)-getPlayerRating(a.playerName,a.role));
        for(const p of fillers){
          chosen.push(p);
          if(chosen.length >= 5) break;
        }
      }
      return chosen.slice(0,6);
    }
    function getSuperOverConfig(playerObj){
      const squadMap = new Map((playerObj && playerObj.squad ? playerObj.squad : []).map(p=>[p.playerName, p]));
      const poolNames = [];
      getOrderedXI(playerObj).slice(0, 11).forEach(name=>{
        if(name && !poolNames.includes(name)) poolNames.push(name);
      });
      if(playerObj && playerObj.playing && playerObj.playing.impact && !poolNames.includes(playerObj.playing.impact)){
        poolNames.push(playerObj.playing.impact);
      }
      const saved = playerObj && playerObj.playing && playerObj.playing.superOver ? playerObj.playing.superOver : null;
      const savedBatters = saved && Array.isArray(saved.batters) ? saved.batters.filter(name=>poolNames.includes(name)) : [];
      const batters = [];
      savedBatters.forEach(name=>{
        if(name && !batters.includes(name)) batters.push(name);
      });
      poolNames.forEach(name=>{
        if(batters.length < 3 && !batters.includes(name)) batters.push(name);
      });
      const savedBowlerEntry = saved && saved.bowler ? squadMap.get(saved.bowler) : null;
      let bowler = savedBowlerEntry && poolNames.includes(saved.bowler) && isBowlingRole(savedBowlerEntry.role) ? saved.bowler : "";
      if(!bowler){
        const fallbackBowler = getBowlingAttack(playerObj).find(entry=>poolNames.includes(entry.playerName));
        if(fallbackBowler) bowler = fallbackBowler.playerName;
      }
      if(!bowler){
        const firstBowlingName = poolNames.find(name=>{
          const entry = squadMap.get(name);
          return entry && isBowlingRole(entry.role);
        });
        bowler = firstBowlingName || poolNames[0] || "";
      }
      return {
        batters: batters.slice(0, 3),
        bowler
      };
    }
    function simulateSuperOverInnings(battingTeamObj, bowlingTeamObj, conditions = null, targetScore = null){
      const batConfig = getSuperOverConfig(battingTeamObj);
      const bowlConfig = getSuperOverConfig(bowlingTeamObj);
      const battingMap = new Map((battingTeamObj.squad || []).map(p=>[p.playerName, p]));
      const bowlingMap = new Map((bowlingTeamObj.squad || []).map(p=>[p.playerName, p]));
      const bowlerName = bowlConfig.bowler;
      const bowlerEntry = bowlingMap.get(bowlerName) || { role: "BOWL" };
      const order = batConfig.batters.slice(0, 3);
      const batterStats = {};
      order.forEach(name=>{
        batterStats[name] = { name, runs: 0, balls: 0, fours: 0, sixes: 0, outDesc: "NOT OUT", SR: "0.0" };
      });
      let strikerSlot = 0;
      let nonStrikerSlot = Math.min(1, Math.max(0, order.length - 1));
      let nextSlot = 2;
      let score = 0;
      let wickets = 0;
      let balls = 0;
      while(balls < 6 && wickets < 2 && order[strikerSlot]){
        const strikerName = order[strikerSlot];
        const strikerEntry = battingMap.get(strikerName) || { role: "BAT" };
        const batRating = getPlayerRating(strikerName, strikerEntry.role);
        const strikeRate = getBatStrikeRate(strikerName, strikerEntry.role);
        const batForm = getCurrentFormScore(strikerName, strikerEntry.role);
        const bowlRating = getPlayerRating(bowlerName, bowlerEntry.role || "BOWL");
        const wicketSkill = getWicketSkill(bowlerName, bowlerEntry.role || "BOWL");
        const bowlEcon = getBowlingEconomy(bowlerName, bowlerEntry.role || "BOWL");
        const runsNeeded = targetScore === null ? 8 : Math.max(0, targetScore - score);
        const ballsLeft = Math.max(1, 6 - balls);
        const pressure = targetScore === null ? 0.62 : clampValue(runsNeeded / ballsLeft / 3.4, 0.25, 1.4);
        const wicketProb = clampValue(
          0.08 +
          wicketSkill * 0.022 +
          (8.0 - Math.min(10.5, bowlEcon)) * 0.018 -
          (batRating - 7.0) * 0.02 -
          (strikeRate - 145) * 0.0007 +
          pressure * 0.05,
          0.05,
          0.3
        );
        balls++;
        batterStats[strikerName].balls++;
        if(Math.random() < wicketProb){
          wickets++;
          batterStats[strikerName].outDesc = `b ${bowlerName}`;
          if(wickets >= 2 || nextSlot >= order.length){
            break;
          }
          order[strikerSlot] = order[nextSlot];
          nextSlot++;
          continue;
        }
        const aggression = clampValue(
          0.46 +
          pressure * 0.32 +
          (conditions && conditions.boundary === "small" ? 0.06 : 0) -
          (conditions && conditions.pitch === "spin" && isSpinBowlingRole(bowlerEntry.role, bowlerName) ? 0.04 : 0) +
          batForm * 0.14,
          0.18,
          1.35
        );
        const roll = Math.random();
        let runs = 0;
        if(roll < Math.max(0.08, 0.22 - aggression * 0.08)) runs = 0;
        else if(roll < 0.48 - aggression * 0.03) runs = 1;
        else if(roll < 0.68) runs = 2;
        else if(roll < 0.74) runs = 3;
        else if(roll < 0.92 - aggression * 0.04) runs = 4;
        else runs = 6;
        if(targetScore !== null && runs > runsNeeded){
          runs = runsNeeded;
        }
        score += runs;
        batterStats[strikerName].runs += runs;
        if(runs === 4) batterStats[strikerName].fours++;
        if(runs === 6) batterStats[strikerName].sixes++;
        if(runs % 2 === 1){
          const temp = strikerSlot;
          strikerSlot = nonStrikerSlot;
          nonStrikerSlot = temp;
        }
        if(balls < 6 && balls % 6 === 0){
          const temp = strikerSlot;
          strikerSlot = nonStrikerSlot;
          nonStrikerSlot = temp;
        }
        if(targetScore !== null && score >= targetScore){
          break;
        }
      }
      const batters = order.map(name=>{
        const entry = batterStats[name] || { name, runs: 0, balls: 0, fours: 0, sixes: 0, outDesc: "DNB", SR: "0.0" };
        const sr = entry.balls > 0 ? ((entry.runs * 100) / entry.balls).toFixed(1) : "0.0";
        return { ...entry, SR: sr };
      });
      return {
        battingTeam: battingTeamObj.name,
        bowlingTeam: bowlingTeamObj.name,
        score,
        wickets,
        balls,
        overs: formatOversFromBalls(balls),
        batters,
        bowler: {
          name: bowlerName,
          overs: formatOversFromBalls(Math.min(6, balls)),
          runs: score,
          wickets: Math.min(2, wickets)
        },
        config: {
          batters: batConfig.batters.slice(0, 3),
          bowler: bowlerName
        }
      };
    }
    function buildPostMatchAwards(scorecard, winnerName){
      const allBatters = [
        ...(scorecard && scorecard.teamA && Array.isArray(scorecard.teamA.bat) ? scorecard.teamA.bat.map(entry=>({ ...entry, team: scorecard.teamA.name })) : []),
        ...(scorecard && scorecard.teamB && Array.isArray(scorecard.teamB.bat) ? scorecard.teamB.bat.map(entry=>({ ...entry, team: scorecard.teamB.name })) : [])
      ];
      const allBowlers = [
        ...(scorecard && scorecard.teamA && Array.isArray(scorecard.teamA.bowlCard) ? scorecard.teamA.bowlCard.map(entry=>({ ...entry, team: scorecard.teamB.name })) : []),
        ...(scorecard && scorecard.teamB && Array.isArray(scorecard.teamB.bowlCard) ? scorecard.teamB.bowlCard.map(entry=>({ ...entry, team: scorecard.teamA.name })) : [])
      ];
      const topScorer = allBatters.slice().sort((a, b)=> (b.runs - a.runs) || (a.balls - b.balls))[0] || null;
      const bestBowler = allBowlers.slice().sort((a, b)=> (b.wickets - a.wickets) || (a.runs - b.runs) || (parseFloat(a.econ) - parseFloat(b.econ)))[0] || null;
      const playerOfMatch = allBatters
        .concat(allBowlers.map(entry=>({
          name: entry.name,
          team: entry.team,
          impactScore: entry.wickets * 26 - entry.runs * 0.8
        })))
        .map(entry=>{
          if(typeof entry.impactScore === "number") return entry;
          return {
            name: entry.name,
            team: entry.team,
            impactScore: entry.runs * 1.1 + ((parseFloat(entry.SR) || 0) - 100) * 0.18
          };
        })
        .sort((a, b)=> b.impactScore - a.impactScore)[0] || null;
      return {
        winnerName,
        topScorer,
        bestBowler,
        playerOfMatch
      };
    }
    function resolveSuperOver(teamAObj, teamBObj, conditions = null){
      const rounds = [];
      for(let round = 1; round <= 3; round++){
        const teamAInnings = simulateSuperOverInnings(teamAObj, teamBObj, conditions, null);
        const teamBInnings = simulateSuperOverInnings(teamBObj, teamAObj, conditions, teamAInnings.score + 1);
        rounds.push({ round, teamA: teamAInnings, teamB: teamBInnings });
        if(teamAInnings.score !== teamBInnings.score){
          const winnerIdx = teamAInnings.score > teamBInnings.score ? 0 : 1;
          return {
            winnerIdx,
            rounds,
            summaryLine: `${winnerIdx === 0 ? teamAObj.name : teamBObj.name} won after a super over`
          };
        }
      }
      const fallbackA = getSquadStrength(getEffectiveSquad(teamAObj));
      const fallbackB = getSquadStrength(getEffectiveSquad(teamBObj));
      const winnerIdx = fallbackA >= fallbackB ? 0 : 1;
      rounds.push({
        round: rounds.length + 1,
        note: "Automatic tie-break used after repeated super over tie."
      });
      return {
        winnerIdx,
        rounds,
        summaryLine: `${winnerIdx === 0 ? teamAObj.name : teamBObj.name} edged the tie-break after repeated super overs`
      };
    }

    // decide realistic wickets for an innings using score, batting strength and bowling strength
    function decideWickets(score, battingStrength, bowlingStrength){
      // baseline average wickets in T20 ~ 5
      // stronger batting -> fewer wickets, stronger bowling -> more wickets
      const base = 5;
      const strengthDiff = bowlingStrength - battingStrength; // positive -> bowlers stronger -> more wickets
      // scale effect
      let expected = base + strengthDiff*0.12;
      // influence of runs: high score -> fewer wickets
      if(score >= 200) expected -= 1.5;
      else if(score >= 170) expected -= 0.8;
      else if(score < 130) expected += 0.8;
      // randomness
      expected += randomNoise(1.6);
      let wickets = Math.round(expected);
      if(wickets < 0) wickets = 0;
      if(wickets > 10) wickets = 10;
      // rarely all out in T20; reduce chance of 10 unless bowling is much stronger and score low
      if(wickets === 10){
        const chance = Math.random();
        if(chance > 0.4) wickets = 7 + Math.floor(Math.random()*3); // 7-9 more likely than 10
      }
      return wickets;
    }

    function clampValue(v, minV, maxV){
      return Math.max(minV, Math.min(maxV, v));
    }

    function buildChaseContext(chaseTarget, projectedRuns, inningsBalls = 120, conditions = null, battingStrength = 7.2, bowlingStrength = 7.2){
      const target = Math.max(1, Math.round(chaseTarget || 1));
      const projection = Math.max(0, Math.round(projectedRuns || 0));
      const balls = Math.max(24, Math.min(120, Math.round(inningsBalls || 120)));
      const overs = Math.ceil(balls / 6);
      const dewBoost = conditions && conditions.dew ? 0.16 : 0;
      const boundaryBoost = conditions && conditions.boundary === "small" ? 0.08 : (conditions && conditions.boundary === "large" ? -0.08 : 0);
      const strengthEdge = (battingStrength - bowlingStrength) * 0.07;
      let simulated = 0;
      let pressure = 0;
      let dotBursts = 0;
      let reliefBursts = 0;
      let runningRisk = 0;
      const phaseIntent = { pp: 0, middle: 0, death: 0 };
      const phaseCount = { pp: 0, middle: 0, death: 0 };

      for(let ov = 0; ov < overs; ov++){
        const ballsLeft = Math.max(1, balls - ov * 6);
        const needed = Math.max(0, target - simulated);
        const reqRate = (needed * 6) / ballsLeft;
        const phase = ov < 6 ? "pp" : ov < 15 ? "middle" : "death";
        let intent = (reqRate - 7.4) / 4.3 + dewBoost + boundaryBoost + strengthEdge + randomNoise(0.18);
        if(phase === "death") intent += 0.1;
        intent = clampValue(intent, -0.35, 1.35);
        phaseIntent[phase] += intent;
        phaseCount[phase]++;

        let overRuns = 6.2 + (projection / Math.max(1, overs) - 6.2) + intent * 2.2 + randomNoise(1.9);
        const dotBurstProb = clampValue(0.07 + Math.max(0, intent) * 0.18 + pressure * 0.06, 0.04, 0.44);
        const boundaryReliefProb = clampValue(0.09 + Math.max(0, intent) * 0.16 + (reqRate > 10 ? 0.16 : 0), 0.06, 0.48);
        const dotBurst = Math.random() < dotBurstProb;
        const relief = Math.random() < boundaryReliefProb;
        if(dotBurst){
          overRuns -= 2 + Math.random() * 2.8;
          pressure += 0.13;
          dotBursts++;
          runningRisk += 0.05;
        }
        if(relief){
          overRuns += 2 + Math.random() * 3.8;
          pressure = Math.max(0, pressure - 0.1);
          reliefBursts++;
        }
        simulated += Math.max(0, Math.round(overRuns));
      }

      const ppIntent = phaseCount.pp ? phaseIntent.pp / phaseCount.pp : 0;
      const midIntent = phaseCount.middle ? phaseIntent.middle / phaseCount.middle : 0;
      const deathIntent = phaseCount.death ? phaseIntent.death / phaseCount.death : 0;
      const deficit = Math.max(0, target - projection);
      const pressureIndex = clampValue((deficit / 18) * 0.12 + pressure + (deathIntent > 0.65 ? 0.14 : 0), 0, 1.6);
      const dotPressure = clampValue(dotBursts / Math.max(1, overs), 0, 1);
      const boundaryRelief = clampValue(reliefBursts / Math.max(1, overs), 0, 1);
      runningRisk = clampValue(runningRisk + pressureIndex * 0.36 + Math.max(0, deathIntent) * 0.18, 0, 1.4);

      return {
        isChase: true,
        target,
        projected: projection,
        phaseIntent: { pp: ppIntent, middle: midIntent, death: deathIntent },
        pressureIndex,
        dotPressure,
        boundaryRelief,
        runningRisk
      };
    }

    function buildDismissalProfile(totalWickets, { conditions = null, isChase = false, chaseContext = null, inningsBalls = 120 } = {}){
      const w = Math.max(0, Math.min(10, Math.round(totalWickets || 0)));
      if(w === 0){
        return { runOuts: 0, stumpingChance: 0.04 };
      }
      const pressure = chaseContext ? chaseContext.pressureIndex || 0 : 0;
      const runningRisk = chaseContext ? chaseContext.runningRisk || 0 : 0;
      const dotPressure = chaseContext ? chaseContext.dotPressure || 0 : 0;
      const overs = Math.max(4, Math.min(20, Math.round((inningsBalls || 120) / 6)));
      const runOutProb = clampValue((isChase ? 0.07 : 0.045) + pressure * 0.11 + runningRisk * 0.09 + dotPressure * 0.06 + (overs < 20 ? 0.02 : 0), 0.03, 0.33);
      let runOuts = 0;
      for(let i=0; i<w; i++){
        const decayed = runOutProb * Math.pow(0.78, i);
        if(Math.random() < decayed) runOuts++;
      }
      runOuts = Math.min(Math.max(0, runOuts), Math.min(3, Math.floor(w / 2) + (isChase ? 1 : 0)));
      const spinBoost = conditions && conditions.pitch === "spin" ? 0.07 : 0;
      const stumpingChance = clampValue(0.06 + spinBoost + dotPressure * 0.08, 0.04, 0.3);
      return { runOuts, stumpingChance };
    }

    function generateInningsExtras(totalRuns, inningsBalls = 120, { conditions = null, isChase = false, chaseContext = null } = {}){
      const runs = Math.max(0, Math.round(totalRuns || 0));
      const balls = Math.max(24, Math.min(120, Math.round(inningsBalls || 120)));
      const pressure = chaseContext ? chaseContext.pressureIndex || 0 : 0;
      const dotPressure = chaseContext ? chaseContext.dotPressure || 0 : 0;
      const boundarySmall = conditions && conditions.boundary === "small";
      const humid = conditions && conditions.weather === "humid";
      const wdRate = 0.018 + (humid ? 0.005 : 0) + (isChase ? 0.003 : 0) + pressure * 0.004;
      const nbRate = 0.005 + (boundarySmall ? 0.002 : 0) + pressure * 0.002;
      const byeRate = 0.006 + dotPressure * 0.003;
      const lbRate = 0.008 + (conditions && conditions.pitch === "pace" ? 0.002 : 0);
      const wd = Math.max(0, Math.round(balls * wdRate + randomNoise(1.2)));
      const nb = Math.max(0, Math.round(balls * nbRate + randomNoise(0.8)));
      const b = Math.max(0, Math.round(balls * byeRate + randomNoise(0.8)));
      const lb = Math.max(0, Math.round(balls * lbRate + randomNoise(0.9)));
      let total = wd + nb + b + lb;
      const cap = Math.max(3, Math.min(26, Math.round(runs * 0.17)));
      if(total > cap){
        const scale = cap / Math.max(1, total);
        let wdS = Math.round(wd * scale);
        let nbS = Math.round(nb * scale);
        let bS = Math.round(b * scale);
        let lbS = Math.round(lb * scale);
        let scaledTotal = wdS + nbS + bS + lbS;
        while(scaledTotal > cap){
          if(lbS > 0){ lbS--; scaledTotal--; continue; }
          if(bS > 0){ bS--; scaledTotal--; continue; }
          if(nbS > 0){ nbS--; scaledTotal--; continue; }
          if(wdS > 0){ wdS--; scaledTotal--; continue; }
          break;
        }
        while(scaledTotal < cap){
          wdS++;
          scaledTotal++;
        }
        return {
          wd: wdS,
          nb: nbS,
          b: bS,
          lb: lbS,
          total: scaledTotal,
          freeHitBalls: Math.max(0, nbS),
          bowlerExtras: wdS + nbS
        };
      }
      return {
        wd,
        nb,
        b,
        lb,
        total,
        freeHitBalls: nb,
        bowlerExtras: wd + nb
      };
    }

    // Enforces batting order progression: only top (wickets + 2) can bat; others are DNB.
    // Also assigns wicket descriptions with real bowler + random fielder names.
    function distributeRunsAmongBatters(battingEntries, totalRuns, wickets, dismissalBowlers = [], fielders = [], options = {}){
      const n = battingEntries.length;
      const w = Math.max(0, Math.min(wickets, 10));
      const battedCount = Math.max(2, Math.min(n, w + 2));
      const batted = battingEntries.slice(0, battedCount);
      const dnb = battingEntries.slice(battedCount);
      const inningsRuns = Math.max(0, Math.round(totalRuns));
      const inningsBallsUsed = Math.max(12, Math.min(120, Math.round(options.inningsBalls || 120)));
      const chaseContext = options && options.chaseContext ? options.chaseContext : null;
      const dismissalProfile = options && options.dismissalProfile ? options.dismissalProfile : { runOuts: 0, stumpingChance: 0.06 };
      const extrasInfo = options && options.extras ? options.extras : { freeHitBalls: 0 };
      const aggressionLevel = clampValue(options && typeof options.aggressionLevel === "number" ? options.aggressionLevel : 0, 0, 1.6);
      const pressureIndex = chaseContext ? clampValue(chaseContext.pressureIndex || 0, 0, 1.6) : 0;
      const dotPressure = chaseContext ? clampValue(chaseContext.dotPressure || 0, 0, 1) : 0;
      const boundaryRelief = chaseContext ? clampValue(chaseContext.boundaryRelief || 0, 0, 1) : 0;
      const chasePhaseIntent = chaseContext && chaseContext.phaseIntent
        ? chaseContext.phaseIntent
        : { pp: 0, middle: 0, death: 0 };
      const inningsOvers = inningsBallsUsed / 6;
      const ppOvers = Math.min(6, inningsOvers);
      const deathOvers = Math.min(5, Math.max(0, inningsOvers - 15));
      const middleOvers = Math.max(0, inningsOvers - ppOvers - deathOvers);
      const ppDemand = ppOvers / Math.max(1, inningsOvers);
      const middleDemand = middleOvers / Math.max(1, inningsOvers);
      const deathDemand = deathOvers / Math.max(1, inningsOvers);

      function getPhasePresenceByPosition(idx){
        if(idx <= 1) return { pp: 0.64, mid: 0.28, death: 0.08 };
        if(idx <= 4) return { pp: 0.22, mid: 0.6, death: 0.18 };
        if(idx <= 6) return { pp: 0.08, mid: 0.34, death: 0.58 };
        return { pp: 0.04, mid: 0.16, death: 0.8 };
      }

      function getPhaseSkill(name, idx){
        const presence = getPhasePresenceByPosition(idx);
        const opener = OPENER_SPECIALISTS[name] || 0;
        const middle = MIDDLE_ORDER_SPECIALISTS[name] || 0;
        const finisher = FINISHER_SPECIALISTS[name] || 0;
        const score = (opener * presence.pp * ppDemand) + (middle * presence.mid * middleDemand) + (finisher * presence.death * deathDemand);
        return {
          runMultiplier: Math.max(0.82, Math.min(1.55, 1 + score * 0.85)),
          strikeAdj: Math.max(-10, Math.min(16, score * 10))
        };
      }

      function getBatterStyle(p, idx){
        const sr = p.strikeRate || 132;
        const openerSkill = OPENER_SPECIALISTS[p.name] || 0;
        const finisherSkill = FINISHER_SPECIALISTS[p.name] || 0;
        const middleSkill = MIDDLE_ORDER_SPECIALISTS[p.name] || 0;
        let style = "balanced";
        if(idx <= 2 && (openerSkill > 0 || sr <= 150)) style = "anchor";
        if(sr >= 153 || (idx <= 3 && sr >= 160)) style = "aggressor";
        if(idx >= 5 && (finisherSkill > 0 || sr >= 160)) style = "finisher";
        if(idx <= 1 && sr >= 165) style = "pinch";
        if(style === "balanced" && middleSkill > 0.25) style = "anchor";
        if(style === "anchor"){
          return { tag: style, runShare: 1.08, strikeAdj: -5, wicketRisk: 0.9, dotResist: 1.15 };
        }
        if(style === "aggressor"){
          return { tag: style, runShare: 1.1, strikeAdj: 8, wicketRisk: 1.16, dotResist: 0.95 };
        }
        if(style === "finisher"){
          return { tag: style, runShare: 1.02, strikeAdj: 9, wicketRisk: 1.12, dotResist: 0.9 };
        }
        if(style === "pinch"){
          return { tag: style, runShare: 1.04, strikeAdj: 11, wicketRisk: 1.22, dotResist: 0.84 };
        }
        return { tag: style, runShare: 1, strikeAdj: 0, wicketRisk: 1, dotResist: 1 };
      }
      const styleProfiles = batted.map((p, idx)=>getBatterStyle(p, idx));

      // Sequential entry logic: start with #1 and #2, then next enters only after wicket.
      const outSet = new Set();
      const active = [];
      if(battedCount > 0) active.push(0);
      if(battedCount > 1) active.push(1);
      let nextIdx = 2;
      for(let d=0; d<Math.min(w, battedCount); d++){
        if(active.length === 0) break;
        const invWeights = active.map(idx=>{
          const rating = batted[idx].rating || 7.0;
          const style = styleProfiles[idx] || { wicketRisk: 1 };
          const pressureMul = 1 + pressureIndex * 0.26 + dotPressure * 0.14 + aggressionLevel * 0.24;
          const reliefMul = 1 - boundaryRelief * 0.08;
          return Math.max(0.12, (9.6 - rating) * style.wicketRisk * pressureMul * reliefMul);
        });
        const sumInv = invWeights.reduce((a,b)=>a+b,0) || 1;
        let rPick = Math.random() * sumInv;
        let outAt = 0;
        for(let i=0;i<invWeights.length;i++){
          rPick -= invWeights[i];
          if(rPick <= 0){ outAt = i; break; }
        }
        const outIdx = active[outAt];
        outSet.add(outIdx);
        active.splice(outAt, 1);
        if(nextIdx < battedCount){
          active.push(nextIdx);
          nextIdx++;
        }
      }

      const positionBoost = [1.22,1.18,1.12,1.05,0.98,0.9,0.82,0.75,0.7,0.68,0.66];
      const topCandidates = batted
        .map((p, idx)=>{
          const isInForm = isPlayerInForm(p.name, p.role);
          const sr = p.strikeRate || 132;
          const rating = p.rating || 7.0;
          const pos = positionBoost[idx] || 0.64;
          const phaseSkill = getPhaseSkill(p.name, idx);
          const style = styleProfiles[idx] || { runShare: 1 };
          const chaseIntentAdj = (chasePhaseIntent.pp + chasePhaseIntent.middle + chasePhaseIntent.death) / 3;
          const score = rating * 0.55 + sr / 120 + pos * 0.4 + (isInForm ? 0.95 : 0) + (phaseSkill.runMultiplier - 1) * 1.8 + (style.runShare - 1) * 2 + chaseIntentAdj * 0.38;
          return { idx, score };
        })
        .sort((a,b)=> b.score - a.score)
        .map(x=>x.idx);
      const anchorIdx = topCandidates[0] ?? 0;
      const secondAnchorIdx = topCandidates[1] ?? anchorIdx;
      const anchorBoost = inningsRuns >= 190 ? 1.9 : inningsRuns >= 170 ? 1.7 : inningsRuns >= 145 ? 1.5 : 1.3;
      const secondBoost = inningsRuns >= 170 ? 1.2 : 1.1;
      const anchorProfile = batted[anchorIdx] || {};
      const anchorInForm = isPlayerInForm(anchorProfile.name || "");
      const anchorSR = anchorProfile.strikeRate || 132;
      const centuryChance = inningsRuns >= 200
        ? (anchorInForm || anchorSR >= 155 ? 0.18 : 0.1)
        : inningsRuns >= 185
          ? (anchorInForm || anchorSR >= 150 ? 0.1 : 0.05)
          : 0;
      const centuryMode = Math.random() < centuryChance;

      const weights = batted.map((p, idx)=>{
        const base = Math.max(0.1, (p.rating || 7.0) - 6.2);
        const pos = positionBoost[idx] || 0.64;
        const stayBoost = outSet.has(idx) ? 0.86 : 1.18;
        const srBoost = Math.max(0.7, (p.strikeRate || 135) / 145);
        const formBoost = isPlayerInForm(p.name, p.role) ? 1.12 : 1;
        const phaseSkill = getPhaseSkill(p.name, idx);
        const style = styleProfiles[idx] || { runShare: 1 };
        const chaseIntent = idx <= 1 ? chasePhaseIntent.pp : (idx <= 5 ? chasePhaseIntent.middle : chasePhaseIntent.death);
        const chaseBoost = chaseContext ? (1 + Math.max(-0.12, chaseIntent * 0.12) + Math.max(0, pressureIndex - 0.3) * 0.05) : 1;
        const dayBoost = 0.82 + Math.random() * 0.4;
        let weight = Math.pow(base, 1.7) * pos * stayBoost * srBoost * formBoost * phaseSkill.runMultiplier * style.runShare * chaseBoost * dayBoost * (0.92 + Math.random() * 0.26);
        if(idx === anchorIdx) weight *= anchorBoost;
        if(idx === secondAnchorIdx) weight *= secondBoost;
        if(centuryMode && idx === anchorIdx) weight *= 1.22;
        return weight;
      });
      const totalW = weights.reduce((a,b)=>a+b,0) || 1;
      const runCaps = batted.map(p=>getPlayerCaps(p.name, p.role).maxRuns);
      const dynamicRunCaps = runCaps.map((cap, i)=>{
        const formAdj = isPlayerInForm(batted[i].name) ? 5 : 0;
        const variance = Math.round(randomNoise(8));
        return Math.max(24, Math.min(140, cap + formAdj + variance));
      });
      const runs = batted.map((_,i)=>Math.min(dynamicRunCaps[i], Math.max(0, Math.round((weights[i]/totalW) * totalRuns))));

      let allocated = runs.reduce((a,b)=>a+b,0);
      let loop = 0;
      while(allocated < totalRuns && loop < 5000){
        const idx = loop % battedCount;
        if(runs[idx] < dynamicRunCaps[idx]){ runs[idx]++; allocated++; }
        loop++;
      }
      loop = 0;
      while(allocated > totalRuns && loop < 5000){
        const idx = loop % battedCount;
        if(runs[idx] > 0){ runs[idx]--; allocated--; }
        loop++;
      }

      // Prevent one batter from repeatedly taking an unrealistic share.
      // Rebalance excess runs into other active top/middle-order batters.
      const shareCap = inningsRuns >= 185 ? 0.42 : inningsRuns >= 160 ? 0.39 : 0.36;
      const hardCap = Math.floor(inningsRuns * shareCap);
      for(let i=0; i<runs.length; i++){
        if(runs[i] <= hardCap) continue;
        let excess = runs[i] - hardCap;
        runs[i] = hardCap;
        allocated -= excess;
        for(let j=0; j<runs.length && excess > 0; j++){
          if(j === i) continue;
          const canTake = Math.max(0, (dynamicRunCaps[j] || 0) - runs[j]);
          if(canTake <= 0) continue;
          const give = Math.min(canTake, excess);
          runs[j] += give;
          excess -= give;
          allocated += give;
        }
      }

      // Ensure realistic milestones: regular 50+ and occasional 100+ in big totals.
      const topRunIdx = runs.reduce((best, val, idx)=> val > runs[best] ? idx : best, 0);
      const topCap = dynamicRunCaps[topRunIdx] || 0;
      const topBatter = batted[topRunIdx] || {};
      const topInForm = isPlayerInForm(topBatter.name || "");
      const topSR = topBatter.strikeRate || 132;
      const canForceFifty = inningsRuns >= 140 && topCap >= 55 && runs[topRunIdx] < 50;
      if(canForceFifty){
        const base50 = (topInForm || topSR >= 148) ? 56 : 50;
        const target50 = Math.min(topCap, Math.round(base50 + Math.random() * 24));
        let need = Math.max(0, target50 - runs[topRunIdx]);
        for(let i=battedCount - 1; i>=0 && need > 0; i--){
          if(i === topRunIdx) continue;
          const floor = outSet.has(i) ? 0 : 8;
          while(need > 0 && runs[i] > floor){
            runs[i]--;
            runs[topRunIdx]++;
            need--;
          }
        }
      }
      const centuryBoostChance = (topInForm || topSR >= 155) ? 0.14 : 0.08;
      const canForceCentury = inningsRuns >= 196 && topCap >= 100 && runs[topRunIdx] >= 74 && runs[topRunIdx] < 100 && Math.random() < centuryBoostChance;
      if(canForceCentury){
        const target100 = Math.min(topCap, Math.round(100 + Math.random() * 14));
        let need = Math.max(0, target100 - runs[topRunIdx]);
        for(let i=battedCount - 1; i>=0 && need > 0; i--){
          if(i === topRunIdx) continue;
          const floor = outSet.has(i) ? 0 : 6;
          while(need > 0 && runs[i] > floor){
            runs[i]--;
            runs[topRunIdx]++;
            need--;
          }
        }
      }

      const bowlerQueue = dismissalBowlers.slice();
      for(let i=bowlerQueue.length - 1; i>0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [bowlerQueue[i], bowlerQueue[j]] = [bowlerQueue[j], bowlerQueue[i]];
      }
      const outIndices = Array.from(outSet);
      for(let i=outIndices.length - 1; i>0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [outIndices[i], outIndices[j]] = [outIndices[j], outIndices[i]];
      }
      const runOutCount = Math.max(0, Math.min(outIndices.length, dismissalProfile.runOuts || 0));
      const runOutSet = new Set(outIndices.slice(0, runOutCount));
      const fielderPool = fielders.slice();
      function randomFrom(arr){ return arr[Math.floor(Math.random() * arr.length)] || ""; }
      function buildDismissalText(bowler, idx){
        const cleanBowler = bowler || "Unknown Bowler";
        const catchFielders = fielderPool.filter(f=>f && f !== cleanBowler);
        const fielder = randomFrom(catchFielders.length ? catchFielders : fielderPool) || "Unknown Fielder";
        if(runOutSet.has(idx)){
          const assist = randomFrom(catchFielders.length ? catchFielders : fielderPool) || "Unknown Fielder";
          return Math.random() < 0.32 ? `run out (${fielder}/${assist})` : `run out (${fielder})`;
        }
        const stumpingChance = clampValue((dismissalProfile.stumpingChance || 0.06) + dotPressure * 0.05, 0.04, 0.34);
        const r = Math.random();
        if(r < stumpingChance){
          return `st ${fielder} b ${cleanBowler}`;
        }
        if(r < 0.52 + pressureIndex * 0.07) return `c ${fielder} b ${cleanBowler}`;
        if(r < 0.8 + pressureIndex * 0.06) return `b ${cleanBowler}`;
        return `lbw b ${cleanBowler}`;
      }

      const resultBatted = batted.map((p, idx)=>{
        const r = runs[idx];
        const phaseSkill = getPhaseSkill(p.name, idx);
        const style = styleProfiles[idx] || { strikeAdj: 0, dotResist: 1 };
        const chaseIntent = idx <= 1 ? chasePhaseIntent.pp : (idx <= 5 ? chasePhaseIntent.middle : chasePhaseIntent.death);
        const pressureStrikeAdj = chaseContext ? (Math.max(0, chaseIntent) * 9 + boundaryRelief * 4 - dotPressure * 5) : 0;
        const aggressionStrikeAdj = aggressionLevel * 7;
        const strikeBase = Math.max(68, (p.strikeRate || 132) + (p.rating - 7.0) * 5 + phaseSkill.strikeAdj + style.strikeAdj + pressureStrikeAdj + aggressionStrikeAdj);
        const dotImpact = chaseContext ? (1 + dotPressure * 0.2 - boundaryRelief * 0.1) : 1;
        const computedBalls = r === 0 ? (outSet.has(idx) ? 1 : 0) : Math.max(1, Math.round(((r * 100) / strikeBase) * dotImpact + randomNoise(3)));
        const dismissalBallBonus = outSet.has(idx) ? 1 : 0;
        const balls = Math.max(outSet.has(idx) ? 1 : 0, computedBalls + dismissalBallBonus);
        const freeHitBonus = extrasInfo && extrasInfo.freeHitBalls ? Math.max(0, Math.round((extrasInfo.freeHitBalls * (style.tag === "aggressor" || style.tag === "pinch" ? 0.32 : 0.2)) + randomNoise(0.6))) : 0;
        let sixes = Math.max(0, Math.floor((r / 28) + freeHitBonus * 0.5 + Math.max(0, pressureStrikeAdj) * 0.05 + randomNoise(0.8)));
        let fours = Math.max(0, Math.floor((r - sixes * 6) / 4));
        while((fours * 4 + sixes * 6) > r){
          if(fours > 0) fours--;
          else if(sixes > 0) sixes--;
          else break;
        }
        const SR = balls > 0 ? Math.round((r / balls) * 1000) / 10 : 0;
        let outDesc = "NOT OUT";
        if(outSet.has(idx)){
          const bowler = runOutSet.has(idx) ? null : (bowlerQueue.shift() || dismissalBowlers[0] || "Unknown Bowler");
          outDesc = buildDismissalText(bowler, idx);
        }
        return { name: p.name, runs: r, balls, fours, sixes, SR, outDesc, rating: p.rating };
      });

      const resultDNB = dnb.map(p=>({ name: p.name, runs: 0, balls: 0, fours: 0, sixes: 0, SR: 0, outDesc: "DNB", rating: p.rating }));
      return [...resultBatted, ...resultDNB];
    }

    function formatOversFromBalls(totalBalls){
      const safeBalls = Math.max(0, Math.round(totalBalls || 0));
      const ov = Math.floor(safeBalls / 6);
      const balls = safeBalls % 6;
      return balls === 0 ? `${ov}` : `${ov}.${balls}`;
    }

    function estimateInningsBalls(totalRuns, wickets, { isChase = false, chaseWon = false, chaseContext = null, chaseTarget = 0 } = {}){
      const pressure = chaseContext ? clampValue(chaseContext.pressureIndex || 0, 0, 1.6) : 0;
      const dotPressure = chaseContext ? clampValue(chaseContext.dotPressure || 0, 0, 1) : 0;
      const boundaryRelief = chaseContext ? clampValue(chaseContext.boundaryRelief || 0, 0, 1) : 0;
      if(isChase && chaseWon){
        const chaseDifficulty = chaseTarget > 0 ? clampValue((chaseTarget - 170) / 60, -0.6, 1) : 0;
        const runRate = Math.max(7.1, Math.min(14.2, 8.9 + boundaryRelief * 1.7 + pressure * 0.7 - dotPressure * 0.8 + chaseDifficulty * 0.35 + randomNoise(1.9)));
        let balls = Math.round((Math.max(1, totalRuns) * 6) / runRate + randomNoise(5));
        balls = Math.max(12, Math.min(119, balls));
        return balls;
      }
      if(isChase && !chaseWon){
        const deficit = chaseTarget > 0 ? Math.max(0, chaseTarget - totalRuns) : 0;
        if(wickets >= 8 && (pressure > 0.7 || deficit >= 20 || Math.random() < 0.45)){
          let balls = Math.round(102 + randomNoise(12) + pressure * 7 - Math.min(24, deficit * 0.3));
          balls = Math.max(72, Math.min(120, balls));
          return balls;
        }
        if(deficit >= 30 && Math.random() < 0.2){
          let balls = Math.round(110 + randomNoise(8));
          balls = Math.max(84, Math.min(120, balls));
          return balls;
        }
      }
      if(wickets >= 10){
        const collapseFactor = Math.max(0, Math.min(1, (188 - totalRuns) / 110));
        let balls = Math.round(120 - collapseFactor * 30 + randomNoise(6));
        balls = Math.max(72, Math.min(120, balls));
        return balls;
      }
      return 120;
    }

    // distribute wickets across bowlers with per-player wicket caps and exact wicket total.
    function distributeBowling(opponentBowling, totalRuns, totalWickets, inningsBalls = 120, bowlingPlan = null, options = {}){
      const bowlers = opponentBowling.slice(0,6);
      if(bowlers.length === 0){
        return { card: [], dismissalBowlers: [] };
      }
      const pitchType = options && options.conditions && options.conditions.pitch ? options.conditions.pitch : "balanced";
      function getPitchMods(name, role){
        const isSpin = isSpinBowlingRole(role, name);
        const isPace = isPaceBowlingRole(role, name) || (!isSpin && isSpecialistBowlingRole(role));
        let econMul = 1;
        let wicketMul = 1;
        let selectionBoost = 0;
        if(pitchType === "spin"){
          if(isSpin){ econMul = 0.9; wicketMul = 1.22; selectionBoost = 0.45; }
          else if(isPace){ econMul = 1.08; wicketMul = 0.9; selectionBoost = -0.2; }
        } else if(pitchType === "pace"){
          if(isPace){ econMul = 0.9; wicketMul = 1.2; selectionBoost = 0.45; }
          else if(isSpin){ econMul = 1.08; wicketMul = 0.9; selectionBoost = -0.2; }
        }
        return { econMul, wicketMul, selectionBoost };
      }
      const ballsTotal = Math.max(1, Math.min(120, Math.round(inningsBalls)));
      const fullOvers = Math.floor(ballsTotal / 6);
      const remBalls = ballsTotal % 6;
      const specialistIdx = bowlers
        .map((b, idx)=>({ idx, role: b.role || "BOWL" }))
        .filter(x=>isSpecialistBowlingRole(x.role))
        .map(x=>x.idx);
      const specialistSet = new Set(specialistIdx);
      const ranked = bowlers
        .map((b, idx)=>{
          const name = b.playerName || b.name;
          const role = b.role || "BOWL";
          const rating = getPlayerRating(name, role);
          const formBoost = isPlayerInForm(name, role) ? 0.7 : 0;
          const roleBoost = isSpecialistBowlingRole(role) ? 2.9 : isAllRounderRole(role) ? 0.75 : 0.25;
          return { idx, role, rating, score: roleBoost + rating + formBoost };
        })
        .sort((a,b)=> b.score - a.score);

      let activeCountBase = fullOvers >= 18 ? 5 : fullOvers >= 14 ? 5 : 4;
      if(fullOvers >= 18 && ranked.length >= 6 && Math.random() < 0.26){
        activeCountBase = 6;
      }
      const minNeeded = Math.max(1, Math.ceil(fullOvers / 4));
      const activeCount = Math.min(ranked.length, Math.max(minNeeded, activeCountBase));
      const activeIdx = ranked.slice(0, activeCount).map(x=>x.idx);
      const planNames = Array.isArray(bowlingPlan) ? bowlingPlan.filter(Boolean) : [];
      planNames.forEach(name=>{
        const idx = bowlers.findIndex(b=>(b.playerName || b.name) === name);
        if(idx >= 0 && !activeIdx.includes(idx)) activeIdx.push(idx);
      });
      while(activeIdx.length > 6) activeIdx.pop();
      const activeBowlers = activeIdx.map(i=>bowlers[i]);
      const activeSpecialistCount = activeIdx.filter(i=>specialistSet.has(i)).length;
      const specialistQuotaBalls = Math.min(
        ballsTotal,
        Math.floor(ballsTotal * 0.8),
        activeSpecialistCount * 24
      );
      const phaseRank = activeBowlers
        .map((b, i)=>{
          const name = b.playerName || b.name;
          const role = b.role || "BOWL";
          const rating = getPlayerRating(name, role);
          const wicketSkill = getWicketSkill(name, role);
          const pitchMods = getPitchMods(name, role);
          const formBoost = isPlayerInForm(name, role) ? 0.25 : 0;
          const ppNamed = POWERPLAY_SPECIALISTS[name] || 0;
          const middleNamed = MIDDLE_OVERS_SPECIALISTS[name] || 0;
          const deathNamed = DEATH_SPECIALISTS[name] || 0;
          return {
            idx: i,
            openScore: rating + (isSpecialistBowlingRole(role) ? 1.2 : 0.35) + formBoost + ppNamed + pitchMods.selectionBoost,
            middleScore: rating * 0.84 + wicketSkill * 4.3 + (isSpecialistBowlingRole(role) ? 0.95 : 0.2) + formBoost + middleNamed + pitchMods.selectionBoost,
            deathScore: rating * 0.72 + wicketSkill * 6.5 + (isSpecialistBowlingRole(role) ? 1.0 : 0.2) + formBoost + deathNamed + pitchMods.selectionBoost
          };
        });
      const openOrder = phaseRank.slice().sort((a,b)=> b.openScore - a.openScore);
      const middleOrder = phaseRank.slice().sort((a,b)=> b.middleScore - a.middleScore);
      const deathOrder = phaseRank.slice().sort((a,b)=> b.deathScore - a.deathScore);
      const openingPref = new Set(openOrder.slice(0, Math.min(2, openOrder.length)).map(x=>x.idx));
      const middlePref = new Set(middleOrder.slice(0, Math.min(3, middleOrder.length)).map(x=>x.idx));
      const deathPref = new Set(deathOrder.slice(0, Math.min(2, deathOrder.length)).map(x=>x.idx));

      const ballsByBowler = activeBowlers.map(()=>0);
      let lastBowlerIdx = -1;
      let lastBowlerStreak = 0;
      let specialistBallsUsed = 0;
      for(let o=0; o<fullOvers; o++){
        const plannedName = Array.isArray(bowlingPlan) ? bowlingPlan[o] : "";
        if(plannedName){
          const plannedIdx = activeBowlers.findIndex(b=>(b.playerName || b.name) === plannedName);
          if(plannedIdx >= 0 && ballsByBowler[plannedIdx] + 6 <= 24){
            ballsByBowler[plannedIdx] += 6;
            if(isSpecialistBowlingRole(activeBowlers[plannedIdx].role || "BOWL")) specialistBallsUsed += 6;
            if(plannedIdx === lastBowlerIdx) lastBowlerStreak++;
            else { lastBowlerIdx = plannedIdx; lastBowlerStreak = 1; }
            continue;
          }
        }
        const isPowerplay = o < Math.min(6, fullOvers);
        const isDeath = o >= Math.max(0, fullOvers - 4);
        const isMiddle = !isPowerplay && !isDeath;
        let bestIdx = -1;
        let bestScore = -Infinity;
        for(let i=0; i<activeBowlers.length; i++){
          if(ballsByBowler[i] >= 24) continue;
          const b = activeBowlers[i];
          const role = b.role || "BOWL";
          const name = b.playerName || b.name;
          const rating = getPlayerRating(name, role);
          const pitchMods = getPitchMods(name, role);
          const formBoost = isPlayerInForm(name, role) ? 0.45 : 0;
          const roleWeight = isSpecialistBowlingRole(role) ? 1.7 : isAllRounderRole(role) ? 1.0 : 0.65;
          const ppNamed = POWERPLAY_SPECIALISTS[name] || 0;
          const middleNamed = MIDDLE_OVERS_SPECIALISTS[name] || 0;
          const deathNamed = DEATH_SPECIALISTS[name] || 0;
          const oversUsed = ballsByBowler[i] / 6;
          let phaseBoost = 0;
          const isSpecialist = isSpecialistBowlingRole(role);
          const specialistNeed = specialistQuotaBalls - specialistBallsUsed;
          const mustPushSpecialist = specialistNeed >= 6;
          if(isPowerplay){
            if(openingPref.has(i)) phaseBoost += 0.75;
            if(isSpecialistBowlingRole(role)) phaseBoost += 0.2;
            phaseBoost += ppNamed * 0.9;
          } else if(isMiddle){
            if(middlePref.has(i)) phaseBoost += 0.65;
            if(isSpecialistBowlingRole(role)) phaseBoost += 0.14;
            phaseBoost += middleNamed * 0.95;
          } else if(isDeath){
            if(deathPref.has(i)) phaseBoost += 0.95;
            if(isSpecialistBowlingRole(role)) phaseBoost += 0.2;
            phaseBoost += deathNamed * 0.95;
          } else {
            if(isAllRounderRole(role)) phaseBoost += 0.12;
          }
          phaseBoost += pitchMods.selectionBoost;
          if(mustPushSpecialist){
            phaseBoost += isSpecialist ? 2.15 : -1.7;
          } else if(isSpecialist){
            phaseBoost += 0.35;
          }
          const repeatPenalty = (i === lastBowlerIdx && lastBowlerStreak >= 2 && activeBowlers.length > 1) ? 1.25 : 0;
          const score = roleWeight * (1 + rating / 12) + formBoost + phaseBoost - (oversUsed * 0.38) - repeatPenalty + randomNoise(0.08);
          if(score > bestScore){
            bestScore = score;
            bestIdx = i;
          }
        }
        if(bestIdx === -1) break;
        ballsByBowler[bestIdx] += 6;
        if(isSpecialistBowlingRole(activeBowlers[bestIdx].role || "BOWL")){
          specialistBallsUsed += 6;
        }
        if(bestIdx === lastBowlerIdx){
          lastBowlerStreak++;
        } else {
          lastBowlerIdx = bestIdx;
          lastBowlerStreak = 1;
        }
      }

      if(remBalls > 0){
        const remPlannedName = Array.isArray(bowlingPlan) ? bowlingPlan[fullOvers] : "";
        if(remPlannedName){
          const plannedIdx = activeBowlers.findIndex(b=>(b.playerName || b.name) === remPlannedName);
          if(plannedIdx >= 0 && ballsByBowler[plannedIdx] + remBalls <= 24){
            ballsByBowler[plannedIdx] += remBalls;
            if(isSpecialistBowlingRole(activeBowlers[plannedIdx].role || "BOWL")) specialistBallsUsed += remBalls;
          } else {
            let bestIdx = -1;
            let bestScore = -Infinity;
            for(let i=0; i<activeBowlers.length; i++){
              if(ballsByBowler[i] + remBalls > 24) continue;
              const b = activeBowlers[i];
              const role = b.role || "BOWL";
              const name = b.playerName || b.name;
              const rating = getPlayerRating(name, role);
              const pitchMods = getPitchMods(name, role);
              const formBoost = isPlayerInForm(name, role) ? 0.4 : 0;
              const roleWeight = isSpecialistBowlingRole(role) ? 1.6 : isAllRounderRole(role) ? 1.0 : 0.65;
              const deathNamed = DEATH_SPECIALISTS[name] || 0;
              const specialistNeed = specialistQuotaBalls - specialistBallsUsed;
              const mustPushSpecialist = specialistNeed >= remBalls;
              const isSpecialist = isSpecialistBowlingRole(role);
              let phaseBoost = (deathPref.has(i) ? 0.8 : 0) + deathNamed * 0.9;
              if(mustPushSpecialist){
                phaseBoost += isSpecialist ? 1.8 : -1.4;
              } else if(isSpecialist){
                phaseBoost += 0.25;
              }
              phaseBoost += pitchMods.selectionBoost;
              const repeatPenalty = (i === lastBowlerIdx && lastBowlerStreak >= 2 && activeBowlers.length > 1) ? 1.2 : 0;
              const score = roleWeight * (1 + rating / 12) + formBoost + phaseBoost - (ballsByBowler[i] / 18) - repeatPenalty;
              if(score > bestScore){
                bestScore = score;
                bestIdx = i;
              }
            }
            if(bestIdx === -1) bestIdx = 0;
            ballsByBowler[bestIdx] += remBalls;
            if(isSpecialistBowlingRole(activeBowlers[bestIdx].role || "BOWL")){
              specialistBallsUsed += remBalls;
            }
          }
        } else {
        let bestIdx = -1;
        let bestScore = -Infinity;
        for(let i=0; i<activeBowlers.length; i++){
          if(ballsByBowler[i] + remBalls > 24) continue;
          const b = activeBowlers[i];
          const role = b.role || "BOWL";
          const name = b.playerName || b.name;
          const rating = getPlayerRating(name, role);
          const pitchMods = getPitchMods(name, role);
          const formBoost = isPlayerInForm(name, role) ? 0.4 : 0;
          const roleWeight = isSpecialistBowlingRole(role) ? 1.6 : isAllRounderRole(role) ? 1.0 : 0.65;
          const deathNamed = DEATH_SPECIALISTS[name] || 0;
          const specialistNeed = specialistQuotaBalls - specialistBallsUsed;
          const mustPushSpecialist = specialistNeed >= remBalls;
          const isSpecialist = isSpecialistBowlingRole(role);
          let phaseBoost = (deathPref.has(i) ? 0.8 : 0) + deathNamed * 0.9;
          if(mustPushSpecialist){
            phaseBoost += isSpecialist ? 1.8 : -1.4;
          } else if(isSpecialist){
            phaseBoost += 0.25;
          }
          phaseBoost += pitchMods.selectionBoost;
          const repeatPenalty = (i === lastBowlerIdx && lastBowlerStreak >= 2 && activeBowlers.length > 1) ? 1.2 : 0;
          const score = roleWeight * (1 + rating / 12) + formBoost + phaseBoost - (ballsByBowler[i] / 18) - repeatPenalty;
          if(score > bestScore){
            bestScore = score;
            bestIdx = i;
          }
        }
        if(bestIdx === -1) bestIdx = 0;
        ballsByBowler[bestIdx] += remBalls;
        if(isSpecialistBowlingRole(activeBowlers[bestIdx].role || "BOWL")){
          specialistBallsUsed += remBalls;
        }
        }
      }

      // allocate runs conceded using bowler economy profile and overs
      const baseRunsAlloc = activeBowlers.map((b, i)=>{
        const name = b.playerName || b.name;
        const role = b.role || "BOWL";
        const pitchMods = getPitchMods(name, role);
        const ppNamed = POWERPLAY_SPECIALISTS[name] || 0;
        const middleNamed = MIDDLE_OVERS_SPECIALISTS[name] || 0;
        const deathNamed = DEATH_SPECIALISTS[name] || 0;
        const specialistAdj = Math.max(-0.2, Math.min(0.22, (ppNamed + middleNamed + deathNamed) * 0.035));
        const econ = getBowlingEconomy(name, role) * pitchMods.econMul * (1 - specialistAdj);
        const oversBowled = ballsByBowler[i] / 6;
        const noise = isSpecialistBowlingRole(role) ? 2.0 : 2.4;
        return Math.max(0, (oversBowled * econ) + randomNoise(noise));
      });
      const baseSum = baseRunsAlloc.reduce((a,b)=>a+b,0) || 1;
      const scale = totalRuns / baseSum;
      const runsAlloc = baseRunsAlloc.map(v=>Math.max(0, Math.round(v * scale)));
      let runsSum = runsAlloc.reduce((a,b)=>a+b,0);
      // adjust runs sum to totalRuns
      let k = 0;
      while(runsSum !== totalRuns){
        const idx = k % Math.max(1, runsAlloc.length);
        if(runsSum < totalRuns){ runsAlloc[idx]++; runsSum++; }
        else { if(runsAlloc[idx] > 0){ runsAlloc[idx]--; runsSum--; } }
        k++;
        if(k>500) break;
      }

      // Keep elite/specialist bowlers economical more often.
      // If they exceed a soft cap, shift extra runs to weaker bowlers.
      const capsByBowler = activeBowlers.map((b, i)=>{
        const name = b.playerName || b.name;
        const role = b.role || "BOWL";
        const balls = ballsByBowler[i];
        const overs = balls / 6;
        const pitchMods = getPitchMods(name, role);
        const ppNamed = POWERPLAY_SPECIALISTS[name] || 0;
        const middleNamed = MIDDLE_OVERS_SPECIALISTS[name] || 0;
        const deathNamed = DEATH_SPECIALISTS[name] || 0;
        const specialistAdj = Math.max(-0.2, Math.min(0.22, (ppNamed + middleNamed + deathNamed) * 0.03));
        const baseEcon = getBowlingEconomy(name, role) * pitchMods.econMul * (1 - specialistAdj);
        const wicketSkill = getWicketSkill(name, role);
        const elite = isSpecialistBowlingRole(role) && (baseEcon <= 7.0 || wicketSkill >= 1.75);
        const econSoftCap = elite ? (baseEcon + 0.95) : (baseEcon + 1.8);
        const maxRuns = Math.max(0, Math.round(overs * econSoftCap));
        return { maxRuns, elite };
      });
      let shiftGuard = 0;
      for(let i=0; i<runsAlloc.length && shiftGuard < 800; i++){
        const cap = capsByBowler[i].maxRuns;
        if(runsAlloc[i] <= cap) continue;
        let excess = runsAlloc[i] - cap;
        runsAlloc[i] = cap;
        runsSum -= excess;
        for(let j=0; j<runsAlloc.length && excess > 0; j++){
          if(j === i) continue;
          const rName = activeBowlers[j].playerName || activeBowlers[j].name;
          const rRole = activeBowlers[j].role || "BOWL";
          const rBalls = ballsByBowler[j];
          const rOvers = rBalls / 6;
          const rPitch = getPitchMods(rName, rRole);
          const rPP = POWERPLAY_SPECIALISTS[rName] || 0;
          const rMiddle = MIDDLE_OVERS_SPECIALISTS[rName] || 0;
          const rDeath = DEATH_SPECIALISTS[rName] || 0;
          const rSpecAdj = Math.max(-0.2, Math.min(0.22, (rPP + rMiddle + rDeath) * 0.03));
          const rBase = getBowlingEconomy(rName, rRole) * rPitch.econMul * (1 - rSpecAdj);
          const rSkill = getWicketSkill(rName, rRole);
          const rElite = isSpecialistBowlingRole(rRole) && (rBase <= 7.0 || rSkill >= 1.75);
          const receiverCap = Math.round(rOvers * (rBase + (rElite ? 1.7 : 3.1)));
          const room = Math.max(0, receiverCap - runsAlloc[j]);
          if(room <= 0) continue;
          const move = Math.min(room, excess);
          runsAlloc[j] += move;
          excess -= move;
          runsSum += move;
        }
        while(excess > 0){
          const idx = Math.floor(Math.random() * runsAlloc.length);
          if(idx === i){ shiftGuard++; if(shiftGuard > 800) break; continue; }
          runsAlloc[idx]++;
          excess--;
          runsSum++;
          shiftGuard++;
          if(shiftGuard > 800) break;
        }
      }
      const caps = activeBowlers.map((b, i)=>{
        const hardCap = Math.min(4, getPlayerCaps(b.playerName || b.name, b.role || "BOWL").maxWickets);
        const oversBowled = ballsByBowler[i] / 6;
        const oversBasedCap = Math.min(4, Math.max(1, Math.ceil(oversBowled * 1.25)));
        return Math.min(hardCap, oversBasedCap);
      });
      const wk = activeBowlers.map(()=>0);
      let remaining = Math.max(0, Math.min(totalWickets, 10));
      let guard = 0;
      while(remaining > 0 && guard < 500){
        guard++;
        const weights = activeBowlers.map((b, i)=>{
          if(wk[i] >= caps[i]) return 0;
          const name = b.playerName || b.name;
          const role = b.role || "BOWL";
          const r = getPlayerRating(name, role);
          const wicketSkill = getWicketSkill(name, role);
          const pitchMods = getPitchMods(name, role);
          const ppNamed = POWERPLAY_SPECIALISTS[name] || 0;
          const middleNamed = MIDDLE_OVERS_SPECIALISTS[name] || 0;
          const deathNamed = DEATH_SPECIALISTS[name] || 0;
          const phaseSkillAdj = Math.max(-0.15, Math.min(0.3, (ppNamed + middleNamed + deathNamed) * 0.06));
          const roleBoost = isSpecialistBowlingRole(b.role) ? 1.5 : 0.96;
          const oversBowled = ballsByBowler[i] / 6;
          const formBoost = isPlayerInForm(name) ? 1.08 : 1;
          const skillBoost = Math.pow(Math.max(0.8, wicketSkill), 1.22);
          return Math.max(0.05, (r - 6.2) * roleBoost * skillBoost * formBoost * pitchMods.wicketMul * (1 + phaseSkillAdj) * Math.max(0.4, oversBowled / 3.2));
        });
        const totalWeight = weights.reduce((a,b)=>a+b,0);
        if(totalWeight <= 0){
          // Fallback: force-assign remaining wickets to best available bowler.
          let best = 0;
          let bestScore = -Infinity;
          for(let i=0;i<activeBowlers.length;i++){
            if(wk[i] >= caps[i]) continue;
            const nm = activeBowlers[i].playerName || activeBowlers[i].name;
            const rl = activeBowlers[i].role || "BOWL";
            const r = getPlayerRating(nm, rl);
            const w = getWicketSkill(nm, rl);
            const score = r + w * 2.1 + (isSpecialistBowlingRole(rl) ? 1 : 0);
            if(score > bestScore){ bestScore = score; best = i; }
          }
          if(bestScore === -Infinity) break;
          wk[best]++;
          remaining--;
          continue;
        }
        let pick = Math.random() * totalWeight;
        let chosen = 0;
        for(let i=0;i<weights.length;i++){
          pick -= weights[i];
          if(pick <= 0){ chosen = i; break; }
        }
        wk[chosen]++;
        remaining--;
      }
      if(totalWickets >= 5){
        const eliteOrder = activeBowlers
          .map((b, i)=>{
            const name = b.playerName || b.name;
            const role = b.role || "BOWL";
            const overs = ballsByBowler[i] / 6;
            const econ = getBowlingEconomy(name, role);
            const skill = getWicketSkill(name, role);
            const eliteScore = skill * 2.3 + (isSpecialistBowlingRole(role) ? 1.2 : 0.1) + (econ <= 7.2 ? 0.7 : 0) + overs * 0.12;
            return { i, role, overs, eliteScore };
          })
          .sort((a,b)=> b.eliteScore - a.eliteScore);
        const topElite = eliteOrder[0];
        if(topElite && topElite.overs >= 3 && wk[topElite.i] === 0 && wk[topElite.i] < caps[topElite.i] && Math.random() < 0.72){
          let donor = -1;
          let donorScore = -Infinity;
          for(let i=0; i<wk.length; i++){
            if(i === topElite.i || wk[i] <= 0) continue;
            const dRole = activeBowlers[i].role || "BOWL";
            const dSkill = getWicketSkill(activeBowlers[i].playerName || activeBowlers[i].name, dRole);
            const score = wk[i] + (isAllRounderRole(dRole) ? 0.4 : 0) - dSkill;
            if(score > donorScore){ donorScore = score; donor = i; }
          }
          if(donor >= 0){
            wk[donor]--;
            wk[topElite.i]++;
          }
        }
      }
      // Reward wicket-takers with tighter final run figures and move the released
      // runs into weaker or lower-impact spells.
      for(let i=0; i<runsAlloc.length; i++){
        if((wk[i] || 0) <= 0) continue;
        const name = activeBowlers[i].playerName || activeBowlers[i].name;
        const role = activeBowlers[i].role || "BOWL";
        const oversBowled = ballsByBowler[i] / 6;
        if(oversBowled <= 0) continue;
        const baseEcon = getBowlingEconomy(name, role);
        const wicketSkill = getWicketSkill(name, role);
        const elite = isSpecialistBowlingRole(role) && (baseEcon <= 7.4 || wicketSkill >= 1.75);
        const wicketDiscount = (wk[i] || 0) * (elite ? 2.4 : 1.6);
        const floorRuns = Math.max(Math.round(oversBowled * (elite ? 4.8 : 5.4)), wk[i] * 2);
        const targetRuns = Math.max(floorRuns, Math.round(oversBowled * baseEcon - wicketDiscount));
        if(runsAlloc[i] <= targetRuns) continue;
        let excess = runsAlloc[i] - targetRuns;
        runsAlloc[i] = targetRuns;
        for(let j=0; j<runsAlloc.length && excess > 0; j++){
          if(j === i) continue;
          const receiverName = activeBowlers[j].playerName || activeBowlers[j].name;
          const receiverRole = activeBowlers[j].role || "BOWL";
          const receiverOvers = ballsByBowler[j] / 6;
          if(receiverOvers <= 0) continue;
          const receiverBase = getBowlingEconomy(receiverName, receiverRole);
          const receiverSkill = getWicketSkill(receiverName, receiverRole);
          const receiverElite = isSpecialistBowlingRole(receiverRole) && (receiverBase <= 7.2 || receiverSkill >= 1.7);
          const receiverCap = Math.round(receiverOvers * (receiverBase + (receiverElite ? 2.1 : 4.1)));
          const receiverRoom = Math.max(0, receiverCap - runsAlloc[j]);
          if(receiverRoom <= 0) continue;
          const move = Math.min(receiverRoom, excess);
          runsAlloc[j] += move;
          excess -= move;
        }
        while(excess > 0){
          const receiverIdx = Math.floor(Math.random() * runsAlloc.length);
          if(receiverIdx === i) continue;
          runsAlloc[receiverIdx]++;
          excess--;
        }
      }
      // Final realism pass: keep per-over run rates within plausible bounds and
      // reward wicket-taking spells with slightly tighter run ceilings.
      const hardCapsByBowler = activeBowlers.map((b, idx)=>{
        const name = b.playerName || b.name;
        const role = b.role || "BOWL";
        const oversBowled = ballsByBowler[idx] / 6;
        const wicketsTaken = wk[idx] || 0;
        const baseEcon = getBowlingEconomy(name, role);
        const wicketSkill = getWicketSkill(name, role);
        const elite = isSpecialistBowlingRole(role) && (baseEcon <= 7.3 || wicketSkill >= 1.6);
        const absoluteCapPerOver = elite ? 13.5 : 15.5;
        const baseCap = oversBowled * absoluteCapPerOver;
        const wicketDiscount = wicketsTaken * (elite ? 1.9 : 1.3);
        const minCap = oversBowled <= 1 ? 7 : oversBowled * 6;
        return Math.max(minCap, Math.round(baseCap - wicketDiscount));
      });
      let redistributeGuard = 0;
      for(let i=0; i<runsAlloc.length && redistributeGuard < 1000; i++){
        const hardCap = hardCapsByBowler[i];
        if(runsAlloc[i] <= hardCap) continue;
        let excess = runsAlloc[i] - hardCap;
        runsAlloc[i] = hardCap;
        for(let j=0; j<runsAlloc.length && excess > 0; j++){
          if(j === i) continue;
          const receiverOvers = ballsByBowler[j] / 6;
          const receiverCap = Math.max(
            receiverOvers <= 1 ? 10 : receiverOvers * 7,
            Math.round(receiverOvers * 17.5)
          );
          const receiverRoom = Math.max(0, receiverCap - runsAlloc[j]);
          if(receiverRoom <= 0) continue;
          const move = Math.min(receiverRoom, excess);
          runsAlloc[j] += move;
          excess -= move;
        }
        while(excess > 0 && redistributeGuard < 1000){
          const idx = Math.floor(Math.random() * runsAlloc.length);
          if(idx === i){ redistributeGuard++; continue; }
          const receiverOvers = ballsByBowler[idx] / 6;
          const receiverCap = Math.max(
            receiverOvers <= 1 ? 10 : receiverOvers * 7,
            Math.round(receiverOvers * 17.5)
          );
          if(runsAlloc[idx] < receiverCap){
            runsAlloc[idx]++;
            excess--;
          }
          redistributeGuard++;
        }
      }
      // now build final array
      const result = activeBowlers.map((b,idx) => {
        const ballsBowled = ballsByBowler[idx];
        const r = Math.max(0, runsAlloc[idx]);
        const wickets = Math.max(0, Math.min(4, wk[idx], caps[idx]));
        const maxMaiden = Math.floor(ballsBowled / 6);
        const maidens = maxMaiden > 0 && Math.random() > 0.92 ? 1 : 0;
        const econ = ballsBowled > 0 ? Math.round((r * 6 / ballsBowled) * 10) / 10 : 0;
        return { name: b.playerName || b.name, overs: formatOversFromBalls(ballsBowled), maidens, runs: r, wickets, econ };
      });
      const dismissalBowlers = [];
      result.forEach(b=>{
        for(let i=0;i<b.wickets;i++) dismissalBowlers.push(b.name);
      });
      return { card: result, dismissalBowlers };
    }

    function generateScorecardForMatch(teamAObj, teamBObj, scoreA, scoreB, tossInfo, idxA, idxB, conditions = null){
      const xiA = getOrderedXI(teamAObj);
      const xiB = getOrderedXI(teamBObj);
      const squadMapA = new Map(teamAObj.squad.map(p=>[p.playerName,p]));
      const squadMapB = new Map(teamBObj.squad.map(p=>[p.playerName,p]));
      const battingEntriesA = xiA.slice(0,11).map(name=>{
        const p = squadMapA.get(name) || {playerName:name, role:"BAT"};
        return { name, role:p.role, rating:getPlayerRating(name,p.role), strikeRate:getBatStrikeRate(name, p.role) };
      });
      const battingEntriesB = xiB.slice(0,11).map(name=>{
        const p = squadMapB.get(name) || {playerName:name, role:"BAT"};
        return { name, role:p.role, rating:getPlayerRating(name,p.role), strikeRate:getBatStrikeRate(name, p.role) };
      });

      // approximate batting & bowling strengths as average ratings of XI batters and bowlers
      const battingStrengthA = battingEntriesA.reduce((acc, p)=> acc + p.rating, 0) / Math.max(1, battingEntriesA.length);
      const battingStrengthB = battingEntriesB.reduce((acc, p)=> acc + p.rating, 0) / Math.max(1, battingEntriesB.length);
      const bowlersA = getBowlingAttack(teamAObj);
      const bowlersB = getBowlingAttack(teamBObj);
      const styleA = getSpinPaceStrength(bowlersA);
      const styleB = getSpinPaceStrength(bowlersB);
      function pitchStyleBoost(style){
        if(!conditions || !conditions.pitch) return 0;
        if(conditions.pitch === "spin") return (style.spin - style.pace) * 0.08;
        if(conditions.pitch === "pace") return (style.pace - style.spin) * 0.08;
        return 0;
      }
      const bowlingStrengthA = (bowlersA.reduce((acc,b)=> acc + (getPlayerRating(b.playerName||b.name, b.role)||7.0),0) / Math.max(1, bowlersA.length));
      const bowlingStrengthB = (bowlersB.reduce((acc,b)=> acc + (getPlayerRating(b.playerName||b.name, b.role)||7.0),0) / Math.max(1, bowlersB.length));
      const firstIsA = tossInfo && tossInfo.battingFirstIdx === idxA;

      const firstProjected = firstIsA ? scoreA : scoreB;
      const firstBattingEntries = firstIsA ? battingEntriesA : battingEntriesB;
      const firstBattingStrength = firstIsA ? battingStrengthA : battingStrengthB;
      const firstBowlingStrength = firstIsA ? bowlingStrengthB : bowlingStrengthA;
      const firstOppBowling = (firstIsA ? bowlersB : bowlersA).map(b=> ({ playerName: b.playerName || b.name, role: b.role }));
      const firstBowlingPlan = firstIsA ? (teamBObj.playing && teamBObj.playing.bowlingPlan) : (teamAObj.playing && teamAObj.playing.bowlingPlan);
      const firstFielders = firstIsA ? xiB.slice(0,11) : xiA.slice(0,11);
      const firstBowlingStyle = firstIsA ? styleB : styleA;
      const firstAggression = clampValue((firstProjected / 20 - 7.6) / 3 + (conditions && conditions.boundary === "small" ? 0.12 : 0) + randomNoise(0.09), 0, 1.2);
      let firstWickets = decideWickets(firstProjected, firstBattingStrength, firstBowlingStrength + pitchStyleBoost(firstBowlingStyle));
      if(firstAggression > 0.52 && Math.random() < (0.35 + firstAggression * 0.3)){
        firstWickets = Math.min(10, firstWickets + 1);
      }
      const firstBalls = estimateInningsBalls(firstProjected, firstWickets);
      const firstDismissalProfile = buildDismissalProfile(firstWickets, { conditions, isChase: false, inningsBalls: firstBalls });
      const firstExtras = generateInningsExtras(firstProjected, firstBalls, { conditions, isChase: false });
      const firstBatterRunsTarget = Math.max(0, firstProjected - firstExtras.total);
      const firstBowlerRunsTarget = Math.max(0, firstProjected - (firstExtras.b + firstExtras.lb));
      const firstBowlerWickets = Math.max(0, firstWickets - firstDismissalProfile.runOuts);
      const firstBowlRes = distributeBowling(firstOppBowling, firstBowlerRunsTarget, firstBowlerWickets, firstBalls, firstBowlingPlan, { conditions });
      const firstBat = distributeRunsAmongBatters(firstBattingEntries, firstBatterRunsTarget, firstWickets, firstBowlRes.dismissalBowlers, firstFielders, {
        inningsBalls: firstBalls,
        dismissalProfile: firstDismissalProfile,
        extras: firstExtras,
        aggressionLevel: firstAggression
      });
      const firstFinalScore = firstBat.reduce((acc, p)=>acc + (p.runs || 0), 0) + firstExtras.total;

      const secondProjectedRaw = firstIsA ? scoreB : scoreA;
      const chaseTarget = firstFinalScore + 1;
      let secondTargetScore = secondProjectedRaw;
      if(secondProjectedRaw >= chaseTarget){
        const chasePressure = chaseTarget >= 245 ? 0.82 : chaseTarget >= 225 ? 0.64 : chaseTarget >= 205 ? 0.4 : chaseTarget >= 185 ? 0.2 : 0.08;
        const headroom = secondProjectedRaw - chaseTarget;
        const collapseChance = clampValue(chasePressure - Math.min(0.2, headroom / 60), 0.04, 0.88);
        if(Math.random() < collapseChance){
          const missBy = chaseTarget >= 225 ? (6 + getRandomInt(18)) : chaseTarget >= 200 ? (4 + getRandomInt(14)) : (2 + getRandomInt(10));
          secondTargetScore = Math.max(0, firstFinalScore - missBy);
        } else {
          secondTargetScore = Math.max(chaseTarget, Math.min(285, chaseTarget + getRandomInt(5)));
        }
      } else {
        secondTargetScore = Math.max(0, Math.min(firstFinalScore, secondProjectedRaw));
        if(firstFinalScore - secondTargetScore <= 2 && Math.random() < 0.01){
          secondTargetScore = firstFinalScore;
        }
      }
      
      if(secondTargetScore === firstFinalScore && Math.random() >= 0.1){
        const nudge = Math.random() < 0.5 ? -1 : 1;
        secondTargetScore = Math.max(0, Math.min(285, secondTargetScore + nudge));
      }
      const chaseWon = secondTargetScore > firstFinalScore;
      const secondBattingEntries = firstIsA ? battingEntriesB : battingEntriesA;
      const secondBattingStrength = firstIsA ? battingStrengthB : battingStrengthA;
      const secondBowlingStrength = firstIsA ? bowlingStrengthA : bowlingStrengthB;
      const secondOppBowling = (firstIsA ? bowlersA : bowlersB).map(b=> ({ playerName: b.playerName || b.name, role: b.role }));
      const secondBowlingPlan = firstIsA ? (teamAObj.playing && teamAObj.playing.bowlingPlan) : (teamBObj.playing && teamBObj.playing.bowlingPlan);
      const secondFielders = firstIsA ? xiA.slice(0,11) : xiB.slice(0,11);
      const secondBowlingStyle = firstIsA ? styleA : styleB;
      const secondChaseContextPreview = buildChaseContext(chaseTarget, secondTargetScore, 120, conditions, secondBattingStrength, secondBowlingStrength);
      const secondAggression = clampValue(
        Math.max(0, secondChaseContextPreview.phaseIntent.death) * 0.55 +
        Math.max(0, secondChaseContextPreview.phaseIntent.middle) * 0.2 +
        secondChaseContextPreview.pressureIndex * 0.4,
        0,
        1.4
      );
      const secondWicketsBase = decideWickets(secondTargetScore, secondBattingStrength, secondBowlingStrength + pitchStyleBoost(secondBowlingStyle));
      let secondWickets = chaseWon ? Math.min(9, secondWicketsBase) : secondWicketsBase;
      if(secondAggression > 0.5 && Math.random() < (0.42 + secondAggression * 0.28)){
        secondWickets = Math.min(9, secondWickets + 1);
      }
      if(secondChaseContextPreview.pressureIndex > 0.65 && Math.random() < 0.8){
        secondWickets = Math.min(9, secondWickets + 1);
      }
      if(secondChaseContextPreview.dotPressure > 0.42 && !chaseWon && Math.random() < 0.68){
        secondWickets = Math.min(9, secondWickets + 1);
      }
      if(!chaseWon){
        const chaseDeficit = Math.max(1, chaseTarget - secondTargetScore);
        const highTargetPressure = chaseTarget >= 210 ? 2 : chaseTarget >= 185 ? 1 : 0;
        const closeFinishPressure = chaseDeficit <= 8 ? 2 : chaseDeficit <= 18 ? 1 : 0;
        const floor = Math.min(9, 4 + highTargetPressure + closeFinishPressure);
        if(secondWickets < floor && Math.random() < 0.85){
          secondWickets = floor - (Math.random() < 0.35 ? 1 : 0);
        }
        if(chaseDeficit <= 12 && chaseTarget >= 175){
          const closeLossFloor = 6 + (chaseDeficit <= 6 ? 1 : 0);
          const closeLossCeil = Math.min(9, 8 + (chaseTarget >= 220 ? 1 : 0));
          if(secondWickets < closeLossFloor || Math.random() < 0.7){
            const span = Math.max(0, closeLossCeil - closeLossFloor);
            secondWickets = closeLossFloor + Math.floor(Math.random() * (span + 1));
          }
        }
      }
      const secondBalls = (!chaseWon && secondTargetScore === firstFinalScore)
        ? 120
        : estimateInningsBalls(secondTargetScore, secondWickets, {
            isChase: true,
            chaseWon,
            chaseContext: secondChaseContextPreview,
            chaseTarget
          });
      const secondChaseContext = buildChaseContext(chaseTarget, secondTargetScore, secondBalls, conditions, secondBattingStrength, secondBowlingStrength);
      const secondDismissalProfile = buildDismissalProfile(secondWickets, {
        conditions,
        isChase: true,
        chaseContext: secondChaseContext,
        inningsBalls: secondBalls
      });
      const secondExtras = generateInningsExtras(secondTargetScore, secondBalls, {
        conditions,
        isChase: true,
        chaseContext: secondChaseContext
      });
      const secondBatterRunsTarget = Math.max(0, secondTargetScore - secondExtras.total);
      const secondBowlerRunsTarget = Math.max(0, secondTargetScore - (secondExtras.b + secondExtras.lb));
      const secondBowlerWickets = Math.max(0, secondWickets - secondDismissalProfile.runOuts);
      const secondBowlRes = distributeBowling(secondOppBowling, secondBowlerRunsTarget, secondBowlerWickets, secondBalls, secondBowlingPlan, { conditions });
      const secondBat = distributeRunsAmongBatters(secondBattingEntries, secondBatterRunsTarget, secondWickets, secondBowlRes.dismissalBowlers, secondFielders, {
        inningsBalls: secondBalls,
        chaseContext: secondChaseContext,
        dismissalProfile: secondDismissalProfile,
        extras: secondExtras,
        aggressionLevel: secondAggression
      });

      let batA, batB, bowlCardA, bowlCardB, ballsA, ballsB, extrasA, extrasB;
      if(firstIsA){
        batA = firstBat; bowlCardA = firstBowlRes.card; ballsA = firstBalls;
        batB = secondBat; bowlCardB = secondBowlRes.card; ballsB = secondBalls;
        extrasA = firstExtras; extrasB = secondExtras;
      } else {
        batB = firstBat; bowlCardB = firstBowlRes.card; ballsB = firstBalls;
        batA = secondBat; bowlCardA = secondBowlRes.card; ballsA = secondBalls;
        extrasB = firstExtras; extrasA = secondExtras;
      }

      const finalScoreA = batA.reduce((acc, p)=>acc + (p.runs || 0), 0) + (extrasA && extrasA.total ? extrasA.total : 0);
      const finalScoreB = batB.reduce((acc, p)=>acc + (p.runs || 0), 0) + (extrasB && extrasB.total ? extrasB.total : 0);
      const topA = batA.slice().sort((x,y)=>y.runs-x.runs)[0];
      const topB = batB.slice().sort((x,y)=>y.runs-x.runs)[0];
      return {
        teamA: { name: teamAObj.name, score: finalScoreA, overs: formatOversFromBalls(ballsA), bat: batA, bowlCard: bowlCardA, top: topA, extras: extrasA || { wd: 0, nb: 0, b: 0, lb: 0, total: 0 } },
        teamB: { name: teamBObj.name, score: finalScoreB, overs: formatOversFromBalls(ballsB), bat: batB, bowlCard: bowlCardB, top: topB, extras: extrasB || { wd: 0, nb: 0, b: 0, lb: 0, total: 0 } }
      };
    }

    function simulateInternal(idxA, idxB, options = {}){
      const squadA = players[idxA], squadB = players[idxB];
      if(isAuctionMode() && ((squadA && squadA.squad ? squadA.squad.length : 0) < getMinimumSquadSizeForPlay() || (squadB && squadB.squad ? squadB.squad.length : 0) < getMinimumSquadSizeForPlay())){
        return null;
      }
      const effA = getEffectiveSquad(squadA), effB = getEffectiveSquad(squadB);
      if(effA.length===0 || effB.length===0) return null;
      const tossInfo = options.tossInfo || buildTossInfoForMatch(idxA, idxB, false, { venueName: options.venueName || "" });
      const conditions = pickMatchConditions(tossInfo, options.venueName || "");
      const strengthA = getSquadStrength(effA), strengthB = getSquadStrength(effB);
      const diff = strengthA - strengthB;
      const xiA = getOrderedXI(squadA).slice(0,11);
      const xiB = getOrderedXI(squadB).slice(0,11);
      const mapA = new Map(squadA.squad.map(p=>[p.playerName,p]));
      const mapB = new Map(squadB.squad.map(p=>[p.playerName,p]));
      const batSRA = xiA.reduce((acc,n)=>{ const p=mapA.get(n)||{role:"BAT"}; return acc + getBatStrikeRate(n,p.role); },0) / Math.max(1, xiA.length);
      const batSRB = xiB.reduce((acc,n)=>{ const p=mapB.get(n)||{role:"BAT"}; return acc + getBatStrikeRate(n,p.role); },0) / Math.max(1, xiB.length);
      const top4SRA = xiA.slice(0,4).reduce((acc,n)=>{ const p=mapA.get(n)||{role:"BAT"}; return acc + getBatStrikeRate(n,p.role); },0) / 4;
      const top4SRB = xiB.slice(0,4).reduce((acc,n)=>{ const p=mapB.get(n)||{role:"BAT"}; return acc + getBatStrikeRate(n,p.role); },0) / 4;
      const inFormA = xiA.reduce((acc,n)=> acc + (isPlayerInForm(n, mapA.get(n)?.role) ? 1 : 0), 0);
      const inFormB = xiB.reduce((acc,n)=> acc + (isPlayerInForm(n, mapB.get(n)?.role) ? 1 : 0), 0);
      const currentFormA = xiA.reduce((acc,n)=> acc + getCurrentFormScore(n, mapA.get(n)?.role), 0) / Math.max(1, xiA.length);
      const currentFormB = xiB.reduce((acc,n)=> acc + getCurrentFormScore(n, mapB.get(n)?.role), 0) / Math.max(1, xiB.length);
      const topOrderFormA = xiA.slice(0,4).reduce((acc,n)=> acc + getCurrentFormScore(n, mapA.get(n)?.role), 0) / 4;
      const topOrderFormB = xiB.slice(0,4).reduce((acc,n)=> acc + getCurrentFormScore(n, mapB.get(n)?.role), 0) / 4;
      const bowlersA = getBowlingAttack(squadA);
      const bowlersB = getBowlingAttack(squadB);
      const styleA = getSpinPaceStrength(bowlersA);
      const styleB = getSpinPaceStrength(bowlersB);
      const econA = bowlersA.reduce((acc,b)=> acc + getBowlingEconomy(b.playerName || b.name, b.role || "BOWL"), 0) / Math.max(1, bowlersA.length);
      const econB = bowlersB.reduce((acc,b)=> acc + getBowlingEconomy(b.playerName || b.name, b.role || "BOWL"), 0) / Math.max(1, bowlersB.length);
      const bowlingFormA = bowlersA.reduce((acc,b)=> acc + getCurrentFormScore(b.playerName || b.name, b.role || "BOWL"), 0) / Math.max(1, bowlersA.length);
      const bowlingFormB = bowlersB.reduce((acc,b)=> acc + getCurrentFormScore(b.playerName || b.name, b.role || "BOWL"), 0) / Math.max(1, bowlersB.length);

      const base = 171;
      const battingImpactA = (batSRA - 138) * 1.45 + (top4SRA - 145) * 0.55 + currentFormA * 8.5 + topOrderFormA * 11.5 + inFormA * 1.2;
      const battingImpactB = (batSRB - 138) * 1.45 + (top4SRB - 145) * 0.55 + currentFormB * 8.5 + topOrderFormB * 11.5 + inFormB * 1.2;
      const bowlingImpactOnA = (econB - 8.0) * 8.4 - bowlingFormB * 7.4; // stronger in-form bowling lowers total
      const bowlingImpactOnB = (econA - 8.0) * 8.4 - bowlingFormA * 7.4;
      const strengthImpact = diff * 0.24 + (currentFormA - currentFormB) * 9.5;
      const battingFireA = (top4SRA - 148) * 0.02 + (topOrderFormA - 0.8) * 0.22 + (currentFormA - 0.8) * 0.15 + (econB - 8.0) * 0.08;
      const battingFireB = (top4SRB - 148) * 0.02 + (topOrderFormB - 0.8) * 0.22 + (currentFormB - 0.8) * 0.15 + (econA - 8.0) * 0.08;
      const bigTotalChanceA = Math.max(0.08, Math.min(0.48, 0.18 + battingFireA));
      const bigTotalChanceB = Math.max(0.08, Math.min(0.48, 0.18 + battingFireB));
      const inningsVarianceA = randomNoise(18) + (Math.random() < 0.24 ? randomNoise(20) : 0);
      const inningsVarianceB = randomNoise(18) + (Math.random() < 0.24 ? randomNoise(20) : 0);
      const collapseSwingA = Math.random() < Math.max(0.08, 0.2 - battingFireA * 0.12 + bowlingFormB * 0.08) ? -(12 + Math.random() * 22) : 0;
      const collapseSwingB = Math.random() < Math.max(0.08, 0.2 - battingFireB * 0.12 + bowlingFormA * 0.08) ? -(12 + Math.random() * 22) : 0;
      const explosionSwingA = Math.random() < bigTotalChanceA ? (14 + Math.random() * 28) : 0;
      const explosionSwingB = Math.random() < bigTotalChanceB ? (14 + Math.random() * 28) : 0;

      const pitchEffectA = conditions.pitch === "spin" ? (styleB.spin - styleA.spin) * -0.22 : conditions.pitch === "pace" ? (styleB.pace - styleA.pace) * -0.22 : 0;
      const pitchEffectB = conditions.pitch === "spin" ? (styleA.spin - styleB.spin) * -0.22 : conditions.pitch === "pace" ? (styleA.pace - styleB.pace) * -0.22 : 0;
      let scoreA = base + battingImpactA + bowlingImpactOnA + strengthImpact + pitchEffectA + conditions.baseRunAdj + inningsVarianceA + collapseSwingA + explosionSwingA;
      let scoreB = base + battingImpactB + bowlingImpactOnB - strengthImpact + pitchEffectB + conditions.baseRunAdj + inningsVarianceB + collapseSwingB + explosionSwingB;
      if(tossInfo.battingFirstIdx === idxA){
        scoreB += 4 + conditions.chaseAdj + randomNoise(5);
      } else {
        scoreA += 4 + conditions.chaseAdj + randomNoise(5);
      }
      scoreA = Math.max(92, Math.min(252, Math.round(scoreA)));
      scoreB = Math.max(92, Math.min(252, Math.round(scoreB)));

      const scorecard = generateScorecardForMatch(squadA, squadB, scoreA, scoreB, tossInfo, idxA, idxB, conditions);
      scoreA = scorecard.teamA.score;
      scoreB = scorecard.teamB.score;
      let winnerIdx = -1;
      let margin = Math.abs(scoreA-scoreB);
      let summaryLine = "";
      const chasingIdx = tossInfo.battingFirstIdx === idxA ? idxB : idxA;
      if(scoreA>scoreB){
        winnerIdx = 0;
        if(idxA === chasingIdx){
          const wicketsLeft = Math.max(0, 10 - countOutsFromBatting(scorecard.teamA.bat));
          summaryLine = `${squadA.name} chased and beat ${squadB.name} by ${wicketsLeft} wickets`;
        } else {
          summaryLine = `${squadA.name} beat ${squadB.name} by ${margin} runs`;
        }
      } else if(scoreB>scoreA){
        winnerIdx = 1;
        if(idxB === chasingIdx){
          const wicketsLeft = Math.max(0, 10 - countOutsFromBatting(scorecard.teamB.bat));
          summaryLine = `${squadB.name} chased and beat ${squadA.name} by ${wicketsLeft} wickets`;
        } else {
          summaryLine = `${squadB.name} beat ${squadA.name} by ${margin} runs`;
        }
      } else {
        const superOver = resolveSuperOver(squadA, squadB, conditions);
        winnerIdx = superOver.winnerIdx;
        margin = 0;
        summaryLine = superOver.summaryLine;
        scorecard.superOver = superOver;
      }
      scorecard.awards = buildPostMatchAwards(scorecard, winnerIdx === 0 ? squadA.name : winnerIdx === 1 ? squadB.name : "Tie");
      return { idxA, idxB, scoreA, scoreB, winnerIdx, margin, summaryLine, toss: tossInfo, conditions, details: scorecard };
    }

    // ---------- UI to render scoreboard ----------
    function renderScoreboardBlock(matchRes, container){
      const sc = matchRes.details;
      const wrapper = document.createElement("div");
      wrapper.className = "scoreboard";

      const wicketsA = countOutsFromBatting(sc.teamA.bat);
      const wicketsB = countOutsFromBatting(sc.teamB.bat);
      const firstIsA = !matchRes.toss || matchRes.toss.battingFirstIdx === matchRes.idxA;
      const firstInnings = firstIsA
        ? { batTeam: sc.teamA, batWickets: wicketsA, bowlTeam: sc.teamB, bowlCard: sc.teamA.bowlCard }
        : { batTeam: sc.teamB, batWickets: wicketsB, bowlTeam: sc.teamA, bowlCard: sc.teamB.bowlCard };
      const secondInnings = firstIsA
        ? { batTeam: sc.teamB, batWickets: wicketsB, bowlTeam: sc.teamA, bowlCard: sc.teamB.bowlCard }
        : { batTeam: sc.teamA, batWickets: wicketsA, bowlTeam: sc.teamB, bowlCard: sc.teamA.bowlCard };

      const header = document.createElement("div");
      header.className = "score-header";
      const left = document.createElement("div");
      left.innerHTML = `<div class="team-title">${firstInnings.batTeam.name} | ${firstInnings.batTeam.score}/${firstInnings.batWickets} (${firstInnings.batTeam.overs} ov)</div><div class="score-sub">${secondInnings.batTeam.name} | ${secondInnings.batTeam.score}/${secondInnings.batWickets} (${secondInnings.batTeam.overs} ov)</div>`;
      const right = document.createElement("div");
      right.innerHTML = `<div class="team-title">${matchRes.summaryLine}</div><div class="score-sub">Top A: ${formatPlayerName(sc.teamA.top.name)} (${sc.teamA.top.runs}) | Top B: ${formatPlayerName(sc.teamB.top.name)} (${sc.teamB.top.runs})</div>`;
      header.appendChild(left); header.appendChild(right); wrapper.appendChild(header);
      if(sc.awards && sc.awards.winnerName){
        const winnerBanner = document.createElement("div");
        winnerBanner.className = "winner-banner";
        winnerBanner.innerHTML = `<strong>${sc.awards.winnerName}</strong><div class="small-text">Match winner</div>`;
        wrapper.appendChild(winnerBanner);
      }
      if(matchRes.toss){
        const toss = matchRes.toss;
        const tossLine = document.createElement("div");
        tossLine.className = "score-sub";
        tossLine.style.marginTop = "6px";
        const caller = players[toss.callerIdx] ? players[toss.callerIdx].name : "Unknown";
        const winner = players[toss.tossWinnerIdx] ? players[toss.tossWinnerIdx].name : "Unknown";
        const firstBat = players[toss.battingFirstIdx] ? players[toss.battingFirstIdx].name : "Unknown";
        tossLine.textContent = `🪙 Toss: ${caller} called ${toss.call}. Coin: ${toss.coinResult}. ${winner} won toss and chose to ${toss.decision}. ${firstBat} batted first.`;
        wrapper.appendChild(tossLine);
      }
      if(matchRes.conditions){
        const cond = document.createElement("div");
        cond.className = "score-sub";
        cond.style.marginTop = "4px";
        cond.textContent = `📍 ${matchRes.conditions.venue} | Pitch: ${matchRes.conditions.pitch} | Boundary: ${matchRes.conditions.boundary} | Weather: ${matchRes.conditions.weather}${matchRes.conditions.dew ? " | Dew: yes" : ""}`;
        wrapper.appendChild(cond);
      }
      if(sc.superOver && Array.isArray(sc.superOver.rounds) && sc.superOver.rounds.length){
        const latestRound = sc.superOver.rounds[sc.superOver.rounds.length - 1];
        const superOverBox = document.createElement("div");
        superOverBox.className = "super-over-summary";
        const superOverTitle = document.createElement("h4");
        superOverTitle.textContent = "Super Over";
        superOverBox.appendChild(superOverTitle);
        if(latestRound.teamA && latestRound.teamB){
          const line = document.createElement("div");
          line.className = "small-text";
          line.textContent = `${latestRound.teamA.battingTeam} ${latestRound.teamA.score}/${latestRound.teamA.wickets} (${latestRound.teamA.overs}) vs ${latestRound.teamB.battingTeam} ${latestRound.teamB.score}/${latestRound.teamB.wickets} (${latestRound.teamB.overs})`;
          superOverBox.appendChild(line);
          const lineup = document.createElement("div");
          lineup.className = "small-text";
          lineup.style.marginTop = "4px";
          lineup.textContent = `${latestRound.teamA.battingTeam}: ${latestRound.teamA.config.batters.map(formatPlayerName).join(", ")} | Bowler: ${formatPlayerName(latestRound.teamB.config.bowler)}. ${latestRound.teamB.battingTeam}: ${latestRound.teamB.config.batters.map(formatPlayerName).join(", ")} | Bowler: ${formatPlayerName(latestRound.teamA.config.bowler)}.`;
          superOverBox.appendChild(lineup);
        } else if(latestRound.note){
          const line = document.createElement("div");
          line.className = "small-text";
          line.textContent = latestRound.note;
          superOverBox.appendChild(line);
        }
        wrapper.appendChild(superOverBox);
      }
      if(sc.awards){
        const awardGrid = document.createElement("div");
        awardGrid.className = "award-grid";
        const awards = [
          sc.awards.playerOfMatch ? { title: "Player of the Match", body: `${formatPlayerName(sc.awards.playerOfMatch.name)} (${sc.awards.playerOfMatch.team})` } : null,
          sc.awards.topScorer ? { title: "Top Scorer", body: `${formatPlayerName(sc.awards.topScorer.name)} - ${sc.awards.topScorer.runs}` } : null,
          sc.awards.bestBowler ? { title: "Best Bowler", body: `${formatPlayerName(sc.awards.bestBowler.name)} - ${sc.awards.bestBowler.wickets}/${sc.awards.bestBowler.runs}` } : null
        ].filter(Boolean);
        awards.forEach(award=>{
          const card = document.createElement("div");
          card.className = "award-card";
          card.innerHTML = `<h4>${award.title}</h4><div>${award.body}</div>`;
          awardGrid.appendChild(card);
        });
        if(awards.length) wrapper.appendChild(awardGrid);
      }

      function createInningsSection(innings){
        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "1fr 1fr";
        row.style.gap = "10px";
        row.style.marginTop = "10px";

        const batTable = document.createElement("table");
        batTable.className = "score";
        batTable.innerHTML = `<thead><tr><th>🏏 BATTING - ${innings.batTeam.name}</th><th class="muted">R</th><th class="muted">B</th><th class="muted">4s</th><th class="muted">6s</th><th class="muted">SR</th></tr></thead>`;
        const batBody = document.createElement("tbody");
        innings.batTeam.bat.forEach(p=>{
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${formatPlayerName(p.name)} <span class="muted">${p.outDesc}</span></td><td>${p.runs}</td><td>${p.balls}</td><td>${p.fours}</td><td>${p.sixes}</td><td>${p.SR}</td>`;
          batBody.appendChild(tr);
        });
        const ex = innings.batTeam.extras || { wd: 0, nb: 0, b: 0, lb: 0, total: 0 };
        const extrasRow = document.createElement("tr");
        extrasRow.innerHTML = `<td><strong>Extras</strong> <span class="muted">(wd ${ex.wd || 0}, nb ${ex.nb || 0}, b ${ex.b || 0}, lb ${ex.lb || 0})</span></td><td><strong>${ex.total || 0}</strong></td><td></td><td></td><td></td><td></td>`;
        batBody.appendChild(extrasRow);
        const totalRow = document.createElement("tr");
        totalRow.innerHTML = `<td><strong>Total</strong></td><td><strong>${innings.batTeam.score || 0}</strong></td><td colspan="4" class="muted">${innings.batTeam.overs} ov</td>`;
        batBody.appendChild(totalRow);
        batTable.appendChild(batBody);

        const bowlTable = document.createElement("table");
        bowlTable.className = "score";
        bowlTable.innerHTML = `<thead><tr><th>🎯 BOWLING - ${innings.bowlTeam.name}</th><th class="muted">O</th><th class="muted">M</th><th class="muted">R</th><th class="muted">W</th><th class="muted">Econ</th></tr></thead>`;
        const bowlBody = document.createElement("tbody");
        innings.bowlCard.forEach(b=>{
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${formatPlayerName(b.name)}</td><td>${b.overs}</td><td>${b.maidens}</td><td>${b.runs}</td><td>${b.wickets}</td><td>${b.econ}</td>`;
          bowlBody.appendChild(tr);
        });
        bowlTable.appendChild(bowlBody);

        row.appendChild(batTable);
        row.appendChild(bowlTable);
        return row;
      }

      wrapper.appendChild(createInningsSection(firstInnings));
      wrapper.appendChild(createInningsSection(secondInnings));
      container.appendChild(wrapper);
    }

    function buildTossSummaryLine(matchRes){
      if(!matchRes || !matchRes.toss) return "";
      const toss = matchRes.toss;
      const caller = players[toss.callerIdx] ? players[toss.callerIdx].name : "Unknown";
      const winner = players[toss.tossWinnerIdx] ? players[toss.tossWinnerIdx].name : "Unknown";
      const firstBat = players[toss.battingFirstIdx] ? players[toss.battingFirstIdx].name : "Unknown";
      return `🪙 Toss: ${caller} called ${toss.call}. Coin: ${toss.coinResult}. ${winner} won toss and chose to ${toss.decision}. ${firstBat} batted first.`;
    }
    function oversToBalls(oversStr){
      const s = String(oversStr || "0");
      if(!s.includes(".")) return parseInt(s, 10) * 6;
      const parts = s.split(".");
      return parseInt(parts[0], 10) * 6 + parseInt(parts[1], 10);
    }
    // ---------- Simulate single match button ----------
    simulateBtn.addEventListener("click", ()=>{
      if(!canCurrentDeviceControlMatches()){ simResult.textContent = "Only the host can run shared match simulations."; return; }
      simResult.innerHTML = "";
      tossResultLine.textContent = "";
      if(!players || players.length<2){ simResult.textContent = "Need at least two squads to simulate."; return; }
      const idxA = parseInt(teamASelect.value,10);
      const idxB = parseInt(teamBSelect.value,10);
      if(isNaN(idxA) || isNaN(idxB)){ simResult.textContent = "Please select both Squad A and Squad B."; return; }
      if(idxA===idxB){ simResult.textContent = "Choose two different squads."; return; }
      const tossInfo = buildTossInfoForMatch(idxA, idxB, true);
      const tossWinnerName = players[tossInfo.tossWinnerIdx] ? players[tossInfo.tossWinnerIdx].name : "Unknown";
      tossResultLine.textContent = `🪙 Coin result: ${tossInfo.coinResult}. ${tossWinnerName} won toss and chose to ${tossInfo.decision}.`;
      const selectedVenue = venueSelect ? (venueSelect.value || "") : "";
      const res = simulateInternal(idxA,idxB, { tossInfo, venueName: selectedVenue });
      if(!res){ simResult.textContent = isAuctionMode() ? "Both auction teams need at least 15 players before simulating." : "Both squads should have at least 1 player before simulating."; return; }
      updateSeasonStatsFromMatch(res);
      renderStatsDashboard();
      renderRivalryBoard();
      const outer = document.createElement("div");
      outer.className = "match-block";
      const title = document.createElement("div"); title.className="collapsible"; title.textContent = `${res.summaryLine} | 📊 Click to expand scoreboard`;
      outer.appendChild(title);
      const boardHolder = document.createElement("div"); boardHolder.style.display="none";
      outer.appendChild(boardHolder);
      renderScoreboardBlock(res, boardHolder);
      simResult.appendChild(outer);
      syncRoomGameState("single-sim");
    });

    // clear scoreboards
    clearScoreboards.addEventListener("click", ()=>{ if(!canCurrentDeviceControlMatches()) return; simResult.innerHTML = ""; tournamentResult.innerHTML = ""; tossResultLine.textContent = ""; leagueFlow = null; playNextMatchBtn.disabled = true; syncRoomGameState("clear-scoreboards"); });
    simResult.addEventListener("click", toggleCollapsibleFromClick);
    tournamentResult.addEventListener("click", toggleCollapsibleFromClick);

    function renderPointsTable(table){
      const wrap = document.createElement("div");
      wrap.className = "dash-card";
      const title = document.createElement("h4");
      title.textContent = "Points Table";
      wrap.appendChild(title);
      const t = document.createElement("table");
      t.className = "score";
      t.innerHTML = "<thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>RunDiff</th></tr></thead>";
      const tb = document.createElement("tbody");
      table.forEach(row=>{
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${row.name}</td><td>${row.played}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.tied}</td><td><strong>${row.pts}</strong></td><td>${row.runDiff.toFixed ? row.runDiff.toFixed(1) : row.runDiff}</td>`;
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      wrap.appendChild(t);
      return wrap;
    }

    function appendMatchBlock(container, label, matchRes){
      const block = document.createElement("div"); block.className = "match-block";
      const venueTag = matchRes && matchRes.conditions && matchRes.conditions.venue ? ` | 📍 ${matchRes.conditions.venue}` : "";
      const head = document.createElement("div"); head.className = "collapsible"; head.textContent = `${label}: ${matchRes.summaryLine}${venueTag} | 📊 Click to view scoreboard`;
      block.appendChild(head);
      const tossMeta = document.createElement("div");
      tossMeta.className = "small-text";
      tossMeta.style.marginTop = "4px";
      tossMeta.textContent = buildTossSummaryLine(matchRes);
      block.appendChild(tossMeta);
      const board = document.createElement("div"); board.style.display = "none"; block.appendChild(board);
      renderScoreboardBlock(matchRes, board);
      container.appendChild(block);
    }

    function refreshLeagueView(){
      if(!leagueFlow) return;
      tournamentResult.innerHTML = "";
      const sorted = leagueFlow.table.slice().sort((a,b)=> b.pts!==a.pts ? b.pts-a.pts : b.runDiff-a.runDiff);
      tournamentResult.appendChild(renderPointsTable(sorted));
      const stageLine = document.createElement("div");
      stageLine.className = "small-text";
      stageLine.style.marginTop = "8px";
      stageLine.textContent = leagueFlow.phase === "league"
        ? `League progress: ${leagueFlow.nextLeague}/${leagueFlow.fixtures.length} matches completed.`
        : leagueFlow.phase === "playoffs"
          ? `Playoffs progress: ${leagueFlow.nextPlayoff}/${leagueFlow.playoffPlan.length} matches completed.`
          : "Tournament complete.";
      tournamentResult.appendChild(stageLine);
      const holder = document.createElement("div");
      holder.style.marginTop = "8px";
      leagueFlow.history.forEach(h=> appendMatchBlock(holder, h.label, h.res));
      tournamentResult.appendChild(holder);
      playNextMatchBtn.disabled = !leagueFlow || leagueFlow.phase === "done";
    }

    function refillLeagueVenueQueue(flow){
      const names = VENUE_PROFILES.map(v=>v.name);
      for(let i=names.length - 1; i>0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
      }
      if(flow.lastVenue && names.length > 1 && names[0] === flow.lastVenue){
        [names[0], names[1]] = [names[1], names[0]];
      }
      flow.venueQueue = names;
      flow.venueCursor = 0;
    }
    function getNextLeagueVenue(flow){
      if(!flow) return "";
      if(!Array.isArray(flow.venueQueue) || flow.venueCursor >= flow.venueQueue.length){
        refillLeagueVenueQueue(flow);
      }
      let venue = flow.venueQueue[flow.venueCursor] || "";
      flow.venueCursor++;
      if(flow.lastVenue && venue === flow.lastVenue && VENUE_PROFILES.length > 1){
        if(flow.venueCursor >= flow.venueQueue.length){
          refillLeagueVenueQueue(flow);
        }
        venue = flow.venueQueue[flow.venueCursor] || venue;
        flow.venueCursor++;
      }
      flow.lastVenue = venue;
      return venue;
    }

    function initLeagueFlow(){
      if(!players || players.length<2){ tournamentResult.textContent = "Need at least two squads for a league."; return; }
      const n = players.length;
      const fixtures = [];
      for(let i=0;i<n;i++){
        for(let j=i+1;j<n;j++){
          fixtures.push({ idxA:i, idxB:j });
        }
      }
      for(let i=fixtures.length - 1; i>0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [fixtures[i], fixtures[j]] = [fixtures[j], fixtures[i]];
      }
      leagueFlow = {
        n,
        fixtures,
        nextLeague: 0,
        playoffPlan: [],
        nextPlayoff: 0,
        phase: "league",
        history: [],
        table: players.map((p,idx)=>({ idx, name:p.name, played:0, won:0, lost:0, tied:0, pts:0, runDiff:0 })),
        elimWinner: null,
        q1Winner: null,
        q1Loser: null,
        venueQueue: [],
        venueCursor: 0,
        lastVenue: ""
      };
      refillLeagueVenueQueue(leagueFlow);
      refreshLeagueView();
      playNextMatchBtn.disabled = false;
    }

    function playNextLeagueMatch(){
      if(!leagueFlow || leagueFlow.phase === "done") return;
      if(leagueFlow.phase === "league"){
        const fx = leagueFlow.fixtures[leagueFlow.nextLeague];
        if(!fx){
          const sorted = leagueFlow.table.slice().sort((a,b)=> b.pts!==a.pts ? b.pts-a.pts : b.runDiff-a.runDiff);
          if(leagueFlow.n === 4){
            leagueFlow.playoffPlan = [
              { label: "Eliminator", idxA: sorted[1].idx, idxB: sorted[2].idx, tag: "elim" },
              { label: "Final", idxA: sorted[0].idx, dynamic: "elimWinner", tag: "final" }
            ];
          } else if(leagueFlow.n >= 4){
            leagueFlow.playoffPlan = [
              { label: "Qualifier 1", idxA: sorted[0].idx, idxB: sorted[1].idx, tag: "q1" },
              { label: "Eliminator", idxA: sorted[2].idx, idxB: sorted[3].idx, tag: "elim" },
              { label: "Qualifier 2", dynamicA: "q1Loser", dynamicB: "elimWinner", tag: "q2" },
              { label: "Final", dynamicA: "q1Winner", dynamicB: "q2Winner", tag: "final" }
            ];
          } else {
            leagueFlow.playoffPlan = [{ label: "Final", idxA: sorted[0].idx, idxB: sorted[1].idx, tag: "final" }];
          }
          leagueFlow.phase = "playoffs";
          refreshLeagueView();
          return;
        }
        const venueName = getNextLeagueVenue(leagueFlow);
        const res = simulateInternal(fx.idxA, fx.idxB, { venueName });
        if(!res){
          leagueFlow.history.push({
            label: `League Match ${leagueFlow.nextLeague + 1}`,
            res: {
              idxA: fx.idxA,
              idxB: fx.idxB,
              summaryLine: `${players[fx.idxA].name} vs ${players[fx.idxB].name} abandoned (insufficient available XI)`,
              toss: null,
              conditions: { venue: venueName || "Unknown", pitch: "balanced", boundary: "medium", weather: "clear", dew: false },
              details: {
                teamA: { name: players[fx.idxA].name, score: 0, overs: "0", bat: [], bowlCard: [], top: { name: "-", runs: 0 }, extras: { wd: 0, nb: 0, b: 0, lb: 0, total: 0 } },
                teamB: { name: players[fx.idxB].name, score: 0, overs: "0", bat: [], bowlCard: [], top: { name: "-", runs: 0 }, extras: { wd: 0, nb: 0, b: 0, lb: 0, total: 0 } }
              }
            }
          });
          leagueFlow.nextLeague++;
          refreshLeagueView();
          return;
        }
        updateSeasonStatsFromMatch(res);
        const tA = leagueFlow.table.find(t=>t.idx===fx.idxA);
        const tB = leagueFlow.table.find(t=>t.idx===fx.idxB);
        tA.played++; tB.played++;
        const diff = res.scoreA - res.scoreB;
        tA.runDiff += diff; tB.runDiff -= diff;
        if(res.winnerIdx===0){ tA.won++; tB.lost++; tA.pts += 2; }
        else if(res.winnerIdx===1){ tB.won++; tA.lost++; tB.pts += 2; }
        else { tA.tied++; tB.tied++; tA.pts++; tB.pts++; }
        leagueFlow.history.push({ label: `League Match ${leagueFlow.nextLeague + 1}`, res });
        leagueFlow.nextLeague++;
        renderStatsDashboard();
        renderRivalryBoard();
        refreshLeagueView();
        return;
      }
      const pf = leagueFlow.playoffPlan[leagueFlow.nextPlayoff];
      if(!pf){
        leagueFlow.phase = "done";
        refreshLeagueView();
        return;
      }
      const idxA = pf.dynamicA ? leagueFlow[pf.dynamicA] : pf.idxA;
      const idxB = pf.dynamicB ? leagueFlow[pf.dynamicB] : (pf.dynamic ? leagueFlow[pf.dynamic] : pf.idxB);
      const venueName = getNextLeagueVenue(leagueFlow);
      const res = simulateInternal(idxA, idxB, { venueName });
      if(!res){
        leagueFlow.phase = "done";
        refreshLeagueView();
        return;
      }
      updateSeasonStatsFromMatch(res);
      leagueFlow.history.push({ label: pf.label, res });
      const winner = res.winnerIdx===0 ? res.idxA : res.winnerIdx===1 ? res.idxB : res.idxA;
      const loser = winner === res.idxA ? res.idxB : res.idxA;
      if(pf.tag === "elim") leagueFlow.elimWinner = winner;
      if(pf.tag === "q1"){ leagueFlow.q1Winner = winner; leagueFlow.q1Loser = loser; }
      if(pf.tag === "q2") leagueFlow.q2Winner = winner;
      if(pf.tag === "final"){
        const champEl = document.createElement("div");
        champEl.style.marginTop = "8px";
        champEl.innerHTML = `<strong>🏆 CHAMPION: ${players[winner].name}</strong>`;
        leagueFlow.phase = "done";
        renderStatsDashboard();
        renderRivalryBoard();
        refreshLeagueView();
        tournamentResult.appendChild(champEl);
        return;
      }
      leagueFlow.nextPlayoff++;
      renderStatsDashboard();
      renderRivalryBoard();
      refreshLeagueView();
    }

    tournamentBtn.addEventListener("click", ()=>{ if(!canCurrentDeviceControlMatches()) return; initLeagueFlow(); syncRoomGameState("init-league"); });
    playNextMatchBtn.addEventListener("click", ()=>{ if(!canCurrentDeviceControlMatches()) return; playNextLeagueMatch(); syncRoomGameState("play-next-league"); });

    // download squads
    downloadBtn.addEventListener("click", ()=>{
      if(!gameStarted||players.length===0) return;
      let out=`IPL Fantasy League - ${isAuctionMode() ? "Auction Mode" : "Spin Draft Mode"}\n\n`;
      players.forEach(p=>{
        const eff=getEffectiveSquad(p); const strength=getSquadStrength(eff); const counts=getRoleCounts(eff); const foreign=getForeignCount(eff); const inForm=getInFormCount(eff);
        out += `=== ${p.name} ===\nTotal in full squad: ${p.squad.length} / ${getActiveSquadLimit()}\nUsed for rating: ${eff.length}\nStrength: ${strength} pts\nRoles: BAT ${counts.BAT}, BOWL ${counts.BOWL}, AR ${counts.AR}, WK ${counts.WK}\nForeign (used): ${foreign} / ${MAX_FOREIGN}\n${isAuctionMode() ? `Purse left: ${formatAuctionPrice(p.purse || 12000)}\nSpent: ${formatAuctionPrice(p.totalSpent || 0)}\n` : ""}In-form (used): ${inForm}\n`;
        if(p.playing && p.playing.xi && p.playing.xi.length===11 && p.playing.impact){
          out += "\nPlaying XI (batting order):\n";
          p.playing.xi.forEach((n,i)=> out += `${i+1}. ${formatPlayerName(n)}\n`);
          out += "Impact: "+formatPlayerName(p.playing.impact)+"\n";
          if(p.playing.superOver && Array.isArray(p.playing.superOver.batters) && p.playing.superOver.batters.length){
            out += `Super Over Batters: ${p.playing.superOver.batters.map(formatPlayerName).join(", ")}\n`;
            out += `Super Over Bowler: ${formatPlayerName(p.playing.superOver.bowler || "-")}\n`;
          }
          if(Array.isArray(p.playing.bowlingPlan) && p.playing.bowlingPlan.some(Boolean)){
            out += "Bowling Plan:\n";
            p.playing.bowlingPlan.forEach((bn, i)=>{ out += `Ov ${i+1}: ${bn ? formatPlayerName(bn) : "auto"}\n`; });
          }
        } else out += "\nPlaying XI + Impact: not set\n";
        out += "\nFull Squad:\n"; p.squad.forEach((s,i)=> out += `${i+1}. ${formatPlayerName(s.playerName)} (${formatRole(s.role)}) - ${s.team}\n`); out += "\n\n";
      });
      const blob=new Blob([out],{type:"text/plain"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="ipl_spin_draft_squads.txt"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });

    function populateSimSelects(){
      const prevA = teamASelect ? teamASelect.value : "";
      const prevB = teamBSelect ? teamBSelect.value : "";
      const prevVenue = venueSelect ? venueSelect.value : "";
      teamASelect.innerHTML = "";
      teamBSelect.innerHTML = "";
      if(venueSelect){
        venueSelect.innerHTML = "";
        const autoOpt = document.createElement("option");
        autoOpt.value = "";
        autoOpt.textContent = "Venue: Auto (Random)";
        venueSelect.appendChild(autoOpt);
        VENUE_PROFILES.forEach(v=>{
          const o = document.createElement("option");
          o.value = v.name;
          o.textContent = `Venue: ${v.name} (${v.pitch})`;
          venueSelect.appendChild(o);
        });
      }
      if(!players || players.length===0){
        syncTossCallerOptions();
        return;
      }
      const phA = document.createElement("option");
      phA.value = "";
      phA.textContent = "Select Squad A";
      teamASelect.appendChild(phA);
      const phB = document.createElement("option");
      phB.value = "";
      phB.textContent = "Select Squad B";
      teamBSelect.appendChild(phB);
      players.forEach((p,i)=>{
        const o = document.createElement("option");
        o.value = i;
        o.textContent = p.name;
        teamASelect.appendChild(o);
        teamBSelect.appendChild(o.cloneNode(true));
      });
      const hasPrevA = Array.from(teamASelect.options).some(opt=>opt.value === prevA);
      const hasPrevB = Array.from(teamBSelect.options).some(opt=>opt.value === prevB);
      if(hasPrevA) teamASelect.value = prevA;
      if(hasPrevB) teamBSelect.value = prevB;
      if(!teamASelect.value && players[0]) teamASelect.value = "0";
      if(!teamBSelect.value && players[1]) teamBSelect.value = "1";
      if(venueSelect && Array.from(venueSelect.options).some(opt=>opt.value === prevVenue)){
        venueSelect.value = prevVenue;
      }
      syncTossCallerOptions();
    }

    // initial render
    renderImportedStatsSummary();
    renderGlobalSummary();
    updateBestSquadSummary();
    renderLatestPickFeed();
    updateTurnOwnerBanner();
    renderAuctionState();
    applyModeUI();
    loadCachedStatsFromServer()
      .then(cache=>{
        if(cache && Object.keys(cache).length){
          importedPlayerStats = cache;
          saveStoredPlayerStats(importedPlayerStats);
          resetImportedProfileCache();
          renderImportedStatsSummary();
          renderPlayers();
          updateBestSquadSummary();
        }
      })
      .catch(()=>{});


