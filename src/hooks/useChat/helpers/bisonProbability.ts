/**
 * 野牛模式（Bison Mode）概率计算的纯函数工具。
 *
 * 从 useChat.tsx 抽离，遵循 AGENTS.md 核心行为准则一 §1（极致微服务与解耦）。
 * 仅包含无 React 依赖的纯函数，可被独立单兵测试。
 *
 * 行为语义与原 useChat.tsx 内部实现完全等价。
 */

/**
 * 对用户提供的表达式触发正则进行安全性校验，
 * 过滤掉可能在 ReDoS 攻击中引发灾难性回溯的模式。
 */
function isSafeRegexForBison(pattern: string): boolean {
  if (!pattern) return true;
  return !/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(pattern) && !/(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(pattern);
}

/**
 * 根据角色性格描述 + AI 上一轮回复情绪 + 用户自定义触发器，
 * 计算野牛模式连续输出的触发概率（范围 5% ~ 85%）。
 *
 * @param character   角色卡数据（需携带 personality、extensions 等字段）
 * @param lastAiContent  上一轮 AI 的回复文本
 * @param triggers   用户配置的表情触发器映射（emotion → regexPattern）
 * @returns 概率百分比，已 clamp 在 [5, 85] 区间内
 */
export function calculateBisonModeProbability(
  character: any,
  lastAiContent: string,
  triggers: Record<string, string>
): number {
  let baseProb = 30; // 默认 30% 基础概率

  if (!character) return baseProb;

  // 1. 分析性格描述字段
  const personality = (character.personality || "").toLowerCase();
  const highTraits = ["急躁", "粗鲁", "多话", "傲慢", "热情", "强势", "残忍", "话痨", "唠叨", "傲娇", "impulsive", "talkative", "aggressive", "rude", "dominant", "passionate"];
  const lowTraits = ["冷漠", "安静", "沉默", "寡言", "silent", "cold", "quiet", "indifferent"];

  highTraits.forEach(trait => {
    if (personality.includes(trait)) baseProb += 8;
  });

  lowTraits.forEach(trait => {
    if (personality.includes(trait)) baseProb -= 10;
  });

  // 2. 从 AI 上一轮回复内容分析情绪特征
  if (lastAiContent && triggers) {
    const lastAiTextLower = lastAiContent.toLowerCase();
    let detectedEmotion = "neutral";
    for (const [emotion, triggerPattern] of Object.entries(triggers)) {
      if (triggerPattern) {
        try {
          if (isSafeRegexForBison(triggerPattern)) {
            const regex = new RegExp(triggerPattern, "i");
            if (regex.test(lastAiTextLower)) {
              detectedEmotion = emotion;
              break;
            }
          } else {
            if (lastAiTextLower.includes(triggerPattern.toLowerCase())) {
              detectedEmotion = emotion;
              break;
            }
          }
        } catch (e) {
          if (lastAiTextLower.includes(triggerPattern.toLowerCase())) {
            detectedEmotion = emotion;
            break;
          }
        }
      }
    }

    // 情绪分类权重调整
    if (["joy", "happy", "smile", "anger", "angry", "rage"].includes(detectedEmotion)) {
      baseProb += 15; // 兴奋/高唤醒度情绪增加说话概率
    } else if (["sadness", "sad", "cry"].includes(detectedEmotion)) {
      baseProb -= 15; // 悲伤/低落情绪减少说话概率
    } else if (["blush", "shy"].includes(detectedEmotion)) {
      baseProb -= 5;  // 羞涩稍微降低连续说话概率
    }
  }

  // 限制概率区间在 5% 至 85% 之间
  return Math.max(5, Math.min(85, baseProb));
}
