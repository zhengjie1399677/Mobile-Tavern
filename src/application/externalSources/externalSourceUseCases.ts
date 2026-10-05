/**
 * 外部能力源的用户级用例：只做校验、存储编排与运行时刷新触发，不触碰协议细节。
 */
import { externalCapabilitySourceSchema } from "../../domain/externalSources/contracts";
import {
  deleteExternalSource,
  getExternalSource,
  listExternalSources,
  setExternalSourceEnabled,
  upsertExternalSource,
} from "../../infrastructure/externalSources/externalSourceStorage";

export const externalSourceUseCases = {
  list: listExternalSources,
  get: getExternalSource,

  async save(input: unknown) {
    return upsertExternalSource(externalCapabilitySourceSchema.parse(input));
  },

  setEnabled: setExternalSourceEnabled,
  remove: deleteExternalSource,
};
