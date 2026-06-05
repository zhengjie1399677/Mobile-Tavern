import { CharacterCard } from "../types";
import { unzlibSync, inflateSync } from "fflate";

// CRC table for PNG chunk writing
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

/**
 * Parses SillyTavern PNG or JSON card format.
 */
export async function parseCharacterFile(
  file: File,
): Promise<Partial<CharacterCard>> {
  if (file.type === "application/json" || file.name.endsWith(".json")) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return extractSillyTavernFields(parsed);
  } else if (file.type === "image/png" || file.name.endsWith(".png")) {
    const buffer = await file.arrayBuffer();
    const parsed = parsePngMetadata(buffer);
    const cardData = extractSillyTavernFields(parsed);

    // Convert current file to base64 to preserve avatar
    const base64Avatar = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    cardData.avatar = base64Avatar;
    return cardData;
  } else {
    throw new Error(
      "unsupported file format. Please upload .png or .json files.",
    );
  }
}

/**
 * Parses the "chara" tEXt metadata chunk of a PNG file.
 */
function parsePngMetadata(arrayBuffer: ArrayBuffer): any {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
    throw new Error("Invalid PNG signature");
  }

  const uint8 = new Uint8Array(arrayBuffer);
  let offset = 8;
  const decoder = new TextDecoder("utf-8");

  while (offset < arrayBuffer.byteLength) {
    if (offset + 8 > arrayBuffer.byteLength) break;
    const length = view.getUint32(offset);
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
                console.warn(
                  "fflate zTXt decompression fell back to text decoding:",
                  infErr,
                );
                textContent = decoder.decode(textBytes);
              }
            }
          } else {
            textContent = decoder.decode(textBytes);
          }
        } else {
          // iTXt has addition compression flags
          // Skip compression details, language tag, and translated keyword
          const compressionFlag = chunkData[nullIdx + 1];
          let scan = nullIdx + 3;
          while (scan < chunkData.length && chunkData[scan] !== 0) scan++;
          scan++; // skip language tag null byte
          while (scan < chunkData.length && chunkData[scan] !== 0) scan++;
          scan++; // skip translated keyword null byte

          const textBytes = chunkData.slice(scan);
          if (compressionFlag === 1) {
            // Compressed with zlib / deflate! Try unzlib first, fall back to raw inflate
            try {
              const decompressed = unzlibSync(textBytes);
              textContent = decoder.decode(decompressed);
            } catch (zlibErr) {
              try {
                const decompressed = inflateSync(textBytes);
                textContent = decoder.decode(decompressed);
              } catch (infErr) {
                console.warn(
                  "fflate decompression fell back to text decoding:",
                  infErr,
                );
                textContent = decoder.decode(textBytes);
              }
            }
          } else {
            textContent = decoder.decode(textBytes);
          }
        }

        // Try base64 decoding with robust UTF-8 decoder, fallback to raw JSON
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
            decoded = trimmed; // fallback to plain text if not a valid base64
          }
          return JSON.parse(decoded);
        } catch (e) {
          try {
            return JSON.parse(textContent.trim());
          } catch (jsonErr) {
            try {
              // Urllib and decode if special characters are present
              const uriDecoded = decodeURIComponent(
                escape(atob(textContent.trim())),
              );
              return JSON.parse(uriDecoded);
            } catch (err3) {
              // Some systems write pure JSON raw but we also try double decode
              return JSON.parse(textContent);
            }
          }
        }
      }
    }

    offset += 12 + length;
  }
  throw new Error(
    "Could not find Character metadata inside this PNG. Try JSON card format.",
  );
}

/**
 * Extracts and maps SillyTavern V1 / V2 / V3 fields to our unified design.
 */
