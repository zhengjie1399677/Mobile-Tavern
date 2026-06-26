// 隐藏脚本容器 + A11y Live Region
// 从原 ChatTab.tsx L1809-1847 + L1862-1865 抽离

import React from "react";

import { createScriptIframeSrcDoc } from "../../utils/tavernHelper";

interface HiddenScriptLayerProps {
  settings: any;
  activeCharacter: any;
  announcement: string;
}

const HiddenScriptLayer = ({
  settings,
  activeCharacter,
  announcement,
}: HiddenScriptLayerProps) => {
  return (
    <>
      {/* Hidden background script runtimes for TavernHelper compatibility */}
      {/* MVU compatibility: #tavern_helper container with data-script-id elements */}
      <div id="tavern_helper" style={{ display: "none" }} aria-hidden="true">
        {settings.enableScriptExecution &&
          activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
            if (script.enabled && script.content) {
              return (
                <div
                  key={script.id}
                  data-script-id={script.id}
                  data-script-name={script.name || "unnamed"}
                />
              );
            }
            return null;
          })}
      </div>
      {settings.enableScriptExecution &&
        activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
          if (script.enabled && script.content) {
            const srcDoc = createScriptIframeSrcDoc(script.content, script.id);
            return (
              <iframe
                key={script.id}
                id={`TH-script--${script.name || "unnamed"}--${script.id}`}
                name={script.name || "unnamed"}
                srcDoc={srcDoc}
                style={{ display: "none" }}
                // eslint-disable-next-line react/no-unknown-property
                sandbox="allow-scripts allow-same-origin"
                // Note: allow-same-origin + allow-scripts is intentionally used here.
                // The MVU bundle requires parent window access (TavernHelper, $, _ etc.)
                // and script execution. Scripts only run from user-imported character cards
                // with explicit enableScriptExecution setting enabled.
              />
            );
          }
          return null;
        })}
      {/* 4. A11y Screen Reader Live Region */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
};

export default HiddenScriptLayer;
