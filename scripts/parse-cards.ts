import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { unzlibSync, inflateSync } from "fflate";

// Polyfill minimal browser globals if needed, but parsePngMetadata doesn't use File/Blob.
// Let's copy parsePngMetadata and extractSillyTavernFields logic or just import them.
// To avoid ESM/TS resolution issues during command execution, let's write a self-contained node script.

// PNG offsets and values
const PNG_SIGNATURE_HEADER_1 = 0x89504e47;
const PNG_SIGNATURE_HEADER_2 = 0x0d0a1a0a;
const PNG_IHDR_END_OFFSET = 33;

const crcTable: number[] = (() => {
  const table: number[] = [];
  let c: number;
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePngMetadata(arrayBuffer: ArrayBuffer): any {
  if (arrayBuffer.byteLength < PNG_IHDR_END_OFFSET) {
    throw new Error("Invalid PNG file: File is too small");
  }
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0) !== PNG_SIGNATURE_HEADER_1 || view.getUint32(4) !== PNG_SIGNATURE_HEADER_2) {
    throw new Error("Invalid PNG signature");
  }

  const uint8 = new Uint8Array(arrayBuffer);
  let offset = 8;
  const decoder = new TextDecoder("utf-8");

  while (offset < arrayBuffer.byteLength) {
    if (offset + 8 > arrayBuffer.byteLength) break;
    const length = view.getUint32(offset);
    if (offset + 12 + length > arrayBuffer.byteLength) {
      throw new Error("Corrupt PNG file");
    }
    const chunkType = String.fromCharCode(
      uint8[offset + 4],
      uint8[offset + 5],
      uint8[offset + 6],
      uint8[offset + 7],
    );

    if (chunkType === "IEND") break;

    if (chunkType === "tEXt" || chunkType === "iTXt" || chunkType === "zTXt") {
      const chunkData = uint8.slice(offset + 8, offset + 8 + length);
      let nullIdx = 0;
      while (nullIdx < chunkData.length && chunkData[nullIdx] !== 0) {
        nullIdx++;
      }

      const keyword = decoder.decode(chunkData.slice(0, nullIdx));
      if (keyword.toLowerCase() === "chara") {
        let textContent = "";
        if (chunkType === "tEXt") {
          textContent = decoder.decode(chunkData.slice(nullIdx + 1));
        } else if (chunkType === "zTXt") {
          const compressionMethod = chunkData[nullIdx + 1];
          const textBytes = chunkData.slice(nullIdx + 2);
          if (compressionMethod === 0) {
            try {
              const decompressed = unzlibSync(textBytes);
              textContent = decoder.decode(decompressed);
            } catch (zlibErr) {
              try {
                const decompressed = inflateSync(textBytes);
                textContent = decoder.decode(decompressed);
              } catch (infErr) {
                textContent = decoder.decode(textBytes);
              }
            }
          } else {
            textContent = decoder.decode(textBytes);
          }
        } else {
          const compressionFlag = chunkData[nullIdx + 1];
          let scan = nullIdx + 3;
          while (scan < chunkData.length && chunkData[scan] !== 0) scan++;
          scan++;
          while (scan < chunkData.length && chunkData[scan] !== 0) scan++;
          scan++;

          const textBytes = chunkData.slice(scan);
          if (compressionFlag === 1) {
            try {
              const decompressed = unzlibSync(textBytes);
              textContent = decoder.decode(decompressed);
            } catch (zlibErr) {
              try {
                const decompressed = inflateSync(textBytes);
                textContent = decoder.decode(decompressed);
              } catch (infErr) {
                textContent = decoder.decode(textBytes);
              }
            }
          } else {
            textContent = decoder.decode(textBytes);
          }
        }

        try {
          const trimmed = textContent.trim();
          let decoded = "";
          try {
            const binString = atob(trimmed);
            const bytes = new Uint8Array(binString.length);
            for (let i = 0; i < binString.length; i++) {
              bytes[i] = binString.charCodeAt(i);
            }
            decoded = new TextDecoder("utf-8").decode(bytes);
          } catch (b64Err) {
            decoded = trimmed;
          }
          return JSON.parse(decoded);
        } catch (e) {
          try {
            return JSON.parse(textContent.trim());
          } catch (jsonErr) {
            try {
              const uriDecoded = decodeURIComponent(
                escape(atob(textContent.trim())),
              );
              return JSON.parse(uriDecoded);
            } catch (err3) {
              return JSON.parse(textContent);
            }
          }
        }
      }
    }

    offset += 12 + length;
  }
  throw new Error("Could not find Character metadata inside this PNG.");
}