function extractSillyTavernFields(raw: any): Partial<CharacterCard> {
  const data = raw.data ? raw.data : raw;

  // Extract from various possible world_info / lorebook containers in SillyTavern
  const rawLorbookEntries =
    data.character_book?.entries ||
    data.world_info?.entries ||
    data.lorebook?.entries ||
    [];

  // Support both array or key-value structures
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
      .map((entry: any) => {
        const entryKeys: string[] = Array.isArray(entry.keys)
          ? entry.keys
          : Array.isArray(entry.key)
            ? entry.key
            : (entry.key || entry.keys || "")
                .split(",")
                .map((k: string) => k.trim())
                .filter(Boolean);

        let stPosition = entry.position !== undefined ? entry.position : entry.placement;
        let position: "top" | "after_char_def" | "before_char_def" | "before_last_mes" | "in_chat" = "after_char_def";
        if (stPosition !== undefined) {
          const numPos = Number(stPosition);
          if (!isNaN(numPos)) {
            switch (numPos) {
              case 0: position = "before_char_def"; break; // ST top / before def
              case 1: position = "after_char_def"; break;  // ST after def
              case 2: position = "after_char_def"; break;  // ST before AN / after scenario
              case 3: position = "after_char_def"; break;  // ST before chat
              case 4: position = "in_chat"; break;         // ST in-chat depth
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

        // Advanced Lorebook Extraction
        const secondaryKeys = Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [];
        let selectiveLogic: "AND_ANY" | "AND_ALL" | "NOT_ANY" | "NONE" = "NONE";
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
          id: Math.random().toString(36).substring(2, 9),
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
      })
      .filter((e: any) => e.content),
  };
}

/**
 * Injects character metadata (as SillyTavern JSON payload) into a PNG array buffer.
 */
export function injectPngMetadata(
  pngBuffer: ArrayBuffer,
  char: CharacterCard,
): Blob {
  const view = new DataView(pngBuffer);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
    throw new Error("Invalid PNG source file");
  }

  const uint8 = new Uint8Array(pngBuffer);
  // Find where IHDR ends
  // IHDR is at offset 8.
  // Chunk structure: Length (4 bytes), Type 'IHDR' (4 bytes), Data (13 bytes), CRC (4 bytes)
  // Ends at 8 + 4 + 4 + 13 + 4 = 33
  const insertOffset = 33;

  // Prepare json block
  const payload = {
    schema: "SillyTavernCard",
    version: 2,
    data: {
      name: char.name,
      description: char.description,
      personality: char.personality,
      scenario: char.scenario,
      first_mes: char.first_mes,
      mes_example: char.mes_example,
      system_prompt: char.system_prompt || "",
      creator: char.creator || "",
      creator_notes: char.creator_notes || "",
      tags: char.tags || [],
      character_version: char.character_version || "1.0.0",
      extensions: {
        ...(char.extensions || {}),
        style: {
          ...(char.extensions?.style || char.extensions?.character_style || {}),
          ...(char.visualSettings ? {
            custom_css: char.visualSettings.customCss,
            bubble_color: char.visualSettings.bubbleColor,
            bubble_text_color: char.visualSettings.bubbleTextColor,
            user_bubble_color: char.visualSettings.userBubbleColor,
            user_bubble_text_color: char.visualSettings.userBubbleTextColor,
            primary_color: char.visualSettings.primaryColor,
            secondary_color: char.visualSettings.secondaryColor,
            background_color: char.visualSettings.backgroundColor,
            bg_image: char.visualSettings.backgroundImageUrl,
            bg_opacity: char.visualSettings.backgroundOpacity,
            bg_blur: char.visualSettings.backgroundBlur,
          } : {})
        }
      },
      character_book: {
        entries:
          char.lorebookEntries?.map((e) => {
            let selectiveLogicVal = 0;
            if (e.selectiveLogic === "AND_ANY") selectiveLogicVal = 1;
            else if (e.selectiveLogic === "AND_ALL") selectiveLogicVal = 2;
            else if (e.selectiveLogic === "NOT_ANY") selectiveLogicVal = 3;

            let stPosStr = "after_char";
            let stPosNum = 1;
            if (e.position === "before_char_def") {
              stPosStr = "before_char";
              stPosNum = 0;
            } else if (e.position === "in_chat") {
              stPosStr = "in_chat";
              stPosNum = 4;
            } else if (e.position === "top") {
              stPosStr = "top";
              stPosNum = 0;
            }

            return {
              keys: e.keys,
              secondary_keys: e.secondary_keys || [],
              content: e.content,
              constant: e.constant,
              enabled: e.enabled,
              comment: e.comment || "",
              position: stPosStr,
              use_regex: !!e.useRegex,
              extensions: {
                position: stPosNum,
                probability: e.probability !== undefined ? e.probability : 100,
                depth: e.depth !== undefined ? e.depth : 4,
                selectiveLogic: selectiveLogicVal,
                scan_depth: e.scanDepth,
                case_sensitive: !!e.caseSensitive,
              }
            };
          }) || [],
      },
    },
  };

  const jsonStr = JSON.stringify(payload);
  const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));

  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode("chara");
  const valueBytes = encoder.encode(base64Str);

  // Content is keyword + null byte + value
  const chunkData = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData.set([0], keywordBytes.length);
  chunkData.set(valueBytes, keywordBytes.length + 1);

  const typeBytes = encoder.encode("tEXt");
  const metaChunk = new Uint8Array(4 + 4 + chunkData.length + 4);
  const metaView = new DataView(metaChunk.buffer);

  // Set length (Big Endian)
  metaView.setUint32(0, chunkData.length);
  // Set type
  metaChunk.set(typeBytes, 4);
  // Set data
  metaChunk.set(chunkData, 8);

  // Compute and set CRC over type and data
  const crcInput = new Uint8Array(4 + chunkData.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, 4);
  const crcVal = crc32(crcInput);
  metaView.setUint32(8 + chunkData.length, crcVal);

  // Merge buffers together
  const output = new Uint8Array(pngBuffer.byteLength + metaChunk.length);
  output.set(uint8.slice(0, insertOffset), 0);
  output.set(metaChunk, insertOffset);
  output.set(uint8.slice(insertOffset), insertOffset + metaChunk.length);

  return new Blob([output], { type: "image/png" });
}

