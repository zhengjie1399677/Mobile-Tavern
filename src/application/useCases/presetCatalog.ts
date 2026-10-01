import type { PresetBundleV2 } from "../../domain/presets/contracts";

/**
 * 预设目录用例：把 `saved_presets_bundle` 的「读-改-写」编排从 Hook 下沉到 application 层。
 *
 * 改造前 `usePresetBundles` 在导入、另存为新预设、保存到当前预设、单个删除与批量删除五处
 * 各自重复「读 Store → 拼 nextSaved → 写 Store → 改 React 状态」：同一套列表代数出现五遍，
 * 并发动作还会互相覆盖（`ARCH-FLOW`：事务与跨 Service 编排进入 application/useCases）。
 *
 * 边界：
 * - 无 React、无 IndexedDB、无环境读取；物理存储经 `PresetCatalogPort` 注入，由调用方（Hook）
 *   把 `PresetService` 适配为端口，用例不直接依赖 `infrastructure/storage`。
 * - 内置预设保护保持调用方前置过滤：判定依赖 hooks 层的出厂默认值，application 不得反向依赖 hooks。
 *   调用方必须先把可删 id 过滤出来，删除变换本身只做机械删除（`CHANGE-SAFE`：不改变既有删除规则）。
 * - 纯变换不生成 id、不读时钟：导入的 id 由导入用例生成，快照 id 由调用方决定。
 * - `changed` 只描述本次变换是否真的改动了列表；`mutate` 与改造前一致，每个用户动作都写回一次 Store。
 */

/** 预设目录的存储端口；由 PresetService 适配，用例不直接依赖 IndexedDB。 */
export interface PresetCatalogPort {
  read(): Promise<PresetBundleV2[] | null>;
  write(presets: PresetBundleV2[]): Promise<void>;
}

export interface PresetCatalogMutation {
  presets: PresetBundleV2[];
  changed: boolean;
}

export interface PresetCatalog {
  mutate(
    transform: (current: PresetBundleV2[]) => PresetCatalogMutation,
  ): Promise<PresetCatalogMutation>;
}

/**
 * 串行化的读-改-写：同一时刻只允许一个变更在跑，避免并发丢更新。
 *
 * 前一个变更失败不得阻断后续变更，因此队列尾部始终接一个「已结算」的 Promise；
 * 失败仍然从 `mutate` 返回的 Promise 抛给调用方，保持改造前由 Hook 捕获并提示的行为。
 *
 * Store 无记录（`read()` 返回 `null`）时以空列表为基：这与改造前导入路径的 `|| []` 一致，
 * 而改造前的「保存」路径曾回退到设置页快照；统一到目录基准后不再回退，避免用陈旧闭包覆盖
 * 已保存列表（`ARCH-FLOW`：Store 是 `savedPresets` 的单一事实来源）。
 */
export function createPresetCatalog(port: PresetCatalogPort): PresetCatalog {
  let queue: Promise<void> = Promise.resolve();

  return {
    mutate(transform) {
      const run = queue.then(async (): Promise<PresetCatalogMutation> => {
        const current = (await port.read()) ?? [];
        const mutation = transform(current);
        await port.write(mutation.presets);
        return mutation;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

/**
 * 纯变换：注册/导入一个预设（同 id 覆盖语义按现有 Hook 的行为逐字复刻）。
 *
 * 改造前的导入路径是「以 Store 列表为基追加」，不做同 id 去重；`preparePresetBundleImport`
 * 每次都会生成新的 `preset`/`bundle` id，因此同 id 覆盖场景在导入路径不可达。
 */
export function registerPresetBundle(
  current: readonly PresetBundleV2[],
  incoming: PresetBundleV2,
): PresetCatalogMutation {
  return { presets: [...current, incoming], changed: true };
}

export interface SavePresetBundleAsNewOptions {
  /**
   * 命中该 bundle id 时原位覆盖，否则追加。
   *
   * 用于「保存修改到当前预设」：改造前只有非内置预设才按 id 覆盖，内置预设一律追加新副本，
   * 因此调用方必须在内置预设生效时省略该字段。
   */
  replaceBundleId?: string | undefined;
}

/**
 * 纯变换：另存为新预设。
 *
 * 不带 `replaceBundleId` 时逐字复刻改造前的「另存为新预设」：直接追加。
 * 带 `replaceBundleId` 时复刻「保存到当前预设」：Store 中缺失目标（刚导入/刚另存尚未同步）时追加，
 * 避免静默"保存成功"但什么都没写。
 */
export function savePresetBundleAsNew(
  current: readonly PresetBundleV2[],
  bundle: PresetBundleV2,
  options?: SavePresetBundleAsNewOptions,
): PresetCatalogMutation {
  const replaceBundleId = options?.replaceBundleId;
  const hasTarget = replaceBundleId !== undefined
    && current.some((candidate) => candidate.id === replaceBundleId);
  const presets = hasTarget
    ? current.map((candidate) => (candidate.id === replaceBundleId ? bundle : candidate))
    : [...current, bundle];
  return { presets, changed: true };
}

/** 纯变换：删除一个预设（内置预设不可删，规则按现有 Hook 复刻：调用方先过滤 id）。 */
export function deletePresetBundle(
  current: readonly PresetBundleV2[],
  id: string,
): PresetCatalogMutation {
  const presets = current.filter((bundle) => bundle.id !== id);
  return { presets, changed: presets.length !== current.length };
}

/**
 * 纯变换：批量删除。
 *
 * 内置预设保护同样由调用方前置过滤：改造前批量删除先剔除内置预设再删除，
 * 若全部为内置预设则直接提示且不写库。
 */
export function deletePresetBundles(
  current: readonly PresetBundleV2[],
  ids: readonly string[],
): PresetCatalogMutation {
  const removable = new Set(ids);
  if (removable.size === 0) return { presets: [...current], changed: false };
  const presets = current.filter((bundle) => !removable.has(bundle.id));
  return { presets, changed: presets.length !== current.length };
}
