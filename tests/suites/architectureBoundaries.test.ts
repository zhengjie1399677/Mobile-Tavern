/**
 * 内核架构边界守卫。
 *
 * 防止后续业务开发重新绕过持久化端口、回流全局内核单例，
 * 或让基础服务反向依赖 React Hook。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assert } from "./testUtils";

const workspace = process.cwd();
const read = (relativePath: string): string =>
  readFileSync(path.join(workspace, relativePath), "utf8");

const listCodeFiles = (relativeDir: string): string[] => {
  const absoluteDir = path.join(workspace, relativeDir);
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return listCodeFiles(relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
};

export async function testArchitectureBoundaries(): Promise<void> {
  console.log("\n--- Running Architecture Boundary Guards ---");

  for (const file of listCodeFiles("src/kernel/services/memory")) {
    assert(
      !read(file).includes("utils/localDB"),
      `${file} 不得绕过记忆持久化端口直接依赖 localDB`
    );
    assert(
      !read(file).includes("infrastructure/"),
      `${file} 不得反向依赖具体基础设施适配器`
    );
  }

  for (const file of listCodeFiles("src/services")) {
    assert(
      !/from\s+["'][^"']*hooks\//.test(read(file)),
      `${file} 不得反向依赖 Hook 层`
    );
  }

  for (const file of listCodeFiles("src/domain/prompt-composition")) {
    assert(
      !/sillytavern/i.test(read(file)),
      `${file} 必须保持格式中立，SillyTavern 语义只能存在于 infrastructure/compat`
    );
  }

  assert(
    !read("src/hooks/useChat/pipelineHelpers.ts").includes("globalKernel"),
    "聊天输出管线必须使用调用方注入的 IKernel"
  );

  assert(
    !read("src/tabs/chat/ChatInputArea.tsx").includes("useContext(UnifiedAppContext)"),
    "聊天输入区不得订阅完整 UnifiedAppContext，必须通过选择器限制状态扩散"
  );

  for (const file of listCodeFiles("src")) {
    assert(
      !/=\s*useUnifiedApp\(\)/.test(read(file)),
      `${file} 不得无选择器订阅完整 UnifiedAppContext`
    );
  }

  for (const file of [
    "src/hooks/useChat/useSendMessage.ts",
    "src/hooks/useChat/useRerollMessage.ts",
  ]) {
    assert(
      !/lastRecalledMemories\s*:/.test(read(file)),
      `${file} 不得把瞬态召回结果附加到 ChatSession`
    );
  }

  for (const file of [
    "src/kernel/Kernel.ts",
    "src/kernel/types.ts",
    "src/utils/localDB.ts",
    "src/kernel/services/PromptService.ts",
  ]) {
    const lines = read(file).split(/\r?\n/).length;
    assert(lines <= 1000, `${file} 超过单文件 1000 行硬上限：${lines}`);
  }

  console.log("✔ 内核架构边界守卫通过");
}
