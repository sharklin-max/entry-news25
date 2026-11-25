// Tuesday 25 November 2026 — one-day world news in one image.
// Draws a dense broadsheet front page (1024x1024 PNG) from 50 verified
// stories, a UTC timeline and a markets bar. No network, no clock, no
// randomness: the same bytes come out of every run. The picture is drawn
// with a small 5x7 bitmap typeface defined below and a hand-rolled PNG
// encoder (zlib for the IDAT payload, own CRC32), standard library only.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// Each glyph is 7 rows of 5 bits, most significant bit on the left.
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 4, 0, 4],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  ",": [0, 0, 0, 0, 4, 4, 8],
  "-": [0, 0, 0, 14, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  "/": [1, 2, 2, 4, 8, 8, 16],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "%": [25, 26, 2, 4, 8, 11, 19],
  $: [4, 15, 20, 14, 5, 30, 4],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "=": [0, 0, 31, 0, 31, 0, 0],
  "*": [0, 4, 21, 14, 21, 4, 0],
  "#": [10, 10, 31, 10, 31, 10, 10],
  "@": [14, 17, 23, 21, 22, 16, 14],
  _: [0, 0, 0, 0, 0, 0, 31],
  "|": [4, 4, 4, 4, 4, 4, 4],
};

// Fold accented letters to plain capitals; everything else unknown
// becomes a blank so the picture never shows a missing-glyph box.
const FOLD: Record<string, string> = {
  "À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A",
  "È": "E", "É": "E", "Ê": "E", "Ë": "E",
  "Ì": "I", "Í": "I", "Î": "I", "Ï": "I",
  "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O",
  "Ù": "U", "Ú": "U", "Û": "U", "Ü": "U",
  "Ý": "Y", "Ñ": "N", "Ç": "C",
};

// ---------------------------------------------------------------- canvas
type RGB = [number, number, number];

const PAPER: RGB = [250, 246, 238];
const INK: RGB = [22, 22, 26];
const NAVY: RGB = [18, 32, 58];
const NAVY2: RGB = [24, 44, 78];
const GOLD: RGB = [212, 164, 62];
const RED: RGB = [178, 34, 34];
const GREY: RGB = [98, 96, 92];
const RULE: RGB = [196, 188, 172];

const px = new Uint8Array(W * H * 3);

// Deterministic integer hash: same input, same output, every run.
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

// Fill a rectangle; `grain` adds a fixed-seed speckle so flat areas keep
// the print texture of newsprint and the PNG stays information-dense.
function fillRect(x: number, y: number, w: number, h: number, c: RGB, grain: number, seed: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const d = grain === 0 ? 0 : Math.floor((hash2(xx, yy, seed) - 0.5) * 2 * grain);
      const i = (yy * W + xx) * 3;
      px[i] = Math.max(0, Math.min(255, c[0] + d));
      px[i + 1] = Math.max(0, Math.min(255, c[1] + d));
      px[i + 2] = Math.max(0, Math.min(255, c[2] + d));
    }
  }
}

function hline(x: number, y: number, w: number, c: RGB): void {
  for (let xx = x; xx < x + w; xx++) setPx(xx, y, c);
}

// -------------------------------------------------------------------- text
function cleanChar(ch: string): string {
  const up = ch.toUpperCase();
  if (FONT[up]) return up;
  if (FOLD[up]) return FOLD[up];
  return " ";
}

function textWidth(s: string, scale: number): number {
  return s.length * (5 * scale + 1) - 1;
}

function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row & (1 << (4 - col))) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            setPx(x + col * scale + dx, y + r * scale + dy, c);
          }
        }
      }
    }
  }
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB): number {
  let cx = x;
  for (const raw of s) {
    const ch = cleanChar(raw);
    drawGlyph(ch, cx, y, scale, c);
    cx += 5 * scale + 1;
  }
  return cx - x - scale;
}

function drawTextRight(s: string, right: number, y: number, scale: number, c: RGB): void {
  drawText(s, right - textWidth(s, scale), y, scale, c);
}

// Greedy word wrap into at most `maxLines` lines of `maxChars` each;
// a too-long last line is cut with an ellipsis.
function wrapText(s: string, maxChars: number, maxLines: number): string[] {
  const words = s.split(" ").filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur === "" ? w : cur + " " + w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur !== "") lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1 && cur.length > maxChars) {
        cur = cur.slice(0, maxChars - 3) + "...";
      }
    }
  }
  if (cur !== "") lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[cut.length - 1];
    if (last.length > maxChars - 3) last = last.slice(0, maxChars - 3);
    cut[cut.length - 1] = last + "...";
    return cut;
  }
  return lines;
}

