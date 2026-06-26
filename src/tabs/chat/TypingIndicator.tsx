// 打字指示器子组件
// 三点弹跳动画，用于 AI 正在生成回复时的视觉反馈

const TypingIndicator = () => {
  return (
    <div className="flex items-center gap-1.5 p-2 px-1">
      <div
        className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]"
        style={{ animationDelay: "0ms" }}
      />
      <div
        className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]"
        style={{ animationDelay: "200ms" }}
      />
      <div
        className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]"
        style={{ animationDelay: "400ms" }}
      />
    </div>
  );
};

export default TypingIndicator;
