// The CLI command tree AS DATA. The parser dispatches from this array and the
// docs site renders /docs/cli from it — one definition, no drift.
//
// PURITY CONTRACT: this module imports nothing (no db, no config, no env).
// The docs generator imports it at build time with an empty environment.

export type FlagDef = {
  flag: string;            // "--product"
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  default?: string | number | boolean;
};

export type CommandDef = {
  name: string;            // "queue approve"
  args?: string[];         // positional, e.g. ["id"]
  summary: string;
  flags: FlagDef[];
  examples: string[];
};

export const commands: CommandDef[] = [
  {
    name: "signup",
    summary: "create a funnelkeeper workspace (email verification, or --agent for an immediate api key + claim link)",
    flags: [
      { flag: "--agent", type: "boolean", description: "create via the agent path: returns an api key immediately plus a claim url for the human" },
      { flag: "--email", type: "string", description: "account email (prompted if omitted)" },
      { flag: "--name", type: "string", description: "owner display name (agent path only)" },
      { flag: "--api-url", type: "string", description: "api base url", default: "https://api.funnelkeeper.com" },
    ],
    examples: ["fk signup", "fk signup --agent --email you@example.com"],
  },
  {
    name: "login",
    summary: "sign in and store an api key in ~/.config/funnelkeeper (0600)",
    flags: [
      { flag: "--key", type: "boolean", description: "paste an existing api key instead of using a password" },
      { flag: "--api-url", type: "string", description: "api base url", default: "https://api.funnelkeeper.com" },
    ],
    examples: ["fk login", "fk login --key", "fk login --api-url http://localhost:3100"],
  },
  { name: "logout", summary: "delete the stored api key", flags: [], examples: ["fk logout"] },
  { name: "account", summary: "show the current workspace (name, email, role)", flags: [], examples: ["fk account"] },
  {
    name: "billing",
    summary: "show the current plan, trial, and usage (prints a checkout or portal url with --checkout / --portal)",
    flags: [
      { flag: "--checkout", type: "string", description: "indie | growth — print a Stripe Checkout URL" },
      { flag: "--portal", type: "boolean", description: "print the Stripe customer-portal URL" },
    ],
    examples: ["fk billing", "fk billing --checkout growth", "fk billing --portal"],
  },
  {
    name: "export",
    args: ["kind"],
    summary: "download events or transactions as csv (growth plan)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--out", type: "string", description: "write to this file instead of stdout" },
    ],
    examples: ["fk export events --product demo", "fk export transactions --product demo --out tx.csv"],
  },
  { name: "accounts", summary: "list workspaces this identity can see (api key: the key's tenant)", flags: [], examples: ["fk accounts"] },
  { name: "team", summary: "list people in the current workspace", flags: [], examples: ["fk team"] },
  {
    name: "team invite",
    summary: "invite someone to this workspace (existing funnelkeeper logins get a join link)",
    flags: [
      { flag: "--email", type: "string", description: "invitee email", required: true },
      { flag: "--role", type: "string", description: "owner | member", default: "member" },
    ],
    examples: ["fk team invite --email teammate@agency.com", "fk team invite --email owner@client.com --role owner"],
  },
  {
    name: "claim-link",
    summary: "print a fresh claim url so the human can set a password on an agent-created account",
    flags: [],
    examples: ["fk claim-link"],
  },
  {
    name: "product create",
    summary: "create a project in your account",
    flags: [
      { flag: "--name", type: "string", description: "display name", required: true },
      { flag: "--slug", type: "string", description: "url-safe id (lowercase, hyphens)", required: true },
      { flag: "--currency", type: "string", description: "iso currency code", default: "USD" },
      { flag: "--domain", type: "string", description: "project domain" },
    ],
    examples: ['fk product create --name "Demo" --slug demo --currency AUD'],
  },
  {
    name: "detect",
    args: ["url"],
    summary: "auto-detect active analytics, pixels, tag managers, and tools on a website or project",
    flags: [
      { flag: "--product", type: "string", description: "project slug (uses project domain if url omitted)" },
      { flag: "--url", type: "string", description: "website url to scan (e.g. https://motormerchants.com.au)" },
    ],
    examples: ["fk detect https://motormerchants.com.au", "fk detect --product demo-product"],
  },
  {
    name: "connect",
    args: ["source"],
    summary: "connect ga4 | gtm | google-ads | gsc (browser/SA), or semrush | clarity | posthog | opinly | bing | ahrefs | meta-ads | linkedin-ads | meta-social | x-social | stripe (token)",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk connect ga4 --product demo", "fk connect google-sa --product demo",
      "fk connect semrush --product demo", "fk connect clarity --product demo",
      "fk connect posthog --product demo", "fk connect opinly --product demo",
      "fk connect bing --product demo", "fk connect ahrefs --product demo",
      "fk connect stripe --product demo"],
  },
  {
    name: "connect test",
    args: ["source"],
    summary: "verify a connected source can actually deliver data",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk connect test ga4 --product demo"],
  },
  {
    name: "connect sync",
    args: ["source"],
    summary: "sync mysql | postgres | mongo | ga4 | posthog | opinly | gsc | bing | meta-ads | linkedin-ads | meta-social | x-social | stripe now",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk connect sync mysql --product motor-merchants"],
  },
  { name: "status", summary: "pipeline health: jobs, sources, queue backlog", flags: [], examples: ["fk status"] },
  {
    name: "track",
    summary: "send a first-party funnel event (server-side, uses your api key)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--stage", type: "string", description: "canonical stage (lead, converted, …)", required: true },
      { flag: "--dedupe", type: "string", description: "idempotency key (required)", required: true },
      { flag: "--name", type: "string", description: "free-form event name" },
      { flag: "--email", type: "string", description: "identity email" },
      { flag: "--external-id", type: "string", description: "identity external id" },
      { flag: "--score", type: "string", description: "lead grade (A, B, C, D) or numeric score" },
      { flag: "--cents", type: "number", description: "value in integer cents" },
      { flag: "--currency", type: "string", description: "iso currency (defaults to the project)" },
    ],
    examples: ['fk track --product demo --stage converted --dedupe order-123 --cents 9900 --name purchase'],
  },
  {
    name: "tracking-key",
    summary: "show the publishable write key and install snippets",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk tracking-key --product demo"],
  },
  {
    name: "tracking-key rotate",
    summary: "mint a new write key and revoke the previous one",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk tracking-key rotate --product demo"],
  },
  {
    name: "tracking-key deploy",
    summary: "publish the snippet via google tag manager (asks for typed confirmation)",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk tracking-key deploy --product demo"],
  },
  {
    name: "ads",
    summary: "roi by campaign, ad group, keyword or creative — spend, revenue, roas, cac",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--level", type: "string", description: "campaign | ad_group | keyword | ad", default: "campaign" },
      { flag: "--days", type: "number", description: "window in days", default: 30 },
    ],
    examples: ["fk ads --product demo --level keyword", "fk ads --product demo --level ad --days 7"],
  },
  {
    name: "ads url-suffix",
    summary: "show whether google ads tags landing urls with the params keyword-level roi needs",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk ads url-suffix --product demo"],
  },
  {
    name: "ads url-suffix apply",
    summary: "add those params to the google ads account (asks for typed confirmation — changes every ad's landing url)",
    flags: [{ flag: "--product", type: "string", description: "project slug", required: true }],
    examples: ["fk ads url-suffix apply --product demo"],
  },
  { name: "portfolio", summary: "one row per project: spend, revenue, cac, ltv:cac", flags: [], examples: ["fk portfolio"] },
  { name: "queue list", summary: "pending keeper cards", flags: [], examples: ["fk queue list"] },
  {
    name: "queue approve",
    args: ["id"],
    summary: "approve a card (asks for typed confirmation — this can move money)",
    flags: [],
    examples: ["fk queue approve 3f1c…"],
  },
  {
    name: "queue reject",
    args: ["id"],
    summary: "dismiss a card",
    flags: [],
    examples: ["fk queue reject 3f1c…"],
  },
  {
    name: "queue snooze",
    args: ["id"],
    summary: "snooze a card",
    flags: [{ flag: "--hours", type: "number", description: "snooze duration", default: 24 }],
    examples: ["fk queue snooze 3f1c… --hours 48"],
  },
  {
    name: "growth",
    summary: "ranked next actions that will generate revenue or growth (activation leaks, friction, wasted spend)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--days", type: "number", description: "lookback window", default: 30 },
      { flag: "--tool", type: "string", description: "cursor | claude | lovable | bolt | v0 — shapes the prompt text", default: "cursor" },
    ],
    examples: ["fk growth --product demo-product", "fk growth --product demo-product --tool claude"],
  },
  {
    name: "social",
    summary: "organic social: followers, reach, engagement, top posts (Meta + X)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--days", type: "number", description: "window in days", default: 30 },
    ],
    examples: ["fk social --product demo-product"],
  },
  {
    name: "prompt",
    args: ["id"],
    summary: "print the full coding-agent prompt for one growth action",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--tool", type: "string", description: "cursor | claude | lovable | bolt | v0", default: "cursor" },
      { flag: "--days", type: "number", description: "lookback window", default: 30 },
    ],
    examples: [
      "fk prompt activation.dropoff.signup-activated --product demo-product",
      "fk prompt activation.dropoff.signup-activated --product demo-product --tool claude",
    ],
  },
  {
    name: "scorecard",
    summary: "weekly growth scorecard (metrics × ISO weeks, auto-filled from the warehouse)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--weeks", type: "number", description: "number of weeks", default: 12 },
    ],
    examples: ["fk scorecard --product demo-product", "fk scorecard --product demo-product --weeks 8"],
  },
  {
    name: "scorecard set",
    summary: "write a manual scorecard cell (week_start is the ISO Monday)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--metric", type: "string", description: "metric key, e.g. blog.posts", required: true },
      { flag: "--week", type: "string", description: "ISO week Monday YYYY-MM-DD", required: true },
      { flag: "--value", type: "number", description: "numeric value (omit to clear)", required: true },
    ],
    examples: ["fk scorecard set --product demo-product --metric blog.posts --week 2026-08-18 --value 2"],
  },
  {
    name: "scorecard export",
    summary: "download the scorecard as csv (growth plan)",
    flags: [
      { flag: "--product", type: "string", description: "project slug", required: true },
      { flag: "--weeks", type: "number", description: "number of weeks", default: 12 },
      { flag: "--out", type: "string", description: "write to this file instead of stdout" },
    ],
    examples: ["fk scorecard export --product demo-product --out scorecard.csv"],
  },
];
