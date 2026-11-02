// The site shows no emojis, so the ones in video titles are dropped. An
// emoji becomes a space (so neighbouring words don't glue together), the
// double punctuation emojis become plain punctuation, and the plain ©, ®
// and ™ signs are kept.
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;

export function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/⁉️?/g, "?!")
    .replace(/‼️?/g, "!!")
    .replace(EMOJI, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([!?.,:;])/g, "$1")
    .trim();
}
