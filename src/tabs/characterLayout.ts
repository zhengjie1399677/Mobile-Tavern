export const CHARACTER_LAYOUT_STORAGE_KEY = "mobile_tavern_character_layout";

export const CHARACTER_LAYOUTS = ["list", "shelf", "showcase"] as const;
export type CharacterLayout = (typeof CHARACTER_LAYOUTS)[number];

export function readCharacterLayout(storage: Pick<Storage, "getItem">): CharacterLayout {
  const stored = storage.getItem(CHARACTER_LAYOUT_STORAGE_KEY);
  return CHARACTER_LAYOUTS.includes(stored as CharacterLayout)
    ? (stored as CharacterLayout)
    : "list";
}

export function saveCharacterLayout(
  storage: Pick<Storage, "setItem">,
  layout: CharacterLayout,
): void {
  storage.setItem(CHARACTER_LAYOUT_STORAGE_KEY, layout);
}