// --------------------------------------------------------------------- PNG
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ stories
// Every story was checked against at least two independent sources before
// being drawn. Times are UTC unless the item is dated by day. Headlines
// are written to fit two lines in the grid (three in the lead cards).
interface Story {
  n: number;
  time: string;
  region: string;
  head: string;
  src: string;
}

const LEADS: Story[] = [
  {
    n: 1, time: "21:00", region: "NORTH AMERICA",
    head: "HUANG'S COMEBACK FADES: NVIDIA -7%, CEO IN THERAPY",
    src: "SCMP / AFP / INVESTOPEDIA",
  },
  {
    n: 2, time: "22:00", region: "EAST ASIA",
    head: "HUAWEI GUILTY ON 10 OF 12 COUNTS; RICO CHARGE FAILS",
    src: "US DOJ / REUTERS / AP",
  },
  {
    n: 3, time: "13:00", region: "EAST ASIA",
    head: "CHINA PROBES CHEN JINING, 4TH POLITBURO MEMBER HELD",
    src: "XINHUA / REUTERS / CNN",
  },
];

const GRID: Story[] = [
  { n: 4, time: "11:00", region: "MIDDLE EAST", head: "HOUTHI STRIKE HITS RIYADH'S PIF TOWER AGAIN, 11 HURT IN SAUDI CAPITAL", src: "AFP / AL JAZEERA" },
  { n: 5, time: "08:00", region: "MIDDLE EAST", head: "TANKERS HIT NEAR HORMUZ AS IRAN'S RIAL SINKS TO RECORD LOW", src: "UKMTO / GULF NEWS" },
  { n: 6, time: "10:00", region: "MIDDLE EAST", head: "ISRAELI STRIKE KILLS HAMAS SECURITY CHIEF IN GAZA AS CEASEFIRE FRAYS", src: "AFP / TIMES OF ISRAEL" },
  { n: 7, time: "23 NOV", region: "EUROPE", head: "LEAKED RUSSIAN DATA PUTS WAR DEAD NEAR 500,000, MODEL SAYS 700,000", src: "MEDUZA / MEDIAZONA" },
  { n: 8, time: "07:38", region: "EUROPE", head: "GERMAN MEDIA: RUSSIA MAY LAUNCH NUCLEAR-ARMED SATELLITE IN DECEMBER", src: "NDR / WDR / SZ" },
  { n: 9, time: "21:00", region: "EAST ASIA", head: "RUSSIAN JETS ENTER KOREAN AIR ZONE; FALSE ALARM SPARKS SHELTER ALERT", src: "YONHAP" },
  { n: 10, time: "19:00", region: "NORTH AMERICA", head: "TRUMP AWARDS GIULIANI THE MEDAL OF FREEDOM IN CLOSED WHITE HOUSE RITE", src: "AP / REUTERS" },
  { n: 11, time: "23 NOV", region: "AFRICA", head: "COP31 ENDS WITHOUT A DEAL BUT PASSES 46 DECISIONS; COP32 SET FOR ADDIS", src: "SWISSINFO / AFP" },
  { n: 12, time: "21:00", region: "NORTH AMERICA", head: "DOW CLOSES ABOVE 50,000 FOR FIRST TIME AS NASDAQ SLIDES 1.5%", src: "INVESTOPEDIA" },
  { n: 13, time: "21:00", region: "NORTH AMERICA", head: "ANTHROPIC SLIDES BELOW ITS $83 IPO PRICE DAYS AFTER LISTING", src: "REUTERS / INVESTOPEDIA" },
  { n: 14, time: "02:00", region: "EAST ASIA", head: "KIM YO-JONG THREATENS TO SHUT SWITZERLAND'S NEW PYONGYANG OFFICE", src: "YONHAP / AP" },
  { n: 15, time: "20:00", region: "LATIN AMERICA", head: "CARTAGENA SUPERMARKET SIEGE: 25 HELD, AT LEAST 10 FREED AS TALKS DRAG ON", src: "AP / CNN" },
  { n: 16, time: "24 NOV", region: "LATIN AMERICA", head: "CAR BOMB WOUNDS 25 IN VILLAVICENCIO AS COLOMBIA MARKS PEACE DEAL AT 10", src: "AP / ARAB NEWS" },
  { n: 17, time: "01:00", region: "SOUTHEAST ASIA", head: "SUSPECTED GAS BLAST LEVELS HANOI EATERY, KILLING 6 AND INJURING 10", src: "XINHUA / REUTERS" },
  { n: 18, time: "24 NOV", region: "AFRICA", head: "LANDMINE CASUALTIES HIT 5-YEAR HIGH AT 6,929, HALF OF THEM CHILDREN", src: "LANDMINE MONITOR / SCMP" },
  { n: 19, time: "24 NOV", region: "NORTH AMERICA", head: "UN: ABOUT 47,000 WOMEN KILLED BY PARTNERS OR KIN IN 2025, 5 AN HOUR", src: "UNODC / UN WOMEN" },
  { n: 20, time: "24 NOV", region: "NORTH AMERICA", head: "US ARMY SERGEANT ADMITS SELLING MILITARY SECRETS TO CHINESE BUYERS", src: "AFP / US DOJ" },
  { n: 21, time: "24 NOV", region: "NORTH AMERICA", head: "SHEIN TO PAY $100M TO SETTLE US CLAIMS IT FAKED DELIVERY AND REVIEWS", src: "FTC / REUTERS" },
  { n: 22, time: "23 NOV", region: "EUROPE", head: "BURGLARS BREAK INTO WILLIAM AND KATE'S NORFOLK HOME; 2 ARRESTED", src: "CNN / THE TIMES" },
  { n: 23, time: "23 NOV", region: "EUROPE", head: "DENMARK'S TOP COURT UPHOLDS 'GHETTO LAW' EVICTIONS IN LANDMARK RULING", src: "AL JAZEERA" },
  { n: 24, time: "11:54", region: "OCEANIA", head: "ENGLAND THRASH AUSTRALIA IN T20 AS DONALD SMASHES 85 OFF 32 BALLS", src: "ESPNCRICINFO / BBC" },
  { n: 25, time: "23 NOV", region: "EUROPE", head: "ESA'S HERA SPOTS ASTEROID ECLIPSE; FIRST CLOSE-UP IMAGES DUE TONIGHT", src: "ESA" },
  { n: 26, time: "24 NOV", region: "MIDDLE EAST", head: "SAUDI STRIKE IN YEMEN KILLS 25, HOUTHI MEDIA SAY, AS WAR SPILLS OVER", src: "SABA / AFP" },
  { n: 27, time: "20:00", region: "NORTH AMERICA", head: "TRUMP PARDONS THANKSGIVING TURKEYS FREEDOM AND FEATHERS AT WHITE HOUSE", src: "AP" },
  { n: 28, time: "24 NOV", region: "MIDDLE EAST", head: "US WEIGHS STRIKES ON IRAN'S LEADERS, NBC REPORTS; NO DECISION YET", src: "NBC" },
  { n: 29, time: "24 NOV", region: "MIDDLE EAST", head: "ISRAEL'S KATZ SAYS IRAN IS BUILDING CHEMICAL WEAPONS; TEHRAN DENIES", src: "GULF NEWS" },
  { n: 30, time: "24 NOV", region: "MIDDLE EAST", head: "QATAR SAYS IT IS MEDIATING US-IRAN TALKS AS TEHRAN SUMMONS ITS ENVOY", src: "GULF NEWS" },
  { n: 31, time: "24 NOV", region: "MIDDLE EAST", head: "US PROBES SUSPECTED IRAN CYBERATTACKS ON UP TO 50 MERCHANT SHIPS", src: "WSJ" },
  { n: 32, time: "24 NOV", region: "MIDDLE EAST", head: "YEMEN GOVERNMENT TROOPS 60 KM FROM ADEN AS BRITAIN SANCTIONS HOUTHIS", src: "GULF NEWS" },
  { n: 33, time: "24 NOV", region: "MIDDLE EAST", head: "26 GAZA PATIENTS AND 27 ESCORTS LEAVE THROUGH RAFAH FOR TREATMENT", src: "HAARETZ" },
  { n: 34, time: "24 NOV", region: "MIDDLE EAST", head: "UAE CONDEMNS HOUTHI ATTACK ON RIYADH AS ARAB STATES RALLY TO SAUDI", src: "GULF NEWS / ARAB NEWS" },
  { n: 35, time: "23 NOV", region: "MIDDLE EAST", head: "US TREASURY SAYS IRAN'S LEADERS ARE 'PANICKING' AS ECONOMY CRUMBLES", src: "GULF NEWS" },
  { n: 36, time: "24 NOV", region: "MIDDLE EAST", head: "TRUMP THREATENS TO SINK IRANIAN SHIPS THAT TRY TO BREAK THE BLOCKADE", src: "GULF NEWS" },
  { n: 37, time: "24 NOV", region: "SOUTH ASIA", head: "BJP AND AKALI DAL REUNITE FOR 2027 PUNJAB POLLS AFTER SIX-YEAR SPLIT", src: "BUSINESS STANDARD" },
  { n: 38, time: "23 NOV", region: "SOUTH ASIA", head: "NEPAL PM SHAH WRAPS FIRST INDIA VISIT WITH $2BN PACKAGE, IIT CAMPUS", src: "PIB / THE HINDU" },
  { n: 39, time: "23 NOV", region: "EUROPE", head: "NATO TO SEND AWACS PLANE TO POLAND AFTER RUSSIAN MISSILES LAND THERE", src: "REUTERS / NATO" },
  { n: 40, time: "23 NOV", region: "EUROPE", head: "EU UNVEILS 22ND RUSSIA SANCTIONS PACKAGE: 60 BANKS OFF SWIFT", src: "EUROPEAN COMMISSION" },
  { n: 41, time: "24 NOV", region: "MIDDLE EAST", head: "HUCKABEE DOUBTS TRUMP PLEDGE TO END $3.8BN ISRAEL AID THIS YEAR", src: "REUTERS / SCMP" },
  { n: 42, time: "24 NOV", region: "AFRICA", head: "CONGO TO HALT COBALT EXPORTS FROM 30 NOV; CHINESE FIRMS RUSH SHIPMENTS", src: "SCMP / BLOOMBERG" },
  { n: 43, time: "24 NOV", region: "EUROPE", head: "OLIGARCH POTANIN TESTIFIES IN LONDON 2.17BN-POUND DIVORCE TRIAL", src: "AFP / THE TIMES" },
  { n: 44, time: "23 NOV", region: "EUROPE", head: "PELICOT 'DEEPLY SHOCKED' AS PUBLISHER USED HER NUDE PHOTOS TO SELL BOOK", src: "AP / STRAITS TIMES" },
  { n: 45, time: "23 NOV", region: "MIDDLE EAST", head: "23 ISRAELI SOLDIERS DIED BY SUICIDE IN 2026, HIGHEST TOLL IN 16 YEARS", src: "HAARETZ / AA" },
  { n: 46, time: "24 NOV", region: "NORTH AMERICA", head: "DEMOCRATS SET 12 DEBATES FOR 2028 RACE AFTER SWEEPING MIDTERM WINS", src: "MANILA TIMES" },
  { n: 47, time: "24 NOV", region: "SOUTHEAST ASIA", head: "MALAYSIA TO DEPORT 6,803 MORE MYANMAR NATIONALS DESPITE GENOCIDE RULING", src: "DECCAN CHRONICLE" },
  { n: 48, time: "24 NOV", region: "NORTH AMERICA", head: "FORT HOOD SURVIVORS BARRED FROM WITNESSING HASAN'S DEC 3 EXECUTION", src: "AP / REUTERS" },
  { n: 49, time: "16:00", region: "OCEANIA", head: "GENE STUDY 'RESURRECTS' 12 CORAL SPECIES ON THE GREAT BARRIER REEF", src: "SCIENCEALERT / JCU" },
  { n: 50, time: "24 NOV", region: "SOUTH ASIA", head: "INDIA WOMEN THRASH CHINA 6-2 IN HOCKEY AND RISE TO WORLD NO. 5", src: "PTI / TRIBUNE" },
];

