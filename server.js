const http = require("http");
const fs = require("fs/promises");
const path = require("path");
// const { chromium } = require("playwright-core");

// ✅ Use ONLY playwright (works both local + Render)
const { chromium } = require("playwright");

// (optional safe fallback for fetch)
const fetch = global.fetch || require("node-fetch");


const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, "data");
const CACHE_FILE = path.join(CACHE_DIR, "official-player-stats-cache.json");
const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

const TEAM_SLUGS = {
  CSK: "chennai-super-kings",
  MI: "mumbai-indians",
  RCB: "royal-challengers-bengaluru",
  KKR: "kolkata-knight-riders",
  SRH: "sunrisers-hyderabad",
  RR: "rajasthan-royals",
  GT: "gujarat-titans",
  LSG: "lucknow-super-giants",
  DC: "delhi-capitals",
  PBKS: "punjab-kings"
};

const TEAM_PAGE_CACHE = new Map();
const PROFILE_PAGE_CACHE = new Map();
let seasonStatsCache = null;
let browserExecutablePath = null;

async function detectBrowserExecutable() {
  if (browserExecutablePath) return browserExecutablePath;
  for (const candidate of EDGE_PATHS) {
    try {
      await fs.access(candidate);
      browserExecutablePath = candidate;
      return browserExecutablePath;
    } catch (err) {
      // Try the next path.
    }
  }
  throw new Error("Could not find a local Chromium-based browser to automate.");
}

// async function withBrowserPage(task) {
//   const executablePath = await detectBrowserExecutable();
//   const browser = await chromium.launch({
//     executablePath,
//     headless: true
//   });
//   try {
//     const page = await browser.newPage({
//       userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
//     });
//     await page.goto("about:blank");
//     return await task(page);
//   } finally {
//     await browser.close();
//   }
// }

