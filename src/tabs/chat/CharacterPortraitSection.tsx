// 大立绘容器（玻璃光盘 + 情绪徽章 + 折叠）
// 从原 ChatTab.tsx L1103-1150 抽离

import React from "react";
import { ChevronUp } from "lucide-react";

/**
 * 角色情绪立绘组件的属性定义
 */
interface CharacterPortraitSectionProps {
  /** 当前活跃的角色卡数据 */
  activeCharacter: any;
  /** 是否拥有可用的表情立绘集合 */
  hasExpressions: boolean;
  /** 当前应渲染的表情立绘图片 URL */
  activePortraitUrl: string;
  /** 当前识别到的情绪名称 */
  currentEmotionName: string;
  /** 是否收起立绘折叠状态 */
  isPortraitCollapsed: boolean;
  /** 设置收起状态的回调函数 */
  setIsPortraitCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  /** 移动端系统键盘是否已弹起 */
  isKeyboardOpen: boolean;
}

/**
 * 角色情绪大立绘展示组件
 * 支持玻璃光盘背景、当前情绪徽章指示，以及移动端输入法弹起时的自动折叠自愈与手动折叠控制
 */
const CharacterPortraitSection = ({
  activeCharacter,
  hasExpressions,
  activePortraitUrl,
  currentEmotionName,
  isPortraitCollapsed,
  setIsPortraitCollapsed,
  isKeyboardOpen,
}: CharacterPortraitSectionProps) => {
  if (!activeCharacter || !hasExpressions || !activePortraitUrl) {
    return null;
  }

  return (
    <div className="bg-card border-b border-border transition-all duration-300 overflow-hidden flex flex-col items-center relative shrink-0">
      {!isPortraitCollapsed && !isKeyboardOpen ? (
        <div className="w-full flex flex-col items-center justify-center p-3 relative h-48 animate-fadeIn">
          {/* 玻璃光泽感的磨砂背景光盘效果 */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-60 pointer-events-none" />
          <div className="w-40 h-40 rounded-2xl overflow-hidden border border-border bg-muted/30 shadow-lg relative flex items-center justify-center">
            {/* 渲染带有平滑淡入动画的当前表情立绘 */}
            <img
              key={activePortraitUrl}
              src={activePortraitUrl}
              alt={`${activeCharacter.name} Portrait`}
              className="w-full h-full object-cover animate-fadeIn mask-feather-bottom"
            />

            {/* 表情徽章指示器 */}
            <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm border border-border text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-sm">
              {currentEmotionName}
            </div>
          </div>

          {/* 折叠收起按钮 */}
          <button
            onClick={() => setIsPortraitCollapsed(true)}
            className="absolute top-2 right-3 text-muted-foreground hover:text-foreground p-1 transition"
            title="收起立绘"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          className="w-full flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 hover:bg-muted/50 transition cursor-pointer"
          onClick={() => {
            if (!isKeyboardOpen) {
              setIsPortraitCollapsed(false);
            }
          }}
        >
          <span className="font-medium flex items-center gap-1.5">
            {isKeyboardOpen ? "⌨️ 键盘输入中已自动折叠情绪立绘" : "🖼️ 点击展开角色动态情绪立绘"}
          </span>
          <span className="scale-90 opacity-70">{isKeyboardOpen ? "输入中" : "展开立绘 ⬇️"}</span>
        </div>
      )}
    </div>
  );
};

export default CharacterPortraitSection;
