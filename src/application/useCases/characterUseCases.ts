import type { ICharacterService } from "../serviceContracts";
import type { CharacterCard } from "../../types";

export function normalizeCharacterCard(character: CharacterCard): CharacterCard {
  return {
    ...character,
    lorebookEntries: (character.lorebookEntries || []).map((entry) => {
      const rawKeys: unknown = entry.keys;
      return {
        ...entry,
        keys: Array.isArray(rawKeys)
          ? rawKeys.filter((key): key is string => typeof key === "string")
          : typeof rawKeys === "string"
            ? rawKeys.split(",").map((key) => key.trim()).filter(Boolean)
            : [],
      };
    }),
  };
}

export function createCharacterUseCases(
  characterService: ICharacterService<CharacterCard>,
) {
  return {
    async loadCatalog(): Promise<CharacterCard[]> {
      let catalog = await characterService.getCharacterCatalog();
      const initialized =
        await characterService.getStoredDefaultCharactersInitializedFlag();

      if (!initialized) {
        const { loadBuiltinCharacters } = await import("../../utils/builtInCharacters");
        await characterService.bulkSaveCharacters(await loadBuiltinCharacters());
        await characterService.saveStoredDefaultCharactersInitializedFlag(true);
        catalog = await characterService.getCharacterCatalog();
      }

      return (catalog || []).map(normalizeCharacterCard);
    },

    async loadCharacter(
      id: string,
      cachedCharacters: readonly CharacterCard[],
    ): Promise<CharacterCard | null> {
      const cached = cachedCharacters.find((character) => character.id === id);
      if (cached && !cached.extensions?.__catalogOnly) return cached;
      const loaded = await characterService.getCharacterById(id);
      return loaded ? normalizeCharacterCard(loaded) : null;
    },

    async saveCharacter(character: CharacterCard): Promise<CharacterCard> {
      const normalized = normalizeCharacterCard(character);
      await characterService.saveCharacter(normalized);
      return normalized;
    },

    deleteCharacter(id: string): Promise<void> {
      return characterService.deleteCharacter(id);
    },
  };
}

export type CharacterUseCases = ReturnType<typeof createCharacterUseCases>;
