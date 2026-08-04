/**
 * 旧导入路径的兼容导出；权威实现位于应用用例层。
 * 保留本文件可避免现有调用方一次性迁移。
 */
export {
  applyPresetCompositionToPromptConfig,
  applyPresetPromptConfig,
  toPresetPromptConfig,
} from "../../application/useCases/presetPromptConfig";