function mapSillyTavernLorebookEntry(entry: any): any {
  const entryKeys: string[] = Array.isArray(entry.keys)
    ? entry.keys
    : Array.isArray(entry.key)
      ? entry.key
      : (entry.key || entry.keys || "")
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean);

  let stPosition = entry.position !== undefined ? entry.position : entry.placement;
  let position = "after_char_def";
  if (stPosition !== undefined) {
    const numPos = Number(stPosition);
    if (!isNaN(numPos)) {
      switch (numPos) {
        case 0: position = "before_char_def"; break;
        case 1: position = "after_char_def"; break;
        case 2: position = "after_char_def"; break;
        case 3: position = "after_char_def"; break;
        case 4: position = "in_chat"; break;
        default: position = "after_char_def"; break;
      }
    } else if (typeof stPosition === "string") {
      const strPos = stPosition as string;
      if (strPos === "top" || strPos === "after_char_def" || strPos === "before_char_def" || strPos === "before_last_mes" || strPos === "in_chat") {
        position = strPos;
      } else if (strPos === "after_char") {
        position = "after_char_def";
      } else if (strPos === "before_char") {
        position = "before_char_def";
      } else {
        position = "after_char_def";
      }
    }
  }

  let depth = entry.depth !== undefined ? Number(entry.depth) : 4;
  let order = entry.order !== undefined ? Number(entry.order) : 100;
  let probability = entry.probability !== undefined ? Number(entry.probability) : 100;
  let addMemo = !!entry.addMemo;

  const extensions = entry.extensions || {};
  if (extensions.position !== undefined) {
    const numExtPos = Number(extensions.position);
    if (!isNaN(numExtPos)) {
      switch (numExtPos) {
        case 0: position = "before_char_def"; break;
        case 1: position = "after_char_def"; break;
        case 2: position = "after_char_def"; break;
        case 3: position = "after_char_def"; break;
        case 4: position = "in_chat"; break;
        default: position = "after_char_def"; break;
      }
    }
  }
  if (extensions.depth !== undefined) depth = Number(extensions.depth);

  const secondaryKeys = Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [];
  let selectiveLogic = "NONE";
  const rawSelLogic = extensions.selectiveLogic !== undefined ? extensions.selectiveLogic : entry.selectiveLogic;
  if (rawSelLogic !== undefined) {
    if (typeof rawSelLogic === "number") {
      switch (rawSelLogic) {
        case 1: selectiveLogic = "AND_ANY"; break;
        case 2: selectiveLogic = "AND_ALL"; break;
        case 3: selectiveLogic = "NOT_ANY"; break;
        default: selectiveLogic = "NONE"; break;
      }
    } else if (typeof rawSelLogic === "string") {
      const strLogic = rawSelLogic as string;
      if (strLogic === "AND_ANY" || strLogic === "AND_ALL" || strLogic === "NOT_ANY" || strLogic === "NONE") {
        selectiveLogic = strLogic;
      }
    }
  }
  const caseSensitive = !!(extensions.case_sensitive ?? entry.case_sensitive ?? entry.caseSensitive);
  const useRegex = !!(entry.use_regex ?? entry.useRegex);
  const scanDepth = extensions.scan_depth !== undefined ? Number(extensions.scan_depth) : (entry.scan_depth !== undefined ? Number(entry.scan_depth) : undefined);

  return {
    id: entry.id || Math.random().toString(36).substring(2, 9),
    keys: entryKeys,
    secondary_keys: secondaryKeys,
    selectiveLogic,
    caseSensitive,
    useRegex,
    scanDepth,
    content: entry.content || entry.value || "",
    constant: !!(entry.constant || entry.constant_active),
    enabled: entry.enabled !== false,
    comment: entry.comment || "",
    position,
    depth,
    order,
    probability,
    addMemo,
  };
}

