import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveBlobViaBridgeOrDownload } from "../../src/utils/characterPngExporter";

describe("AndroidThemeBridge Frontend Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clean window object
    delete (window as any).AndroidThemeBridge;
  });

  // ------------------------------------------------------------------
  // 1. File Saving Exporter Integration (saveBlobViaBridgeOrDownload)
  // ------------------------------------------------------------------

  it("saveBlobViaBridgeOrDownload should call AndroidThemeBridge.saveFileBase64 when bridge is present and call onSuccess", async () => {
    const saveFileBase64Mock = vi.fn().mockReturnValue("Download/Mobile Tavern/test_char.png");
    (window as any).AndroidThemeBridge = {
      saveFileBase64: saveFileBase64Mock,
    };

    const blob = new Blob(["mock-image-data"], { type: "image/png" });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    // Use a promise to wait for FileReader async operation
    await new Promise<void>((resolve) => {
      saveBlobViaBridgeOrDownload(
        blob,
        "test_char.png",
        "image/png",
        (path) => {
          onSuccess(path);
          resolve();
        },
        (err) => {
          onError(err);
          resolve();
        }
      );
    });

    expect(saveFileBase64Mock).toHaveBeenCalledTimes(1);
    expect(saveFileBase64Mock).toHaveBeenCalledWith(
      "test_char.png",
      expect.any(String), // base64 payload
      "image/png"
    );
    expect(onSuccess).toHaveBeenCalledWith("Download/Mobile Tavern/test_char.png");
    expect(onError).not.toHaveBeenCalled();
  });

  it("saveBlobViaBridgeOrDownload should call onError when AndroidThemeBridge returns an error string", async () => {
    const saveFileBase64Mock = vi.fn().mockReturnValue("error:Permission denied or write failed");
    (window as any).AndroidThemeBridge = {
      saveFileBase64: saveFileBase64Mock,
    };

    const blob = new Blob(["mock-image-data"], { type: "image/png" });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await new Promise<void>((resolve) => {
      saveBlobViaBridgeOrDownload(
        blob,
        "test_char.png",
        "image/png",
        (path) => {
          onSuccess(path);
          resolve();
        },
        (err) => {
          onError(err);
          resolve();
        }
      );
    });

    expect(saveFileBase64Mock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("error:Permission denied or write failed");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("saveBlobViaBridgeOrDownload should fallback to browser download when bridge is absent", () => {
    // Mock browser download dependencies
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    const clickSpy = vi.fn();
    const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((el: any) => {
      el.click = clickSpy;
      return el;
    });
    const removeSpy = vi.spyOn(document.body, "removeChild").mockImplementation(() => ({} as any));

    const blob = new Blob(["mock-image-data"], { type: "image/png" });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    saveBlobViaBridgeOrDownload(blob, "test_char.png", "image/png", onSuccess, onError);

    expect(mockCreateObjectURL).toHaveBeenCalledWith(blob);
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(onSuccess).toHaveBeenCalledWith("");
    expect(onError).not.toHaveBeenCalled();

    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });

  // ------------------------------------------------------------------
  // 2. Safe Areas Custom Event Dispatch / Listener Test
  // ------------------------------------------------------------------

  it("should successfully trigger custom event and verify subscriber logic", () => {
    const eventSpy = vi.fn();
    window.addEventListener("androidSafeAreasChanged", eventSpy);

    const event = new CustomEvent("androidSafeAreasChanged", {
      detail: { top: 25, bottom: 50, left: 10, right: 10 },
    });
    window.dispatchEvent(event);

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy.mock.calls[0][0].detail).toEqual({
      top: 25,
      bottom: 50,
      left: 10,
      right: 10,
    });

    window.removeEventListener("androidSafeAreasChanged", eventSpy);
  });
});
