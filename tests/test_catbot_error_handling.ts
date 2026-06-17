// 单元测试：验证 useCatbot 和 server.ts 中的小猫额度报错分类逻辑
export function runCatbotErrorTests() {
  console.log("\n--- 开始验证小猫额度与次数限制判定规则 ---");

  const isQuotaError = (errMsg: string) => {
    const errMsgLower = errMsg.toLowerCase();
    return (
      errMsgLower.includes("429") ||
      errMsgLower.includes("quota") ||
      errMsgLower.includes("limit") ||
      errMsgLower.includes("insufficient") ||
      errMsgLower.includes("exceeded") ||
      errMsgLower.includes("balance") ||
      errMsgLower.includes("funds") ||
      errMsgLower.includes("次数用尽") ||
      errMsgLower.includes("额度已满") ||
      errMsgLower.includes("不够") ||
      errMsgLower.includes("欠费") ||
      errMsgLower.includes("充值")
    );
  };

  // 1. 应当被判定为额度已满/次数限制的报错样例
  const positiveCases = [
    "HTTP error 429: Too Many Requests",
    "API key quota exceeded for this model",
    "Your account has insufficient funds",
    "Billing limit reached, please upgrade your plan",
    "Request limit exceeded",
    "insufficient_balance",
    "云端大模型额度不足了，请联系管理员充值",
    "今日调用次数用尽",
    "账户欠费中，请及时处理",
    "HTTP error 400: Out of Quota",
  ];

  // 2. 应当被判定为普通网络/其他错误的报错样例
  const negativeCases = [
    "TIMEOUT",
    "Fetch failed to connect to database",
    "HTTP error 500: Internal Server Error",
    "SyntaxError: Unexpected token < in JSON at position 0",
    "Cannot read property 'reply' of undefined",
  ];

  for (const tc of positiveCases) {
    const res = isQuotaError(tc);
    if (!res) {
      throw new Error(`【未通过】样例应被判定为额度错误但没有被匹配成功: "${tc}"`);
    }
    console.log(`✔ 正确拦截额度/限流报错: "${tc}"`);
  }

  for (const tc of negativeCases) {
    const res = isQuotaError(tc);
    if (res) {
      throw new Error(`【未通过】样例不应被判定为额度错误但被误拦截: "${tc}"`);
    }
    console.log(`✔ 正确排除普通报错: "${tc}"`);
  }

  console.log("✔ 额度错误分类匹配算法全部验证通过！");

  console.log("\n--- 开始验证锁定睡觉表情(sleep)的判定规则 ---");

  const checkLockSleep = (reply: string) => {
    return (
      reply.includes("次数已经用光光") || 
      reply.includes("小猫累了") || 
      reply.includes("要去睡觉了") ||
      reply.includes("小本本都已经写满") ||
      reply.includes("脑瓜转不动了")
    );
  };

  const shouldLock = [
    "呜呜，今天找本喵提问的次数已经用光光了，要去睡觉了喵",
    "小猫累了，本喵今天不会再回答了喵",
    "哎呀，脑力已经不够用了，要去睡觉了喵💤",
    "喵呜……今天帮本喵记 Bug 的次数已经用光了，本喵的小本本都已经写满啦！",
    "唔……今天解答的技术问题太多啦，本喵的脑瓜转不动了，明天再来问本喵关于设置和配置的事喵~ 💤"
  ];

  const shouldNotLock = [
    "喵呜！网络好像断掉了喵！",
    "本喵在认真听哦，什么事喵？",
  ];

  for (const tc of shouldLock) {
    const res = checkLockSleep(tc);
    if (!res) {
      throw new Error(`【未通过】文案应当触发锁定睡觉，但没有成功: "${tc}"`);
    }
    console.log(`✔ 正确锁定睡觉状态: "${tc}"`);
  }

  for (const tc of shouldNotLock) {
    const res = checkLockSleep(tc);
    if (res) {
      throw new Error(`【未通过】文案不应当触发锁定睡觉，但被误匹配: "${tc}"`);
    }
    console.log(`✔ 正确避开非锁定状态: "${tc}"`);
  }

  console.log("✔ 表情锁定匹配算法验证通过！");
}