/**
 * Native, lightweight client-side password encryption/decryption using XOR and SHA-256 password digests.
 * Solves the .backup.zip requirement natively and reliably without heavy browser JSZip/AES bundling dependencies.
 */
const byteToHex: string[] = [];
for (let i = 0; i < 256; i++) {
  byteToHex.push(i.toString(16).padStart(2, "0"));
}

const hexToVal: Record<string, number> = {};
for (let i = 0; i < 256; i++) {
  const hex = i.toString(16).padStart(2, "0");
  hexToVal[hex] = i;
  hexToVal[hex.toUpperCase()] = i;
}

export function bufToHex(buf: Uint8Array): string {
  const hexParts = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    hexParts[i] = byteToHex[buf[i]];
  }
  return hexParts.join("");
}

export function hexToBuf(hexStr: string): Uint8Array {
  const len = hexStr.length;
  if (len % 2 !== 0) throw new Error("Invalid hex string");
  const buf = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    const byteHex = hexStr.substring(i, i + 2);
    const val = hexToVal[byteHex];
    if (val === undefined) throw new Error("Invalid hex character");
    buf[i / 2] = val;
  }
  return buf;
}

export async function encryptBackupData(
  dataStr: string,
  pass: string,
): Promise<string> {
  const encoder = new TextEncoder();

  // Create password digest for key (simple hash-based sizing)
  const passBuf = encoder.encode(pass);
  const hashBuffer = await crypto.subtle.digest("SHA-256", passBuf);

  // Import the hash as an AES-GCM key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dataBuf = encoder.encode(dataStr);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    dataBuf,
  );

  const encryptedBytes = new Uint8Array(encryptedBuffer);

  // Hex encode IV + Encrypted Data
  const ivHex = bufToHex(iv);
  const dataHex = bufToHex(encryptedBytes);

  return ivHex + dataHex;
}

export async function decryptBackupData(
  hexStr: string,
  pass: string,
): Promise<string> {
  // If it's old un-prefixed hex, fallback to XOR for backward compatibility?
  // Let's check size, but we can just use AES-GCM directly
  if (hexStr.length < 24) throw new Error("Invalid encrypted data format");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Extract IV (first 24 hex characters = 12 bytes)
  const ivHex = hexStr.slice(0, 24);
  const dataHex = hexStr.slice(24);

  const iv = hexToBuf(ivHex);
  const encryptedBytes = hexToBuf(dataHex);

  // Create password digest
  const passBuf = encoder.encode(pass);
  const hashBuffer = await crypto.subtle.digest("SHA-256", passBuf);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      encryptedBytes,
    );
    return decoder.decode(decryptedBuffer);
  } catch (e) {
    // Fallback to XOR if AES fails (backward compatibility for old backups)
    try {
      const keyArray = new Uint8Array(hashBuffer);
      const oldEncrypted = hexToBuf(hexStr);
      const decrypted = new Uint8Array(oldEncrypted.length);
      for (let i = 0; i < oldEncrypted.length; i++) {
        decrypted[i] = oldEncrypted[i] ^ keyArray[i % keyArray.length];
      }
      const result = decoder.decode(decrypted);
      if (
        result.includes("characters") ||
        result.includes("sessions") ||
        result.includes("{")
      ) {
        return result;
      }
      throw new Error();
    } catch (err) {
      throw new Error(
        "密码错误或数据已损坏 (Password incorrect or data corrupted)",
      );
    }
  }
}
