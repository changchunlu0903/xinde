# 谁是卧底 V8 Clean Start 从零重建版

你要从头重新建，按这个顺序：

## 1. 新建 Supabase 项目

Supabase 新建项目后，进入 SQL Editor。

运行：
database_full_start.sql

这个文件会一次性创建：
- rooms
- players
- votes
- speeches
- Realtime
- 原型版 RLS 权限

注意：database_full_start.sql 里有 drop table。
如果是全新项目没关系；如果旧项目有重要数据，不要直接跑。

## 2. 创建 Edge Function

Supabase 左侧进入 Edge Functions，不要进 SQL Editor。

创建函数名：
generate-words

把这个文件内容粘进去部署：
supabase/functions/generate-words/index.ts

## 3. AI Key 两种方式

方式 A：网页里填
进入游戏首页 AI 设置：
- AI API URL: https://api.openai.com/v1
- AI API Key: 你的 OpenAI API Key
- UID: 空着
- 当前模型: gpt-4o-mini

方式 B：Supabase Secrets
Edge Functions → Secrets 添加：
- AI_API_KEY
- AI_BASE_URL
- AI_MODEL

## 4. 前端部署

把下面三个文件上传 GitHub Pages：
- index.html
- style.css
- main.js

上传前必须先改 main.js 顶部：
SUPABASE_URL
SUPABASE_ANON_KEY

## 5. GitHub Pages

仓库上传文件后：
Settings → Pages → Deploy from a branch → main → /root → Save

等链接生成后打开测试。
