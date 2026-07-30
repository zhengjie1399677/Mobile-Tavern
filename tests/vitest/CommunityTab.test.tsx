import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CommunityTab from "../../src/tabs/CommunityTab";

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: () => ({
    settings: {
      userName: "Traveler",
      userPersonas: [],
    },
    characters: [{ id: "local-1", name: "Local Character" }],
    loadCharacterById: vi.fn(),
    saveCharacter: vi.fn(),
    showCustomAlert: vi.fn(),
  }),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    language: "en",
    t: (key: string, variables?: Record<string, string | number>) =>
      variables?.time ? `${key}:${variables.time}` : key,
  }),
}));

vi.mock("../../src/domain/community/api", () => ({
  listCommunityCards: vi.fn().mockResolvedValue([
    {
      id: "featured",
      title: "Featured Character",
      description: "A vivid character for a long-running story.",
      mimeType: "image/png",
      fileSize: 4096,
      uploaderName: "Creator",
      createdAt: 1_754_006_400,
      lastDownloadedAt: 1_754_092_800,
      downloadCount: 12,
      downloadUrl: "/cards/featured.png",
    },
    {
      id: "second",
      title: "Second Character",
      description: "Another character.",
      mimeType: "application/json",
      fileSize: 2048,
      uploaderName: "Writer",
      createdAt: 1_754_006_400,
      downloadCount: 3,
      downloadUrl: "/cards/second.json",
    },
  ]),
  uploadCommunityCard: vi.fn(),
  fetchCommunityCardFile: vi.fn(),
}));

describe("角色卡社区页面", () => {
  it("以精选封面和双列卡片展示上传、下载信息", async () => {
    const { container } = render(<CommunityTab />);

    expect(await screen.findByText("Featured Character")).toBeInTheDocument();
    expect(screen.getByText("Second Character")).toBeInTheDocument();
    expect(screen.getAllByText(/community\.uploaded_at:/)).toHaveLength(2);
    expect(screen.getByText(/community\.last_downloaded_at:/)).toBeInTheDocument();

    const cards = container.querySelectorAll("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveClass("col-span-2");
    expect(cards[1]).not.toHaveClass("col-span-2");
    expect(cards[0].querySelector("img")).toHaveAttribute(
      "src",
      "https://community.neural-node.xyz/cards/featured.png",
    );

    await waitFor(() => {
      expect(screen.getByText("community.featured")).toBeInTheDocument();
    });
  });
});
