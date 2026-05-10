import {
  MenuBarExtra,
  Icon,
  Color,
  Image,
  getPreferenceValues,
  openExtensionPreferences,
  showHUD,
  open,
} from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, copyFile, chmod, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SERVICE_LABEL = "io.local.sing-box.profiled";
const LAUNCH_DAEMON_PATH = `/Library/LaunchDaemons/${SERVICE_LABEL}.plist`;
const STAGED_CONFIG = "/tmp/singboxmenu-staged.json";
const ACTIVE_CONFIG = "/Library/SingBoxMenu/active.json";
const SING_BOX_HINTS = [
  "/opt/homebrew/bin/sing-box",
  "/usr/local/bin/sing-box",
  "/usr/bin/sing-box",
];

interface Prefs {
  configFolder: string;
  singBoxBinary?: string;
}

type ServiceStatus = "running" | "loaded" | "installed" | "notInstalled";

interface Profile {
  id: string;
  path: string;
  valid: boolean;
  active: boolean;
  error?: string;
}

interface Snapshot {
  status: ServiceStatus;
  profiles: Profile[];
  binaryFound: boolean;
  daemonInstalled: boolean;
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  running: "Running",
  loaded: "Loaded",
  installed: "Stopped",
  notInstalled: "Not Installed",
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function findSingBox(prefBinary?: string): Promise<string | null> {
  const candidates = [prefBinary, ...SING_BOX_HINTS].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const s = await stat(c);
      if (s.isFile()) return c;
    } catch {
      /* continue */
    }
  }
  return null;
}

async function detectStatus(): Promise<ServiceStatus> {
  try {
    const { stdout } = await execFileAsync("/bin/launchctl", ["print", `system/${SERVICE_LABEL}`]);
    return stdout.includes("state = running") ? "running" : "loaded";
  } catch {
    return (await exists(LAUNCH_DAEMON_PATH)) ? "installed" : "notInstalled";
  }
}

async function fileHash(p: string): Promise<string | null> {
  try {
    const data = await readFile(p);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

function execError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = String(e.stderr ?? "").trim();
    if (stderr) return stderr;
    const stdout = String(e.stdout ?? "").trim();
    if (stdout) return stdout;
    const message = String(e.message ?? "").trim();
    if (message) return message;
  }
  return String(err);
}

async function listProfiles(folder: string, binary: string | null): Promise<Profile[]> {
  if (!folder) return [];

  const candidates: { dir: string; prefix: string }[] = [
    { dir: folder, prefix: "" },
    { dir: path.join(folder, "profiles"), prefix: "profiles/" },
  ];

  const found: { id: string; path: string }[] = [];
  for (const { dir, prefix } of candidates) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const fullPath = path.join(dir, name);
      if (path.resolve(fullPath) === ACTIVE_CONFIG) continue;
      found.push({ id: prefix + name, path: fullPath });
    }
  }

  found.sort((a, b) => a.id.localeCompare(b.id));

  const activeHash = await fileHash(ACTIVE_CONFIG);

  return Promise.all(
    found.map(async ({ id, path: p }) => {
      const [hash, validation] = await Promise.all([
        fileHash(p),
        binary
          ? execFileAsync(binary, ["check", "-c", p])
              .then(() => ({ valid: true as const }))
              .catch((err: unknown) => ({ valid: false as const, error: execError(err) }))
          : Promise.resolve({ valid: true as const }),
      ]);

      const active = activeHash !== null && hash !== null && hash === activeHash;
      return {
        id,
        path: p,
        valid: validation.valid,
        active,
        error: "error" in validation ? validation.error : undefined,
      };
    }),
  );
}

async function loadSnapshot(prefs: Prefs): Promise<Snapshot> {
  const binary = await findSingBox(prefs.singBoxBinary);
  const [status, profiles, daemonInstalled] = await Promise.all([
    detectStatus(),
    listProfiles(prefs.configFolder, binary),
    exists(LAUNCH_DAEMON_PATH),
  ]);
  return { status, profiles, binaryFound: !!binary, daemonInstalled };
}

async function activateProfile(profilePath: string, binary: string) {
  await execFileAsync(binary, ["check", "-c", profilePath]);
  await copyFile(profilePath, STAGED_CONFIG);
  await chmod(STAGED_CONFIG, 0o600);

  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/usr/bin/install",
    "-o",
    "root",
    "-g",
    "wheel",
    "-m",
    "644",
    STAGED_CONFIG,
    ACTIVE_CONFIG,
  ]);

  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "bootstrap",
    "system",
    LAUNCH_DAEMON_PATH,
  ]).catch(() => undefined);
  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "enable",
    `system/${SERVICE_LABEL}`,
  ]).catch(() => undefined);
  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "kickstart",
    "-k",
    `system/${SERVICE_LABEL}`,
  ]);
}

