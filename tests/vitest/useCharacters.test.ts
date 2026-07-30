import { renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCharacters } from "../../src/hooks/useCharacters";

const mocks = vi.hoisted(() => ({
  editor: {
    charModalOpen: true,
    setCharModalOpen: vi.fn(),
    editingChar: { id: "character-1" },
    setEditingChar: vi.fn(),
    isDbWriting: false,
    activeLoreTab: "character",
    setActiveLoreTab: vi.fn(),
    editingLoreEntry: null,
    setEditingLoreEntry: vi.fn(),
    expandedLoreIds: new Set<string>(),
    setExpandedLoreIds: vi.fn(),
    editingActiveCharLoreEntry: null,
    setEditingActiveCharLoreEntry: vi.fn(),
    handleAddNewCharacter: vi.fn(),
    handleEditCharacter: vi.fn(),
    handleDeleteCharacter: vi.fn(),
    handleSaveCharacter: vi.fn(),
    handleSaveLoreEntry: vi.fn(),
    handleSaveActiveCharLoreEntry: vi.fn(),
  },
  importExport: {
    handleImportCardFile: vi.fn(),
    handleImportSillyLorebook: vi.fn(),
    handleExportCharacterJSON: vi.fn(),
    handleExportCharacterPNG: vi.fn(),
  },
}));

vi.mock("../../src/hooks/useCharacterEditor", () => ({
  useCharacterEditor: () => mocks.editor,
}));

vi.mock("../../src/hooks/useCharacterImportExport", () => ({
  useCharacterImportExport: () => mocks.importExport,
}));

describe("useCharacters 聚合契约", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("保持编辑、CRUD 与导入导出能力的统一公开接口", () => {
    const { result } = renderHook(() => useCharacters());

    expect(result.current.charModalOpen).toBe(true);
    expect(result.current.editingChar).toEqual({ id: "character-1" });
    expect(result.current.handleSaveCharacter).toBe(mocks.editor.handleSaveCharacter);
    expect(result.current.handleDeleteCharacter).toBe(mocks.editor.handleDeleteCharacter);
    expect(result.current.handleImportCardFile).toBe(mocks.importExport.handleImportCardFile);
    expect(result.current.handleExportCharacterPNG).toBe(
      mocks.importExport.handleExportCharacterPNG,
    );
  });

  it("调用方获得的函数仍直接委托给职责明确的子 Hook", () => {
    const { result } = renderHook(() => useCharacters());
    const lorebookFile = new File(["{}"], "lorebook.json", {
      type: "application/json",
    });
    const input = document.createElement("input");
    Object.defineProperty(input, "files", { value: [lorebookFile] });
    const importEvent = {
      target: input,
      currentTarget: input,
    } as unknown as ChangeEvent<HTMLInputElement>;

    result.current.handleAddNewCharacter();
    result.current.handleImportSillyLorebook(importEvent);
    result.current.setCharModalOpen(false);

    expect(mocks.editor.handleAddNewCharacter).toHaveBeenCalledOnce();
    expect(mocks.importExport.handleImportSillyLorebook).toHaveBeenCalledWith(
      importEvent,
    );
    expect(mocks.editor.setCharModalOpen).toHaveBeenCalledWith(false);
  });
});
