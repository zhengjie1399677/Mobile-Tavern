import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatScroll } from "../../src/tabs/chat/useChatScroll";

/**
 * 可变 ref 类型，绕过 React.RefObject 的 readonly 限制以注入 mock 容器。
 */
type MutableRefObject<T> = { current: T };

describe("useChatScroll hook tests", () => {
  it("should initialize correctly", () => {
    const { result } = renderHook(() =>
      useChatScroll({ activeSessionId: "session-1", chatSubTab: "dialogue" })
    );

    expect(result.current.scrollContainerRef.current).toBeNull();
    expect(result.current.showScrollButton).toBe(false);
    expect(typeof result.current.handleScroll).toBe("function");
    expect(typeof result.current.scrollToBottom).toBe("function");
  });

  it("should update showScrollButton when handleScroll is called with high offset", () => {
    const { result } = renderHook(() =>
      useChatScroll({ activeSessionId: "session-1", chatSubTab: "dialogue" })
    );

    // Mock the DOM elements
    const mockContainer = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTo: vi.fn(),
    };
    (result.current.scrollContainerRef as unknown as MutableRefObject<HTMLDivElement | null>).current = mockContainer as unknown as HTMLDivElement;

    // Trigger handleScroll
    act(() => {
      result.current.handleScroll();
    });

    // distanceToBottom = 1000 - 100 - 500 = 400 > 300
    expect(result.current.showScrollButton).toBe(true);
    expect(result.current.isAtBottomRef.current).toBe(false);
  });

  it("should hide scroll button when scrolled close to bottom", () => {
    const { result } = renderHook(() =>
      useChatScroll({ activeSessionId: "session-1", chatSubTab: "dialogue" })
    );

    const mockContainer = {
      scrollTop: 450,
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTo: vi.fn(),
    };
    (result.current.scrollContainerRef as unknown as MutableRefObject<HTMLDivElement | null>).current = mockContainer as unknown as HTMLDivElement;

    act(() => {
      result.current.handleScroll();
    });

    // distanceToBottom = 1000 - 450 - 500 = 50 < 60
    expect(result.current.showScrollButton).toBe(false);
    expect(result.current.isAtBottomRef.current).toBe(true);
  });

  it("should trigger smooth scrollTo and reset states when scrollToBottom is called", () => {
    const { result } = renderHook(() =>
      useChatScroll({ activeSessionId: "session-1", chatSubTab: "dialogue" })
    );

    const scrollToMock = vi.fn();
    const mockContainer = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTo: scrollToMock,
    };
    (result.current.scrollContainerRef as unknown as MutableRefObject<HTMLDivElement | null>).current = mockContainer as unknown as HTMLDivElement;

    // Set scroll button to true first
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.showScrollButton).toBe(true);

    // Call scrollToBottom
    act(() => {
      result.current.scrollToBottom();
    });

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 1000,
      behavior: "smooth",
    });
    expect(result.current.showScrollButton).toBe(false);
    expect(result.current.isAtBottomRef.current).toBe(true);
  });
});
