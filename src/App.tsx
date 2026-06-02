import React from "react";
import { LegacyAppContextProvider } from "./contexts/LegacyAppContextProvider";
import MainLayout from "./components/MainLayout";

export {
  DEFAULT_PRESETS,
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
} from "./contexts/LegacyAppContextProvider";

export default function App() {
  return (
    <LegacyAppContextProvider>
      <MainLayout />
    </LegacyAppContextProvider>
  );
}
