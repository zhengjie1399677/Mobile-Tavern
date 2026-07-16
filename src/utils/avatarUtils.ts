/**
 * 根据角色名字哈希获取占位头像的渐变色样式类
 * @param name 角色名称
 * @returns Tailwind CSS 渐变色样式类字符串
 */
export function getAvatarGradientClass(name: string): string {
  const gradients = [
    "bg-gradient-to-tr from-pink-500/10 to-rose-500/20 text-rose-400 border-rose-500/20! dark:text-rose-300",
    "bg-gradient-to-tr from-blue-600/10 to-cyan-500/20 text-cyan-400 border-cyan-500/20! dark:text-cyan-300",
    "bg-gradient-to-tr from-violet-600/10 to-purple-500/20 text-purple-400 border-purple-500/20! dark:text-purple-300",
    "bg-gradient-to-tr from-emerald-600/10 to-teal-500/20 text-teal-400 border-emerald-500/20! dark:text-teal-300",
    "bg-gradient-to-tr from-amber-500/10 to-orange-500/20 text-orange-400 border-orange-500/20! dark:text-orange-300",
  ];
  if (!name) return gradients[0];
  const charHash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return gradients[charHash % gradients.length];
}
