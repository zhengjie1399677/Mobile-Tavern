/**
 * PNG 角色卡解析测试套件
 *
 * 覆盖 testPngCardParser：PNG 元数据注入与回读解析的 roundtrip 校验。
 */

import { injectPngMetadata } from "../../src/utils/cardParser";
import { CharacterCard } from "../../src/types";
import { assert, parsePngMetadataLocal } from "./testUtils";

export async function testPngCardParser() {
  console.log("\n--- Running PNG Card Parser & Writer Verification ---");

  const originalChar: CharacterCard = {
    id: "char_test_99",
    name: "Tavern Hero (中文 ✅)",
    description: "Tavern Character Description.",
    personality: "Cool.",
    scenario: "Fantasy setting.",
    first_mes: "Welcome!",
    mes_example: "",
    system_prompt: "",
    lorebookEntries: [],
  };

  const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const dummyPngBuffer = Buffer.from(base64Png, 'base64');

  const arrayBuffer = dummyPngBuffer.buffer.slice(
    dummyPngBuffer.byteOffset,
    dummyPngBuffer.byteOffset + dummyPngBuffer.byteLength
  );

  const resultBlob = injectPngMetadata(arrayBuffer, originalChar);
  const outputBuffer = await resultBlob.arrayBuffer();

  const extracted = parsePngMetadataLocal(outputBuffer);
  const data = extracted.data || extracted;

  assert(data.name === originalChar.name, "PNG character name matches");
  assert(data.description === originalChar.description, "PNG character description matches");
  console.log("✔ PNG Metadata injection and roundtrip parsing verified!");
}
