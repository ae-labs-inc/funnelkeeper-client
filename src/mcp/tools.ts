// The MCP tool registry AS DATA. The stdio server registers from this array
// and the docs site renders /docs/mcp from it — one definition, no drift.
//
// PURITY CONTRACT: imports zod only. The docs generator loads this at build
// time with an empty environment.
//
// HITL: the three queue-resolution tools require `actor` — the HUMAN's name
// or email. The tool descriptions instruct the model to ask the user, and the
// API records via=mcp plus the key id alongside resolved_by, so attribution
// is auditable. Approval must be relayed from the human, never initiated.
import { z } from "zod";

export type ToolDef = {
  name: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  method: "GET" | "POST" | "DELETE";
  path: (args: Record<string, unknown>) => string;
  body?: (args: Record<string, unknown>) => unknown;
  readOnly: boolean;
  destructive?: boolean;
};

const slug = z.string().describe("Project slug, e.g. 'demo-product'.");
const actor = z.string().min(1).describe(
  "The human operator's name or email. Ask the user for it; never supply a model name or invent one. Written to the audit log as resolved_by.");

export const tools: ToolDef[] = [
  {
    name: "signup_account",
    description:
      "Create a FunnelKeeper tenant from scratch (setup mode — only available when no API key is configured). Returns a working API key (persisted to ~/.config/funnelkeeper/config.json) plus a single-use claim_url the human opens to set a password and take over the account. Remaining tools become available after this succeeds.",
    input: z.object({
      email: z.string().email().describe("The human owner's email. Email is the person's identity; they can later belong to multiple workspaces."),
      name: z.string().min(1).max(80).optional().describe("Owner display name."),
    }),
    method: "POST", path: () => "/auth/agent-signup", body: (a) => ({ email: a.email, name: a.name }),
    readOnly: false,
  },
  {
    name: "get_claim_link",
    description:
      "Re-issue the single-use claim URL so the human can set a password and take over an agent-created account. 409 if the account is already claimed — they should use password reset instead.",
    input: z.object({}),
    method: "POST", path: () => "/auth/claim-link", readOnly: false,
  },
  {
    name: "get_billing",
    description:
      "Current workspace plan, trial days left, usage vs limits (projects, seats, events, AI analyses), and whether Stripe checkout is available. The workspace holds one plan; each project is free for its own 30 days and then adds one unit of subscription quantity — product_lines shows where each one stands. 402 plan_limit errors from other tools mean this plan is the ceiling — upgrade via the dashboard Billing screen.",
    input: z.object({}),
    method: "GET", path: () => "/billing", readOnly: true,
  },
  {
    name: "get_account",
    description:
      "The current workspace: tenant id, display name, the authenticated person's email and member_role. API keys are scoped to one workspace.",
    input: z.object({}),
    method: "GET", path: () => "/auth/me", readOnly: true,
  },
  {
    name: "list_accounts",
    description:
      "Workspaces the authenticated identity can see. A dashboard session returns every accepted membership; an API key returns only the key's tenant.",
    input: z.object({}),
    method: "GET", path: () => "/auth/accounts", readOnly: true,
  },
  {
    name: "list_team",
    description: "People in the current workspace (owners, members, pending invites, disabled).",
    input: z.object({}),
    method: "GET", path: () => "/team", readOnly: true,
  },
  {
    name: "invite_team_member",
    description:
      "Invite a person to the current workspace. A new email gets a set-password link; an existing FunnelKeeper login gets a join link (409 only if they are already on this workspace). Returns the invite URL for the owner to share.",
    input: z.object({
      email: z.string().email(),
      member_role: z.enum(["owner", "member"]).default("member"),
    }),
    method: "POST", path: () => "/team/invites",
    body: (a) => ({ email: a.email, member_role: a.member_role ?? "member" }),
    readOnly: false,
  },
  {
    name: "get_portfolio",
    description: "One row per project: spend 7d/30d, visitors, leads, revenue, customers, CAC, LTV:CAC, gate status, pending card count.",
    input: z.object({}),
    method: "GET", path: () => "/portfolio", readOnly: true,
  },
  {
    name: "get_product",
    description: "A single project's portfolio row.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}`, readOnly: true,
  },
  {
    name: "get_funnel",
    description: "Funnel stage × channel volumes for a project.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/funnel?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "get_payback",
    description: "Cohort payback curves ({cohorts, cac}): cumulative revenue per customer by days since acquisition, per channel, plus per-channel CAC.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/payback`, readOnly: true,
  },
  {
    name: "get_queue",
    description: "Pending Keeper cards (proposals, insights, alerts). Cards are resolved only by a human decision.",
    input: z.object({}),
    method: "GET", path: () => "/queue", readOnly: true,
  },
  {
    name: "get_health",
    description: "Pipeline health: job runs, per-source data freshness, queue backlog, unattributed revenue share.",
    input: z.object({}),
    method: "GET", path: () => "/health", readOnly: true,
  },
  {
    name: "get_connections",
    description: "Integration inventory: each source's status, config, last sync, last error.",
    input: z.object({}),
    method: "GET", path: () => "/connections", readOnly: true,
  },
  {
    name: "create_product",
    description: "Create a project in the authenticated account.",
    input: z.object({
      name: z.string().min(1).max(120),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
      currency: z.string().length(3).default("USD"),
      domain: z.string().optional(),
    }),
    method: "POST", path: () => "/products", body: (a) => a, readOnly: false,
  },
  {
    name: "connect_source_start",
    description: "Begin connecting ga4, gtm, and/or google_ads via OAuth. Returns an authorization URL — give it to the human to open in their browser (never send them into the FunnelKeeper dashboard), then poll connect_source_status with the returned state. Prefer kinds so one consent click covers GA4+GTM together. For a zero-click path when you have Google admin, use connect_service_account instead.",
    input: z.object({
      product_slug: slug,
      kinds: z.array(z.enum(["ga4", "gtm", "google_ads", "gsc"])).min(1).optional()
        .describe("One grant covers every kind in this list. Prefer this over kind. gsc requires GOOGLE_GSC_OAUTH=1."),
      kind: z.enum(["ga4", "gtm", "google_ads", "gsc"]).optional()
        .describe("Single kind. Ignored when kinds is set."),
    }),
    method: "POST", path: () => "/connect/google/start",
    body: (a) => ({
      product_slug: a.product_slug,
      kinds: (a.kinds as string[] | undefined)?.length
        ? a.kinds
        : [a.kind ?? "ga4"],
      client: "mcp",
    }),
    readOnly: false,
  },
  {
    name: "connect_service_account",
    description: "Begin connecting GA4 and/or GTM via a per-account service account — no OAuth consent screen. Returns sa_email plus the exact Google API calls (accessBindings.create / user_permissions.create) to grant it. If you have Admin on the client's property/container, make those calls yourself; otherwise give the email to the human to paste into GA4/GTM Admin. Then call verify_service_account. Google Ads is not on this path.",
    input: z.object({
      product_slug: slug,
      kinds: z.array(z.enum(["ga4", "gtm", "gsc"])).min(1).default(["ga4", "gtm"]),
    }),
    method: "POST", path: () => "/connect/google/service-account/start",
    body: (a) => ({ product_slug: a.product_slug, kinds: a.kinds ?? ["ga4", "gtm"] }),
    readOnly: false,
  },
  {
    name: "verify_service_account",
    description: "Finish a service-account GA4/GTM connection. Without ids: lists the properties/containers now visible to the service account (same options shape as connect_source_status). With ids: a live read proves the grant landed, the connection goes active, and a backfill starts.",
    input: z.object({
      product_slug: slug,
      ga4_property_id: z.string().optional().describe("GA4 property id (digits, or properties/123)."),
      gtm_container_path: z.string().optional().describe("GTM container path, e.g. accounts/123/containers/456."),
      gsc_site_url: z.string().optional().describe("Search Console site URL (https://example.com/ or sc-domain:example.com)."),
    }),
    method: "POST", path: () => "/connect/google/service-account/verify",
    body: (a) => a,
    readOnly: false,
  },
  {
    name: "connect_source_status",
    description: "Poll an in-progress Google connection. pending → keep waiting; complete → results plus entity options (properties/containers) for connect_source_select; error → what went wrong.",
    input: z.object({ state: z.string() }),
    method: "GET", path: (a) => `/connect/google/status?state=${encodeURIComponent(String(a.state))}`, readOnly: true,
  },
  {
    name: "connect_source_select",
    description: "Finish a Google connection by choosing which GA4 property / GTM container / Ads customer to use, from the options returned by connect_source_status.",
    input: z.object({
      state: z.string(),
      ga4_property_id: z.string().optional(),
      gtm_container_path: z.string().optional(),
      ads_customer_id: z.string().optional(),
      gsc_site_url: z.string().optional(),
    }),
    method: "POST", path: () => "/connect/google/select", body: (a) => a, readOnly: false,
  },
  {
    name: "set_semrush_key",
    description: "Connect SEMrush by storing the customer's own API key (encrypted at rest). No test call is made — SEMrush calls burn the customer's units.",
    input: z.object({ product_slug: slug, api_key: z.string(), domain: z.string(), database: z.string().length(2).default("us") }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/semrush`,
    body: (a) => ({ api_key: a.api_key, domain: a.domain, database: a.database ?? "us" }), readOnly: false,
  },
  {
    name: "connect_clarity",
    description: "Connect Microsoft Clarity by storing the customer's Data Export API token (encrypted) and project id. The daily job samples session recordings (playback URLs, never video) and one URL-grain insights snapshot. Token comes from Clarity → Settings → Data Export.",
    input: z.object({
      product_slug: slug,
      api_token: z.string().describe("Clarity Data Export JWT from Settings → Data Export."),
      project_id: z.string().describe("Clarity project id from Settings → Overview."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/clarity`,
    body: (a) => ({ api_token: a.api_token, project_id: a.project_id }), readOnly: false,
  },
  {
    name: "connect_posthog",
    description: "Connect PostHog by storing the customer's personal API key (encrypted), project id and host. The key needs scope query:read for funnel events, plus session_recording:read for replay. Host defaults to https://us.posthog.com — pass https://eu.posthog.com for EU cloud or their own origin when self-hosted. After connecting, set which PostHog events feed which stages with set_posthog_event_maps.",
    input: z.object({
      product_slug: slug,
      api_key: z.string().describe("PostHog personal API key (starts with phx_), from Settings → Personal API keys."),
      project_id: z.string().describe("PostHog project id — the number in the project URL."),
      host: z.string().optional().describe("PostHog origin. Omit for US cloud."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/posthog`,
    body: (a) => ({ api_key: a.api_key, project_id: a.project_id, host: a.host }), readOnly: false,
  },
  {
    name: "connect_opinly",
    description: "Connect Opinly by storing the customer's API key (encrypted) and optional company id. The daily job snapshots AI-search (GEO) visibility, site-audit health, tracked keyword ranks and competitor gaps. Key comes from Opinly → Settings → Developers (sk-…). Pass company_id when the key can see more than one company.",
    input: z.object({
      product_slug: slug,
      api_key: z.string().describe("Opinly API key from Settings → Developers (starts with sk-)."),
      company_id: z.string().optional().describe("Opinly company id (comp_…). Optional when the key sees only one company."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/opinly`,
    body: (a) => ({ api_key: a.api_key, company_id: a.company_id }), readOnly: false,
  },
  {
    name: "connect_bing",
    description: "Connect Bing Webmaster by storing the customer's API key (encrypted) and site URL. The daily job reads query and page stats. Key comes from Bing Webmaster → Settings → API Access.",
    input: z.object({
      product_slug: slug,
      api_key: z.string().describe("Bing Webmaster API key."),
      site_url: z.string().describe("Verified site URL as it appears in Bing Webmaster."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/bing`,
    body: (a) => ({ api_key: a.api_key, site_url: a.site_url }), readOnly: false,
  },
  {
    name: "connect_ahrefs",
    description: "Connect Ahrefs by storing the customer's API v3 token (encrypted) and target domain. Snapshots run weekly — units deplete. Never test-called.",
    input: z.object({
      product_slug: slug,
      api_key: z.string().describe("Ahrefs API v3 token."),
      domain: z.string().describe("Domain to track, e.g. example.com."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/ahrefs`,
    body: (a) => ({ api_key: a.api_key, domain: a.domain }), readOnly: false,
  },
  {
    name: "connect_meta_ads",
    description: "Connect Meta Ads by storing a user/system-user token (encrypted) and optional ad account id. Adult-adjacent projects are refused. Omit ad_account_id to discover accounts, then call again with one. For 1-click OAuth, use connect_meta_start.",
    input: z.object({
      product_slug: slug,
      access_token: z.string().describe("Meta token with ads_read."),
      ad_account_id: z.string().optional().describe("Numeric ad account id, no act_ prefix."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/meta-ads`,
    body: (a) => ({ access_token: a.access_token, ad_account_id: a.ad_account_id }), readOnly: false,
  },
  {
    name: "connect_meta_start",
    description: "Begin connecting Meta Ads and/or Meta Social via OAuth. Returns an authorization URL for the user to open, then poll connect_meta_status with the returned state.",
    input: z.object({
      product_slug: slug,
      kinds: z.array(z.enum(["meta_ads", "meta_social"])).min(1).optional()
        .describe("Meta kinds to connect (meta_ads, meta_social). Default is ['meta_ads']."),
    }),
    method: "POST", path: () => "/connect/meta/start",
    body: (a) => ({
      product_slug: a.product_slug,
      kinds: (a.kinds as string[] | undefined)?.length ? a.kinds : ["meta_ads"],
      client: "mcp",
    }),
    readOnly: false,
  },
  {
    name: "connect_meta_status",
    description: "Poll an in-progress Meta connection. pending → keep waiting; complete → results plus discovered ad accounts and pages; error → what went wrong.",
    input: z.object({ state: z.string() }),
    method: "GET", path: (a) => `/connect/meta/status?state=${encodeURIComponent(String(a.state))}`, readOnly: true,
  },
  {
    name: "connect_meta_select",
    description: "Finish a Meta OAuth connection by choosing which Meta Ad Account and/or Facebook Page to track, from the options returned by connect_meta_status.",
    input: z.object({
      state: z.string(),
      ad_account_id: z.string().optional().describe("Numeric ad account id, no act_ prefix."),
      page_id: z.string().optional().describe("Facebook Page id."),
    }),
    method: "POST", path: () => "/connect/meta/select", body: (a) => a, readOnly: false,
  },
  {
    name: "connect_linkedin_ads",
    description: "Connect LinkedIn Ads by storing a token with r_ads + r_ads_reporting (encrypted) and optional ad account id. Omit ad_account_id to discover.",
    input: z.object({
      product_slug: slug,
      access_token: z.string().describe("LinkedIn Marketing token."),
      ad_account_id: z.string().optional().describe("Numeric sponsored account id."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/linkedin-ads`,
    body: (a) => ({ access_token: a.access_token, ad_account_id: a.ad_account_id }), readOnly: false,
  },
  {
    name: "connect_meta_social",
    description: "Connect Meta Social (Facebook Page + linked Instagram) by storing a user token (encrypted) and optional Page id. Omit page_id to discover.",
    input: z.object({
      product_slug: slug,
      access_token: z.string().describe("Meta token with pages_show_list and pages_read_engagement."),
      page_id: z.string().optional().describe("Facebook Page id."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/meta-social`,
    body: (a) => ({ access_token: a.access_token, page_id: a.page_id }), readOnly: false,
  },
  {
    name: "connect_x_social",
    description: "Connect X (Twitter) Social by storing a Bearer token (encrypted) and username. Daily public_metrics and recent tweets are ingested.",
    input: z.object({
      product_slug: slug,
      bearer_token: z.string().describe("X API v2 Bearer token."),
      username: z.string().describe("X username without @."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/x-social`,
    body: (a) => ({ bearer_token: a.bearer_token, username: a.username }), readOnly: false,
  },
  {
    name: "connect_stripe",
    description: "Connect Stripe by storing a Restricted or Secret API key (encrypted). Successful charges become converted/payment events plus revenue; refunds and open/lost disputes write negative ledger rows. Prefer a Restricted key with Charges, Customers, Refunds and Disputes read.",
    input: z.object({
      product_slug: slug,
      api_key: z.string().describe("Stripe Restricted or Secret key (rk_live_… / sk_live_…, or _test_)."),
      default_stage: z.enum(["converted", "payment"]).optional()
        .describe("Funnel stage for a successful charge. Defaults to converted."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/stripe`,
    body: (a) => ({ api_key: a.api_key, default_stage: a.default_stage }), readOnly: false,
  },
  {
    name: "set_posthog_event_maps",
    description: "Replace which PostHog events count as which funnel stages. Each mapped event is ingested as daily aggregate stage rows. Map each stage from ONE source — a stage fed by both PostHog and GA4 double-counts.",
    input: z.object({
      product_slug: slug,
      event_maps: z.array(z.object({
        event: z.string().describe("PostHog event name, e.g. 'signed_up'."),
        stage: z.enum(["impression", "visit", "engaged", "lead", "qualified", "signup", "activated", "converted", "payment", "churned"]),
      })).max(20),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/posthog/event-maps`,
    body: (a) => ({ event_maps: a.event_maps }), readOnly: false,
  },
  {
    name: "list_session_recordings",
    description: "Session recording pointers from the connected replay sources (Microsoft Clarity, PostHog): playback URL, duration, entry path, and friction signals (rage/dead click, JS error). Empty until a replay source is connected and the daily sync has run. Filter by landing-page path, signal, or provider.",
    input: z.object({
      slug,
      days: z.number().int().positive().max(30).default(7),
      path: z.string().optional().describe("Landing-page path, e.g. '/pricing'."),
      signal: z.enum(["rage_click", "dead_click", "js_error"]).optional(),
      provider: z.enum(["clarity", "posthog"]).optional(),
      limit: z.number().int().positive().max(250).default(50),
    }),
    method: "GET",
    path: (a) => {
      const q = new URLSearchParams();
      q.set("days", String(a.days ?? 7));
      if (a.path) q.set("path", String(a.path));
      if (a.signal) q.set("signal", String(a.signal));
      if (a.provider) q.set("provider", String(a.provider));
      q.set("limit", String(a.limit ?? 50));
      return `/products/${a.slug}/recordings?${q}`;
    },
    readOnly: true,
  },
  {
    name: "test_connection",
    description: "Verify a connected source can deliver data (cheap, side-effect-free probe).",
    input: z.object({ product_slug: slug, kind: z.enum(["ga4", "gtm", "google_ads", "gsc", "semrush", "mysql", "postgres", "mongo", "clarity", "posthog", "opinly", "bing", "ahrefs", "meta_ads", "linkedin_ads", "meta_social", "x_social", "stripe"]) }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/${a.kind}/test`, readOnly: false,
  },
  {
    name: "detect_website_integrations",
    description:
      "Inspect a website URL or project domain to auto-detect active analytics, pixels, tag managers, CRM, payments, and tracking scripts (GA4, GTM, Google Ads, Microsoft Clarity, PostHog, FunnelKeeper tracking, Meta Pixel, TikTok, LinkedIn, Stripe, Hotjar, Segment, Plausible, Shopify, Webflow, etc.) and recommend FunnelKeeper connections.",
    input: z.object({
      product_slug: slug.optional().describe("Project slug if inspecting an existing project in FunnelKeeper (will cross-reference existing connections)."),
      url: z.string().optional().describe("Website URL to scan (e.g. 'https://motormerchants.com.au'). If omitted and product_slug is provided, uses the project's domain."),
    }),
    method: "POST",
    path: (a) => (a.product_slug ? `/products/${a.product_slug}/detect-integrations` : `/tools/detect-integrations`),
    body: (a) => (a.url ? { url: a.url } : {}),
    readOnly: true,
  },
  {
    name: "sync_connection",
    description:
      "Run a source now instead of waiting for the sweep (hourly for databases, daily for GA4 and PostHog), and clear any backoff so a corrected connection recovers immediately. Use this straight after setting event maps or credentials — a connection that has never synced starts a staged backfill (30 days so the dashboard populates, then a year, then everything the plan allows), so the surfaces fill rather than sitting empty. Returns when the run STARTS; poll list_connections for status/last_sync_at/last_error and backfill_days, which is how deep it has read so far. SEMrush and Clarity are excluded: their quotas deplete. Opinly is included — its snapshot reads stored company data.",
    input: z.object({ product_slug: slug, kind: z.enum(["mysql", "postgres", "mongo", "ga4", "posthog", "opinly", "gsc", "bing", "meta_ads", "linkedin_ads", "meta_social", "x_social", "stripe"]) }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/${a.kind}/sync`, readOnly: false,
  },
  {
    name: "track_events",
    description:
      "Send first-party funnel events (server-side). Each event needs a canonical stage and a dedupe_id (retries are safe). Optional name, identity (email/external_id), attribution (utm/gclid/fbclid/referrer, plus the Google Ads ValueTrack ids when the source captured them — those place the revenue on a campaign/keyword/creative), and value (integer cents). Source namespace is api:<slug>.",
    input: z.object({
      slug,
      events: z.array(z.object({
        stage: z.enum(["impression", "visit", "engaged", "lead", "qualified", "signup", "activated", "converted", "payment", "churned"]),
        dedupe_id: z.string().min(1).max(128),
        name: z.string().max(80).optional(),
        occurred_at: z.string().optional(),
        identity: z.object({ email: z.string().optional(), external_id: z.string().optional() }).optional(),
        attribution: z.object({
          channel: z.string().optional(), utm_source: z.string().optional(), utm_medium: z.string().optional(),
          utm_campaign: z.string().optional(), gclid: z.string().optional(), fbclid: z.string().optional(),
          li_fat_id: z.string().optional(),
          referrer: z.string().optional(),
          campaign_id: z.string().optional().describe("ValueTrack {campaignid}."),
          ad_group_id: z.string().optional().describe("ValueTrack {adgroupid}."),
          ad_id: z.string().optional().describe("ValueTrack {creative} — the ad id."),
          target_id: z.string().optional().describe("ValueTrack {targetid}; only the 'kwd-…' form is a keyword."),
          keyword: z.string().optional().describe("ValueTrack {keyword} or utm_term — the keyword text."),
          match_type: z.string().optional().describe("ValueTrack {matchtype}: e/p/b/a."),
        }).optional(),
        value: z.object({
          amount_cents: z.number().int(),
          currency: z.string().length(3).optional(),
          kind: z.enum(["charge", "usage", "invoice", "refund", "dispute", "adjustment"]).optional(),
        }).optional(),
        score: z.union([z.string(), z.number()]).optional().describe("Optional lead grade ('A', 'B', 'C', 'D') or numeric score (e.g. 85)."),
        props: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      })).min(1).max(500),
    }),
    method: "POST", path: (a) => `/products/${a.slug}/events`,
    body: (a) => ({ events: a.events }), readOnly: false,
  },
  {
    name: "get_tracking_snippet",
    description:
      "The project's publishable write key (fk_pub_…) plus copy-paste <script> tag, GTM Custom HTML, and a server-side curl example. key is null until rotate_tracking_key has been called.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/tracking-key`, readOnly: true,
  },
  {
    name: "rotate_tracking_key",
    description:
      "Mint a new publishable write key and revoke the previous one. The old key stops ingesting immediately — update the snippet / GTM tag. Audited.",
    input: z.object({ slug }),
    method: "POST", path: (a) => `/products/${a.slug}/tracking-key`, readOnly: false,
  },
  {
    name: "deploy_tracking_gtm",
    description:
      "HUMAN-GATED: publish the FunnelKeeper tracking snippet into the connected GTM container (new workspace, Custom HTML on All Pages, create version, publish live). Only call this to relay an explicit human confirm. 403 means reconnect Google (grant is still read-only). 409 if no write key or GTM is not connected.",
    input: z.object({ slug }),
    method: "POST", path: (a) => `/products/${a.slug}/tracking/gtm-deploy`,
    readOnly: false, destructive: true,
  },
  {
    name: "get_spend",
    description: "Daily spend by channel and campaign for a project, with the daily cap and whether it is currently binding.",
    input: z.object({ product_slug: slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.product_slug}/spend?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "log_distribution",
    description: "Record a distribution event you performed for the user — a post shipped, a listing submitted, an email sent — so its traffic joins back via utm_campaign.",
    input: z.object({
      product_slug: slug,
      channel: z.string().describe("Channel id, e.g. social_reddit, community, email."),
      kind: z.string().describe("What happened: forum_post, dm_wave, launch, social_post, email_blast."),
      url: z.string().url().optional(),
      utm_campaign: z.string().optional(),
      note: z.string().optional(),
    }),
    method: "POST", path: () => "/distribution",
    body: (a) => ({ productSlug: a.product_slug, channel: a.channel, kind: a.kind, url: a.url, utmCampaign: a.utm_campaign, note: a.note }),
    readOnly: false,
  },
  {
    name: "propose_budget_change",
    description: "budget.propose: suggest a spend change with rationale and rollback condition. Returns pending_human — a HUMAN approves it in the app; you cannot execute it. Policy caps are enforced server-side: over-cap proposals are rejected with policy_code.",
    input: z.object({
      product_slug: slug,
      network: z.enum(["meta", "google"]),
      campaign_id: z.string().optional(),
      from_cents: z.number().int().nonnegative().optional(),
      to_cents: z.number().int().positive().describe("Proposed daily cap, integer cents."),
      rationale: z.string().min(10).max(2000).describe("Why — shown to the human on the card."),
      rollback_if: z.record(z.unknown()).optional(),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/proposals`,
    body: (a) => ({ network: a.network, campaign_id: a.campaign_id, from_cents: a.from_cents, to_cents: a.to_cents, rationale: a.rationale, rollback_if: a.rollback_if }),
    readOnly: false,
  },
  {
    name: "get_attribution",
    description: "Revenue by channel under first-touch AND last-touch models, with spend, customers, CAC and ROAS per channel, plus attribution coverage. Unattributed revenue is its own row — never smeared.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/attribution?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "get_attribution_sales",
    description: "Every sale in a window with first-touch and last-touch channel, customer (email/external id), amount, and first-touch UTM. Unattributed sales are labelled 'unattributed' — never smeared. Newest first.",
    input: z.object({
      slug,
      days: z.number().int().positive().max(365).default(30),
      channel: z.string().optional().describe("Filter by first-touch channel, including 'unattributed'."),
      limit: z.number().int().positive().max(2000).default(500),
    }),
    method: "GET",
    path: (a) => `/products/${a.slug}/attribution/sales?days=${a.days ?? 30}&limit=${a.limit ?? 500}` +
      (a.channel ? `&channel=${encodeURIComponent(String(a.channel))}` : ""),
    readOnly: true,
  },
  {
    name: "get_ad_performance",
    description:
      "ROI one level BELOW channel: spend, first- and last-touch revenue, customers, CAC and ROAS per campaign, ad group, keyword or creative. Cost comes from Google Ads at that grain; revenue comes from the ad ids captured on each customer's first click. Two rows are honest sentinels and must be reported as such, never dropped or merged: 'unattributed' is revenue with no paid click at all, and 'no_dimension' is revenue from an ad that has nothing at this grain (Performance Max, Shopping and Demand Gen have no keywords). totals.spend_without_detail_cents is the matching gap on the cost side. If coverage.identities_with_dimension is low, the fix is get_ads_url_suffix.",
    input: z.object({
      slug,
      level: z.enum(["campaign", "ad_group", "keyword", "ad"]).default("campaign"),
      days: z.number().int().positive().max(365).default(30),
      limit: z.number().int().positive().max(500).default(100),
    }),
    method: "GET",
    path: (a) => `/products/${a.slug}/attribution/ads?days=${a.days ?? 30}&level=${a.level ?? "campaign"}&limit=${a.limit ?? 100}`,
    readOnly: true,
  },
  {
    name: "get_ads_url_suffix",
    description:
      "Whether the project's Google Ads account tags its landing URLs with the ValueTrack parameters keyword- and creative-level ROI depends on. Returns the account's current final URL suffix, whether auto-tagging is on, which params are missing, and the exact string to add. Read-only.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/connections/google-ads/url-suffix`, readOnly: true,
  },
  {
    name: "set_ads_url_suffix",
    description:
      "Add FunnelKeeper's ValueTrack parameters to the Google Ads account's final URL suffix, keeping any the tenant already had. This CHANGES the landing URL of every ad in the account — ask the human first and only call it when they say yes. The alternative is to hand them `recommended_suffix` from get_ads_url_suffix to paste themselves.",
    input: z.object({ slug }),
    method: "POST", path: (a) => `/products/${a.slug}/connections/google-ads/url-suffix`, readOnly: false,
  },
  {
    name: "get_timeseries",
    description: "Daily spend, revenue, visits, leads and new customers for a project — zero-filled, oldest first.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(90) }),
    method: "GET", path: (a) => `/products/${a.slug}/timeseries?days=${a.days ?? 90}`, readOnly: true,
  },
  {
    name: "get_health_report",
    description: "Scored audit of the project (0–100): site & tracking, funnel, advertising, SEO & social. Every failing check carries the action that fixes it.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/health-report?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "get_demand_report",
    description:
      "Demand-gen report for a project: search impressions/clicks, top queries with striking-distance and low-CTR flags, keyword ranks across SEMrush/Ahrefs/Opinly, AI visibility, and authority. Empty sources still return so you can see what to connect.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/demand?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "get_social_report",
    description:
      "Organic social report: follower totals, reach, engagement rate, per-network split (Meta vs X), and top posts. Empty sources still return so you can see what to connect.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/social?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "get_growth_actions",
    description:
      "Ranked next incremental changes that will generate revenue or growth for this project: activation leaks, friction, wasted spend, missing conversions, weak landing pages. Each row includes estimated monthly impact and a copy-paste prompt for a coding agent. Ask this before inventing a feature. Spend changes are listed as proposals only — never execute them.",
    input: z.object({
      slug,
      days: z.number().int().positive().max(365).default(30),
      tool: z.enum(["cursor", "claude_code", "lovable", "bolt", "v0"]).default("cursor")
        .describe("Which coding agent the prompts should address."),
    }),
    method: "GET",
    path: (a) => `/products/${a.slug}/growth-actions?days=${a.days ?? 30}&tool=${a.tool ?? "cursor"}`,
    readOnly: true,
  },
  {
    name: "get_growth_prompt",
    description:
      "Full prompt for one growth action, tailored to Cursor, Claude Code, Lovable, Bolt, or v0. Use the id from get_growth_actions. Hand this to the coding agent as the next task. Does not change spend.",
    input: z.object({
      slug,
      id: z.string().describe("Growth action id from get_growth_actions, e.g. activation.dropoff.signup-activated."),
      tool: z.enum(["cursor", "claude_code", "lovable", "bolt", "v0"]).default("cursor"),
      days: z.number().int().positive().max(365).optional(),
    }),
    method: "POST",
    path: (a) => `/products/${a.slug}/growth-actions/${a.id}/prompt`,
    body: (a) => ({ tool: a.tool ?? "cursor", days: a.days }),
    readOnly: true,
  },
  {
    name: "list_landing_pages",
    description: "Landing pages for a project: path, conversion characteristics (sessions, engagement, conversions vs the previous window), and the latest AI quality score if analysed.",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/landing-pages?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "add_landing_page",
    description: "Track a landing page by URL so it can be scored and compared. Path is derived from the URL; duplicates 409.",
    input: z.object({ slug, url: z.string().url() }),
    method: "POST", path: (a) => `/products/${a.slug}/landing-pages`,
    body: (a) => ({ url: a.url }), readOnly: false,
  },
  {
    name: "get_landing_page",
    description: "One landing page: analysis history (newest first) and daily traffic series.",
    input: z.object({ slug, id: z.string().uuid(), days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/landing-pages/${a.id}?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "analyze_landing_page",
    description: "Fetch the live page and score it against the weighted quality rubric via OpenRouter. On-demand only; appends a new analysis row. Takes 10–20s.",
    input: z.object({ slug, id: z.string().uuid() }),
    method: "POST", path: (a) => `/products/${a.slug}/landing-pages/${a.id}/analyze`, readOnly: false,
  },
  {
    name: "list_landing_page_filters",
    description: "Saved exclude filters for landing pages (path prefix or wildcard patterns to hide from the pages surface).",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/landing-pages/filters`, readOnly: true,
  },
  {
    name: "set_landing_page_filter",
    description: "Create or update an exclude filter for landing pages (e.g. pattern '/deals' or '/guides/*').",
    input: z.object({
      slug,
      pattern: z.string().min(1).max(500).describe("Path prefix or wildcard pattern, e.g. '/deals' or '/deals/*'"),
      enabled: z.boolean().optional().default(true).describe("Whether this filter is active"),
    }),
    method: "POST", path: (a) => `/products/${a.slug}/landing-pages/filters`,
    body: (a) => ({ pattern: a.pattern, enabled: a.enabled }),
    readOnly: false,
  },
  {
    name: "delete_landing_page_filter",
    description: "Delete a saved landing page exclude filter by id.",
    input: z.object({ slug, id: z.string().uuid() }),
    method: "DELETE", path: (a) => `/products/${a.slug}/landing-pages/filters/${a.id}`,
    readOnly: false,
  },
  {
    name: "get_history",
    description: "The audit timeline: every change and decision — Keeper cards raised, human approvals (resolved_by), policy blocks, config edits — newest first.",
    input: z.object({
      product_slug: z.string().optional().describe("Limit to one project."),
      days: z.number().int().positive().max(365).default(90),
      limit: z.number().int().positive().max(500).default(200),
    }),
    method: "GET",
    path: (a) => `/history?days=${a.days ?? 90}&limit=${a.limit ?? 200}` +
      (a.product_slug ? `&product=${encodeURIComponent(String(a.product_slug))}` : ""),
    readOnly: true,
  },
  {
    name: "get_funnel_definition",
    description: "The project's funnel definition (ordered, labelled steps) plus per-stage tracking status: recent volume and which sources feed each canonical stage.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/funnel/definition`, readOnly: true,
  },
  {
    name: "set_funnel_definition",
    description: "Save the project's funnel steps. Stages must come from the canonical taxonomy (impression, visit, engaged, lead, qualified, signup, activated, converted, payment, churned); labels are free text. Audited.",
    input: z.object({
      slug,
      steps: z.array(z.object({ stage: z.string(), label: z.string().min(1).max(40) })).min(2).max(10),
    }),
    method: "POST", path: (a) => `/products/${a.slug}/funnel/definition`,
    body: (a) => ({ steps: a.steps }), readOnly: false,
  },
  {
    name: "get_conversions",
    description: "The project's conversion definitions — primary (the money event) and secondary (milestones) — each with its stage, source, value mode and 30-day count/value.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/conversions`, readOnly: true,
  },
  {
    name: "save_conversion",
    description: "Create or update a conversion definition (upserts by key). tier: primary = core bottom-of-funnel goal event (e.g. 'waitlist-joined' or 'car-sold'), secondary = a milestone ('car-listed', 'demo-scheduled'). stage must be canonical taxonomy; source restricts to 'mysql', 'postgres', 'mongo', 'ga4' or 'stripe' (with event_name for one GA4 event). value_mode: 'transaction' reads each conversion's own revenue row from the source (dynamic values), 'fixed' uses fixed_value_cents + currency, 'none' counts only. score_mode: 'none' (default), 'grade' (A/B/C/D categorical qualification), or 'numeric' (point score). target_cpa_cents: optional target cost per acquisition in cents. Audited.",
    input: z.object({
      product_slug: slug,
      key: z.string().describe("Stable slug, e.g. 'car-sold' or 'waitlist-signup'."),
      label: z.string().min(1).max(60),
      tier: z.string().describe("'primary' or 'secondary'."),
      stage: z.string().describe("Canonical stage (impression, visit, engaged, lead, qualified, signup, activated, converted, payment, churned)."),
      source: z.string().optional().describe("'mysql', 'postgres', 'mongo', 'ga4' or 'stripe'; omit for any source."),
      event_name: z.string().optional().describe("GA4 only: count just this event."),
      value_mode: z.string().optional().describe("'none' (default), 'fixed', or 'transaction'."),
      fixed_value_cents: z.number().int().optional(),
      currency: z.string().optional(),
      score_mode: z.string().optional().describe("'none' (default), 'grade', or 'numeric'."),
      target_cpa_cents: z.number().int().positive().optional().describe("Target CPA in cents."),
      grade_weights: z.record(z.number()).optional(),
      is_active: z.boolean().optional(),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/conversions`,
    body: (a) => ({
      key: a.key, label: a.label, tier: a.tier, stage: a.stage, source: a.source,
      event_name: a.event_name, value_mode: a.value_mode, fixed_value_cents: a.fixed_value_cents,
      currency: a.currency, score_mode: a.score_mode, target_cpa_cents: a.target_cpa_cents,
      grade_weights: a.grade_weights, is_active: a.is_active,
    }),
    readOnly: false,
  },
  {
    name: "delete_conversion",
    description: "Delete a conversion definition by key. Configuration only — the underlying events are untouched. Audited.",
    input: z.object({ product_slug: slug, key: z.string() }),
    method: "POST", path: (a) => `/products/${a.product_slug}/conversions/${a.key}/delete`,
    readOnly: false,
  },
  {
    name: "get_conversion_report",
    description: "Per conversion: count and value in the window vs the prior window, plus a per-channel split (event channel, else identity first touch, else 'unattributed').",
    input: z.object({ slug, days: z.number().int().positive().max(365).default(30) }),
    method: "GET", path: (a) => `/products/${a.slug}/conversions/report?days=${a.days ?? 30}`, readOnly: true,
  },
  {
    name: "set_ga4_event_maps",
    description: "Map GA4 events onto canonical funnel stages (replaces the whole map). Each mapped event is ingested daily so funnel steps and ga4-bound conversions can be built from GA4 events. Map each stage from ONE source — a stage fed by both GA4 and MySQL double-counts.",
    input: z.object({
      product_slug: slug,
      event_maps: z.array(z.object({
        event: z.string().describe("GA4 event name, e.g. 'generate_lead'."),
        stage: z.string().describe("Canonical stage it counts as."),
      })).max(20),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/ga4/event-maps`,
    body: (a) => ({ event_maps: a.event_maps }), readOnly: false,
  },
  {
    name: "connect_mysql",
    description: "Connect the project's MySQL database. Tenants pass `credentials` (host/port/user/password/database — encrypted at rest; use a READ-ONLY user, ideally on a replica). Operators may instead pass *_env NAMES resolved on the API host. event_maps turn source tables into funnel events, identities, channels (attribution columns) and revenue (the dynamic per-row values 'transaction'-mode conversions read).",
    input: z.object({
      product_slug: slug,
      credentials: z.object({
        host: z.string(), port: z.number().int().optional(),
        user: z.string().describe("A READ-ONLY database user."),
        password: z.string(), database: z.string(),
      }).optional().describe("Tenant path. Mutually exclusive with the *_env names."),
      host_env: z.string().optional().describe("Operator path: env var NAME holding the host, e.g. 'MM_MYSQL_HOST'."),
      port_env: z.string().optional(),
      user_env: z.string().optional(),
      password_env: z.string().optional(),
      database_env: z.string().optional(),
      event_maps: z.array(z.object({
        table: z.string(), pk: z.string(), ts_col: z.string(),
        stage: z.string().describe("Canonical stage."),
        identity: z.object({ email_col: z.string().optional(), external_id_col: z.string().optional() }).optional(),
        attribution: z.object({
          channel_col: z.string().optional(), utm_source_col: z.string().optional(),
          utm_medium_col: z.string().optional(), utm_campaign_col: z.string().optional(),
          gclid_col: z.string().optional(), fbclid_col: z.string().optional(),
          li_fat_id_col: z.string().optional(),
          referrer_col: z.string().optional(),
        }).optional(),
        revenue: z.object({
          amount_col: z.string(), currency: z.string(),
          kind: z.string().optional().describe("Transaction kind, default 'charge'."),
          is_dollars: z.boolean().optional(),
        }).optional(),
      }).passthrough()).max(20).optional(),
      status: z.string().optional().describe("'active' (default) or 'pending'."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/mysql`,
    body: (a) => ({
      credentials: a.credentials,
      host_env: a.host_env, port_env: a.port_env, user_env: a.user_env,
      password_env: a.password_env, database_env: a.database_env,
      event_maps: a.event_maps, status: a.status,
    }),
    readOnly: false,
  },
  {
    name: "set_mysql_event_maps",
    description: "Replace the MySQL connection's table→stage maps without touching credentials. Each map: table/pk/ts_col/stage, optional identity columns (stitching), attribution columns (channels), and a revenue column (dynamic per-row values). revenue.amount_col must be what THIS BUSINESS earns — a marketplace/brokerage fee or commission, not the sale price / GMV passing through. Set revenue.basis to 'net' (your take) or 'gross' (the full transaction). Saving remaps and restates every day already backfilled, with adjustment rows — originals stay, the difference is a new row. One stage per source; map a row's revenue on exactly one stage.",
    input: z.object({
      product_slug: slug,
      event_maps: z.array(z.record(z.unknown())).max(20)
        .describe("MysqlEventMap objects — schema in /openapi.json."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/mysql/event-maps`,
    body: (a) => ({ event_maps: a.event_maps }), readOnly: false,
  },
  {
    name: "suggest_mysql_mappings",
    description: "Propose table→stage event maps from the connected MySQL schema. source=preset returns applicable common templates (marketplace/brokerage, e-commerce, lead-gen, SaaS) — marketplace prefers a fee/commission column over sale price. source=ai asks the model to infer maps from tables, columns and 3 sample rows (those rows are sent to the AI provider) and is told to pick what the business earns, not GMV. schema_summary.money_columns lists numeric candidates labelled net/gross/unclear. schema_summary.unresolved_money_tables lists tables with two or more money columns whose names do not uniquely identify the take — ask a human, do not guess. Pass `tables` to restrict which tables are described. Does NOT save — review the proposal then call set_mysql_event_maps.",
    input: z.object({
      product_slug: slug,
      source: z.enum(["preset", "ai"]).describe("'preset' for common templates; 'ai' to infer from the live schema."),
      preset_id: z.string().optional().describe("When source=preset, optionally return just this template (ecommerce | lead-gen | saas-subscription)."),
      tables: z.array(z.string()).max(30).optional()
        .describe("Optional table names to describe and send. Omit for the first 30."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/mysql/suggest-mappings`,
    body: (a) => ({ source: a.source, preset_id: a.preset_id, tables: a.tables }),
    readOnly: true,
  },
  {
    name: "connect_postgres",
    description: "Connect the project's Postgres database (tenant-only). Pass `credentials` (host/port/user/password/database, optional schema — encrypted at rest; use a READ-ONLY role, ideally on a replica) plus event_maps — the data-not-code mapping from source tables to funnel stages, identities, attribution channels and revenue. Each map may set `schema` to reach a non-public schema.",
    input: z.object({
      product_slug: slug,
      credentials: z.object({
        host: z.string(), port: z.number().int().optional(),
        user: z.string().describe("A READ-ONLY database role."),
        password: z.string(), database: z.string(),
        schema: z.string().optional().describe("Default schema; per-map `schema` overrides."),
      }),
      event_maps: z.array(z.object({
        schema: z.string().optional().describe("Postgres schema; omit for 'public'."),
        table: z.string(), pk: z.string(), ts_col: z.string(),
        stage: z.string().describe("Canonical stage."),
        identity: z.object({ email_col: z.string().optional(), external_id_col: z.string().optional() }).optional(),
        attribution: z.object({
          channel_col: z.string().optional(), utm_source_col: z.string().optional(),
          utm_medium_col: z.string().optional(), utm_campaign_col: z.string().optional(),
          gclid_col: z.string().optional(), fbclid_col: z.string().optional(),
          li_fat_id_col: z.string().optional(),
          referrer_col: z.string().optional(),
        }).optional(),
        revenue: z.object({
          amount_col: z.string(), currency: z.string(),
          kind: z.string().optional().describe("Transaction kind, default 'charge'."),
          is_dollars: z.boolean().optional(),
        }).optional(),
      }).passthrough()).max(20).optional(),
      status: z.string().optional().describe("'active' (default) or 'pending'."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/postgres`,
    body: (a) => ({ credentials: a.credentials, event_maps: a.event_maps, status: a.status }),
    readOnly: false,
  },
  {
    name: "set_postgres_event_maps",
    description: "Replace the Postgres connection's table→stage maps without touching credentials. Same shape as MySQL event maps, plus an optional per-map `schema`. One stage per source; map a row's revenue on exactly one stage.",
    input: z.object({
      product_slug: slug,
      event_maps: z.array(z.record(z.unknown())).max(20)
        .describe("PostgresEventMap objects — schema in /openapi.json."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/postgres/event-maps`,
    body: (a) => ({ event_maps: a.event_maps }), readOnly: false,
  },
  {
    name: "connect_mongo",
    description: "Connect the project's MongoDB database (tenant-only). Pass `credentials` with a single connection string `uri` (encrypted at rest — mongodb:// or mongodb+srv://; SRV, replica sets, TLS and authSource all live in the URI; use a read-only user) plus event_maps — collection-based maps from source documents to funnel stages, identities, attribution channels and revenue. Field paths may use dot notation to reach nested values.",
    input: z.object({
      product_slug: slug,
      credentials: z.object({
        uri: z.string().describe("A MongoDB connection string (mongodb:// or mongodb+srv://)."),
      }),
      event_maps: z.array(z.object({
        collection: z.string().describe("The collection to read documents from."),
        pk_field: z.string().describe("Field path holding the unique id."),
        ts_field: z.string().describe("Field path holding the timestamp."),
        stage: z.string().describe("Canonical stage."),
        identity: z.object({ email_field: z.string().optional(), external_id_field: z.string().optional() }).optional(),
        attribution: z.object({
          channel_field: z.string().optional(), utm_source_field: z.string().optional(),
          utm_medium_field: z.string().optional(), utm_campaign_field: z.string().optional(),
          gclid_field: z.string().optional(), fbclid_field: z.string().optional(),
          li_fat_id_field: z.string().optional(),
          referrer_field: z.string().optional(),
        }).optional(),
        revenue: z.object({
          amount_field: z.string(), currency: z.string(),
          kind: z.string().optional().describe("Transaction kind, default 'charge'."),
          is_dollars: z.boolean().optional(),
        }).optional(),
      }).passthrough()).max(20).optional(),
      status: z.string().optional().describe("'active' (default) or 'pending'."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/mongo`,
    body: (a) => ({ credentials: a.credentials, event_maps: a.event_maps, status: a.status }),
    readOnly: false,
  },
  {
    name: "set_mongo_event_maps",
    description: "Replace the MongoDB connection's collection→stage maps without touching credentials. Each map: collection/pk_field/ts_field/stage, optional identity field paths (stitching), attribution field paths (channels), and a revenue field path (dynamic per-row values). One stage per source; map a document's revenue on exactly one stage.",
    input: z.object({
      product_slug: slug,
      event_maps: z.array(z.record(z.unknown())).max(20)
        .describe("MongoEventMap objects — schema in /openapi.json."),
    }),
    method: "POST", path: (a) => `/products/${a.product_slug}/connections/mongo/event-maps`,
    body: (a) => ({ event_maps: a.event_maps }), readOnly: false,
  },
  {
    name: "list_dashboards",
    description: "The project's saved dashboards (name + widget spec). The built-in Overview is not stored.",
    input: z.object({ slug }),
    method: "GET", path: (a) => `/products/${a.slug}/dashboards`, readOnly: true,
  },
  {
    name: "create_dashboard",
    description: "Build a dashboard for the user. Pass a full spec ({widgets:[...]}, schema DashboardSpec in /openapi.json — widget types: metric, timeseries, funnel, payback, queue, breakdown, ad_breakdown (level campaign|ad_group|keyword|ad × measure roas|spend|revenue_first), note; each widget may carry layout {x,y,w,h} on a 12-column × 32px-row grid, or omit it to auto-pack in order) to compose it exactly, or just a prompt to let the server's deterministic composer draft it. Users can then rearrange everything by drag and drop.",
    input: z.object({
      slug,
      name: z.string().min(1).max(80),
      description: z.string().max(300).optional(),
      spec: z.record(z.unknown()).optional().describe("A DashboardSpec object. Validated server-side."),
      prompt: z.string().max(500).optional().describe("Plain-words description, used only when spec is omitted."),
    }),
    method: "POST", path: (a) => `/products/${a.slug}/dashboards`,
    body: (a) => ({ name: a.name, description: a.description, spec: a.spec, prompt: a.prompt }),
    readOnly: false,
  },
  {
    name: "update_dashboard",
    description: "Rename a dashboard or replace its widget spec (validated server-side). Audited.",
    input: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(80).optional(),
      spec: z.record(z.unknown()).optional(),
    }),
    method: "POST", path: (a) => `/dashboards/${a.id}`,
    body: (a) => ({ name: a.name, spec: a.spec }), readOnly: false,
  },
  {
    name: "approve_card",
    description: "HUMAN-GATED: approve a pending Keeper card. Approving a proposal can change ad spend. Only call this to relay an explicit decision the human just made — never decide for them. The server's policy engine still enforces caps and walls.",
    input: z.object({ id: z.string().uuid(), actor }),
    method: "POST", path: (a) => `/queue/${a.id}/approve`, body: (a) => ({ actor: a.actor }),
    readOnly: false, destructive: true,
  },
  {
    name: "reject_card",
    description: "HUMAN-GATED: dismiss a pending Keeper card, relaying the human's explicit decision.",
    input: z.object({ id: z.string().uuid(), actor }),
    method: "POST", path: (a) => `/queue/${a.id}/reject`, body: (a) => ({ actor: a.actor }),
    readOnly: false, destructive: true,
  },
  {
    name: "snooze_card",
    description: "HUMAN-GATED: snooze a pending Keeper card for the human.",
    input: z.object({ id: z.string().uuid(), actor, hours: z.number().int().positive().max(720).default(24) }),
    method: "POST", path: (a) => `/queue/${a.id}/snooze`, body: (a) => ({ actor: a.actor, snoozeHours: a.hours ?? 24 }),
    readOnly: false, destructive: true,
  },
  {
    name: "get_scorecard",
    description:
      "Weekly growth scorecard for a project: a metrics × ISO-weeks matrix auto-filled from the warehouse, plus any manual cells the human typed. Weeks are completed ISO weeks (the running week is partial and misleading); set include_current to append it. History window follows the plan. Use this before inventing a weekly report.",
    input: z.object({
      slug,
      weeks: z.number().int().positive().max(104).default(12),
      include_current: z.boolean().default(false),
    }),
    method: "GET",
    path: (a) => `/products/${a.slug}/scorecard?weeks=${a.weeks ?? 12}${a.include_current ? "&current=1" : ""}`,
    readOnly: true,
  },
  {
    name: "get_scorecard_insights",
    description:
      "Scorecard analysis for a project: cell highlights plus typed cards (insight / query / action). Deterministic on every plan; LLM-enriched on Growth. Never proposes spend changes.",
    input: z.object({
      slug,
      weeks: z.number().int().positive().max(104).default(12),
    }),
    method: "GET",
    path: (a) => `/products/${a.slug}/scorecard/insights?weeks=${a.weeks ?? 12}`,
    readOnly: true,
  },
  {
    name: "set_scorecard",
    description:
      "Replace the project's scorecard definition (sections and metrics). Auto metrics must use catalog keys. Does not write warehouse facts.",
    input: z.object({
      slug,
      sections: z.array(z.object({
        id: z.string(),
        label: z.string(),
        metrics: z.array(z.object({
          key: z.string(),
          label: z.string(),
          kind: z.enum(["auto", "manual", "derived"]),
          metric_ref: z.string().optional(),
          formula: z.string().optional(),
          format: z.enum(["int", "cents", "percent"]),
          target: z.number().nullable().optional(),
        })),
      })),
      template: z.string().nullable().optional(),
    }),
    method: "POST",
    path: (a) => `/products/${a.slug}/scorecard`,
    body: (a) => ({ sections: a.sections, template: a.template }),
    readOnly: false,
  },
  {
    name: "record_scorecard_values",
    description:
      "Write manual scorecard cells (blog posts, LinkedIn followers, …). week_start is the ISO Monday (YYYY-MM-DD). Null clears a cell. Audited.",
    input: z.object({
      slug,
      actor,
      cells: z.array(z.object({
        metric_key: z.string(),
        week_start: z.string().describe("ISO week Monday, YYYY-MM-DD."),
        value: z.number().nullable(),
      })).min(1),
    }),
    method: "POST",
    path: (a) => `/products/${a.slug}/scorecard/values`,
    body: (a) => ({ cells: a.cells }),
    readOnly: false,
  },
  {
    name: "suggest_scorecard",
    description:
      "Propose scorecard metrics from connected sources (LLM phrasing on Indie+). Proposals only — call set_scorecard after the human accepts.",
    input: z.object({
      slug,
      prompt: z.string().max(400).optional(),
    }),
    method: "POST",
    path: (a) => `/products/${a.slug}/scorecard/suggest`,
    body: (a) => ({ prompt: a.prompt }),
    readOnly: true,
  },
  {
    name: "export_scorecard",
    description: "Download the scorecard as CSV (Growth plan). For Excel use the dashboard export button.",
    input: z.object({ slug, weeks: z.number().int().positive().max(104).default(12) }),
    method: "GET",
    path: (a) => `/products/${a.slug}/scorecard/export.csv?weeks=${a.weeks ?? 12}`,
    readOnly: true,
  },
  {
    name: "share_scorecard",
    description: "Mint a public read-only URL for the project's weekly scorecard (build-in-public).",
    input: z.object({ slug }),
    method: "POST",
    path: (a) => `/products/${a.slug}/scorecard/share`,
    readOnly: false,
  },
  {
    name: "chat",
    description:
      "Ask the Keeper in prose (same engine as the dashboard chat). Prefer a specific tool when you already know the call. Spend changes still become proposal cards.",
    input: z.object({
      message: z.string().min(1).max(8000),
      product_slug: z.string().optional().describe("Default project scope."),
    }),
    method: "POST",
    path: (a) => (a.product_slug ? `/products/${a.product_slug}/chat` : "/chat"),
    body: (a) => ({ messages: [{ role: "user", content: a.message }] }),
    readOnly: false,
  },
];