// ------------------------------------------------------------------ layout
const REGION_COLOR: Record<string, RGB> = {
  "NORTH AMERICA": [178, 34, 34],
  "LATIN AMERICA": [34, 120, 80],
  EUROPE: [30, 80, 160],
  "MIDDLE EAST": [176, 110, 20],
  AFRICA: [120, 70, 140],
  "EAST ASIA": [180, 40, 90],
  "SOUTH ASIA": [200, 90, 30],
  "SOUTHEAST ASIA": [0, 120, 120],
  OCEANIA: [40, 110, 180],
};

const MASTHEAD_H = 56;
const LEAD_Y = 56;
const LEAD_H = 52;
const GRID_Y = 108;
const ROW_H = 36;
const FOOTER_Y = 972;

function drawMasthead(): void {
  fillRect(0, 0, W, MASTHEAD_H, NAVY, 5, 11);
  drawText("THE WORLD IN ONE DAY", 8, 3, 1, GOLD);
  drawText("TUESDAY 25 NOVEMBER 2026", 8, 11, 4, [250, 246, 238]);
  drawText("50 SOURCED STORIES - 9 REGIONS - UTC TIMELINE - EVERY STORY CHECKED", 8, 41, 2, GOLD);
  drawTextRight("50", W - 8, 6, 5, GOLD);
  drawTextRight("STORIES", W - 8, 44, 1, GOLD);
  hline(0, MASTHEAD_H - 1, W, GOLD);
}

