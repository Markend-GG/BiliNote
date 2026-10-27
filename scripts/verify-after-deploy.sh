#!/usr/bin/env bash
# Docker 恢复后的一键验证序列（V3.1-V3.5 通用）。在 Git Bash 里跑：
#   bash scripts/verify-after-deploy.sh
# 任何一步失败会立刻停（set -e），失败输出就是排查起点。
set -e
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

echo "== 1/6 容器内后端全量测试（期望：仅 5 个上游既有失败）=="
docker run --rm -v "$PWD/backend:/src:ro" bilinote-gpu-base:local sh -c \
  "cp -r /src /tmp/b && cd /tmp/b && /usr/local/bin/python -m unittest discover -s tests -t . 2>&1 | tail -4"

echo "== 2/6 构建镜像（typecheck 门禁在 ui 阶段，类型错误会在这里红）=="
docker build -f Dockerfile.patch -t bilinote-gpu:local . | tail -3

echo "== 3/6 重建容器（7 卷，数据都在卷里）=="
docker stop bilinote || true
docker rm bilinote || true
docker run -d --name bilinote --gpus all -p 80:80 --restart unless-stopped \
  -e HF_ENDPOINT=https://hf-mirror.com -e PYTHONUNBUFFERED=1 \
  -v bilinote-cache:/root/.cache -v bilinote-config:/app/backend/config \
  -v bilinote-data:/app/backend/data -v bilinote-models:/app/backend/models \
  -v bilinote-static:/app/backend/static -v bilinote-uploads:/app/backend/uploads \
  -v bilinote-vector:/app/backend/vector_db \
  bilinote-gpu:local
sleep 18

echo "== 4/6 接口冒烟 =="
curl -sf http://localhost/api/library | head -c 160; echo
curl -sf "http://localhost/api/search?q=%E5%9F%BA%E6%9C%9F" | head -c 160; echo
curl -sf http://localhost/api/storage/scan | head -c 160; echo
# 别用 -o /dev/null：脚本顶部 MSYS_NO_PATHCONV=1 会让它字面传给 mingw curl，
# 打不开 "/dev/null" → curl exit 23 → set -e 中断（2026-10-27 踩过）
deep_link_code=$(curl -s -w '\n%{http_code}' http://localhost/note/00000000-0000-4000-8000-000000000000 | tail -n1)
echo "deep link /note/:id -> ${deep_link_code}"
docker exec bilinote sh -c 'grep -c logfile_maxbytes /etc/supervisor/conf.d/supervisord.conf'

echo "== 5/6 浏览器冒烟（headless Edge，visibilityState=visible，scroll-spy 能真验）=="
(cd e2e && npx playwright test)

echo "== 6/6 前端单测 + 类型 =="
(cd BillNote_frontend && npx vitest run | tail -3 && npx tsc -p tsconfig.app.json --noEmit && echo "tsc: 0 errors")

echo "ALL VERIFY STEPS PASSED"
