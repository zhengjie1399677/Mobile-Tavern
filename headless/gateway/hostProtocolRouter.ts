import { Router, type Request, type Response } from "express";
import type { IKernel } from "../../src/application/serviceContracts";
import { KernelServices } from "../../src/application/serviceContracts";
import type {
  ICharacterService,
  IDatabaseService,
  IAgentRuntimeService,
  ISettingsService,
} from "../../src/application/serviceContracts";
import type { CharacterCard, ChatSession, Message, UserSettings } from "../../src/types";
import {
  exportBackupJson,
  importBackupJson,
  savePersistedSnapshot,
} from "../storageDriver";
import { getActiveRuntimeProfileSnapshot } from "../../src/application/runtime";
import { Logger } from "../../src/utils/logger";
import type { HeadlessConfig } from "../config";

const logger = Logger.create("HostProtocolRouter");

export function createHostProtocolRouter(kernel: IKernel, config: HeadlessConfig): Router {
  const router = Router();

  // GET /api/host/status: 获取无头宿主健康状态与运行时诊断
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const databaseService = kernel.getService<IDatabaseService<ChatSession>>(KernelServices.Database);
      const characterService = kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
      const agentRuntime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);

      const [characters, sessionsCount] = await Promise.all([
        characterService.getAllCharacters(),
        databaseService.getSessionsCount(),
      ]);

      const activeProfile = getActiveRuntimeProfileSnapshot();
      const diagnostics = agentRuntime.getDiagnostics();

      res.json({
        status: "ok",
        mode: "headless",
        activeProfile: activeProfile?.profileId ?? "none",
        profileVersion: activeProfile?.profileVersion ?? 0,
        charactersCount: characters.length,
        sessionsCount,
        registeredTools: diagnostics.tools.map((t) => ({
          name: t.name,
          version: t.version,
          riskLevel: t.riskLevel,
        })),
        registeredDrivers: diagnostics.drivers,
        registeredProviders: diagnostics.providers,
      });
    } catch (err) {
      logger.error("Failed to get host status", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/host/characters: 获取所有角色列表
  router.get("/characters", async (req: Request, res: Response) => {
    try {
      const characterService = kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
      const characters = await characterService.getAllCharacters();
      res.json({
        characters: characters.map((c) => ({
          id: c.id,
          name: c.name || "Unnamed",
          description: c.description || "",
          personality: c.personality || "",
          creator: c.creator || "",
          character_version: c.character_version || "",
          hasAvatar: Boolean(c.avatar),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/host/characters: 导入或保存新角色卡
  router.post("/characters", async (req: Request, res: Response) => {
    try {
      const characterService = kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
      const character = req.body as CharacterCard;
      if (!character || !character.id) {
        res.status(400).json({ error: "Missing character payload or id" });
        return;
      }
      await characterService.saveCharacter(character);
      res.json({ success: true, characterId: character.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/host/sessions: 获取会话列表
  router.get("/sessions", async (req: Request, res: Response) => {
    try {
      const databaseService = kernel.getService<IDatabaseService<ChatSession>>(KernelServices.Database);
      const pageSize = Number(req.query.pageSize) || 30;
      const page = await databaseService.getSessionsPage({ pageSize });
      res.json({
        sessions: page.sessions,
        hasMore: page.hasMore,
        cursor: page.cursor,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/host/sessions: 创建新会话
  router.post("/sessions", async (req: Request, res: Response) => {
    try {
      const databaseService = kernel.getService<IDatabaseService<ChatSession, CharacterCard, unknown, Message, Partial<ChatSession>>>(
        KernelServices.Database,
      );
      const characterService = kernel.getService<ICharacterService<CharacterCard>>(
        KernelServices.Character,
      );
      const { characterId, title } = req.body || {};
      if (!characterId) {
        res.status(400).json({ error: "characterId is required" });
        return;
      }
      const character = await characterService.getCharacterById(characterId);
      if (!character) {
        res.status(404).json({ error: `Character ${characterId} not found` });
        return;
      }
      const newSession = await databaseService.createNewSession(character, undefined);
      if (title && title.trim()) {
        await databaseService.updateSessionMetadata(newSession.id, { title: title.trim() });
        newSession.title = title.trim();
      }
      res.json({ success: true, session: newSession });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/host/backup/export: 导出标准统一备份 v6
  router.post("/backup/export", async (req: Request, res: Response) => {
    try {
      const jsonStr = await exportBackupJson(kernel);
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="mobile-tavern-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      res.send(jsonStr);
    } catch (err) {
      logger.error("Failed to export backup", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/host/backup/import: 导入标准统一备份
  // mode=merge 时与宿主现有数据求并集（跨设备日常同步推荐）；缺省 replace 为整体覆盖。
  // preserveSettings=true 时保留宿主自己的设置（覆盖模式下跨设备同步必须带）：快照是脱敏的，
  // 否则一次推送就会把宿主的 API Key 清空。合并模式无条件保留宿主设置，不依赖该开关。
  router.post("/backup/import", async (req: Request, res: Response) => {
    try {
      const payloadString = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const preserveFlag = String(req.query.preserveSettings ?? "").toLowerCase();
      const preserveLocalSettings =
        preserveFlag === "1" || preserveFlag === "true" || preserveFlag === "yes";
      const mode = String(req.query.mode ?? "").toLowerCase() === "merge" ? "merge" : "replace";
      const result = await importBackupJson(kernel, payloadString, { preserveLocalSettings, mode });
      await savePersistedSnapshot(kernel, config.absoluteDataDir);
      res.json({
        success: true,
        mode: result.mode,
        preservedLocalSettings: result.mode === "merge" ? true : preserveLocalSettings,
        ...(result.mergeStats ? { mergeStats: result.mergeStats } : {}),
        message: result.mode === "merge"
          ? "Backup merged into host data and snapshot updated"
          : "Backup successfully imported and snapshot updated",
      });
    } catch (err) {
      logger.error("Failed to import backup", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/host/snapshot/save: 手动触发持久化保存
  router.post("/snapshot/save", async (req: Request, res: Response) => {
    try {
      const savedPath = await savePersistedSnapshot(kernel, config.absoluteDataDir);
      res.json({ success: true, savedPath });
    } catch (err) {
      logger.error("Failed to save snapshot", err);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
