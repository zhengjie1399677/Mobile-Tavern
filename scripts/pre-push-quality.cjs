/**
 * 判断 pre-push 应运行完整质量门禁，还是只校验纯版本发布提交。
 *
 * 只有提交内容与 bump-version.cjs 从父提交生成的结果完全一致时，才允许
 * 使用轻量版本校验；任何无法确认的情况都会回退到完整门禁。
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const {
  MANAGED_VERSION_FILES,
  buildVersionUpdates,
  getCurrentVersion,
} = require("./bump-version.cjs");

const ZERO_SHA = /^0+$/;
const RELEASE_SUBJECT = /^chore\(release\): bump version to (\d+\.\d+\.\d+)$/;

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr?.trim() || `git ${args.join(" ")} 执行失败`,
    );
  }
  return result.stdout.trim();
}

function readCommitContents(commit) {
  return new Map(
    MANAGED_VERSION_FILES.map((filePath) => [filePath, git(["show", `${commit}:${filePath}`])]),
  );
}

function sameFiles(left, right) {
  return left.length === right.length && left.every((filePath, index) => filePath === right[index]);
}

function validateReleaseCommit(commitish) {
  const commit = git(["rev-parse", `${commitish}^{commit}`]);
  const subject = git(["show", "-s", "--format=%s", commit]);
  const subjectMatch = subject.match(RELEASE_SUBJECT);
  if (!subjectMatch) return null;

  const revision = git(["rev-list", "--parents", "-n", "1", commit]).split(/\s+/);
  if (revision.length !== 2) return null;
  const parent = revision[1];
  const parentContents = readCommitContents(parent);
  const commitContents = readCommitContents(commit);
  const targetVersion = subjectMatch[1];
  const expectedContents = buildVersionUpdates(parentContents, targetVersion);
  const expectedChangedFiles = MANAGED_VERSION_FILES
    .filter((filePath) => parentContents.get(filePath) !== expectedContents.get(filePath).trimEnd())
    .sort();
  const actualChangedFiles = git([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    parent,
    commit,
  ])
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();

  if (!sameFiles(expectedChangedFiles, actualChangedFiles)) return null;
  if (getCurrentVersion(commitContents) !== targetVersion) return null;
  for (const filePath of MANAGED_VERSION_FILES) {
    if (commitContents.get(filePath) !== expectedContents.get(filePath).trimEnd()) return null;
  }

  return { commit, parent, version: targetVersion };
}

function parseUpdates(input) {
  return input
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error(`无法解析 pre-push 引用：${line}`);
      return {
        localRef: fields[0],
        localSha: fields[1],
        remoteRef: fields[2],
        remoteSha: fields[3],
      };
    });
}

function isReleaseOnlyPush(updates) {
  if (updates.length === 0) return false;
  let releaseIdentity = null;

  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) return false;

    let release;
    if (update.localRef.startsWith("refs/heads/")) {
      if (!update.remoteRef.startsWith("refs/heads/") || ZERO_SHA.test(update.remoteSha)) {
        return false;
      }
      release = validateReleaseCommit(update.localSha);
      if (!release || release.parent !== update.remoteSha) return false;
    } else if (update.localRef.startsWith("refs/tags/v")) {
      if (update.remoteRef !== update.localRef) return false;
      release = validateReleaseCommit(update.localSha);
      if (!release || update.localRef !== `refs/tags/v${release.version}`) return false;
    } else {
      return false;
    }

    const identity = `${release.commit}:v${release.version}`;
    if (releaseIdentity && releaseIdentity !== identity) return false;
    releaseIdentity = identity;
  }

  return Boolean(releaseIdentity);
}

function main() {
  try {
    const updates = parseUpdates(fs.readFileSync(0, "utf8"));
    process.stdout.write(isReleaseOnlyPush(updates) ? "release" : "full");
  } catch (error) {
    console.error(`无法确认纯版本发布，将使用完整质量门禁：${error.message}`);
    process.stdout.write("full");
  }
}

main();
