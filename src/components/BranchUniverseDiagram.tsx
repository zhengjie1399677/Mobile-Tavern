import React, { useState, useRef } from "react";
import { useTranslation } from "../contexts/LanguageContext";
import { GitFork, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { ChatSession } from "../types";
import type { MemoryFragment } from "../kernel/services/memory/types";

interface BranchUniverseDiagramProps {
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  fragments: MemoryFragment[];
  onSelectSession: (id: string) => void;
  onInspectNode: (sessionId: string, turn: number, fragments: MemoryFragment[]) => void;
}

export default function BranchUniverseDiagram({
  sessions,
  activeSession,
  fragments,
  onSelectSession,
  onInspectNode,
}: BranchUniverseDiagramProps) {
  const { t } = useTranslation();
  
  // 手势缩放与拖拽状态
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const pinchDistance = useRef<number | null>(null);
  const pinchScale = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // 参数常量
  const turnHeight = 50; // 每条消息的垂直距离 (px)
  const colWidth = 140;  // 每个水平通道的间距 (px)

  // 1. 水平通道 X 分配
  const getXCoordinate = (sessionId: string, totalWidth: number): number => {
    const columns: Record<string, number> = {};
    let nextLeft = -1;
    let nextRight = 1;

    // 默认主分支在中间
    const rootSession = sessions.find((s) => !s.parentSessionId) || sessions[0];
    if (!rootSession) return totalWidth / 2;

    columns[rootSession.id] = 0;
    
    // 按时间顺序对其他分支进行通道分配，奇数在右，偶数在左
    const otherSessions = [...sessions]
      .filter((s) => s.id !== rootSession.id)
      .sort((a, b) => a.createdAt - b.createdAt);

    otherSessions.forEach((s, idx) => {
      if (idx % 2 === 0) {
        columns[s.id] = nextRight++;
      } else {
        columns[s.id] = nextLeft--;
      }
    });

    const colIndex = columns[sessionId] ?? 0;
    return totalWidth / 2 + colIndex * colWidth;
  };

  // 2. 计算垂直偏移 Y
  const yOffsets: Record<string, number> = {};
  const sessionsByTime = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
  const rootSession = sessions.find((s) => !s.parentSessionId) || sessions[0];
  
  if (rootSession) {
    yOffsets[rootSession.id] = 60; // 根节点留出 60px 边距
  }

  sessionsByTime.forEach((s) => {
    if (rootSession && s.id === rootSession.id) return;
    if (s.parentSessionId && s.parentMessageId) {
      const parentOffset = yOffsets[s.parentSessionId] ?? 60;
      const parentSess = sessions.find((p) => p.id === s.parentSessionId);
      const splitIdx = parentSess
        ? parentSess.messages.findIndex((m) => m.id === s.parentMessageId)
        : -1;
      const splitY = parentOffset + (splitIdx >= 0 ? splitIdx : 0) * turnHeight;
      yOffsets[s.id] = splitY + 45; // 在分裂消息高度下方 45px 开始垂直向下
    } else {
      yOffsets[s.id] = 60;
    }
  });

  // 3. 树尺寸计算，为 SVG viewBox 提供大小
  const svgWidth = Math.max(colWidth * (sessions.length + 1), 600);
  let svgHeight = 400;
  sessions.forEach((s) => {
    const endY = (yOffsets[s.id] ?? 60) + (s.messages?.length ?? 0) * turnHeight + 100;
    if (endY > svgHeight) svgHeight = endY;
  });

  // 4. 拖拽与手势控制处理器
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - translate.x, y: e.clientY - translate.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setTranslate({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isDragging.current = false;
      pinchDistance.current = touchDistance(e.touches[0], e.touches[1]);
      pinchScale.current = scale;
      return;
    }
    if (e.touches.length === 1) {
      isDragging.current = true;
      const touch = e.touches[0];
      dragStart.current = { x: touch.clientX - translate.x, y: touch.clientY - translate.y };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchDistance.current) {
      const ratio = touchDistance(e.touches[0], e.touches[1]) / pinchDistance.current;
      setScale(Math.min(3, Math.max(0.6, pinchScale.current * ratio)));
      return;
    }
    if (!isDragging.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setTranslate({
      x: touch.clientX - dragStart.current.x,
      y: touch.clientY - dragStart.current.y,
    });
  };

  const handleReset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    pinchDistance.current = null;
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-zinc-950/40 border border-zinc-800/80 rounded-xl overflow-hidden shadow-inner select-none touch-none">
      
      {/* 缩放手势浮动控制栏 */}
      <div className="absolute top-2 right-2 z-10 flex gap-1.5 bg-zinc-900/80 backdrop-blur-md p-1 border border-zinc-800 rounded-lg">
        <button
          onClick={() => setScale((prev) => Math.min(prev + 0.2, 3))}
          className="p-1.5 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded active:scale-95 transition-all"
          title="放大"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setScale((prev) => Math.max(prev - 0.2, 0.6))}
          className="p-1.5 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded active:scale-95 transition-all"
          title="缩小"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleReset}
          className="p-1.5 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded active:scale-95 transition-all"
          title="重置"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* SVG Canvas 画布容器 */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={(event) => {
          event.preventDefault();
          setScale((current) => Math.min(3, Math.max(0.6, current + (event.deltaY < 0 ? 0.1 : -0.1))));
        }}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden"
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-full select-none"
        >
          {/* Neon 荧光流光效果渐变定义 */}
          <defs>
            <linearGradient id="neon-glow" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="active-neon" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.8" />
            </linearGradient>
            <filter id="shadow-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* 交互变换组 */}
          <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
            
            {/* 第一部分：绘制所有的贝塞尔连接线（分支分岔路径） */}
            {sessions.map((s) => {
              if (!s.parentSessionId || !s.parentMessageId) return null;
              
              const startX = getXCoordinate(s.parentSessionId, svgWidth);
              const endX = getXCoordinate(s.id, svgWidth);

              const parentOffset = yOffsets[s.parentSessionId] ?? 60;
              const parentSess = sessions.find((p) => p.id === s.parentSessionId);
              const splitIdx = parentSess
                ? parentSess.messages.findIndex((m) => m.id === s.parentMessageId)
                : -1;
              const startY = parentOffset + (splitIdx >= 0 ? splitIdx : 0) * turnHeight;
              const endY = yOffsets[s.id] ?? 60;

              // 三次贝塞尔曲线：从父线 (startX, startY) 平滑弯曲指向子线 (endX, endY)
              const pathD = `M ${startX} ${startY} C ${startX} ${startY + 25}, ${endX} ${endY - 25}, ${endX} ${endY}`;
              const isActive = s.id === activeSession?.id || s.parentSessionId === activeSession?.id;

              return (
                <g key={`link-${s.id}`}>
                  {/* 流光呼吸底层发光线 */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isActive ? "#10b981" : "#8b5cf6"}
                    strokeWidth="4"
                    strokeOpacity="0.3"
                    filter="url(#shadow-glow)"
                  />
                  {/* 运动流光虚线层 */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isActive ? "#34d399" : "#a78bfa"}
                    strokeWidth="2.5"
                    strokeDasharray="6 5"
                    className="animate-shimmer"
                    style={{
                      strokeDashoffset: 0,
                      animation: "shimmer-effect 2s linear infinite",
                    }}
                  />
                </g>
              );
            })}

            {/* 第二部分：绘制主树干以及垂直会话时间轴 */}
            {sessions.map((s) => {
              const x = getXCoordinate(s.id, svgWidth);
              const startY = yOffsets[s.id] ?? 60;
              const length = s.messages?.length ?? 0;
              const endY = startY + length * turnHeight;
              const isActive = s.id === activeSession?.id;

              return (
                <g key={`branch-${s.id}`}>
                  {/* 垂直时间柱 */}
                  <line
                    x1={x}
                    y1={startY}
                    x2={x}
                    y2={endY}
                    stroke={isActive ? "url(#active-neon)" : "url(#neon-glow)"}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeOpacity={isActive ? 0.95 : 0.45}
                  />

                  {/* 时空分支起点及终点小圆点 */}
                  <circle cx={x} cy={startY} r="4.5" fill={isActive ? "#34d399" : "#a78bfa"} />
                  <circle cx={x} cy={endY} r="4" fill={isActive ? "#10b981" : "#60a5fa"} />

                  {/* 会话分支名称气泡悬浮标签 */}
                  <g
                    transform={`translate(${x}, ${startY - 18})`}
                    onClick={() => onSelectSession(s.id)}
                    className="cursor-pointer active:scale-95 transition-all"
                  >
                    <rect
                      x="-55"
                      y="-11"
                      width="110"
                      height="20"
                      rx="6"
                      fill={isActive ? "rgba(16,185,129,0.15)" : "rgba(30,30,40,0.85)"}
                      stroke={isActive ? "#10b981" : "rgba(139,92,246,0.3)"}
                      strokeWidth="1"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={isActive ? "#34d399" : "#d4d4d8"}
                      fontSize="9"
                      fontWeight={isActive ? "bold" : "normal"}
                      className="font-sans"
                    >
                      {s.title.length > 10 ? `${s.title.slice(0, 8)}...` : s.title || t("session_manager.default_branch_name")}
                    </text>
                  </g>

                  {/* 轮次里程碑微节点与长期记忆挂载晶体 */}
                  {Array.isArray(s.messages) &&
                    s.messages.map((m, idx) => {
                      const nodeY = startY + idx * turnHeight;
                      // 获取属于该轮次的长期记忆碎片
                      const nodeFragments = fragments.filter(
                        (f) => f.sessionId === s.id && f.sourceTurnEnd === idx + 1
                      );
                      const activeFragments = nodeFragments.filter((fragment) => fragment.status === "active");
                      const hasMemory = activeFragments.length > 0;

                      return (
                        <g key={`node-${s.id}-${idx}`}>
                          {/* 微节点圆圈 */}
                          <circle
                            cx={x}
                            cy={nodeY}
                            r="5"
                            fill="rgba(30,41,59,0.95)"
                            stroke={isActive ? "#34d399" : "#8b5cf6"}
                            strokeWidth="1.5"
                            className="cursor-pointer"
                            role="button"
                            tabIndex={0}
                            aria-label={t("memory.inspect_turn", { turn: String(idx + 1) })}
                            onClick={(event) => {
                              event.stopPropagation();
                              onInspectNode(s.id, idx + 1, nodeFragments);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onInspectNode(s.id, idx + 1, nodeFragments);
                              }
                            }}
                          />
                          
                          {/* 记忆碎片晶体挂载（如果有） */}
                          {hasMemory && (
                            <g
                              transform={`translate(${x + 14}, ${nodeY})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onInspectNode(s.id, idx + 1, nodeFragments);
                              }}
                              className="cursor-pointer animate-pulse-glow"
                            >
                              {/* 连线虚线 */}
                              <line
                                x1="-14"
                                y1="0"
                                x2="-4"
                                y2="0"
                                stroke="#10b981"
                                strokeWidth="1"
                                strokeDasharray="2 2"
                              />
                              {/* 发光晶体六角星 */}
                              <polygon
                                points="0,-6 5,-2 5,2 0,6 -5,2 -5,-2"
                                fill="#10b981"
                                filter="url(#shadow-glow)"
                              />
                              {activeFragments.length > 1 && (
                                <text x="9" y="3" fill="#d1fae5" fontSize="8" fontWeight="bold">
                                  {activeFragments.length}
                                </text>
                              )}
                              <polygon
                                points="0,-6 5,-2 5,2 0,6 -5,2 -5,-2"
                                fill="#d1fae5"
                                stroke="#34d399"
                                strokeWidth="0.8"
                              />
                            </g>
                          )}
                        </g>
                      );
                    })}
                </g>
              );
            })}
          </g>
        </svg>

        {/* 空白状态提示 */}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-zinc-500 font-sans">
            <GitFork className="w-8 h-8 opacity-30 mb-2" />
            <p className="text-xs">{t("session_manager.empty_tree") || "暂无分支脉络数据"}</p>
          </div>
        )}
      </div>

      {/* SVG 动画与发光的关键帧样式 */}
      <style>{`
        @keyframes shimmer-effect {
          to {
            stroke-dashoffset: -30;
          }
        }
        .animate-pulse-glow {
          animation: pulse-glow-effect 1.8s ease-in-out infinite;
        }
        @keyframes pulse-glow-effect {
          0%, 100% {
            filter: drop-shadow(0 0 1px rgba(16,185,129,0.4));
            opacity: 0.85;
          }
          50% {
            filter: drop-shadow(0 0 5px rgba(52,211,153,0.85));
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

function touchDistance(first: React.Touch, second: React.Touch): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}
