// Discord invite stats for the homepage (members, online) plus the server
// icon, stored on our own site so visitors never contact Discord. Uses the
// public invite endpoint, no token needed. Run by data-refresh.yml.
import { writeFile, readFile } from "node:fs/promises";

const INVITE = "psW4NgjBFN";
const OUT = "assets/data/discord.json";
const ICON_OUT = "assets/img/discord-icon.png";

const res = await fetch(`https://discord.com/api/v10/invites/${INVITE}?with_counts=true`, {
  headers: { "User-Agent": "zevkev.de data refresh (https://zevkev.de)" },
});
if (!res.ok) throw new Error(`Discord invite request failed: ${res.status}`);
const invite = await res.json();
const guild = invite.guild || {};

let previous = {};
try {
  previous = JSON.parse(await readFile(OUT, "utf8"));
} catch {}

if (guild.id && guild.icon && guild.icon !== previous.iconHash) {
  const icon = await fetch(`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`);
  if (icon.ok) {
    await writeFile(ICON_OUT, Buffer.from(await icon.arrayBuffer()));
    console.log(`Updated server icon (${guild.icon})`);
  }
}

const data = {
  name: guild.name || "Medienspeicher",
  members: invite.approximate_member_count ?? null,
  online: invite.approximate_presence_count ?? null,
  iconHash: guild.icon || previous.iconHash || null,
};
const changed = ["name", "members", "online", "iconHash"].some((key) => data[key] !== previous[key]);
if (changed) {
  await writeFile(OUT, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2) + "\n");
}
console.log(`Discord: ${data.members} Mitglieder, ${data.online} online${changed ? "" : " (unchanged)"}`);
