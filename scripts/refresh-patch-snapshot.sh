#!/usr/bin/env bash
# 刷新 feature-custom-patches.patch：把全部自定义改动相对上游基线打包成一份可重放的补丁。
# 升级镜像 / 换机器时，只要在上游基线的干净检出上 git apply 这份补丁就能恢复我们的改动。
#
#   bash scripts/refresh-patch-snapshot.sh
#
# 基线 90940fd = 开始改之前的上游 master 提交（git merge-base --is-ancestor 可验证）。
# 生成时排除补丁文件自身，否则每一轮都会把上一轮的内容当新增文件嵌进来，体积按轮次翻倍。
set -e
cd "$(dirname "$0")/.."
BASE=90940fd
OUT=feature-custom-patches.patch
ROOT="$(pwd)"

git diff "$BASE" HEAD -- . ":(exclude)$OUT" > "$OUT"

# 只写不验等于没写：在基线的临时 worktree 上 --check 一遍，坏补丁当场暴露
TMP="$(mktemp -d)"
git worktree add --detach "$TMP" "$BASE" >/dev/null 2>&1
status=0
if (cd "$TMP" && git apply --check "$ROOT/$OUT"); then
  echo "OK: $(wc -l < "$OUT") 行，可在 $BASE 上干净应用"
else
  echo "FAIL: 补丁无法干净应用到 $BASE" >&2
  status=1
fi
git worktree remove --force "$TMP" >/dev/null 2>&1 || true
exit $status
