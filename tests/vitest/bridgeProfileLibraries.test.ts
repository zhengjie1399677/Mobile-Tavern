import { describe, expect, it } from "vitest";
import { shouldLoadUiLibraries } from "../../src/utils/tavernHelper/bridgeCore";
import type { CharacterCard } from "../../src/types";

function character(overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id: "char-1",
    name: "测试角色",
    avatar: "",
    description: "",
    personality: "",
    first_mes: "",
    lorebookEntries: [],
    ...overrides,
  } as unknown as CharacterCard;
}

describe("受信模式的 UI 库加载判定", () => {
  it("只有正则脚本的卡片（状态栏/插图）也必须加载重型 UI 库", () => {
    // 线上回归：人妻 这类卡片没有 tavern_helper 脚本、开场白也没有代码块，
    // 之前不会加载 Vue/Pinia/jQuery，受信模式下消息 iframe 永久停在
    // 「正在载入脚本依赖…」，卡片状态栏与插图完全不出现。
    const card = character({
      extensions: {
        regex_scripts: [
          { id: "card-illustration", scriptName: "插图", findRegex: "/<SceneInfo>([\\s\\S]*?)<\\/SceneInfo>/gm" },
        ],
      },
    } as unknown as Partial<CharacterCard>);

    expect(shouldLoadUiLibraries(card, null)).toBe(true);
  });

  it("全局 / 预设正则脚本同样会触发加载（正则不是卡片私有的）", () => {
    expect(shouldLoadUiLibraries(character(), { globalRegexScripts: [{ disabled: false }] })).toBe(true);
    expect(shouldLoadUiLibraries(character(), { presetRegexScripts: [{ disabled: false }] })).toBe(true);
  });

  it("全部禁用的正则、纯文本卡不触发额外加载", () => {
    const card = character({
      extensions: { regex_scripts: [{ disabled: true }, { disabled: true }] },
    } as unknown as Partial<CharacterCard>);

    expect(shouldLoadUiLibraries(card, null)).toBe(false);
    expect(shouldLoadUiLibraries(character(), { globalRegexScripts: [{ disabled: true }] })).toBe(false);
  });

  it("卡片脚本、开场白 iframe / HTML 代码块仍然触发加载", () => {
    expect(shouldLoadUiLibraries(character({
      extensions: { tavern_helper: { scripts: [{ content: "// mvu_bundle" }] } },
    } as unknown as Partial<CharacterCard>), null)).toBe(true);

    expect(shouldLoadUiLibraries(character({ first_mes: "<iframe srcdoc='x'></iframe>" }), null)).toBe(true);

    expect(shouldLoadUiLibraries(character({ first_mes: "```html\n<b>x</b>\n```" }), null)).toBe(true);
  });
});
