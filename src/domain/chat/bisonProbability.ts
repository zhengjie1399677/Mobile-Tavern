/**
 * 野牛模式概率领域规则。
 *
 * 该模块只包含纯业务计算，不依赖 React、Kernel、存储或网络。
 * Kernel/Pipeline 仅调用其公开函数，不持有任何具体角色行为规则。
 */

function isSafeRegexForBison(pattern: string): boolean {
  if (!pattern) return true;
  return !/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(pattern) &&
    !/(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(pattern);
}

export function calculateBisonModeProbability(
  character: any,
  lastAiContent: string,
  triggers: Record<string, string>
): number {
  let baseProb = 30;
  if (!character) return baseProb;

  const personality = (character.personality || "").toLowerCase();
  const highTraits = [
    "急躁", "粗鲁", "多话", "傲慢", "热情", "强势", "残忍", "话痨", "唠叨", "傲娇",
    "impulsive", "talkative", "aggressive", "rude", "dominant", "passionate",
  ];
  const lowTraits = [
    "冷漠", "安静", "沉默", "寡言", "silent", "cold", "quiet", "indifferent",
  ];

  highTraits.forEach((trait) => {
    if (personality.includes(trait)) baseProb += 8;
  });
  lowTraits.forEach((trait) => {
    if (personality.includes(trait)) baseProb -= 10;
  });

  if (lastAiContent && triggers) {
    const lastAiTextLower = lastAiContent.toLowerCase();
    let detectedEmotion = "neutral";
    for (const [emotion, triggerPattern] of Object.entries(triggers)) {
      if (!triggerPattern) continue;
      try {
        if (isSafeRegexForBison(triggerPattern)) {
          if (new RegExp(triggerPattern, "i").test(lastAiTextLower)) {
            detectedEmotion = emotion;
            break;
          }
        } else if (lastAiTextLower.includes(triggerPattern.toLowerCase())) {
          detectedEmotion = emotion;
          break;
        }
      } catch {
        if (lastAiTextLower.includes(triggerPattern.toLowerCase())) {
          detectedEmotion = emotion;
          break;
        }
      }
    }

    if (["joy", "happy", "smile", "anger", "angry", "rage"].includes(detectedEmotion)) {
      baseProb += 15;
    } else if (["sadness", "sad", "cry"].includes(detectedEmotion)) {
      baseProb -= 15;
    } else if (["blush", "shy"].includes(detectedEmotion)) {
      baseProb -= 5;
    }
  }

  return Math.max(5, Math.min(85, baseProb));
}