async function startService() {
  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "bootstrap",
    "system",
    LAUNCH_DAEMON_PATH,
  ]).catch(() => undefined);
  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "enable",
    `system/${SERVICE_LABEL}`,
  ]).catch(() => undefined);
  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "kickstart",
    "-k",
    `system/${SERVICE_LABEL}`,
  ]);
}

async function stopService() {
  await execFileAsync("/usr/bin/sudo", [
    "-n",
    "/bin/launchctl",
    "bootout",
    `system/${SERVICE_LABEL}`,
  ]);
}

export default function Command() {
  const prefs = getPreferenceValues<Prefs>();
  const { data, isLoading, revalidate } = useCachedPromise(loadSnapshot, [prefs], {
    keepPreviousData: true,
  });

  const status: ServiceStatus = data?.status ?? "notInstalled";
  const profiles = data?.profiles ?? [];
  const isRunning = status === "running";
  const binaryFound = data?.binaryFound ?? true;
  const daemonInstalled = data?.daemonInstalled ?? true;

  const menuIcon: Image.ImageLike = isRunning
    ? "menubar-icon.png"
    : { source: "menubar-icon.png", tintColor: Color.SecondaryText };

  const dotIcon: Image.ImageLike = {
    source: Icon.CircleFilled,
    tintColor: isRunning ? Color.Green : Color.SecondaryText,
  };

  return (
    <MenuBarExtra
      icon={menuIcon}
      isLoading={isLoading}
      tooltip={`sing-box: ${STATUS_LABEL[status]}`}
    >
      <MenuBarExtra.Item icon={dotIcon} title={`sing-box: ${STATUS_LABEL[status]}`} />

      {!binaryFound && (
        <MenuBarExtra.Item
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
          title="sing-box binary not found"
          subtitle="Set path in Preferences"
          onAction={openExtensionPreferences}
        />
      )}
      {!daemonInstalled && (
        <MenuBarExtra.Item
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
          title="LaunchDaemon not installed"
          subtitle="Run SingBoxMenu.app → Install / Enable Boot Service"
        />
      )}

      <MenuBarExtra.Separator />

      <MenuBarExtra.Submenu title="Profiles" icon={Icon.List}>
        {profiles.length === 0 ? (
          <MenuBarExtra.Item title="No .json configs found" />
        ) : (
          profiles.map((p) => (
            <MenuBarExtra.Item
              key={p.path}
              title={p.id}
              tooltip={p.error ?? p.path}
              icon={
                p.active
                  ? { source: Icon.CheckCircle, tintColor: Color.Green }
                  : !p.valid
                    ? { source: Icon.XMarkCircle, tintColor: Color.Red }
                    : { source: Icon.Circle, tintColor: Color.SecondaryText }
              }
              onAction={async () => {
                if (!p.valid) {
                  await showHUD(`✗ ${p.id} — ${p.error ?? "invalid"}`);
                  return;
                }
                try {
                  const binary = await findSingBox(prefs.singBoxBinary);
                  if (!binary) throw new Error("sing-box binary not found");
                  await activateProfile(p.path, binary);
                  await showHUD(`✓ Activated ${p.id}`);
                  revalidate();
                } catch (err) {
                  await showHUD(`✗ ${execError(err)}`);
                }
              }}
            />
          ))
        )}
      </MenuBarExtra.Submenu>

      <MenuBarExtra.Separator />

      <MenuBarExtra.Item
        title="Start"
        icon={Icon.Play}
        onAction={async () => {
          try {
            await startService();
            await showHUD("✓ sing-box started");
            revalidate();
          } catch (err) {
            await showHUD(`✗ ${execError(err)}`);
          }
        }}
      />
      <MenuBarExtra.Item
        title="Stop"
        icon={Icon.Stop}
        onAction={async () => {
          try {
            await stopService();
            await showHUD("✓ sing-box stopped");
            revalidate();
          } catch (err) {
            await showHUD(`✗ ${execError(err)}`);
          }
        }}
      />
      <MenuBarExtra.Item
        title="Refresh"
        icon={Icon.RotateClockwise}
        shortcut={{ modifiers: ["cmd"], key: "r" }}
        onAction={() => revalidate()}
      />

      <MenuBarExtra.Separator />

      <MenuBarExtra.Item
        title="Reveal Config Folder"
        icon={Icon.Folder}
        onAction={() => open(prefs.configFolder)}
      />
      <MenuBarExtra.Item
        title="Open Preferences..."
        icon={Icon.Gear}
        shortcut={{ modifiers: ["cmd"], key: "," }}
        onAction={openExtensionPreferences}
      />
    </MenuBarExtra>
  );
}
