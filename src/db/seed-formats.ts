import type { formatKind } from "./schema";

type Kind = (typeof formatKind.enumValues)[number];

/**
 * Starting list of viewing formats. Aliases are the other spellings found in
 * the watch log; matching is case- and whitespace-insensitive, so "sky" and
 * "Cinema " need no alias. New formats are added from the app.
 */
export const SEED_FORMATS: { name: string; kind: Kind; aliases?: string[] }[] = [
  { name: "Blu Ray", kind: "disc" },
  { name: "4K Blu Ray", kind: "disc" },
  { name: "DVD", kind: "disc" },
  { name: "HD DVD", kind: "disc", aliases: ["HDDVD"] },

  { name: "Cinema", kind: "cinema" },
  { name: "BFI IMAX", kind: "cinema" },

  { name: "Netflix", kind: "streaming" },
  { name: "Amazon Prime Video", kind: "streaming" },
  { name: "Disney +", kind: "streaming" },
  { name: "Love Film", kind: "streaming" },
  { name: "Plex", kind: "streaming" },
  { name: "Paramount +", kind: "streaming" },
  { name: "Apple TV +", kind: "streaming", aliases: ["Apple TV"] },
  { name: "Mubi", kind: "streaming" },
  { name: "Arrow Player", kind: "streaming" },
  { name: "BFI Player", kind: "streaming" },
  { name: "HBO Max", kind: "streaming" },
  { name: "YouTube", kind: "streaming" },
  { name: "ITVX", kind: "streaming" },
  { name: "BBC iPlayer", kind: "streaming" },
  { name: "Fawesome", kind: "streaming" },
  { name: "Stream", kind: "streaming" },

  { name: "Sky", kind: "tv" },
  { name: "Sky Movies", kind: "tv" },
  { name: "Sky One", kind: "tv" },
  { name: "Sky Arts", kind: "tv" },
  { name: "Sky Documentaries", kind: "tv" },
  { name: "Film 4", kind: "tv" },
  { name: "Channel 4", kind: "tv" },
  { name: "BBC One", kind: "tv" },
  { name: "ITV", kind: "tv" },
  { name: "ITV4", kind: "tv" },
  { name: "Comedy Central", kind: "tv" },
  { name: "TV", kind: "tv" },

  { name: "Download", kind: "download" },
  { name: "Plane", kind: "other" },
];

/** Disc watch format -> the catalogue format of the copy it would have been played from. */
export const DISC_TO_MEDIA: Record<string, "4K UltraHD" | "Blu Ray" | "DVD" | "HD DVD"> = {
  "4K Blu Ray": "4K UltraHD",
  "Blu Ray": "Blu Ray",
  DVD: "DVD",
  "HD DVD": "HD DVD",
};
