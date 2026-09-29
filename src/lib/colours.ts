/** Spine colours used in the catalogue, with the swatch used to draw them. */
export const SPINE_COLOURS: Record<string, string> = {
  Black: "#1c1c1e",
  Grey: "#8e8e93",
  Silver: "#c7c7cc",
  White: "#f5f5f0",
  Cream: "#efe4c8",
  Yellow: "#f2c12e",
  Gold: "#c9a23f",
  Orange: "#e8772e",
  Red: "#c9302c",
  Pink: "#e67ea8",
  Purple: "#7a4fa3",
  Blue: "#2f6fbe",
  Green: "#3f8f4f",
  Brown: "#7b5234",
};

export const COLOUR_NAMES = Object.keys(SPINE_COLOURS);

export function swatch(name: string): string {
  return SPINE_COLOURS[name] ?? "#b0b0b0";
}
