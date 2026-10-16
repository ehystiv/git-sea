/**
 * Leading emoji of a commit message, as Unicode ("✨ add login") or as a gitmoji shortcode
 * (":sparkles: add login"). The commit graph shows it in the node instead of the kind icon.
 */

/** Gitmoji shortcodes (gitmoji.dev) and a few common GitHub ones, to the emoji they stand for. */
const SHORTCODES: Record<string, string> = {
  art: "🎨", zap: "⚡️", fire: "🔥", bug: "🐛", ambulance: "🚑️", sparkles: "✨", memo: "📝", rocket: "🚀",
  lipstick: "💄", tada: "🎉", white_check_mark: "✅", lock: "🔒️", closed_lock_with_key: "🔐", bookmark: "🔖",
  rotating_light: "🚨", construction: "🚧", green_heart: "💚", arrow_down: "⬇️", arrow_up: "⬆️", pushpin: "📌",
  construction_worker: "👷", chart_with_upwards_trend: "📈", recycle: "♻️", heavy_plus_sign: "➕",
  heavy_minus_sign: "➖", wrench: "🔧", hammer: "🔨", globe_with_meridians: "🌐", pencil2: "✏️", poop: "💩",
  rewind: "⏪️", twisted_rightwards_arrows: "🔀", package: "📦️", alien: "👽️", truck: "🚚", page_facing_up: "📄",
  boom: "💥", bento: "🍱", wheelchair: "♿️", bulb: "💡", beers: "🍻", speech_balloon: "💬", card_file_box: "🗃️",
  loud_sound: "🔊", mute: "🔇", busts_in_silhouette: "👥", children_crossing: "🚸", building_construction: "🏗️",
  iphone: "📱", clown_face: "🤡", egg: "🥚", see_no_evil: "🙈", camera_flash: "📸", alembic: "⚗️", mag: "🔍️",
  label: "🏷️", seedling: "🌱", triangular_flag_on_post: "🚩", goal_net: "🥅", dizzy: "💫", wastebasket: "🗑️",
  passport_control: "🛂", adhesive_bandage: "🩹", monocle_face: "🧐", coffin: "⚰️", test_tube: "🧪",
  necktie: "👔", stethoscope: "🩺", bricks: "🧱", technologist: "🧑‍💻", money_with_wings: "💸", thread: "🧵",
  safety_vest: "🦺", airplane: "✈️", pencil: "📝", books: "📚", heavy_check_mark: "✔️", x: "❌", warning: "⚠️",
  star: "⭐", fix: "🐛", tools: "🛠️", hammer_and_wrench: "🛠️", gear: "⚙️", broom: "🧹", lock_with_ink_pen: "🔏",
};

/** One emoji: a pictograph with its variation selector, skin tone and ZWJ sequence, or a flag. */
const UNICODE = /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)/u;
const SHORTCODE = /^:([a-z0-9_+-]+):/;

/** The emoji at the start of `text` and the text after it, or null when it does not start with one. */
export function leadingEmoji(text: string): { emoji: string; rest: string } | null {
  const trimmed = text.trimStart();
  const unicode = UNICODE.exec(trimmed);
  if (unicode) return { emoji: unicode[0], rest: trimmed.slice(unicode[0].length).trimStart() };
  const code = SHORTCODE.exec(trimmed);
  const emoji = code ? SHORTCODES[code[1] ?? ""] : undefined;
  if (code && emoji) return { emoji, rest: trimmed.slice(code[0].length).trimStart() };
  return null;
}