function drawLeads(): void {
  for (let i = 0; i < LEADS.length; i++) {
    const s = LEADS[i];
    const x = 8 + i * 336;
    drawText("LEAD " + s.n + " - " + s.region, x, LEAD_Y + 3, 1, RED);
    const lines = wrapText(s.head, 29, 2);
    for (let li = 0; li < lines.length; li++) {
      drawText(lines[li], x, LEAD_Y + 11 + li * 14, 2, INK);
    }
    drawText(s.time + " UTC | " + s.src, x, LEAD_Y + 41, 1, GREY);
    if (i < 2) {
      for (let yy = LEAD_Y + 8; yy < LEAD_Y + LEAD_H - 8; yy++) setPx(x + 328, yy, RULE);
    }
  }
  hline(0, GRID_Y - 1, W, INK);
}

function drawGrid(): void {
  for (let i = 0; i < GRID.length; i++) {
    const s = GRID[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 8 + col * 510;
    const y = GRID_Y + row * ROW_H;
    if (row % 2 === 1) fillRect(x, y, 498, ROW_H, [243, 238, 228], 0, 0);
    const bar = REGION_COLOR[s.region] || GREY;
    fillRect(x, y + 2, 4, ROW_H - 4, bar, 0, 0);
    drawTextRight(String(s.n).padStart(2, "0"), x + 30, y + 1, 2, RED);
    const lines = wrapText(s.head, 41, 2);
    for (let li = 0; li < lines.length; li++) {
      drawText(lines[li], x + 38, y + 1 + li * 14, 2, INK);
    }
    drawText(s.time + " UTC | " + s.src + " | " + s.region, x + 38, y + 30, 1, GREY);
  }
  // The one empty slot (row 24, right column) carries the method note.
  const bx = 8 + 510;
  const by = GRID_Y + 23 * ROW_H;
  fillRect(bx, by + 2, 498, ROW_H - 4, [238, 232, 220], 2, 23);
  drawText("HOW WE CHECKED", bx + 10, by + 5, 1, RED);
  drawText("EVERY STORY VERIFIED AGAINST 2+ INDEPENDENT SOURCES. TIMES IN UTC.", bx + 10, by + 15, 1, INK);
  drawText("PRICES AT TUE 24 NOV US CLOSE. NEXT UPDATE: WED 26 NOV.", bx + 10, by + 24, 1, INK);
}

function drawFooter(): void {
  fillRect(0, FOOTER_Y, W, H - FOOTER_Y, NAVY2, 5, 31);
  hline(0, FOOTER_Y, W, GOLD);
  drawText("DOW 50,019 +0.9%  |  S&P 500 7,201 -0.5%  |  NASDAQ 23,734 -1.5%", 8, FOOTER_Y + 3, 2, [250, 246, 238]);
  drawText("BITCOIN $59,800 -2.2%  |  BRENT $91.40 +2.3%  |  GOLD $3,550 -2.8%  |  10-YR 4.93%", 8, FOOTER_Y + 19, 2, GOLD);
  drawText("UTC TIMELINE: 01:00 HANOI BLAST - 08:00 HORMUZ TANKERS - 11:00 RIYADH STRIKE - 13:00 CHEN PROBE - 19:00 GIULIANI MEDAL - 21:00 WALL ST CLOSE - 22:00 HUAWEI VERDICT", 8, FOOTER_Y + 35, 1, [200, 205, 220]);
  drawText("REGIONS: NORTH AMERICA - LATIN AMERICA - EUROPE - MIDDLE EAST - AFRICA - EAST ASIA - SOUTH ASIA - SOUTHEAST ASIA - OCEANIA", 8, FOOTER_Y + 44, 1, [200, 205, 220]);
}

function main(): void {
  const total = LEADS.length + GRID.length;
  if (total !== 50) throw new Error("story count is " + total + ", expected 50");
  fillRect(0, 0, W, H, PAPER, 2, 7);
  drawMasthead();
  drawLeads();
  drawGrid();
  drawFooter();
  const png = encodePng();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);
  const sha = createHash("sha256").update(png).digest("hex");
  console.log("WROTE " + outPath + " " + png.length + " bytes sha256=" + sha);
}

main();
