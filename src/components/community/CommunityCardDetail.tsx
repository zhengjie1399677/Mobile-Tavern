import React from "react";
import { Download, LoaderCircle, MessageCircle, Send, Trash2, X } from "lucide-react";
import {
  createCommunityComment,
  deleteCommunityCard,
  deleteCommunityComment,
  listCommunityComments,
  type CommunityCardSummary,
  type CommunityComment,
} from "../../domain/community/api";
import { getCommunityAdminToken } from "../../domain/community/adminSession";
import type { CommunityIdentity } from "../../domain/community/identity";
import { formatCommunityTimestamp, formatCommunityFileSize } from "../../domain/community/presentation";

interface CommunityCardDetailProps {
  card: CommunityCardSummary;
  identity: CommunityIdentity;
  language: string;
  onClose: () => void;
  onCardDeleted: (cardId: string) => void;
  confirmAction: (message: string, title?: string) => Promise<boolean>;
  showAlert: (message: string) => Promise<void>;
  onDownload?: (card: CommunityCardSummary) => void;
  downloading?: boolean;
  downloadProgress?: number;
}

export function CommunityCardDetail({
  card,
  identity,
  language,
  onClose,
  onCardDeleted,
  confirmAction,
  showAlert,
  onDownload,
  downloading,
  downloadProgress,
}: CommunityCardDetailProps) {
  const [comments, setComments] = React.useState<CommunityComment[]>([]);
  const [content, setContent] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const adminToken = getCommunityAdminToken();
  const contentLength = Array.from(content).length;

  React.useEffect(() => {
    const controller = new AbortController();
    listCommunityComments(card.id, controller.signal)
      .then(setComments)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        void showAlert(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [card.id, showAlert]);

  const submitComment = async () => {
    const normalized = content.trim();
    if (!normalized || contentLength > 100 || submitting) return;
    setSubmitting(true);
    try {
      const created = await createCommunityComment({
        cardId: card.id,
        identity,
        content: normalized,
      });
      setComments((previous) => [created, ...previous]);
      setContent("");
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const removeComment = async (comment: CommunityComment) => {
    if (!adminToken) return;
    if (!(await confirmAction(`删除“${comment.authorName}”的这条评论？`, "管理员操作"))) {
      return;
    }
    try {
      await deleteCommunityComment(comment.id, adminToken);
      setComments((previous) => previous.filter((item) => item.id !== comment.id));
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : String(error));
    }
  };

  const removeCard = async () => {
    if (!adminToken) return;
    if (!(await confirmAction(`永久删除角色卡“${card.title}”及其全部评论？`, "管理员操作"))) {
      return;
    }
    try {
      await deleteCommunityCard(card.id, adminToken);
      onCardDeleted(card.id);
      onClose();
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4 animate-in fade-in duration-200">
      {/* Background click close */}
      <div className="absolute inset-0" onClick={onClose} />
      
      {/* Modal dialog */}
      <section className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border/60 glass-panel shadow-2xl sm:max-w-md sm:rounded-3xl animate-in slide-in-from-bottom duration-250 z-10">
        <header className="flex items-center gap-3 border-b border-border/40 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-foreground">{card.title}</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {card.uploaderName} · {formatCommunityTimestamp(card.createdAt, language)}
            </p>
          </div>
          {onDownload && (
            <button
              type="button"
              disabled={downloading}
              onClick={() => onDownload(card)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-md hover:opacity-90 active:scale-95 transition-all shrink-0 disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  <span>{downloadProgress !== undefined ? `${downloadProgress}%` : "下载中"}</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  <span>下载</span>
                </>
              )}
            </button>
          )}
          {adminToken && (
            <button
              type="button"
              onClick={() => void removeCard()}
              className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-destructive hover:bg-destructive/10 transition active:scale-95 shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/40 transition active:scale-95"
            aria-label="关闭"
          >
            <X className="mx-auto h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* Card Meta Info */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80 font-medium">
            <span className="bg-muted px-2 py-0.5 rounded-md border border-border/40">
              {card.mimeType === "image/png" ? "PNG 角色卡" : "JSON 角色卡"}
            </span>
            <span>{formatCommunityFileSize(card.fileSize)}</span>
            <span>{card.downloadCount} 次下载</span>
          </div>

          {/* Description */}
          <div className="bg-card/40 rounded-xl p-3 border border-border/40">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {card.description || "暂无角色卡介绍"}
            </p>
          </div>

          {/* Comments Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span>评论 ({comments.length})</span>
            </div>

            {/* Comment Form */}
            <div className="rounded-xl border border-border/55 bg-input/40 p-3 shadow-inner space-y-2">
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={2}
                placeholder="写下对这张角色卡的看法……"
                className="w-full resize-none bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <div className="flex items-center justify-between">
                <span className={contentLength > 100 ? "text-[10px] text-destructive" : "text-[10px] text-muted-foreground"}>
                  {contentLength}/100 · 每小时最多 6 条
                </span>
                <button
                  type="button"
                  disabled={!content.trim() || contentLength > 100 || submitting}
                  onClick={() => void submitComment()}
                  className="flex h-8 items-center gap-1 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  {submitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  <span>发表</span>
                </button>
              </div>
            </div>

            {/* Comment List */}
            <div className="space-y-2">
              {loading ? (
                <div className="py-8 flex justify-center">
                  <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : comments.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground/60">还没有评论，快来抢沙发吧~</p>
              ) : (
                comments.map((comment) => (
                  <article key={comment.id} className="rounded-xl border border-border/30 bg-card/45 p-3 space-y-1.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground/90">{comment.authorName}</span>
                      <div className="flex items-center gap-2">
                        <time className="text-[9px] text-muted-foreground">
                          {formatCommunityTimestamp(comment.createdAt, language)}
                        </time>
                        {adminToken && (
                          <button
                            type="button"
                            onClick={() => void removeComment(comment)}
                            aria-label="删除评论"
                            className="text-destructive hover:opacity-80 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs text-foreground/80 leading-relaxed">
                      {comment.content}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
