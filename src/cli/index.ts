#!/usr/bin/env node
// fk — the FunnelKeeper CLI. Command definitions live in commands.ts (data);
// this file is dispatch + handlers. Exit codes: 0 ok, 1 error, 2 usage.
import { spawn } from "node:child_process";
import os from "node:os";
import { commands } from "./commands.js";
import { readConfig, writeConfig, deleteConfig, configPath, type CliConfig } from "./config.js";
import { ask, askHidden, confirmTyped } from "./prompt.js";
import { table, money, dim, bold, fail } from "./render.js";
import { makeClient, ApiError } from "../shared/apiClient.js";

const VERSION = "0.2.0";
const DEFAULT_API = "https://api.funnelkeeper.com";

type Parsed = { command: string; positionals: string[]; flags: Record<string, string | number | boolean> };

function parseArgv(argv: string[]): Parsed {
  const words: string[] = [];
  const flags: Record<string, string | number | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = /^-?\d+(\.\d+)?$/.test(next) ? Number(next) : next;
        i++;
      }
    } else {
      words.push(a);
    }
  }
  // Longest matching multi-word command wins ("queue approve" over "queue").
  const sorted = [...commands].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    const parts = c.name.split(" ");
    if (parts.every((p, i) => words[i] === p)) {
      return { command: c.name, positionals: words.slice(parts.length), flags };
    }
  }
  return { command: words.join(" "), positionals: [], flags };
}

function usage(): string {
  const rows = commands.map((c) => [
    `fk ${c.name}${(c.args ?? []).map((a) => ` <${a}>`).join("")}`,
    c.summary,
  ]);
  return [
    bold("fk — the funnelkeeper cli"),
    "",
    table(["command", "what it does"], rows),
    "",
    dim(`config: ${configPath()}`),
    dim("docs: https://api.funnelkeeper.com/openapi.json"),
  ].join("\n");
}

function cliGrowthTool(raw: string): "cursor" | "claude_code" | "lovable" | "bolt" | "v0" {
  const map: Record<string, "cursor" | "claude_code" | "lovable" | "bolt" | "v0"> = {
    cursor: "cursor",
    claude: "claude_code",
    claude_code: "claude_code",
    lovable: "lovable",
    bolt: "bolt",
    v0: "v0",
  };
  return map[raw] ?? "cursor";
}

