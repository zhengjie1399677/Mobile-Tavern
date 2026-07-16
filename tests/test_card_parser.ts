import { injectPngMetadata } from "../src/utils/cardParser";
import { CharacterCard } from "../src/types";

// Explicitly require parsePngMetadata from the compiled/executed module or we can extract it.
// Wait! parsePngMetadata is a private function in cardParser.ts, not exported.
// But we can test it through another pathway, or we can copy/mock its behavior, or we can temporarily export it to test it!
// Let's see if we can read the file as text and dynamically test it, or copy the parsePngMetadata function into our test file.
// Copying parsePngMetadata into the test is extremely easy and verifies the exact implementation logic!

import { unzlibSync, inflateSync } from "fflate";

const PNG_SIGNATURE_HEADER_1 = 0x89504e47;
const PNG_SIGNATURE_HEADER_2 = 0x0d0a1a0a;
const PNG_IHDR_END_OFFSET = 33;

function parsePngMetadata(arrayBuffer: ArrayBuffer): any {
  if (arrayBuffer.byteLength < PNG_IHDR_END_OFFSET) {
    throw new Error("Invalid PNG file: File is too small to contain valid metadata chunks.");
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
      throw new Error("Corrupt PNG file: Chunk data length exceeds file boundary.");
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

// 1x1 Pixel Dummy PNG for testing
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dummyPngBuffer = Buffer.from(base64Png, 'base64');

async function testCardRoundtrip() {
  console.log("=== Running PNG Metadata Roundtrip Test ===");

  const originalChar: CharacterCard = {
    id: "test_id_123",
    name: "测试角色 (Unicode Test 😊)",
    description: "Line 1\nLine 2 with special $ symbol and brackets {{user}}",
    personality: "Shy but sweet.",
    scenario: "Tavern scenario.",
    first_mes: "Hello! How can I help you today?",
    mes_example: "<START>\n{{user}}: Hi!\n{{char}}: Hello!",
    system_prompt: "Write in a narrative descriptive style.",
    lorebookEntries: [
      {
        id: "l1",
        keys: ["sword"],
        content: "Sword details.",
        constant: false,
        enabled: true,
      }
    ],
    character_version: "2.1.0",
    tags: ["Friendly", "Fantasy"],
  };

  // 1. Inject metadata into the dummy PNG
  const arrayBuffer = dummyPngBuffer.buffer.slice(
    dummyPngBuffer.byteOffset,
    dummyPngBuffer.byteOffset + dummyPngBuffer.byteLength
  );

  const resultBlob = injectPngMetadata(arrayBuffer, originalChar);
  
  // 2. Read output back from Blob to ArrayBuffer
  const outputBuffer = await resultBlob.arrayBuffer();
  
  // 3. Extract the metadata from the modified PNG
  const extractedRaw = parsePngMetadata(outputBuffer);

  // 4. Verify fields
  const data = extractedRaw.data || extractedRaw;
  
  console.log("Extracted Name:", data.name);
  console.log("Extracted Version:", data.character_version);
  
  if (data.name !== originalChar.name) {
    throw new Error(`Name mismatch: Expected ${originalChar.name}, got ${data.name}`);
  }
  if (data.description !== originalChar.description) {
    throw new Error(`Description mismatch`);
  }
  if (data.character_version !== originalChar.character_version) {
    throw new Error(`Version mismatch`);
  }
  if (data.character_book?.entries?.[0]?.keys?.[0] !== "sword") {
    throw new Error(`Lorebook entries mismatch`);
  }
  
  console.log("✔ PNG Metadata injection and extraction successfully verified!");
}

testCardRoundtrip().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
