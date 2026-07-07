import dgram from "dgram";
import dns from "dns/promises";
import fs from "fs";
import dnsPacket from "dns-packet";
import { execFile } from "child_process";
import { promisify } from "util";
import { normalizeDomain } from "./storage";

export interface RestoreResult {
  ok: boolean;
  issues: string[];
}

const exec = promisify(execFile);
const UPSTREAM = "8.8.8.8";
const UPSTREAM_PORT = 53;
const HOSTS_PATH = "C:\\Windows\\System32\\drivers\\etc\\hosts";
const HOSTS_START = "# BEGIN FOCUS BLOCK";
const HOSTS_END = "# END FOCUS BLOCK";

const DOH_POLICIES = [
  { key: "HKLM\\SOFTWARE\\Policies\\Google\\Chrome", value: "DnsOverHttpsMode" },
  { key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", value: "DnsOverHttpsMode" },
];

export class DnsBlocker {
  private socket: dgram.Socket | null = null;
  private upstream: dgram.Socket | null = null;
  private blocklist = new Set<string>();
  private _running = false;
  private _dnsRedirectOk = false;
  private _lastDomain: string | null = null;

  get running(): boolean {
    return this._running;
  }

  get dnsRedirectOk(): boolean {
    return this._dnsRedirectOk;
  }

  get lastDomain(): string | null {
    return this._lastDomain;
  }

  updateBlocklist(domains: string[]): void {
    this.blocklist = new Set(domains.map(normalizeDomain));
    if (this._running) {
      updateHostsFile(this.blocklist).catch(() => {});
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._running) {
        resolve();
        return;
      }

      const socket = dgram.createSocket("udp4");
      const upstream = dgram.createSocket("udp4");
      const pending = new Map<number, { port: number; address: string }>();

      socket.on("error", (err) => {
        this._running = false;
        reject(
          new Error(`DNS failed: ${err.message}. Run Focus as Administrator.`)
        );
      });

      socket.on("message", (msg, rinfo) => {
        let query: dnsPacket.DecodedPacket;
        try {
          query = dnsPacket.decode(msg);
        } catch {
          return;
        }

        const question = query.questions?.[0];
        if (!question) return;

        const domain = normalizeDomain(String(question.name));
        if (domain) this._lastDomain = domain;

        if (isBlocked(domain, this.blocklist)) {
          const response = dnsPacket.encode({
            type: "response",
            id: query.id ?? 0,
            flags: (1 << 15) | (1 << 10),
            questions: query.questions,
            answers: [],
          });
          // NXDOMAIN via raw buffer edit — @types/dns-packet lacks rcode field
          const buf = Buffer.from(response);
          buf[3] = (buf[3] & 0xf0) | 3;
          socket.send(buf, rinfo.port, rinfo.address);
          return;
        }

        const qid = query.id ?? 0;
        pending.set(qid, { port: rinfo.port, address: rinfo.address });
        upstream.send(msg, UPSTREAM_PORT, UPSTREAM);
      });

      upstream.on("message", (msg) => {
        let response: dnsPacket.DecodedPacket;
        try {
          response = dnsPacket.decode(msg);
        } catch {
          return;
        }
        const rid = response.id ?? 0;
        const target = pending.get(rid);
        if (target) {
          pending.delete(rid);
          socket.send(msg, target.port, target.address);
        }
      });

      socket.bind(53, "127.0.0.1", async () => {
        this.socket = socket;
        this.upstream = upstream;
        this._running = true;

        try {
          this._dnsRedirectOk = await configureSystemDns(true);
          await updateHostsFile(this.blocklist);
          await disableBrowserDoH(true);
          await flushDnsCache();

          if (!this._dnsRedirectOk) {
            await this.stop();
            reject(
              new Error(
                "Could not redirect Windows DNS to 127.0.0.1. " +
                  "Focus needs Administrator rights — close the app, right-click Focus, " +
                  "choose Run as administrator, then turn blocking on again."
              )
            );
            return;
          }
          resolve();
        } catch (err) {
          await this.stop();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async stopLocal(): Promise<void> {
    this._running = false;
    this._dnsRedirectOk = false;
    this.socket?.close();
    this.upstream?.close();
    this.socket = null;
    this.upstream = null;
  }

  async stop(): Promise<RestoreResult> {
    await this.stopLocal();
    return restoreSystemNetworking();
  }
}

export async function isSystemDnsStuck(): Promise<boolean> {
  try {
    const output = await runPowerShell(`
      $up = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
      if (-not $up) { 'none' }
      else {
        $stuck = $false
        foreach ($a in $up) {
          $servers = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4).ServerAddresses
          if ($servers -contains '127.0.0.1') { $stuck = $true }
        }
        if ($stuck) { 'stuck' } else { 'ok' }
      }
    `);
    return output === "stuck";
  } catch {
    return false;
  }
}

export async function hasHostsBlock(): Promise<boolean> {
  try {
    const content = fs.readFileSync(HOSTS_PATH, "utf8");
    return content.includes(HOSTS_START);
  } catch {
    return false;
  }
}

export async function getNetworkingIssues(): Promise<string[]> {
  const issues: string[] = [];
  if (await isSystemDnsStuck()) {
    issues.push("Windows DNS is still pointing to 127.0.0.1");
  }
  if (await hasHostsBlock()) {
    issues.push("Hosts file still contains Focus block entries");
  }
  if (issues.length === 0 && !(await verifyDnsResolution())) {
    issues.push("DNS lookups are failing");
  }
  return issues;
}

export async function verifySystemRestored(): Promise<RestoreResult> {
  const issues = await getNetworkingIssues();
  return { ok: issues.length === 0, issues };
}

export async function restoreSystemNetworking(): Promise<RestoreResult> {
  await configureSystemDns(false);
  await removeHostsBlock();
  await disableBrowserDoH(false);
  await flushDnsCache();

  let result = await verifySystemRestored();
  if (!result.ok && (await isSystemDnsStuck())) {
    await resetDnsViaNetsh();
    await flushDnsCache();
    result = await verifySystemRestored();
  }
  return result;
}

export async function ensureSystemUnblocked(): Promise<RestoreResult> {
  const check = await verifySystemRestored();
  if (check.ok) return check;
  return restoreSystemNetworking();
}

export async function cleanupOrphanedBlocking(): Promise<RestoreResult> {
  return restoreSystemNetworking();
}

export async function verifyDnsResolution(): Promise<boolean> {
  try {
    await dns.resolve4("google.com");
    return true;
  } catch {
    return false;
  }
}

function isBlocked(domain: string, blocklist: Set<string>): boolean {
  return [...blocklist].some(
    (b) => domain === b || domain.endsWith(`.${b}`)
  );
}

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await exec("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  return stdout.trim();
}

async function configureSystemDns(enable: boolean): Promise<boolean> {
  if (enable) {
    try {
      const output = await runPowerShell(`
        $changed = $false
        Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
          Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ServerAddresses @('127.0.0.1') -ErrorAction Stop
          $changed = $true
        }
        if ($changed) { 'ok' } else { 'none' }
      `);
      if (output !== "ok") return false;

      const verify = await runPowerShell(`
        $up = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
        if (-not $up) { 'none' }
        else {
          $allLocal = $true
          foreach ($a in $up) {
            $servers = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4).ServerAddresses
            if ($servers -notcontains '127.0.0.1') { $allLocal = $false }
          }
          if ($allLocal) { 'ok' } else { 'fail' }
        }
      `);
      return verify === "ok";
    } catch {
      for (const name of ["Wi-Fi", "Ethernet", "WiFi"]) {
        try {
          await exec("netsh", [
            "interface",
            "ip",
            "set",
            "dns",
            `name=${name}`,
            "source=static",
            "addr=127.0.0.1",
            "register=none",
            "validate=no",
          ]);
          return true;
        } catch {
          /* try next */
        }
      }
      return false;
    }
  }

  try {
    await runPowerShell(`
      Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
        Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ResetServerAddresses -ErrorAction Stop
      }
    `);
    return !(await isSystemDnsStuck());
  } catch {
    /* fall through to netsh */
  }

  return resetDnsViaNetsh();
}

async function resetDnsViaNetsh(): Promise<boolean> {
  let changed = false;
  const names = await listActiveAdapterNames();
  for (const name of names) {
    try {
      await exec("netsh", [
        "interface",
        "ip",
        "set",
        "dns",
        `name=${name}`,
        "source=dhcp",
      ]);
      changed = true;
    } catch {
      /* try next */
    }
  }
  if (!changed) return false;
  return !(await isSystemDnsStuck());
}

async function listActiveAdapterNames(): Promise<string[]> {
  try {
    const output = await runPowerShell(`
      Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.Name }
    `);
    if (!output) return ["Wi-Fi", "Ethernet", "WiFi"];
    return output.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
  } catch {
    return ["Wi-Fi", "Ethernet", "WiFi", "Ethernet 2", "Ethernet 3"];
  }
}

async function updateHostsFile(blocklist: Set<string>): Promise<void> {
  let content = "";
  try {
    content = fs.readFileSync(HOSTS_PATH, "utf8");
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.trim() === HOSTS_START) {
      inBlock = true;
      continue;
    }
    if (line.trim() === HOSTS_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) kept.push(line);
  }

  const entries: string[] = [HOSTS_START];
  for (const domain of blocklist) {
    entries.push(`0.0.0.0 ${domain}`);
    entries.push(`0.0.0.0 www.${domain}`);
  }
  entries.push(HOSTS_END);

  const trimmed = kept.join("\n").replace(/\n+$/, "");
  const next = trimmed ? `${trimmed}\n${entries.join("\n")}\n` : `${entries.join("\n")}\n`;
  try {
    fs.writeFileSync(HOSTS_PATH, next, "utf8");
  } catch {
    /* hosts file requires admin — DNS blocking still works without it */
  }
}

async function removeHostsBlock(): Promise<void> {
  try {
    const content = fs.readFileSync(HOSTS_PATH, "utf8");
    const lines = content.split(/\r?\n/);
    const kept: string[] = [];
    let inBlock = false;
    for (const line of lines) {
      if (line.trim() === HOSTS_START) {
        inBlock = true;
        continue;
      }
      if (line.trim() === HOSTS_END) {
        inBlock = false;
        continue;
      }
      if (!inBlock) kept.push(line);
    }
    fs.writeFileSync(HOSTS_PATH, kept.join("\n").replace(/\n+$/, "") + "\n", "utf8");
  } catch {
    /* best effort */
  }
}

async function disableBrowserDoH(disable: boolean): Promise<void> {
  for (const { key, value } of DOH_POLICIES) {
    try {
      if (disable) {
        await exec("reg", ["add", key, "/v", value, "/t", "REG_SZ", "/d", "disable", "/f"]);
      } else {
        await exec("reg", ["delete", key, "/v", value, "/f"]);
      }
    } catch {
      /* key may not exist on delete */
    }
  }
}

async function flushDnsCache(): Promise<void> {
  try {
    await exec("ipconfig", ["/flushdns"]);
  } catch {
    /* best effort */
  }
}