function needAuth(): { cfg: CliConfig; api: ReturnType<typeof makeClient> } {
  const cfg = readConfig();
  if (!cfg) fail("not signed in. run fk login first.");
  return { cfg, api: makeClient({ apiUrl: cfg.api_url, apiKey: cfg.api_key, client: "cli", version: VERSION }) };
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgv(process.argv.slice(2));

  if (!command || flags.help || command === "help" || flags.version) {
    if (flags.version) return void console.log(VERSION);
    console.log(usage());
    process.exit(command || flags.help ? 0 : 2);
  }

  switch (command) {
    case "signup": {
      const apiUrl = String(flags["api-url"] ?? DEFAULT_API);
      const anon = makeClient({ apiUrl, apiKey: "", client: "cli", version: VERSION });
      if (flags.agent) {
        const email = flags.email ? String(flags.email) : await ask("email: ");
        const name = flags.name ? String(flags.name) : undefined;
        const res = await anon.post<{
          account_id: string; api_key: string; claim_url: string; claim_expires_at: string;
        }>("/auth/agent-signup", { email, name });
        writeConfig({ api_url: apiUrl, api_key: res.api_key, account_email: email.trim().toLowerCase() });
        console.log(`account created. api key stored in ${configPath()} (0600).`);
        console.log(`\nhand this claim url to the human (valid until ${res.claim_expires_at}):\n\n  ${res.claim_url}\n`);
        return;
      }
      const email = flags.email ? String(flags.email) : await ask("email: ");
      const password = await askHidden("password (10+ chars): ");
      await anon.post("/auth/signup", { email, password });
      console.log("check your email for the verification link, then run fk login.");
      return;
    }

    case "login": {
      const apiUrl = String(flags["api-url"] ?? DEFAULT_API);
      let apiKey: string;
      let accountEmail: string;
      if (flags.key) {
        apiKey = await askHidden("api key (fk_live_…): ");
        const probe = makeClient({ apiUrl, apiKey, client: "cli", version: VERSION });
        const me = await probe.get<{ email: string }>("/auth/me");
        accountEmail = me.email;
      } else {
        const email = await ask("email: ");
        const password = await askHidden("password: ");
        const anon = makeClient({ apiUrl, apiKey: "", client: "cli", version: VERSION });
        const login = await anon.post<{ token: string; account: { email: string } }>("/auth/login", { email, password });
        const sess = makeClient({ apiUrl, apiKey: login.token, client: "cli", version: VERSION });
        const minted = await sess.post<{ key: string }>("/auth/keys", { name: `cli ${os.hostname()}` });
        apiKey = minted.key;
        accountEmail = login.account.email;
        // The session served its purpose; the stored credential is the key.
        await sess.post("/auth/logout").catch(() => {});
      }
      writeConfig({ api_url: apiUrl, api_key: apiKey, account_email: accountEmail });
      console.log(`signed in as ${accountEmail}. key stored in ${configPath()} (0600).`);
      return;
    }

    case "logout":
      deleteConfig();
      console.log("signed out. the api key remains valid — revoke it from the dashboard if needed.");
      return;

    case "billing": {
      const { api } = needAuth();
      if (flags.checkout) {
        const plan = String(flags.checkout);
        if (plan !== "indie" && plan !== "growth") fail("--checkout wants indie or growth");
        const res = await api.post<{ url: string }>("/billing/checkout", { plan });
        console.log(res.url);
        return;
      }
      if (flags.portal) {
        const res = await api.post<{ url: string }>("/billing/portal", {});
        console.log(res.url);
        return;
      }
      const b = await api.get<{
        plan: string; plan_status: string; trial_days_left: number | null;
        period: string;
        usage: { products: number; seats: number; events: number; analyses: number };
        limits: { products: number | null; seats: number | null; events: number; analyses: number };
        billable_products: number;
        product_lines: Array<{ name: string; billable: boolean; trial_days_left: number | null; events: number }>;
      }>("/billing");
      console.log(table(
        ["plan", "status", "trial", "products", "events", "seats", "period"],
        [[
          b.plan,
          b.plan_status,
          b.trial_days_left === null ? "—" : `${b.trial_days_left}d`,
          `${b.billable_products}/${b.usage.products} billing`,
          `${b.usage.events}/${b.limits.events}`,
          `${b.usage.seats}/${b.limits.seats ?? "∞"}`,
          b.period,
        ]],
      ));
      if (b.product_lines.length > 0) {
        console.log("");
        console.log(table(
          ["product", "billing", "events"],
          b.product_lines.map((l) => [
            l.name,
            l.billable ? "yes" : `trial · ${l.trial_days_left ?? 0}d left`,
            String(l.events),
          ]),
        ));
      }
      return;
    }

    case "export": {
      const kind = positionals[0] ?? fail("kind required: events | transactions");
      if (kind !== "events" && kind !== "transactions") fail("kind must be events or transactions");
      const slug = String(flags.product ?? fail("--product required"));
      const { api } = needAuth();
      const csv = await api.get<string>(`/products/${encodeURIComponent(slug)}/export/${kind}.csv`);
      if (flags.out) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(String(flags.out), typeof csv === "string" ? csv : String(csv));
        console.log(`wrote ${flags.out}`);
      } else {
        console.log(typeof csv === "string" ? csv : String(csv));
      }
      return;
    }

    case "account": {
      const { api } = needAuth();
      const me = await api.get<{
        email: string; role: string; member_role?: string;
        account_name?: string; name?: string | null; created_at: string;
      }>("/auth/me");
      console.log(table(
        ["workspace", "email", "role", "member", "since"],
        [[me.account_name ?? "—", me.email, me.role, me.member_role ?? "—", me.created_at.slice(0, 10)]],
      ));
      return;
    }

    case "accounts": {
      const { api } = needAuth();
      const rows = await api.get<Array<{ id: string; name: string; role: string; member_role: string }>>("/auth/accounts");
      if (rows.length === 0) return void console.log("no workspaces.");
      console.log(table(
        ["name", "role", "member", "id"],
        rows.map((r) => [r.name, r.role, r.member_role, r.id]),
      ));
      return;
    }

    case "team": {
      const { api } = needAuth();
      const rows = await api.get<Array<{
        email: string; name: string | null; member_role: string; status: string; last_seen_at: string | null;
      }>>("/team");
      if (rows.length === 0) return void console.log("no members.");
      console.log(table(
        ["person", "role", "status", "last seen"],
        rows.map((r) => [r.name || r.email, r.member_role, r.status, r.last_seen_at ? r.last_seen_at.slice(0, 10) : "—"]),
      ));
      return;
    }

    case "team invite": {
      const { api } = needAuth();
      const email = flags.email ? String(flags.email) : fail("--email is required");
      const role = String(flags.role ?? "member");
      if (role !== "owner" && role !== "member") fail("--role must be owner or member");
      const res = await api.post<{ invite_url: string; already_registered: boolean; expires_in_hours: number }>(
        "/team/invites", { email, member_role: role });
      console.log(res.already_registered
        ? `invite created — they already have a funnelkeeper login. share:\n\n  ${res.invite_url}\n`
        : `invite created (valid ${res.expires_in_hours}h). share:\n\n  ${res.invite_url}\n`);
      return;
    }

    case "claim-link": {
      const { api } = needAuth();
      const res = await api.post<{ claim_url: string; expires_at: string }>("/auth/claim-link");
      console.log(`claim url (valid until ${res.expires_at}):\n\n  ${res.claim_url}\n`);
      return;
    }

    case "product create": {
      const { api } = needAuth();
      const name = flags.name ? String(flags.name) : fail("--name is required");
      const slug = flags.slug ? String(flags.slug) : fail("--slug is required");
      const p = await api.post<{ slug: string; stage: string }>("/products", {
        name, slug,
        currency: String(flags.currency ?? "USD").toUpperCase(),
        domain: flags.domain ? String(flags.domain) : undefined,
      });
      console.log(`created ${p.slug} (${p.stage}). next: fk connect ga4 --product ${p.slug}`);
      return;
    }

    case "detect": {
      const urlArg = positionals[0] ?? (flags.url ? String(flags.url) : undefined);
      const product = flags.product ? String(flags.product) : undefined;
      if (!urlArg && !product) fail("provide a URL or --product <slug>");
      const { api } = needAuth();
      const endpoint = product
        ? `/products/${product}/detect-integrations`
        : `/tools/detect-integrations`;
      const body = urlArg ? { url: urlArg } : {};
      const res = await api.post<{
        url: string;
        final_url: string;
        domain: string;
        detected_count: number;
        integrations: Array<{
          name: string;
          category: string;
          detected_id: string | null;
          is_connected?: boolean;
          connection_status?: string;
          details: string | null;
          recommendation: string | null;
        }>;
        platform: { name: string; category: string; details?: string } | null;
        summary: string;
      }>(endpoint, body);

      console.log(`\n${bold("Website detection")} · ${res.domain}`);
      if (res.platform) console.log(dim(`platform: ${res.platform.name} (${res.platform.category})`));
      console.log(dim(`scanned: ${res.final_url}\n`));
      console.log(res.summary + "\n");

      if (res.integrations.length > 0) {
        const rows = res.integrations.map((item) => [
          item.name,
          item.category,
          item.detected_id ?? dim("(present)"),
          item.is_connected ? "connected" : item.connection_status === "pending" ? "pending" : dim("not connected"),
          item.recommendation ?? "",
        ]);
        console.log(table(["tool", "category", "detected id", "status in fk", "recommendation"], rows));
      }
      return;
    }

    case "connect": {
      const source = positionals[0] ?? fail("which source? ga4 | gtm | google-ads | gsc | google-sa | semrush | clarity | posthog | opinly | bing | ahrefs");
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const { api } = needAuth();

      if (source === "semrush") {
        const key = await askHidden("semrush api key: ");
        const domain = await ask("domain to track (e.g. example.com): ");
        await api.post(`/products/${product}/connections/semrush`, { api_key: key, domain });
        console.log("semrush connected. snapshots run weekly — units deplete, so no test call is made.");
        return;
      }

      if (source === "clarity") {
        const token = await askHidden("clarity data-export token (Settings → Data Export): ");
        const projectId = await ask("clarity project id (Settings → Overview): ");
        await api.post(`/products/${product}/connections/clarity`, { api_token: token, project_id: projectId });
        console.log("clarity connected. daily job samples session recordings (playback urls, never video).");
        return;
      }

      if (source === "posthog") {
        const key = await askHidden("posthog personal api key (Settings → Personal API keys, needs query:read): ");
        const projectId = await ask("posthog project id (the number in the project url): ");
        const host = (await ask("posthog host [https://us.posthog.com]: ")).trim();
        await api.post(`/products/${product}/connections/posthog`, {
          api_key: key, project_id: projectId, host: host || undefined,
        });
        console.log(
          "posthog connected. next: map events onto stages so the funnel fills —\n"
          + `  fk connect sync posthog --product ${product} runs it now.`);
        return;
      }

      if (source === "opinly") {
        const key = await askHidden("opinly api key (Settings → Developers, sk-…): ");
        const companyId = (await ask("opinly company id (comp_…, blank if the key sees only one): ")).trim();
        await api.post(`/products/${product}/connections/opinly`, {
          api_key: key, company_id: companyId || undefined,
        });
        console.log(
          "opinly connected. daily job snapshots AI-search visibility, site audit and keywords —\n"
          + `  fk connect sync opinly --product ${product} runs it now.`);
        return;
      }

      if (source === "bing") {
        const key = await askHidden("bing webmaster api key (Settings → API Access): ");
        const siteUrl = await ask("site url as verified in Bing (https://example.com/): ");
        await api.post(`/products/${product}/connections/bing`, { api_key: key, site_url: siteUrl });
        console.log(
          "bing connected. daily job reads query and page stats —\n"
          + `  fk connect sync bing --product ${product} runs it now.`);
        return;
      }

      if (source === "ahrefs") {
        const key = await askHidden("ahrefs api v3 token: ");
        const domain = await ask("domain to track (e.g. example.com): ");
        await api.post(`/products/${product}/connections/ahrefs`, { api_key: key, domain });
        console.log("ahrefs connected. snapshots run weekly — units deplete, so no test call is made after connect.");
        return;
      }

      if (source === "gsc") {
        const start = await api.post<{
          sa_email: string;
          instructions: Record<string, { human: string }>;
        }>("/connect/google/service-account/start", { product_slug: product, kinds: ["gsc"] });
        console.log(`\nadd this email as a Restricted user in Search Console:\n\n  ${start.sa_email}\n`);
        const line = start.instructions.gsc?.human;
        if (line) console.log(`  ${line}`);
        await ask("press enter once the grant is in place … ");
        const discovered = await api.post<{
          status?: string;
          options?: { gsc_sites?: Array<{ site_url: string }> };
        }>("/connect/google/service-account/verify", { product_slug: product });
        const sites = discovered.options?.gsc_sites ?? [];
        let siteUrl: string;
        if (sites.length === 1) siteUrl = sites[0].site_url;
        else if (sites.length > 1) siteUrl = await pick("search console site", sites.map((s) => s.site_url), sites.map((s) => s.site_url));
        else siteUrl = await ask("search console site url (https://example.com/ or sc-domain:example.com): ");
        const done = await api.post<{ activated: string[] }>("/connect/google/service-account/verify", {
          product_slug: product, gsc_site_url: siteUrl,
        });
        console.log(`${(done.activated ?? []).join(", ")} connected. run fk connect sync gsc --product ${product} to pull now.`);
        return;
      }

      if (source === "google-sa") {
        const kinds = ["ga4", "gtm"] as const;
        const start = await api.post<{
          sa_email: string;
          instructions: Record<string, { human: string }>;
        }>("/connect/google/service-account/start", { product_slug: product, kinds: [...kinds] });
        console.log(`\nadd this email as Viewer (GA4) / container user (GTM):\n\n  ${start.sa_email}\n`);
        for (const k of kinds) {
          const line = start.instructions[k]?.human;
          if (line) console.log(`  ${k}: ${line}`);
        }
        await ask("press enter once the grant is in place … ");
        const discovered = await api.post<{
          status?: string;
          ok?: boolean;
          activated?: string[];
          options?: {
            ga4_properties?: Array<{ id: string; name: string }>;
            gtm_containers?: Array<{ path: string; name: string; public_id: string }>;
          };
        }>("/connect/google/service-account/verify", { product_slug: product });
        const options = discovered.options ?? {};
        const select: { product_slug: string; ga4_property_id?: string; gtm_container_path?: string } = {
          product_slug: product,
        };
        const props = options.ga4_properties ?? [];
        if (props.length === 1) select.ga4_property_id = props[0].id;
        else if (props.length > 1) {
          select.ga4_property_id = await pick("ga4 property", props.map((p) => `${p.name} (${p.id})`), props.map((p) => p.id));
        }
        const cs = options.gtm_containers ?? [];
        if (cs.length === 1) select.gtm_container_path = cs[0].path;
        else if (cs.length > 1) {
          select.gtm_container_path = await pick("gtm container", cs.map((c) => `${c.name} (${c.public_id})`), cs.map((c) => c.path));
        }
        if (!select.ga4_property_id && !select.gtm_container_path) {
          fail("connected, but nothing is visible to that service account yet. add the email, then run this again.");
        }
        const done = await api.post<{ activated: string[] }>("/connect/google/service-account/verify", select);
        console.log(`${(done.activated ?? []).join(", ")} connected. run fk connect test ga4 --product ${product} to verify.`);
        return;
      }

      const kind = source === "google-ads" ? "google_ads" : source;
      if (!["ga4", "gtm", "google_ads", "gsc"].includes(kind)) fail(`unknown source ${source}`);
      const start = await api.post<{ state: string; auth_url: string; expires_at: string }>(
        "/connect/google/start", { product_slug: product, kinds: [kind], client: "cli" });

      console.log(`\nopen this url to connect ${source} for ${product}:\n\n  ${start.auth_url}\n`);
      openBrowser(start.auth_url);
      process.stdout.write("waiting for authorization … (ctrl-c to cancel)\n");

      const deadline = new Date(start.expires_at).getTime();
      let interval = 2000;
      const t0 = Date.now();
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval));
        if (Date.now() - t0 > 30_000) interval = 5000;
        const s = await api.get<{ status: string; error?: string; results?: unknown; options?: Record<string, unknown> }>(
          `/connect/google/status?state=${encodeURIComponent(start.state)}`);
        if (s.status === "pending") continue;
        if (s.status === "error") fail(`authorization failed: ${s.error}`);

        // Complete: pick entities if there's a choice.
        const options = s.options ?? {};
        const select: Record<string, string> = { state: start.state };
        if (kind === "ga4") {
          const props = (options.ga4_properties ?? []) as Array<{ id: string; name: string }>;
          if (props.length === 0) fail("connected, but no GA4 properties are visible to that Google account.");
          select.ga4_property_id = props.length === 1 ? props[0].id : await pick("ga4 property", props.map((p) => `${p.name} (${p.id})`), props.map((p) => p.id));
        } else if (kind === "gsc") {
          const sites = (options.gsc_sites ?? []) as Array<{ site_url: string }>;
          if (sites.length === 0) fail("connected, but no Search Console sites are visible to that Google account.");
          select.gsc_site_url = sites.length === 1 ? sites[0].site_url : await pick("search console site", sites.map((s) => s.site_url), sites.map((s) => s.site_url));
        } else if (kind === "gtm") {
          const cs = (options.gtm_containers ?? []) as Array<{ path: string; name: string; public_id: string }>;
          if (cs.length === 0) fail("connected, but no GTM containers are visible to that Google account.");
          select.gtm_container_path = cs.length === 1 ? cs[0].path : await pick("gtm container", cs.map((c) => `${c.name} (${c.public_id})`), cs.map((c) => c.path));
        } else {
          // Discovery needs the developer token too; fall back to typing the id.
          const cs = (options.ads_customers ?? []) as Array<{ id: string; name: string; currency: string; manager: boolean }>;
          const usable = cs.filter((c) => !c.manager);
          select.ads_customer_id = usable.length === 0
            ? await ask("google ads customer id (from ads.google.com): ")
            : usable.length === 1
              ? usable[0].id
              : await pick("google ads account", usable.map((c) => `${c.name} (${c.currency})`), usable.map((c) => c.id));
        }
        const done = await api.post<{ activated: string[] }>("/connect/google/select", select);
        console.log(`${done.activated.join(", ")} connected. run fk connect test ${source} --product ${product} to verify.`);
        return;
      }
      fail("authorization window expired. run the command again.");
    }
    // eslint-disable-next-line no-fallthrough
    case "connect test": {
      const source = positionals[0] ?? fail("which source?");
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const kind = source === "google-ads" ? "google_ads" : source;
      const { api } = needAuth();
      const res = await api.post<{ ok: boolean; detail: string }>(`/products/${product}/connections/${kind}/test`);
      console.log(`${res.ok ? "ok" : "failed"} — ${res.detail}`);
      process.exit(res.ok ? 0 : 1);
    }
    // eslint-disable-next-line no-fallthrough
    case "connect sync": {
      const source = positionals[0] ?? fail("which source?");
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const { api } = needAuth();
      const res = await api.post<{ detail: string }>(`/products/${product}/connections/${source}/sync`);
      console.log(`${res.detail} run fk status to watch it land.`);
      return;
    }
    // eslint-disable-next-line no-fallthrough
    case "track": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const stage = flags.stage ? String(flags.stage) : fail("--stage is required");
      const dedupe = flags.dedupe ? String(flags.dedupe) : fail("--dedupe is required");
      const { api } = needAuth();
      const event: Record<string, unknown> = { stage, dedupe_id: dedupe };
      if (flags.name) event.name = String(flags.name);
      if (flags.email || flags["external-id"]) {
        event.identity = {
          email: flags.email ? String(flags.email) : undefined,
          external_id: flags["external-id"] ? String(flags["external-id"]) : undefined,
        };
      }
      if (flags.cents !== undefined) {
        event.value = {
          amount_cents: Number(flags.cents),
          currency: flags.currency ? String(flags.currency).toUpperCase() : undefined,
        };
      }
      const res = await api.post<{ ok: true; received: number }>(`/products/${product}/events`, { events: [event] });
      console.log(`accepted ${res.received} event${res.received === 1 ? "" : "s"} (${stage}).`);
      return;
    }

    case "tracking-key": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const { api } = needAuth();
      const k = await api.get<{
        key: string | null; snippet: string | null; gtm_html: string | null; curl_example: string;
        gtm_connected: boolean;
        gtm_deploy: { deployed_at: string; version_name?: string; fk_snippet_found?: boolean } | null;
      }>(`/products/${product}/tracking-key`);
      if (!k.key) return void console.log("no write key yet. fk tracking-key rotate --product " + product);
      console.log(`key:     ${k.key}`);
      console.log(`snippet: ${k.snippet}`);
      if (k.gtm_html) console.log(`\ngtm custom html:\n${k.gtm_html}`);
      console.log(`\nserver-side:\n${k.curl_example}`);
      if (k.gtm_connected) {
        const found = k.gtm_deploy?.fk_snippet_found;
        console.log(dim(`\ngtm: connected${found === true ? ", snippet live" : found === false ? ", snippet not in live container" : ""}`));
      }
      return;
    }

    case "tracking-key rotate": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const { api } = needAuth();
      const k = await api.post<{ key: string; rotated: boolean; snippet: string }>(`/products/${product}/tracking-key`);
      console.log(`${k.rotated ? "rotated" : "created"}: ${k.key}`);
      console.log(`snippet: ${k.snippet}`);
      return;
    }

    case "tracking-key deploy": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      if (!(await confirmTyped("this publishes a FunnelKeeper tag to the LIVE gtm container."))) fail("cancelled.");
      const { api } = needAuth();
      const res = await api.post<{ workspace_name: string; version_name: string }>(
        `/products/${product}/tracking/gtm-deploy`);
      console.log(`published ${res.version_name} (${res.workspace_name}).`);
      return;
    }

    case "status": {
      const { api } = needAuth();
      const h = await api.get<{
        jobs: Array<{ name: string; last_ok: boolean | null; last_success_at: string | null; consecutive_failures: number }>;
        queue: { pending: number; past_expiry: number } | null;
      }>("/health");
      console.log(table(
        ["job", "last result", "failures"],
        h.jobs.map((j) => [j.name, j.last_ok === null ? "—" : j.last_ok ? "ok" : "FAILED", String(j.consecutive_failures)]),
        [2]));
      console.log(dim(`\nqueue: ${h.queue?.pending ?? 0} pending`));
      return;
    }

    case "ads": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const level = String(flags.level ?? "campaign");
      const days = Number(flags.days ?? 30);
      const { api } = needAuth();
      const r = await api.get<{
        level: string;
        rows: Array<{
          key: string; label: string | null; spend_cents: number; revenue_first_cents: number;
          roas: number | null; customers_first: number; cac_cents: number | null; currency: string | null;
        }>;
        totals: { spend_without_detail_cents: number; unattributed_cents: number; no_dimension_cents: number };
        coverage: { paid_identities: number; identities_with_dimension: number };
      }>(`/products/${product}/attribution/ads?days=${days}&level=${level}`);
      if (r.rows.length === 0) {
        return void console.log(`nothing at ${level} grain yet. connect google ads, then fk ads url-suffix --product ${product}`);
      }
      const cur = r.rows.find((x) => x.currency)?.currency ?? "USD";
      const name = (x: { key: string; label: string | null }) =>
        x.key === "unattributed" ? "(unattributed)"
        : x.key === "no_dimension" ? `(no ${level.replace("_", " ")})`
        : x.label || `#${x.key}`;
      console.log(table(
        [level.replace("_", " "), "spend", "revenue", "roas", "customers", "cac"],
        r.rows.map((x) => [
          name(x), money(x.spend_cents, cur), money(x.revenue_first_cents, cur),
          x.roas === null ? "—" : `${Number(x.roas).toFixed(2)}x`,
          String(x.customers_first), money(x.cac_cents, cur),
        ]),
        [1, 2, 3, 4, 5]));
      // The two gaps are the whole point of reading this honestly.
      if (r.totals.spend_without_detail_cents > 0) {
        console.log(dim(`\n${money(r.totals.spend_without_detail_cents, cur)} of spend has no ${level.replace("_", " ")} (performance max / shopping report none).`));
      }
      const placed = r.coverage.paid_identities > 0
        ? r.coverage.identities_with_dimension / r.coverage.paid_identities : null;
      if (placed !== null && placed < 0.8) {
        console.log(dim(`${Math.round(placed * 100)}% of paid visitors carry one. fk ads url-suffix --product ${product}`));
      }
      return;
    }

    case "ads url-suffix": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const { api } = needAuth();
      const s = await api.get<{
        customer_id: string | null; final_url_suffix: string | null; auto_tagging_enabled: boolean;
        complete: boolean; missing: string[]; proposed_suffix: string; recommended_suffix: string;
        read_error: string | null;
      }>(`/products/${product}/connections/google-ads/url-suffix`);
      console.log(`account:      ${s.customer_id ?? "—"}`);
      if (s.read_error) {
        console.log(`\ncouldn't read the account: ${s.read_error}`);
        console.log(`\npaste this into the account final url suffix:\n${s.recommended_suffix}`);
        return;
      }
      console.log(`auto-tagging: ${s.auto_tagging_enabled ? "on" : "off — turn it on in google ads"}`);
      console.log(`current:      ${s.final_url_suffix || "(none)"}`);
      if (s.complete) return void console.log("\nall tracking parameters present.");
      console.log(`missing:      ${s.missing.join(", ")}`);
      console.log(`\npaste this as the account final url suffix:\n${s.proposed_suffix}`);
      console.log(dim(`\nor apply it for me: fk ads url-suffix apply --product ${product}`));
      return;
    }

    case "ads url-suffix apply": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      if (!(await confirmTyped("this changes the landing url of EVERY ad in the google ads account."))) fail("cancelled.");
      const { api } = needAuth();
      const res = await api.post<{ suffix: string; added: string[]; already_complete: boolean }>(
        `/products/${product}/connections/google-ads/url-suffix`);
      if (res.already_complete) return void console.log("nothing to do — every parameter was already there.");
      console.log(`added ${res.added.join(", ")}.\nsuffix is now: ${res.suffix}`);
      return;
    }

    case "portfolio": {
      const { api } = needAuth();
      const rows = await api.get<Array<{
        slug: string; currency: string; spend_30d_cents: number; revenue_30d_cents: number;
        cac_cents: number | null; ltv_cac: number | null;
      }>>("/portfolio");
      if (rows.length === 0) return void console.log("no products yet. fk product create --name … --slug …");
      console.log(table(
        ["product", "spend 30d", "revenue 30d", "cac", "ltv:cac"],
        rows.map((r) => [
          r.slug, money(r.spend_30d_cents, r.currency), money(r.revenue_30d_cents, r.currency),
          money(r.cac_cents, r.currency), r.ltv_cac === null ? "—" : Number(r.ltv_cac).toFixed(1),
        ]),
        [1, 2, 3, 4]));
      return;
    }

    case "queue list": {
      const { api } = needAuth();
      const cards = await api.get<Array<{ id: string; product_slug: string | null; card_type: string; headline: string; metric_line: string }>>("/queue");
      if (cards.length === 0) return void console.log("queue clear.");
      console.log(table(
        ["id", "product", "type", "headline"],
        cards.map((c) => [c.id.slice(0, 8), c.product_slug ?? "—", c.card_type, c.headline])));
      return;
    }

    case "growth": {
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const days = Number(flags.days ?? 30);
      const tool = cliGrowthTool(String(flags.tool ?? "cursor"));
      const { api } = needAuth();
      const r = await api.get<{
        actions: Array<{
          id: string; headline: string; metric_line: string; category: string;
          difficulty: string; revenue_impact_cents: number | null; currency: string;
        }>;
      }>(`/products/${product}/growth-actions?days=${days}&tool=${tool}`);
      if (r.actions.length === 0) {
        return void console.log("no growth actions yet. connect a source and wait for a window of events.");
      }
      const cur = r.actions[0]?.currency ?? "USD";
      console.log(table(
        ["id", "category", "impact", "effort", "headline"],
        r.actions.map((a) => [
          a.id,
          a.category,
          a.revenue_impact_cents === null ? "—" : `${money(a.revenue_impact_cents, cur)}/mo`,
          a.difficulty.replace("_", " "),
          a.headline,
        ]),
        [4]));
      console.log(dim(`\nfk prompt <id> --product ${product} --tool ${flags.tool ?? "cursor"}`));
      return;
    }

    case "prompt": {
      const id = positionals[0] ?? fail("growth action id required (fk growth --product …)");
      const product = flags.product ? String(flags.product) : fail("--product is required");
      const tool = cliGrowthTool(String(flags.tool ?? "cursor"));
      const days = Number(flags.days ?? 30);
      const { api } = needAuth();
      const r = await api.post<{ prompt: string }>(
        `/products/${product}/growth-actions/${encodeURIComponent(id)}/prompt`,
        { tool, days });
      console.log(r.prompt);
      return;
    }

    case "queue approve":
    case "queue reject":
    case "queue snooze": {
      const shortId = positionals[0] ?? fail("card id required (fk queue list)");
      const { api } = needAuth();
      const cards = await api.get<Array<{ id: string; headline: string; metric_line: string; action_spec: unknown }>>("/queue");
      const card = cards.find((c) => c.id.startsWith(shortId));
      if (!card) fail("no pending card with that id. run fk queue list.");
      const action = command.split(" ")[1];

      if (action === "approve" || action === "reject") {
        console.log(`\n  ${card.headline}\n  ${dim(card.metric_line)}`);
        if (card.action_spec) console.log(`  ${dim(JSON.stringify(card.action_spec))}`);
        const warn = action === "approve" ? "approving can change spend." : "dismissing removes it from the queue.";
        if (!(await confirmTyped(`\n${warn}`))) fail("cancelled.");
      }
      await api.post(`/queue/${card.id}/${action}`, action === "snooze" ? { snoozeHours: Number(flags.hours ?? 24) } : {});
      console.log(`${action === "approve" ? "approved" : action === "reject" ? "dismissed" : "snoozed"}.`);
      return;
    }

    default:
      console.error(`unknown command: ${command}\n`);
      console.log(usage());
      process.exit(2);
  }
}

async function pick(label: string, display: string[], values: string[]): Promise<string> {
  console.log(`\nchoose a ${label}:`);
  display.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
  const n = Number(await ask("number: "));
  if (!Number.isInteger(n) || n < 1 || n > values.length) fail("that wasn't one of the options.");
  return values[n - 1];
}

main().catch((e) => {
  if (e instanceof ApiError) fail(e.status === 401 ? "not authorized. run fk login again." : e.message);
  fail(e instanceof Error ? e.message : String(e));
});
