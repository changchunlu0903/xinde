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


## V9 更新

V9 主要修复：
- 手机网页里 Realtime 偶尔不刷新，需要手动刷新才能看到发言/投票/阶段变化。
- 增加 1.8 秒轻量自动同步兜底。
- 切回页面、切换房间分页、提交发言/讨论/投票后会立刻重新拉取数据。
- 数据库结构不变，不需要重新跑 SQL。


## V10 更新

修复手机版输入体验：
- 输入框聚焦后自动滚到屏幕中间，避免被键盘挡住。
- 使用 visualViewport 监听键盘高度，给页面底部自动补空间。
- 强制 input / textarea / select 字号 16px，避免 iOS 自动放大导致错位。
- 手机端顶部房间分页改成横向滚动，键盘弹出时不再挤压错位。
- 不需要重新跑 SQL。


## V11 更新

新增可移动悬浮窗：
- 玩家模式：像微信一样的全局聊天讨论，任意页面都能打开。
- 房主模式：房主可在悬浮窗里一键推进流程，不用反复切房主控制台。
- 悬浮窗可拖动，位置会记住。
- 聊天实时更新，未读消息显示红点。
- 数据库结构沿用 speeches.kind='discussion'，不需要重新跑 SQL。


## V12 更新：出题者规则修正

- 自己想词模式：房主就是出题者/出题主持。
- 出题者知道平民词和卧底词，所以系统会自动让房主不参与本局。
- 自己想词模式至少需要 3 个参与玩家 + 1 个出题主持。
- 如果房主也想参与游戏，请使用 AI 出词模式。
- 不需要重新跑 SQL。


## V13 更新：悬浮窗体验修复

- 用户上滑查看旧聊天时，不再自动跳回底部。
- 点击悬浮按钮时，如果按钮在屏幕下方，聊天窗会自动弹到按钮上方。
- 点击悬浮窗外的空白区域可以关闭。
- 房主打开悬浮窗默认进入“房主操控”，玩家默认进入“玩家聊天”。
- 不需要重新跑 SQL。
