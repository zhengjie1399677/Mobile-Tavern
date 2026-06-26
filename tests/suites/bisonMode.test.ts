/**
 * 野牛模式概率测试套件
 *
 * 覆盖 testBisonModeProbability：
 *  - 基础概率、性格调整、情绪联动
 *  - ReDoS 危险正则安全降级为 includes 匹配
 */

import { calculateBisonModeProbability } from "../../src/hooks/useChat/helpers/bisonProbability";
import { assert } from "./testUtils";

export function testBisonModeProbability() {
  console.log("\n--- Running Bison Mode Probability Verification ---");

  const triggers = {
    joy: "笑了|微笑|开心|😊|smile|joy|happy",
    sadness: "哭|流泪|伤心|😢|cry|sad",
    anger: "生气|愤怒|😡|angry|rage",
    blush: "脸红|害羞|😳|blush|shy",
  };

  // 1. 基础情况
  const charNormal = { personality: "" };
  assert(calculateBisonModeProbability(charNormal, "", triggers) === 30, "Base probability should be 30");

  // 2. 具备急躁性格的说话性格
  const charAggressive = { personality: "性格急躁且非常粗鲁，傲慢强势" };
  // 急躁(+8) + 粗鲁(+8) + 傲慢(+8) + 强势(+8) = +32. 30 + 32 = 62.
  assert(calculateBisonModeProbability(charAggressive, "", triggers) === 62, "Aggressive personality should increase probability to 62");

  // 3. 冷漠安静性格
  const charQuiet = { personality: "冷漠安静沉默寡言" };
  // 冷漠(-10) + 安静(-10) + 沉默(-10) + 寡言(-10) = -40. 30 - 40 = -10, clamped to 5
  assert(calculateBisonModeProbability(charQuiet, "", triggers) === 5, "Quiet personality should decrease probability to clamp at 5");

  // 4. 情绪联动 (生气)
  const charNormalAngry = { personality: "" };
  const lastAngryText = "你到底想怎么样？！我非常生气！😡";
  // anger (+15) -> 30 + 15 = 45.
  assert(calculateBisonModeProbability(charNormalAngry, lastAngryText, triggers) === 45, "Anger emotion should increase probability to 45");

  // 5. 性格与情绪组合 (冷漠 + 开心)
  const charCold = { personality: "有些冷漠" }; // -10 -> 20
  const lastHappyText = "听你这么说，我忍不住笑了，心里很开心。"; // joy (+15) -> 20 + 15 = 35.
  assert(calculateBisonModeProbability(charCold, lastHappyText, triggers) === 35, "Cold personality + Happy emotion should equal 35");

  // 6. ReDoS 防护验证（真实实现独有行为：危险正则降级为 includes 匹配，不抛错）
  const dangerousTriggers = {
    joy: "(a+)+b", // 嵌套量词，isSafeRegexForBison 判定为不安全
  };
  const redosChar = { personality: "" };
  // 文本不含字面量 "(a+)+b"，includes 降级不命中 → 30
  assert(calculateBisonModeProbability(redosChar, "happy smiling day", dangerousTriggers) === 30,
    "ReDoS dangerous regex should be safely degraded to includes matching, not throw");
  // 文本含字面量 "(a+)+b"，includes 降级命中 → joy (+15) → 45
  assert(calculateBisonModeProbability(redosChar, "trigger: (a+)+b", dangerousTriggers) === 45,
    "ReDoS degraded includes matching should still detect literal trigger presence");

  console.log("✔ Bison Mode Probability calculation logic verified!");
}
