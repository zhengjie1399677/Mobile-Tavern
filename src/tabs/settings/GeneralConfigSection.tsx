import { Accordion } from "../../../components/ui/accordion";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import AsrConfigSection from "./AsrConfigSection";
import ApiConfigSection, { type SaveState } from "./sections/ApiConfigSection";
import ImageGenConfigSection from "./sections/ImageGenConfigSection";
import TtsConfigSection from "./sections/TtsConfigSection";

export interface GeneralConfigSectionProps
  extends Pick<UnifiedAppContextProps,
    | "settings"
    | "updateSettings"
    | "availableModels"
    | "isFetchingModels"
    | "handleFetchModels"
    | "testApiConnection"
    | "connectionStatus"
    | "showCustomPrompt"
    | "showCustomConfirm"
    | "getKernelService"
  > {
  saveState: SaveState;
  freeCount: number;
}

export default function GeneralConfigSection({
  settings,
  updateSettings,
  availableModels,
  isFetchingModels,
  handleFetchModels,
  testApiConnection,
  connectionStatus,
  showCustomPrompt,
  showCustomConfirm,
  getKernelService,
  saveState,
  freeCount,
}: GeneralConfigSectionProps) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <ApiConfigSection
        settings={settings}
        updateSettings={updateSettings}
        availableModels={availableModels}
        isFetchingModels={isFetchingModels}
        handleFetchModels={handleFetchModels}
        testApiConnection={testApiConnection}
        connectionStatus={connectionStatus}
        showCustomPrompt={showCustomPrompt}
        showCustomConfirm={showCustomConfirm}
        saveState={saveState}
        freeCount={freeCount}
      />
      <ImageGenConfigSection settings={settings} updateSettings={updateSettings} />
      <TtsConfigSection settings={settings} updateSettings={updateSettings} getKernelService={getKernelService} />
      <AsrConfigSection settings={settings} updateSettings={updateSettings} />
    </Accordion>
  );
}
