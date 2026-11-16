import type { SportId } from "@/lib/types";

/**
 * Entirely fictional teams and name pools for the DEMO data set.
 * None of these represent real clubs, leagues or athletes.
 */
export interface DemoTeamSeed {
  city: string;
  name: string;
  abbr: string;
  conference: string;
  venue: string;
  colors: [string, string];
}

export const DEMO_TEAMS: Record<SportId, DemoTeamSeed[]> = {
  nba: [
    { city: "Harbor City", name: "Tides", abbr: "HCT", conference: "East", venue: "Pier 9 Arena", colors: ["#1e6fd9", "#0b2545"] },
    { city: "Ironvale", name: "Forge", abbr: "IRF", conference: "East", venue: "Anvil Center", colors: ["#d9622b", "#2b2d42"] },
    { city: "Northgate", name: "Lynx", abbr: "NGL", conference: "East", venue: "Gateway Fieldhouse", colors: ["#2bb39b", "#102a2a"] },
    { city: "Redwater", name: "Herons", abbr: "RWH", conference: "East", venue: "Riverside Dome", colors: ["#c81d4e", "#3a0d1b"] },
    { city: "Summit Bay", name: "Glaciers", abbr: "SBG", conference: "West", venue: "Bayfront Arena", colors: ["#6ec1e4", "#14324a"] },
    { city: "Granite Falls", name: "Rams", abbr: "GFR", conference: "West", venue: "Quarry Court", colors: ["#a3a3a3", "#3b2f5c"] },
    { city: "Coral Point", name: "Mantas", abbr: "CPM", conference: "West", venue: "Reef Pavilion", colors: ["#ff7a59", "#063a4a"] },
    { city: "Silverton", name: "Comets", abbr: "SLC", conference: "West", venue: "Starlight Arena", colors: ["#c0c7d1", "#4b1d6b"] },
  ],
  nfl: [
    { city: "Eastport", name: "Anchors", abbr: "EPA", conference: "North", venue: "Dockside Stadium", colors: ["#264b8c", "#d4a017"] },
    { city: "Westbrook", name: "Stallions", abbr: "WBS", conference: "North", venue: "Paddock Field", colors: ["#7a1f2b", "#e8c07d"] },
    { city: "Pine Ridge", name: "Timberwolves", abbr: "PRT", conference: "North", venue: "Evergreen Park", colors: ["#2f6b3a", "#c7c2b0"] },
    { city: "Lakeshore", name: "Mariners", abbr: "LSM", conference: "North", venue: "Shoreline Bowl", colors: ["#1b8fbf", "#0c1f33"] },
    { city: "Copper Mesa", name: "Scorpions", abbr: "CMS", conference: "South", venue: "Canyon Stadium", colors: ["#c46b2a", "#2d1a0e"] },
    { city: "Bayou Crest", name: "Gators", abbr: "BCG", conference: "South", venue: "Delta Field", colors: ["#3e8e41", "#f2d16b"] },
    { city: "Highland", name: "Monarchs", abbr: "HLM", conference: "South", venue: "Crown Stadium", colors: ["#5b2c83", "#e0b84a"] },
    { city: "Stonebridge", name: "Titans", abbr: "SBT", conference: "South", venue: "Keystone Field", colors: ["#4a5568", "#e53e3e"] },
  ],
  mlb: [
    { city: "Riverbend", name: "Otters", abbr: "RBO", conference: "League A", venue: "Riverbend Yard", colors: ["#7b4a2a", "#e9d8a6"] },
    { city: "Maple Grove", name: "Cardinals", abbr: "MGC", conference: "League A", venue: "Grove Park", colors: ["#c1121f", "#fdf0d5"] },
    { city: "Port Haven", name: "Clippers", abbr: "PHC", conference: "League A", venue: "Harborlight Field", colors: ["#003049", "#f77f00"] },
    { city: "Dustin Valley", name: "Miners", abbr: "DVM", conference: "League A", venue: "Lode Stadium", colors: ["#6c757d", "#ffba08"] },
    { city: "Sunfield", name: "Suns", abbr: "SFS", conference: "League B", venue: "Solar Park", colors: ["#f48c06", "#370617"] },
    { city: "Cold Spring", name: "Polar Bears", abbr: "CSP", conference: "League B", venue: "Frost Field", colors: ["#90e0ef", "#03045e"] },
    { city: "Oak Hollow", name: "Owls", abbr: "OHO", conference: "League B", venue: "Hollow Grounds", colors: ["#606c38", "#fefae0"] },
    { city: "Brightwater", name: "Pelicans", abbr: "BWP", conference: "League B", venue: "Tidewater Park", colors: ["#219ebc", "#ffb703"] },
  ],
  nhl: [
    { city: "Frostburg", name: "Wolves", abbr: "FBW", conference: "Atlantic", venue: "Icehouse Arena", colors: ["#4ea8de", "#0b132b"] },
    { city: "Kingsport", name: "Knights", abbr: "KPK", conference: "Atlantic", venue: "Citadel Center", colors: ["#b5179e", "#240046"] },
    { city: "Blackrock", name: "Ravens", abbr: "BRR", conference: "Atlantic", venue: "Basalt Arena", colors: ["#8d99ae", "#14151a"] },
    { city: "Elm Harbor", name: "Pilots", abbr: "EHP", conference: "Atlantic", venue: "Hangar Garden", colors: ["#e63946", "#1d3557"] },
    { city: "Cedar Rapids North", name: "Lumberjacks", abbr: "CRL", conference: "Pacific", venue: "Sawmill Arena", colors: ["#bc6c25", "#283618"] },
    { city: "Glacier Point", name: "Yetis", abbr: "GPY", conference: "Pacific", venue: "Summit Ice", colors: ["#caf0f8", "#023e8a"] },
    { city: "Ember City", name: "Blaze", abbr: "ECB", conference: "Pacific", venue: "Furnace Arena", colors: ["#f3722c", "#3d0c02"] },
    { city: "Seaview", name: "Squall", abbr: "SVS", conference: "Pacific", venue: "Breakwater Center", colors: ["#43aa8b", "#0d1b2a"] },
  ],
  soccer: [
    { city: "Ashford", name: "United", abbr: "ASU", conference: "Premier Demo", venue: "Ashford Park", colors: ["#d62828", "#ffffff"] },
    { city: "Kingsbridge", name: "Rovers", abbr: "KBR", conference: "Premier Demo", venue: "Bridge Lane", colors: ["#1d4ed8", "#facc15"] },
    { city: "Millbrook", name: "Athletic", abbr: "MBA", conference: "Premier Demo", venue: "Mill Road", colors: ["#15803d", "#f8fafc"] },
    { city: "Hartwell", name: "City", abbr: "HWC", conference: "Premier Demo", venue: "Hartwell Stadium", colors: ["#38bdf8", "#0f172a"] },
    { city: "Saltmarsh", name: "Wanderers", abbr: "SMW", conference: "Premier Demo", venue: "Marsh End", colors: ["#f97316", "#1c1917"] },
    { city: "Ravensford", name: "FC", abbr: "RVF", conference: "Premier Demo", venue: "The Rookery", colors: ["#111827", "#e5e7eb"] },
    { city: "Westmere", name: "Albion", abbr: "WMA", conference: "Premier Demo", venue: "Mere Park", colors: ["#7e22ce", "#fde68a"] },
    { city: "Thornbury", name: "Town", abbr: "TBT", conference: "Premier Demo", venue: "Thorn Road", colors: ["#b91c1c", "#0369a1"] },
  ],
};

