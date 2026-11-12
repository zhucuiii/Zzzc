#!/usr/bin/env bash
# Build and publish the signed Windows portable update.
# Usage: ./release.sh v2.3.0 "更新说明"
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$ROOT/dist/releases"
KEY_FILE="$ROOT/.secrets/update-key.txt"
REPO="zhucuiii/Zzzc"
FEED_URL="https://github.com/$REPO/releases/latest/download/desktop-update-v2.json"
VERSION="${1:-}"
NOTES="${2:-}"
UPLOAD=1
if (($#)); then shift; fi
if (($#)) && [[ "$1" != --* ]]; then NOTES="$1"; shift; fi

usage() {
    echo "用法: ./release.sh v2.3.0 \"更新说明\"" >&2
    echo "只构建、不发布: ./release.sh v2.3.0 \"更新说明\" --no-upload" >&2
}

while (($#)); do
    case "$1" in
        --no-upload) UPLOAD=0; shift ;;
        *) echo "未知参数: $1" >&2; usage; exit 2 ;;
    esac
done
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { usage; exit 2; }
[[ -f "$KEY_FILE" ]] || { echo "缺少本机签名密钥: $KEY_FILE（不会被提交）" >&2; exit 1; }

for tool in go bun node powershell git; do
    command -v "$tool" >/dev/null || { echo "缺少构建工具: $tool" >&2; exit 1; }
done
if ((UPLOAD)); then
    command -v gh >/dev/null || { echo "缺少 GitHub CLI: gh" >&2; exit 1; }
    gh auth status >/dev/null
    gh release view "$VERSION" --repo "$REPO" >/dev/null 2>&1 && {
        echo "$VERSION 已发布；为防止覆盖安装包，已停止。请使用新版本号。" >&2; exit 1;
    }
fi

# The key file remains local and is ignored by Git. Do not enable shell tracing.
set -a
# shellcheck disable=SC1090
source "$KEY_FILE"
set +a
: "${PUBLIC_KEY:?签名公钥为空}"
: "${PRIVATE_KEY:?签名私钥为空}"
export BEEFTV_UPDATER_PUBLIC_KEY="$PUBLIC_KEY"
export BEEFTV_UPDATER_PRIVATE_KEY="$PRIVATE_KEY"
export BEEFTV_UPDATER_FEED_URL="$FEED_URL"
export CGO_ENABLED=1
export GOROOT="${GOROOT:-C:/Users/Administrator/tools/go}"
export BEEFTV_NODE_RUNTIME="${BEEFTV_NODE_RUNTIME:-C:\\APP\\alma\\alma-server\\runtime}"
export PATH="/c/Users/Administrator/tools/msys64/msys64/ucrt64/bin:/c/Users/Administrator/tools/go/bin:/c/Users/Administrator/tools/bin:$PATH"

cd "$ROOT"
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo "工作区还有未提交改动。请先提交或暂存，确保安装包对应明确的源码提交。" >&2
    exit 1
fi
CURRENT_VERSION="$(tr -d '[:space:]' < VERSION)"
[[ "$CURRENT_VERSION" == "$VERSION" ]] || {
    echo "VERSION 文件是 $CURRENT_VERSION，参数是 $VERSION；请先更新 VERSION 并提交。" >&2
    exit 1;
}

if ((UPLOAD)); then
    CURRENT_BRANCH="$(git branch --show-current)"
    [[ "$CURRENT_BRANCH" == "main" ]] || { echo "请从 main 分支发布，当前为 $CURRENT_BRANCH。" >&2; exit 1; }
    [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
        echo "本地 main 与 origin/main 不一致；请先拉取或推送。" >&2; exit 1;
    }
fi

echo "=== 构建 $VERSION（commit $(git rev-parse --short HEAD)） ==="
powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT/scripts/build-beeftv-windows-release.ps1"

BIN_DIR="$ROOT/backend/cmd/desktop/build/bin"
EXE="$BIN_DIR/BeefTV.exe"
[[ -f "$EXE" ]] || { echo "构建完成但找不到 BeefTV.exe，停止发版。" >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"
ZIP="$OUTPUT_DIR/BeefTV-$VERSION-windows-amd64.zip"
MANIFEST="$OUTPUT_DIR/desktop-update-v2.json"
rm -f -- "$ZIP" "$MANIFEST"

echo "=== 打包并实际解包验收便携式 ZIP ==="
(cd "$ROOT/backend" && go run ./cmd/update-release package \
    -platform windows-amd64 -input "$BIN_DIR" -output "$ZIP")
VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/beeftv-release-verify.XXXXXX")"
trap 'rm -rf -- "$VERIFY_DIR"' EXIT
(cd "$ROOT/backend" && go run ./cmd/update-release verify-extract \
    -platform windows-amd64 -zip "$ZIP" -dest "$VERIFY_DIR/payload")
rm -rf -- "$VERIFY_DIR"
trap - EXIT

echo "=== 签名并生成更新清单 ==="
COMMIT="$(git rev-parse HEAD)"
(cd "$ROOT/backend" && go run ./cmd/update-release sign \
    -schema 2 \
    -version "$VERSION" \
    -commit "$COMMIT" \
    -asset "windows-amd64=$ZIP" \
    -download-base "https://github.com/$REPO/releases/download" \
    -notes "${NOTES:-Zzzc $VERSION 发布}" \
    -expect-public-key "$PUBLIC_KEY" \
    -output "$MANIFEST")

echo "=== 校验发布产物 ==="
(cd "$ROOT/backend" && go run ./cmd/update-release verify \
    -envelope "$MANIFEST" \
    -public-key-text "$PUBLIC_KEY")
node - "$MANIFEST" "$ZIP" "$VERSION" "$REPO" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [manifestPath, zipPath, version, repo] = process.argv.slice(2);
const envelope = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
const asset = payload.platforms?.['windows-amd64'];
if (payload.schema !== 2 || payload.version !== version || !asset) throw new Error('更新清单的版本或平台不匹配');
const urls = asset.urls?.length ? asset.urls : [asset.url];
const expected = `https://github.com/${repo}/releases/download/${version}/BeefTV-${version}-windows-amd64.zip`;
if (!urls.includes(expected)) throw new Error('更新清单的下载地址不是当前 Release');
const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
if (asset.sha256 !== digest || asset.size !== fs.statSync(zipPath).size) throw new Error('ZIP 的签名哈希或大小不匹配');
console.log(`签名与 ZIP 校验通过：${asset.size} bytes`);
NODE

if ((UPLOAD)); then
    echo "=== 上传至 GitHub Releases ==="
    git tag -a "$VERSION" -m "Zzzc $VERSION" "$COMMIT"
    git push origin main
    git push origin "$VERSION"
    gh release create "$VERSION" "$ZIP" "$MANIFEST" \
        --repo "$REPO" --title "Zzzc $VERSION" \
        --notes "${NOTES:-Zzzc $VERSION 发布}" --verify-tag
    echo "=== 发布完成 ==="
    gh release view "$VERSION" --repo "$REPO" --json url --jq .url
else
    echo "=== 本地构建完成，未上传 ==="
    echo "$ZIP"
    echo "$MANIFEST"
fi
