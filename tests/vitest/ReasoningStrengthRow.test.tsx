import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelCapabilityRegistry } from "../../src/application/services/llmCompatibility";
import ReasoningStrengthRow from "../../src/tabs/settings/ReasoningStrengthRow";

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderRow = (props: {
  value: "auto" | "off" | "low" | "medium" | "high" | "max";
  modelId: string;
  baseUrl: string;
  onChange?: (value: string) => void;
}) => render(
  <ReasoningStrengthRow
    label="推理强度"
    description="测试描述"
    value={props.value}
    modelId={props.modelId}
    baseUrl={props.baseUrl}
    onChange={(next) => props.onChange?.(next)}
  />,
);

describe("ReasoningStrengthRow", () => {
  beforeEach(() => ModelCapabilityRegistry.resetRuntimeCacheForTesting());
  afterEach(() => cleanup());

  it("按模型能力渲染可选档位并回传选择", () => {
    const onChange = vi.fn();
    renderRow({
      value: "auto",
      modelId: "gpt-5.6",
      baseUrl: "https://api.openai.com/v1",
      onChange,
    });

    expect(screen.getByRole("radio", { name: "api.reasoning_strength.off" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "api.reasoning_strength.max" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "api.reasoning_strength.high" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("无法关闭思考的模型不提供关闭档位", () => {
    renderRow({ value: "auto", modelId: "o3", baseUrl: "https://api.openai.com/v1" });

    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.queryByRole("radio", { name: "api.reasoning_strength.off" })).toBeNull();
  });

  it("未识别的模型只提供自动并给出提示", () => {
    renderRow({ value: "auto", modelId: "custom-model", baseUrl: "https://proxy.example/v1" });

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByText("api.reasoning_strength_unavailable")).toBeTruthy();
  });

  it("当前档位不被模型支持时给出收敛提示", () => {
    renderRow({ value: "off", modelId: "o3", baseUrl: "https://api.openai.com/v1" });

    expect(screen.getByText("api.reasoning_strength_clamped")).toBeTruthy();
  });
});