export const FIRST_NAMES = [
  "Aiden", "Marcus", "Teo", "Darius", "Kellan", "Rafael", "Jonah", "Malik", "Elias", "Corbin", "Dante", "Kenji", "Luca", "Mateo",
  "Silas", "Tobias", "Ezra", "Jalen", "Rowan", "Callum", "Idris", "Nico", "Arlo", "Desmond", "Bram", "Cyrus", "Omari", "Felix",
  "Quinn", "Remy", "Soren", "Tariq", "Viktor", "Wes", "Yusuf", "Zane", "Ansel", "Bastian", "Cole", "Dorian", "Emeka", "Finnian",
  "Gideon", "Hugo", "Ivo", "Joaquin", "Kofi", "Leif", "Milo", "Nash", "Oren", "Pax", "Rhys", "Sami", "Thiago", "Ulises", "Vance",
];

export const LAST_NAMES = [
  "Ashcroft", "Bellamy", "Calloway", "Dunmore", "Everly", "Fairbanks", "Galloway", "Hargrove", "Ingram", "Jessup", "Kingsley",
  "Lockhart", "Mercer", "Northcott", "Okafor", "Pemberton", "Quarles", "Ravensworth", "Sutcliffe", "Thorne", "Underhill", "Vasquez",
  "Whitlock", "Yardley", "Abernathy", "Blackwood", "Crestfield", "Delacroix", "Easterling", "Fenwick", "Greaves", "Holloway",
  "Iwobi", "Jarrell", "Kessler", "Larkspur", "Montclair", "Nakamura", "Oduya", "Prescott", "Rourke", "Stavros", "Tennant",
  "Valdivia", "Wexford", "Zelenko", "Ambrose", "Brightman", "Castellan", "Draper", "Ellsworth", "Fontaine", "Garrity",
];

