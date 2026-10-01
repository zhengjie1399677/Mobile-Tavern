import { useState } from "react";
import { BookOpen, Brain, Compass, MessageSquare, Plus, ShieldAlert, Sparkles, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { PromptComposerButton } from "./PromptComposerControls";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  WORKFLOW_NODE_TEMPLATES,
  type WorkflowNodeTemplate,
} from "./workflowNodeLibrary";

interface WorkflowNodeLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (template: WorkflowNodeTemplate) => void;
}

export default function WorkflowNodeLibraryDialog({
  open,
  onOpenChange,
  onSelectTemplate,
}: WorkflowNodeLibraryDialogProps) {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const categories = [
    { id: "all", label: "全部节点", icon: Sparkles },
    { id: "role", label: "人设与角色", icon: User },
    { id: "context", label: "上下文与记忆", icon: BookOpen },
    { id: "rules", label: "规则与深度注入", icon: ShieldAlert },
    { id: "advanced", label: "思考与推演", icon: Brain },
  ];

  const filteredTemplates = selectedCategory === "all"
    ? WORKFLOW_NODE_TEMPLATES
    : WORKFLOW_NODE_TEMPLATES.filter((tmpl) => tmpl.category === selectedCategory);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "role": return User;
      case "context": return BookOpen;
      case "rules": return ShieldAlert;
      case "advanced": return Brain;
      default: return Sparkles;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[85dvh] w-full max-w-xl -translate-x-1/2 translate-y-0 overflow-y-auto rounded-b-none border border-border/80 bg-background/95 p-0 backdrop-blur-md shadow-2xl">
        <DialogHeader className="border-b border-border/70 px-4 pb-3 pt-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-xs">
              <Compass className="h-4 w-4" />
            </span>
            <span>添加工作流节点</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            从标准模版库向当前提示词流水线中添加功能节点。
          </DialogDescription>
        </DialogHeader>

        {/* 分类切换胶囊 */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-4 pt-3 pb-1 no-scrollbar border-b border-border/40">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const active = selectedCategory === cat.id;
            return (
              <PromptComposerButton
                key={cat.id}
                type="button"
                variant="ghost"
                onClick={() => setSelectedCategory(cat.id)}
                className={`h-7.5 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-none transition-all ${
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30 font-bold"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{cat.label}</span>
              </PromptComposerButton>
            );
          })}
        </div>

        {/* 节点卡片列表 */}
        <div className="space-y-2 p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {filteredTemplates.map((template) => {
            const Icon = getCategoryIcon(template.category);
            return (
              <div
                key={template.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-3.5 backdrop-blur-xs transition-all hover:border-primary/50 hover:bg-card/90 shadow-xs"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-primary shadow-xs mt-0.5 group-hover:bg-primary/10">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground truncate">{template.name}</span>
                      <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.2 text-[9px] font-mono font-bold text-primary">
                        {template.placement.type === "in_chat" ? `深度 ${template.placement.depth}` : "顺序"}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground font-normal line-clamp-2">
                      {template.description}
                    </p>
                  </div>
                </div>

                <PromptComposerButton
                  type="button"
                  onClick={() => {
                    onSelectTemplate(template);
                    onOpenChange(false);
                  }}
                  className="h-8 shrink-0 gap-1.5 border-primary/30 bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20 shadow-xs justify-center"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>添加至画布</span>
                </PromptComposerButton>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
