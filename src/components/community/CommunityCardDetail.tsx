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
    <div className="fixed inset-0 z-[120] flex items-end bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4">
      <section className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <header className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold">{card.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {card.uploaderName} · {formatCommunityTimestamp(card.createdAt, language)}
            </p>
          </div>
          {onDownload && (
            <button
              type="button"
              disabled={downloading}
              onClick={() => onDownload(card)}
              className="flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm"
            >
              {downloading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              下载
            </button>
          )}
          {adminToken && (
            <button
              type="button"
              onClick={() => void removeCard()}
              className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-destructive active:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" /> 删除卡片
            </button>
          )}
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-lg">
            <X className="mx-auto h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto p-4">
          {/* 卡片信息 */}
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{card.mimeType === "image/png" ? "PNG 角色卡" : "JSON 角色卡"}</span>
            <span>{formatCommunityFileSize(card.fileSize)}</span>
            <span>{card.downloadCount} 次下载</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {card.description || "暂无角色卡介绍"}
          </p>
          <div className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="h-4 w-4 text-primary" />
            评论
          </div>
          <div className="mt-3 rounded-xl border border-border bg-card p-3">
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={3}
              placeholder="写下对这张角色卡的看法……"
              className="w-full resize-none bg-transparent text-sm outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className={contentLength > 100 ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {contentLength}/100 · 每小时最多 6 条
              </span>
              <button
                type="button"
                disabled={!content.trim() || contentLength > 100 || submitting}
                onClick={() => void submitComment()}
                className="flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {submitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                发表
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <LoaderCircle className="mx-auto my-8 h-5 w-5 animate-spin text-primary" />
            ) : comments.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">还没有评论</p>
            ) : comments.map((comment) => (
              <article key={comment.id} className="rounded-xl border border-border/70 bg-card/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{comment.authorName}</span>
                  <div className="flex items-center gap-2">
                    <time className="text-[10px] text-muted-foreground">
                      {formatCommunityTimestamp(comment.createdAt, language)}
                    </time>
                    {adminToken && (
                      <button
                        type="button"
                        onClick={() => void removeComment(comment)}
                        aria-label="删除评论"
                        className="text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.content}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