/** Roster templates: position label, position group, and role. */
export const ROSTER_TEMPLATES: Record<SportId, { pos: string; group: string; role: "starter" | "rotation" | "reserve" }[]> = {
  nba: [
    { pos: "PG", group: "G", role: "starter" },
    { pos: "SG", group: "G", role: "starter" },
    { pos: "SF", group: "F", role: "starter" },
    { pos: "PF", group: "F", role: "starter" },
    { pos: "C", group: "C", role: "starter" },
    { pos: "G", group: "G", role: "rotation" },
    { pos: "F", group: "F", role: "rotation" },
  ],
  nfl: [
    { pos: "QB", group: "QB", role: "starter" },
    { pos: "RB", group: "RB", role: "starter" },
    { pos: "WR", group: "WR", role: "starter" },
    { pos: "WR", group: "WR", role: "starter" },
    { pos: "WR", group: "WR", role: "rotation" },
    { pos: "TE", group: "TE", role: "starter" },
  ],
  mlb: [
    { pos: "SS", group: "H", role: "starter" },
    { pos: "CF", group: "H", role: "starter" },
    { pos: "1B", group: "H", role: "starter" },
    { pos: "RF", group: "H", role: "starter" },
    { pos: "C", group: "H", role: "starter" },
    { pos: "SP", group: "SP", role: "starter" },
    { pos: "SP", group: "SP", role: "starter" },
  ],
  nhl: [
    { pos: "C", group: "F", role: "starter" },
    { pos: "LW", group: "F", role: "starter" },
    { pos: "RW", group: "F", role: "starter" },
    { pos: "C", group: "F", role: "rotation" },
    { pos: "D", group: "D", role: "starter" },
    { pos: "D", group: "D", role: "starter" },
    { pos: "G", group: "G", role: "starter" },
  ],
  soccer: [
    { pos: "ST", group: "FW", role: "starter" },
    { pos: "LW", group: "FW", role: "starter" },
    { pos: "CM", group: "MF", role: "starter" },
    { pos: "AM", group: "MF", role: "starter" },
    { pos: "DM", group: "MF", role: "rotation" },
    { pos: "CB", group: "DF", role: "starter" },
    { pos: "FB", group: "DF", role: "starter" },
    { pos: "GK", group: "GK", role: "starter" },
  ],
};

/** Game schedule cadence for the demo seasons. */
export const SCHEDULE: Record<SportId, { everyDays: number; offsetDays: number; hourUtc: number; minuteUtc: number }> = {
  nba: { everyDays: 2, offsetDays: 0, hourUtc: 23, minuteUtc: 45 },
  nhl: { everyDays: 2, offsetDays: 1, hourUtc: 23, minuteUtc: 30 },
  mlb: { everyDays: 1, offsetDays: 0, hourUtc: 23, minuteUtc: 5 },
  nfl: { everyDays: 7, offsetDays: 0, hourUtc: 18, minuteUtc: 0 },
  soccer: { everyDays: 7, offsetDays: 6, hourUtc: 15, minuteUtc: 0 },
};

export const DEMO_SEASONS = [
  { id: "2025-26", start: "2026-01-04", end: "2026-07-31" },
  { id: "2026-27", start: "2026-09-06", end: "2027-07-31" },
];