function extractSillyTavernFields(raw: any): any {
  const data = raw.data ? raw.data : raw;
  const rawLorbookEntries =
    data.character_book?.entries ||
    data.world_info?.entries ||
    data.lorebook?.entries ||
    [];

  const lorebookList = Array.isArray(rawLorbookEntries)
    ? rawLorbookEntries
    : typeof rawLorbookEntries === "object"
      ? Object.values(rawLorbookEntries)
      : [];

  const name = data.name || data.char_name || data.charName || "未命名角色";
  const description =
    data.description ||
    data.char_persona ||
    data.charPersona ||
    data.persona ||
    "";

  return {
    name,
    description,
    personality:
      data.personality || data.char_personality || data.charPersonality || "",
    scenario: data.scenario || data.world_scenario || data.worldScenario || "",
    first_mes:
      data.first_mes ||
      data.char_greeting ||
      data.charGreeting ||
      data.greeting ||
      "",
    mes_example:
      data.mes_example ||
      data.example_dialogue ||
      data.exampleDialogue ||
      data.example_dialogs ||
      "",
    system_prompt: data.system_prompt || data.systemPrompt || "",
    post_history_instructions:
      data.post_history_instructions || data.postHistoryInstructions || "",
    alternate_greetings: Array.isArray(data.alternate_greetings)
      ? data.alternate_greetings
      : [],
    creator: data.creator || data.creator_notes || "",
    creator_notes: data.creator_notes || data.creatorNotes || "",
    tags: Array.isArray(data.tags) ? data.tags.map((t: any) => String(t).trim()) : [],
    character_version: data.character_version || data.version || "1.0.0",
    extensions: data.extensions || {},
    visualSettings: (() => {
      const ext = data.extensions || {};
      const rawStyle = ext.style || ext.character_style || {};
      const parsedVisualSettings: Record<string, any> = {
        customCss: rawStyle.custom_css || rawStyle.customCss || ext.custom_css || ext.customCss || "",
        bubbleColor: rawStyle.bubble_color || rawStyle.bubbleColor || ext.bubble_color || ext.bubbleColor || "",
        bubbleTextColor: rawStyle.bubble_text_color || rawStyle.bubbleTextColor || ext.bubble_text_color || ext.bubbleTextColor || "",
        userBubbleColor: rawStyle.user_bubble_color || rawStyle.userBubbleColor || ext.user_bubble_color || ext.userBubbleColor || "",
        userBubbleTextColor: rawStyle.user_bubble_text_color || rawStyle.userBubbleTextColor || ext.user_bubble_text_color || ext.userBubbleTextColor || "",
        primaryColor: rawStyle.primary_color || rawStyle.primaryColor || ext.primary_color || ext.primaryColor || "",
        secondaryColor: rawStyle.secondary_color || rawStyle.secondaryColor || ext.secondary_color || ext.secondaryColor || "",
        backgroundColor: rawStyle.background_color || rawStyle.backgroundColor || ext.background_color || ext.backgroundColor || "",
        backgroundImageUrl: rawStyle.bg_image || rawStyle.bgImage || rawStyle.background_url || rawStyle.backgroundUrl || ext.bg_image || ext.bgImage || ext.background_url || ext.backgroundUrl || "",
        backgroundOpacity: rawStyle.bg_opacity !== undefined ? Number(rawStyle.bg_opacity) : (ext.bg_opacity !== undefined ? Number(ext.bg_opacity) : undefined),
        backgroundBlur: rawStyle.bg_blur !== undefined ? Number(rawStyle.bg_blur) : (ext.bg_blur !== undefined ? Number(ext.bg_blur) : undefined),
        expressions: rawStyle.expressions || ext.expressions || data.expressions || undefined,
        enableAsteriskFormatting: rawStyle.enable_asterisk_formatting !== undefined ? !!rawStyle.enable_asterisk_formatting : (rawStyle.enableAsteriskFormatting !== undefined ? !!rawStyle.enableAsteriskFormatting : (ext.enable_asterisk_formatting !== undefined ? !!ext.enable_asterisk_formatting : (ext.enableAsteriskFormatting !== undefined ? !!ext.enableAsteriskFormatting : undefined))),
      };

      const clean = Object.fromEntries(
        Object.entries(parsedVisualSettings).filter(([_, v]) => v !== undefined && v !== "")
      );
      return Object.keys(clean).length > 0 ? clean : undefined;
    })(),
    lorebookEntries: lorebookList
      .map(mapSillyTavernLorebookEntry)
      .filter((e: any) => e.content),
  };
}

const inputDir = path.join(process.cwd(), "builtin");
const filenames = ["Lina Schneider.png", "The Assassin.png", "YOUR CEO BOSS.png"];
const cards: any[] = [];

for (const name of filenames) {
  const fullPath = path.join(inputDir, name);
  if (!fs.existsSync(fullPath)) {
    console.error(`File does not exist: ${fullPath}`);
    process.exit(1);
  }
  const fileBuffer = fs.readFileSync(fullPath);
  const parsedData = parsePngMetadata(fileBuffer.buffer);
  const card = extractSillyTavernFields(parsedData);

  // Set ID and Avatar base64
  card.id = "char_ST_builtin_" + name.replace(/\.[^/.]+$/, "").replace(/\s+/g, "_").toLowerCase();
  card.avatar = `data:image/png;base64,${fileBuffer.toString("base64")}`;
  cards.push(card);
  console.log(`Parsed successfully: ${card.name}`);
}

const outputContent = `import { CharacterCard } from "../types";

export const BUILTIN_CHARACTERS: CharacterCard[] = ${JSON.stringify(cards, null, 2)};
`;

fs.writeFileSync("src/utils/builtInCharacters.ts", outputContent, "utf-8");
console.log("builtInCharacters.ts generated successfully under src/utils/!");
