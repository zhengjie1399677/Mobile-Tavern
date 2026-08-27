import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplashScreen } from "../../src/components/SplashScreen";

describe("SplashScreen", () => {
  it("使用固定品牌底色与透明启动 Logo，不跟随用户主题", () => {
    const { container } = render(<SplashScreen isVisible />);

    const splash = container.querySelector('[data-ui="startup-splash"]');
    const logo = screen.getByRole("img", { name: "Mobile Tavern" });
    expect(splash).toHaveStyle({ backgroundColor: "#01091c" });
    expect(logo).toHaveAttribute("src", "/splash-logo.png");
    expect(logo).toHaveAttribute("fetchpriority", "high");
  });

  it("不可见时不渲染启动内容", () => {
    render(<SplashScreen isVisible={false} />);
    expect(screen.queryByRole("img", { name: "Mobile Tavern" })).not.toBeInTheDocument();
  });
});
