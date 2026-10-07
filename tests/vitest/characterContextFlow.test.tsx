import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../src/contexts/AppContext";
import {
  CharacterProvider,
  useCharactersState,
} from "../../src/contexts/CharacterContext";
import { KernelProvider } from "../../src/contexts/KernelContext";
import type { ICharacterService } from "../../src/application/serviceContracts";
import type { IKernel } from "../../src/kernel";
import type { CharacterCard } from "../../src/types";

function createCharacter(id: string, name: string): CharacterCard {
  return {
    id,
    name,
    avatar: "",
    description: "",
    personality: "",
    first_mes: "",
    lorebookEntries: [],
  } as unknown as CharacterCard;
}

function CharacterConsumer() {
  const {
    characters,
    activeCharacter,
    setActiveCharId,
    saveCharacter,
    deleteCharacter,
  } = useCharactersState();

  return (
    <div>
      <span data-testid="catalog">{characters.map((character) => character.name).join(",")}</span>
      <span data-testid="active">{activeCharacter?.name ?? "未选择"}</span>
      <span data-testid="active-description">{activeCharacter?.description ?? ""}</span>
      <button onClick={() => setActiveCharId("character-1")}>选择角色</button>
      <button onClick={() => void saveCharacter(createCharacter("character-2", "角色乙"))}>
        保存角色
      </button>
      <button onClick={() => void deleteCharacter("character-1")}>删除角色</button>
    </div>
  );
}

function createHarness() {
  const initialCharacter = createCharacter("character-1", "角色甲");
  const characterService = {
    name: "character",
    init: vi.fn(),
    getAllCharacters: vi.fn().mockResolvedValue([initialCharacter]),
    getCharacterCatalog: vi.fn().mockResolvedValue([initialCharacter]),
    getCharacterById: vi.fn().mockResolvedValue(initialCharacter),
    saveCharacter: vi.fn().mockResolvedValue(undefined),
    deleteCharacter: vi.fn().mockResolvedValue(undefined),
    bulkSaveCharacters: vi.fn().mockResolvedValue(undefined),
    getStoredDefaultCharactersInitializedFlag: vi.fn().mockResolvedValue(true),
    saveStoredDefaultCharactersInitializedFlag: vi.fn().mockResolvedValue(undefined),
  } satisfies ICharacterService<CharacterCard>;

  const kernel = {
    getService: vi.fn(() => characterService),
  } as unknown as IKernel;

  return { characterService, kernel };
}

describe("角色跨组件数据流契约", () => {
  it("服务目录经过用例层和 Context 投影到消费组件，并能更新选择状态", async () => {
    const { characterService, kernel } = createHarness();

    render(
      <KernelProvider kernel={kernel}>
        <AppProvider>
          <CharacterProvider>
            <CharacterConsumer />
          </CharacterProvider>
        </AppProvider>
      </KernelProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("catalog")).toHaveTextContent("角色甲");
    });
    expect(characterService.getCharacterCatalog).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active")).toHaveTextContent("未选择");

    fireEvent.click(screen.getByRole("button", { name: "选择角色" }));
    expect(screen.getByTestId("active")).toHaveTextContent("角色甲");
  });

  it("消费组件的保存与删除操作经过 Context 和用例层更新服务及视图", async () => {
    const { characterService, kernel } = createHarness();

    render(
      <KernelProvider kernel={kernel}>
        <AppProvider>
          <CharacterProvider>
            <CharacterConsumer />
          </CharacterProvider>
        </AppProvider>
      </KernelProvider>,
    );

    await screen.findByText("角色甲");
    fireEvent.click(screen.getByRole("button", { name: "保存角色" }));

    await waitFor(() => {
      expect(characterService.saveCharacter).toHaveBeenCalledWith(
        expect.objectContaining({ id: "character-2", name: "角色乙" }),
      );
      expect(screen.getByTestId("catalog")).toHaveTextContent("角色甲,角色乙");
    });

    fireEvent.click(screen.getByRole("button", { name: "删除角色" }));

    await waitFor(() => {
      expect(characterService.deleteCharacter).toHaveBeenCalledWith("character-1");
      expect(screen.getByTestId("catalog")).toHaveTextContent("角色乙");
    });
  });

  it("活跃角色仍是轻量目录投影时自动补载完整卡", async () => {
    // 目录投影只带展示字段：没有 regex_scripts / tavern_helper.scripts / 世界书。
    const catalogEntry = {
      id: "character-1",
      name: "角色甲",
      avatar: "",
      extensions: { __catalogOnly: true },
    } as unknown as CharacterCard;
    const fullCard = {
      ...createCharacter("character-1", "角色甲"),
      description: "完整卡描述",
      extensions: { regex_scripts: [{ id: "regex-1", scriptName: "插图" }] },
    } as unknown as CharacterCard;

    const characterService = {
      name: "character",
      init: vi.fn(),
      getAllCharacters: vi.fn().mockResolvedValue([fullCard]),
      getCharacterCatalog: vi.fn().mockResolvedValue([catalogEntry]),
      getCharacterById: vi.fn().mockResolvedValue(fullCard),
      saveCharacter: vi.fn().mockResolvedValue(undefined),
      deleteCharacter: vi.fn().mockResolvedValue(undefined),
      bulkSaveCharacters: vi.fn().mockResolvedValue(undefined),
      getStoredDefaultCharactersInitializedFlag: vi.fn().mockResolvedValue(true),
      saveStoredDefaultCharactersInitializedFlag: vi.fn().mockResolvedValue(undefined),
    } satisfies ICharacterService<CharacterCard>;
    const kernel = {
      getService: vi.fn(() => characterService),
    } as unknown as IKernel;

    render(
      <KernelProvider kernel={kernel}>
        <AppProvider>
          <CharacterProvider>
            <CharacterConsumer />
          </CharacterProvider>
        </AppProvider>
      </KernelProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("catalog")).toHaveTextContent("角色甲");
    });
    expect(screen.getByTestId("active-description")).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "选择角色" }));

    await waitFor(() => {
      expect(characterService.getCharacterById).toHaveBeenCalledWith("character-1");
      expect(screen.getByTestId("active-description")).toHaveTextContent("完整卡描述");
    });
  });
});