async function withBrowserPage(task) {
  let browser;

  if (process.env.RENDER) {
    // Render (Linux server)
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  } else {
    // Local (your current Windows logic)
    const executablePath = await detectBrowserExecutable();
    browser = await chromium.launch({
      executablePath,
      headless: true
    });
  }

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    });
    await page.goto("about:blank");
    return await task(page);
  } finally {
    await browser.close();
  }
}
//end of withBrowserPage

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, relPath);
  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(data);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function writeCache(cache) {
  await ensureCacheDir();
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function slugifyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unslugName(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchTeamPage(teamCode) {
  const slug = TEAM_SLUGS[teamCode];
  if (!slug) throw new Error(`Unknown team code: ${teamCode}`);
  if (TEAM_PAGE_CACHE.has(slug)) return TEAM_PAGE_CACHE.get(slug);
  const html = await fetchText(`https://www.iplt20.com/teams/${slug}`);
  TEAM_PAGE_CACHE.set(slug, html);
  return html;
}

function scoreSlugCandidate(playerName, slug) {
  const targetSlug = slugifyName(playerName);
  const targetParts = targetSlug.split("-").filter(Boolean);
  const slugParts = String(slug || "").split("-").filter(Boolean);
  let score = 0;
  if (slug === targetSlug) score += 100;
  if (slug.includes(targetSlug) || targetSlug.includes(slug)) score += 40;
  targetParts.forEach(part => {
    if (slugParts.includes(part)) score += 10;
    else if (slugParts.some(slugPart => slugPart.includes(part) || part.includes(slugPart))) score += 4;
  });
  return score;
}

function findPlayerProfileUrl(teamHtml, playerName) {
  const matches = [...String(teamHtml || "").matchAll(/\/players\/([a-z0-9-]+)\/(\d+)/gi)];
  if (!matches.length) return null;
  const best = matches
    .map(match => ({
      slug: match[1],
      url: `https://www.iplt20.com/players/${match[1]}/${match[2]}`,
      score: scoreSlugCandidate(playerName, match[1])
    }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.url : null;
}

async function fetchProfileText(url) {
  if (PROFILE_PAGE_CACHE.has(url)) return PROFILE_PAGE_CACHE.get(url);
  const html = await fetchText(url);
  const text = stripTags(html);
  PROFILE_PAGE_CACHE.set(url, text);
  return text;
}

function parseOverviewNumber(text, label) {
  const match = String(text).match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s+${label}`, "i"));
  return match ? Number(match[1]) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferStrikeRateFromText(role, text, batting) {
  const profileText = String(text || "").toLowerCase();
  const base = /WK/.test(role) ? 145 : /AR/.test(role) ? 148 : /BOWL/.test(role) ? 118 : 142;
  let boost = 0;
  if (/orange cap|run-scoring charts|premier opener|go-to batter|flamboyant|power-hitter|destructive|explosive/.test(profileText)) boost += 10;
  if (/opener|opening/.test(profileText)) boost += 5;
  if (/finisher/.test(profileText)) boost += 6;
  if (batting && batting.average >= 40) boost += 4;
  if (batting && batting.runs >= 500) boost += 5;
  return clamp(Math.round(base + boost), 120, 185);
}

function inferRecentScores(batting, text) {
  if (!batting) return [];
  const profileText = String(text || "").toLowerCase();
  const avg = batting.average || Math.max(18, Math.round((batting.runs || 0) / 10));
  const high = batting.highest || Math.round(avg * 1.7);
  let formBoost = 0;
  if (/back in form|orange cap|won the orange cap|consistent|high run-scoring seasons|winning campaign/.test(profileText)) formBoost += 8;
  const recentBase = clamp(Math.round(avg + formBoost), 16, Math.max(32, high));
  return [
    clamp(recentBase + 10, 0, high),
    clamp(recentBase - 6, 0, high),
    clamp(recentBase + 4, 0, high),
    clamp(recentBase - 2, 0, high),
    clamp(recentBase + 14, 0, high)
  ];
}

function inferRecentWickets(bowling, text) {
  if (!bowling) return [];
  const profileText = String(text || "").toLowerCase();
  let base = bowling.wickets >= 18 ? 2 : bowling.wickets >= 10 ? 1 : 0;
  if (/in form|leading wicket|purple cap|strike bowler|spearhead/.test(profileText)) base += 1;
  return [
    clamp(base + 1, 0, Math.max(1, bowling.bestWickets || 4)),
    clamp(base, 0, Math.max(1, bowling.bestWickets || 4)),
    clamp(base + 1, 0, Math.max(1, bowling.bestWickets || 4)),
    clamp(Math.max(0, base - 1), 0, Math.max(1, bowling.bestWickets || 4)),
    clamp(base + 2, 0, Math.max(1, bowling.bestWickets || 4))
  ];
}

function collectSeasonMentions(text) {
  const mentions = [];
  const patterns = [
    /IPL\s(20\d{2})[^.]{0,180}?(\d+)\s+runs[^.]{0,120}?(?:average of\s([\d.]+))?[^.]{0,120}?(?:strike rate of\s([\d.]+))?[^.]{0,120}?(?:top score of\s(\d+))/gi,
    /IPL\s(20\d{2})[^.]{0,180}?(\d+)\s+wickets[^.]{0,120}?(?:economy of\s([\d.]+))?[^.]{0,120}?(?:best figures? of\s(\d+))/gi
  ];
  patterns.forEach((pattern, patternIndex) => {
    let match;
    while ((match = pattern.exec(text))) {
      if (patternIndex === 0) {
        mentions.push({
          year: Number(match[1]),
          batting: {
            runs: Number(match[2] || 0),
            average: Number(match[3] || 0),
            strikeRate: Number(match[4] || 0),
            highest: Number(match[5] || 0)
          }
        });
      } else {
        mentions.push({
          year: Number(match[1]),
          bowling: {
            wickets: Number(match[2] || 0),
            economy: Number(match[3] || 0),
            bestWickets: Number(match[4] || 0)
          }
        });
      }
    }
  });
  return mentions.sort((a, b) => b.year - a.year);
}

function parseOfficialProfileStats(playerName, role, profileText, profileUrl) {
  const matches = parseOverviewNumber(profileText, "Matches");
  const seasonMentions = collectSeasonMentions(profileText);
  const latestBatting = seasonMentions.find(item => item.batting)?.batting || null;
  const latestBowling = seasonMentions.find(item => item.bowling)?.bowling || null;
  const profile = {};
  const battingBlock = latestBatting ? {
    runs: latestBatting.runs || 0,
    average: latestBatting.average || 0,
    strikeRate: latestBatting.strikeRate || inferStrikeRateFromText(role, profileText, latestBatting),
    highest: latestBatting.highest || Math.max(40, Math.round((latestBatting.average || 24) * 1.8)),
    recentScores: inferRecentScores(latestBatting, profileText)
  } : null;
  const bowlingBlock = latestBowling ? {
    wickets: latestBowling.wickets || 0,
    economy: latestBowling.economy || (/BOWL/.test(role) ? 8.1 : 8.7),
    bestWickets: latestBowling.bestWickets || 3,
    recentWickets: inferRecentWickets(latestBowling, profileText)
  } : null;
  if (latestBatting || /batter|wk-batter|batsman/i.test(profileText) || /BAT|WK/.test(role)) {
    profile.ipl = {
      matches,
      batting: battingBlock || {
        runs: 0,
        average: 24,
        strikeRate: inferStrikeRateFromText(role, profileText, null),
        highest: 45,
        recentScores: inferRecentScores({ average: 24, highest: 45, runs: 180 }, profileText)
      },
      bowling: bowlingBlock
    };
  } else if (latestBowling || /bowler|all-rounder/i.test(profileText) || /BOWL|AR/.test(role)) {
    profile.ipl = {
      matches,
      batting: /AR/.test(role) ? {
        runs: 140,
        average: 20,
        strikeRate: inferStrikeRateFromText(role, profileText, null),
        highest: 34,
        recentScores: inferRecentScores({ average: 20, highest: 34, runs: 140 }, profileText)
      } : null,
      bowling: bowlingBlock || {
        wickets: /BOWL/.test(role) ? 12 : 6,
        economy: /BOWL/.test(role) ? 8.1 : 8.8,
        bestWickets: /BOWL/.test(role) ? 4 : 2,
        recentWickets: inferRecentWickets({ wickets: /BOWL/.test(role) ? 12 : 6, bestWickets: /BOWL/.test(role) ? 4 : 2 }, profileText)
      }
    };
  }
  if (!profile.ipl) {
    return {
      ok: false,
      reason: `Could not extract usable official IPL stats for ${playerName}`,
      profileUrl
    };
  }
  return {
    ok: true,
    stats: profile,
    profileUrl
  };
}

function cleanNumber(value) {
  const text = String(value || "").replace(/[^0-9.]/g, "");
  return text ? Number(text) : 0;
}

function buildRecentScoresFromSeason(row) {
  const avg = cleanNumber(row.avg);
  const high = cleanNumber(row.hs);
  const sr = cleanNumber(row.sr);
  const base = Math.max(12, Math.round(avg || cleanNumber(row.runs) / Math.max(1, cleanNumber(row.mat) || 1)));
  const aggressionBoost = sr >= 170 ? 8 : sr >= 150 ? 4 : 0;
  return [
    Math.min(high || 120, base + aggressionBoost + 10),
    Math.min(high || 120, Math.max(0, base - 8)),
    Math.min(high || 120, base + aggressionBoost),
    Math.min(high || 120, Math.max(0, base - 2)),
    Math.min(high || 120, base + aggressionBoost + 5)
  ];
}

function buildRecentWicketsFromSeason(row) {
  const wkts = cleanNumber(row.wkts);
  const bbi = cleanNumber(row.bbi);
  const mat = Math.max(1, cleanNumber(row.mat));
  const base = wkts / mat;
  return [
    Math.min(bbi || 4, Math.max(0, Math.round(base + 1))),
    Math.min(bbi || 4, Math.max(0, Math.round(base))),
    Math.min(bbi || 4, Math.max(0, Math.round(base + 1))),
    Math.min(bbi || 4, Math.max(0, Math.round(base))),
    Math.min(bbi || 4, Math.max(0, Math.round(base + 2)))
  ];
}

function mergeSeasonStat(target, patch) {
  const current = target || {};
  return {
    matches: patch.matches || current.matches || 0,
    batting: patch.batting || current.batting || null,
    bowling: patch.bowling || current.bowling || null
  };
}

async function scrapeSeasonStatsPage() {
  if (seasonStatsCache) return seasonStatsCache;
  const statsMap = {};
  await withBrowserPage(async page => {
    await page.goto("https://www.iplt20.com/stats/2026", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    async function openTable(label) {
      await page.locator(`text=${label}`).first().evaluate(el => el.click());
      await page.waitForTimeout(2500);
      const viewAll = page.getByText("View All", { exact: true }).first();
      if (await viewAll.count()) {
        await viewAll.evaluate(el => el.click());
        await page.waitForTimeout(2500);
      }
      return page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table) return [];
        const rows = Array.from(table.querySelectorAll("tr"));
        return rows.slice(1).map(tr => {
          const cells = Array.from(tr.querySelectorAll("td,th"));
          const values = cells.map(td => td.innerText.trim());
          const anchor = tr.querySelector("a.st-ply");
          return {
            values,
            href: anchor ? anchor.getAttribute("href") || "" : ""
          };
        }).filter(row => row.values.length > 3);
      });
    }
    const battingRows = await openTable("Orange Cap");
    battingRows.forEach(row => {
      const playerSlug = row.href.split("/players/")[1]?.split("/")[0] || "";
      const playerName = unslugName(playerSlug) || String(row.values[1] || "").split("\n")[0].trim();
      if (!playerName) return;
      const team = String(row.values[1] || "").split("\n")[1]?.trim() || "";
      const batting = {
        runs: cleanNumber(row.values[2]),
        average: cleanNumber(row.values[7]),
        strikeRate: cleanNumber(row.values[9]),
        highest: cleanNumber(row.values[6]),
        recentScores: buildRecentScoresFromSeason({
          runs: row.values[2],
          mat: row.values[3],
          hs: row.values[6],
          avg: row.values[7],
          sr: row.values[9]
        }),
        fours: cleanNumber(row.values[12]),
        sixes: cleanNumber(row.values[13]),
        fifties: cleanNumber(row.values[11]),
        hundreds: cleanNumber(row.values[10])
      };
      statsMap[playerName] = mergeSeasonStat(statsMap[playerName], {
        matches: cleanNumber(row.values[3]),
        batting,
        team
      });
    });
    const bowlingRows = await openTable("Purple Cap");
    bowlingRows.forEach(row => {
      const playerSlug = row.href.split("/players/")[1]?.split("/")[0] || "";
      const playerName = unslugName(playerSlug) || "";
      if (!playerName) return;
      const team = String(row.values[1] || "").split("\n")[1]?.trim() || "";
      const wickets = cleanNumber(row.values[2]);
      const bowling = {
        wickets,
        economy: cleanNumber(row.values[9]),
        bestWickets: cleanNumber(row.values[7]),
        recentWickets: buildRecentWicketsFromSeason({
          wkts: row.values[2],
          mat: row.values[3],
          bbi: row.values[7]
        }),
        average: cleanNumber(row.values[8]),
        strikeRate: cleanNumber(row.values[10])
      };
      statsMap[playerName] = mergeSeasonStat(statsMap[playerName], {
        matches: cleanNumber(row.values[3]),
        bowling,
        team
      });
    });
  });
  seasonStatsCache = statsMap;
  return statsMap;
}

async function fetchOfficialPlayerStats(player) {
  const teamHtml = await fetchTeamPage(player.team);
  const profileUrl = findPlayerProfileUrl(teamHtml, player.name);
  if (!profileUrl) {
    return { ok: false, reason: `Official IPL profile link not found for ${player.name}` };
  }
  const profileText = await fetchProfileText(profileUrl);
  return parseOfficialProfileStats(player.name, player.role, profileText, profileUrl);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleOfficialSync(req, res) {
  const body = await readJsonBody(req);
  const players = Array.isArray(body.players) ? body.players : [];
  const offset = Number(body.offset) || 0;
  const limit = Math.max(1, Math.min(12, Number(body.limit) || 8));
  const batch = players.slice(offset, offset + limit);
  const cache = await readCache();
  const seasonStats = await scrapeSeasonStatsPage();
  const synced = {};
  const notFound = [];
  const errors = [];
  for (const player of batch) {
    if (!player || !player.name || !player.team) continue;
    if (cache[player.name]) {
      synced[player.name] = cache[player.name];
      continue;
    }
    try {
      const seasonProfile = seasonStats[player.name];
      if (seasonProfile) {
        const normalized = {
          ipl: {
            matches: seasonProfile.matches || 0,
            batting: seasonProfile.batting || null,
            bowling: seasonProfile.bowling || null
          }
        };
        cache[player.name] = normalized;
        synced[player.name] = normalized;
      } else {
        const result = await fetchOfficialPlayerStats(player);
        if (result.ok) {
          cache[player.name] = result.stats;
          synced[player.name] = result.stats;
        } else {
          notFound.push({ name: player.name, reason: result.reason || "Not found" });
        }
      }
    } catch (err) {
      errors.push({ name: player.name, reason: err.message });
    }
  }
  await writeCache(cache);
  const nextOffset = Math.min(players.length, offset + batch.length);
  sendJson(res, 200, {
    ok: true,
    synced,
    notFound,
    errors,
    nextOffset,
    done: nextOffset >= players.length,
    cacheCount: Object.keys(cache).length
  });
}

async function handleCachedStats(_req, res) {
  const cache = await readCache();
  sendJson(res, 200, { ok: true, stats: cache });
}

async function handleResetCache(_req, res) {
  seasonStatsCache = null;
  await writeCache({});
  sendJson(res, 200, { ok: true });
}

async function handleBrowserFetchTest(_req, res) {
  const url = "https://www.espncricinfo.com/records/tournament/batting-most-runs-career/indian-premier-league-17740";
  const result = await withBrowserPage(async page => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    const bodyText = await page.locator("body").innerText();
    const tableCount = await page.locator("table").count();
    return {
      title,
      tableCount,
      sample: bodyText.slice(0, 2000)
    };
  });
  sendJson(res, 200, { ok: true, url, result });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/cached-player-stats") {
      await handleCachedStats(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/sync-official-stats") {
      await handleOfficialSync(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/reset-official-stats") {
      await handleResetCache(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/test-browser-fetch") {
      await handleBrowserFetchTest(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`IPL game server running at http://localhost:${PORT}`);
});
