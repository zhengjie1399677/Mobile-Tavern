/**
 * 测试套件共享工具
 *
 * 提供断言函数、PNG 元数据解析工具以及 PNG 校验常量，
 * 供各测试套件文件按需引用，避免重复定义。
 */

// PNG 校验常量
export const PNG_SIGNATURE_HEADER_1 = 0x89504e47;
export const PNG_SIGNATURE_HEADER_2 = 0x0d0a1a0a;
export const PNG_IHDR_END_OFFSET = 33;

/**
 * 简易断言函数：条件为 false 时抛出携带 message 的 Error。
 */
export function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * 本地实现的 PNG tEXt 块解析，用于测试中校验注入的 chara 元数据。
 */
export function parsePngMetadataLocal(arrayBuffer: ArrayBuffer): any {
  if (arrayBuffer.byteLength < PNG_IHDR_END_OFFSET) {
    throw new Error("Invalid PNG: size too small");
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
      throw new Error("Corrupt PNG chunk");
    }
    const chunkType = String.fromCharCode(
      uint8[offset + 4],
      uint8[offset + 5],
      uint8[offset + 6],
      uint8[offset + 7],
    );

    if (chunkType === "IEND") break;

    if (chunkType === "tEXt") {
      const chunkData = uint8.slice(offset + 8, offset + 8 + length);
      let nullIdx = 0;
      while (nullIdx < chunkData.length && chunkData[nullIdx] !== 0) {
        nullIdx++;
      }

      const keyword = decoder.decode(chunkData.slice(0, nullIdx));
      if (keyword.toLowerCase() === "chara") {
        const textContent = decoder.decode(chunkData.slice(nullIdx + 1));
        const trimmed = textContent.trim();
        let decoded = "";
        try {
          const binString = atob(trimmed);
          const bytes = new Uint8Array(binString.length);
          for (let i = 0; i < binString.length; i++) {
            bytes[i] = binString.charCodeAt(i);
          }
          decoded = new TextDecoder("utf-8").decode(bytes);
        } catch {
          decoded = trimmed;
        }
        return JSON.parse(decoded);
      }
    }
    offset += 12 + length;
  }
  throw new Error("Chara chunk not found");
}
