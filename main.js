import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * 你需要改这里：
 * SUPABASE_URL：项目主页里的 https://xxxx.supabase.co
 * SUPABASE_ANON_KEY：API Keys 里的 anon / public / publishable key
 */
const SUPABASE_URL = "https://azourucdainmhhnyqfij.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_FPowOyAa13yaAH80UAwjnA_mYyOVA9m";

const isConfigured =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_ANON_KEY.includes("填你的");

const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);

const phaseMap = {
  waiting: "等待玩家",
  assigning: "查看身份",
  speaking: "发言阶段",
  discussing: "讨论阶段",
  voting: "投票阶段",
  result: "本轮结果",
  ended: "游戏结束",
};

const speakingModeMap = {
  ordered_text: "顺序文字",
  ordered_voice: "顺序语音",
  free_text: "自由文字",
  offline: "线下口头",
};

const defaultAiConfig = {
  aiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiUid: "",
  aiModel: "",
};

const defaultPrompts = {
  wordSystemPrompt: `你是“谁是卧底”游戏的专业出题主持人。
你只负责生成词语，不参与游戏。
你必须只返回 JSON，不要 Markdown，不要解释。`,
  wordUserPrompt: `请根据以下信息生成一组“谁是卧底”词语。

分类：{{category}}
难度：{{difficulty}}
玩家人数：{{playerCount}}
额外要求：{{requirement}}

要求：
1. 平民词和卧底词必须相似，但不能完全同义。
2. 两个词不能一眼看出谁是卧底。
3. 词语必须适合口头描述。
4. 不要生成敏感、政治、血腥、低俗内容。
5. 不要生成太抽象、太偏门、太难解释的词。
6. 最好是中文短词。

只返回 JSON：
{
  "civilianWord": "平民词",
  "undercoverWord": "卧底词",
  "category": "分类",
  "difficulty": "难度",
  "reason": "为什么这组词适合"
}`,
  hostPrompt: `你是“谁是卧底”的系统主持人。
语气清楚、轻松、有一点综艺感，但不要太吵。
你不能泄露任何身份，不能说出平民词或卧底词。
你只负责提醒当前流程、发言顺序、投票状态和结果。`,
};

let state = {
  room: null,
  players: [],
  votes: [],
  speeches: [],
  me: null,
  channel: null,
  pollTimer: null,
  loadingNow: false,
  wordVisible: false,
  recognition: null,
  recognizing: false,
  floatOpen: false,
  unreadDiscussion: 0,
  lastSeenDiscussionCount: 0,
};

const localKey = {
  roomId: "undercover_room_id",
  playerId: "undercover_player_id",
  prompts: "undercover_ai_prompts_v3",
  aiConfig: "undercover_ai_config_v4",
  floatPos: "undercover_float_pos_v11",
};

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => node.classList.add("hidden"), 2600);
}

function setBusy(button, busy, textWhenBusy = "处理中...") {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = textWhenBusy;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}

function clearRoomCache() {
  localStorage.removeItem(localKey.roomId);
  localStorage.removeItem(localKey.playerId);
}

function getPrompts() {
  try {
    return { ...defaultPrompts, ...JSON.parse(localStorage.getItem(localKey.prompts) || "{}") };
  } catch {
    return { ...defaultPrompts };
  }
}

function getAiConfig() {
  try {
    return { ...defaultAiConfig, ...JSON.parse(localStorage.getItem(localKey.aiConfig) || "{}") };
  } catch {
    return { ...defaultAiConfig };
  }
}

function fillAiInputs() {
  const c = getAiConfig();
  const pairs = [
    ["aiBaseUrl", c.aiBaseUrl],
    ["aiApiKey", c.aiApiKey],
    ["aiUid", c.aiUid],
    ["aiModel", c.aiModel],
    ["aiBaseUrlRoom", c.aiBaseUrl],
    ["aiApiKeyRoom", c.aiApiKey],
    ["aiUidRoom", c.aiUid],
    ["aiModelRoom", c.aiModel],
  ];
  for (const [id, value] of pairs) {
    if ($(id)) $(id).value = value || "";
  }
}

function readAiConfigFrom(suffix = "") {
  return {
    aiBaseUrl: $(`aiBaseUrl${suffix}`).value.trim().replace(/\/$/, ""),
    aiApiKey: $(`aiApiKey${suffix}`).value.trim(),
    aiUid: $(`aiUid${suffix}`).value.trim(),
    aiModel: $(`aiModel${suffix}`).value.trim(),
  };
}

function saveAiConfigFrom(suffix = "") {
  const config = readAiConfigFrom(suffix);
  localStorage.setItem(localKey.aiConfig, JSON.stringify(config));
  fillAiInputs();
  toast("AI 接入设置已保存。");
}

function fillModelSelect(suffix, models) {
  const select = $(`aiModelSelect${suffix}`);
  if (!select) return;

  select.innerHTML = `<option value="">选择一个模型</option>` + models
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");

  select.onchange = () => {
    if (select.value) {
      $(`aiModel${suffix}`).value = select.value;
      saveAiConfigFrom(suffix);
    }
  };
}

async function findModels(suffix = "") {
  if (!assertConfigured()) return;

  const config = readAiConfigFrom(suffix);
  localStorage.setItem(localKey.aiConfig, JSON.stringify(config));
  fillAiInputs();

  const btn = suffix ? $("btnFindModelsRoom") : $("btnFindModels");
  setBusy(btn, true, "寻找中...");

  try {
    const { data, error } = await sb.functions.invoke("generate-words", {
      body: {
        action: "list-models",
        aiBaseUrl: config.aiBaseUrl,
        aiApiKey: config.aiApiKey,
        aiUid: config.aiUid,
      },
    });

    if (error) throw new Error(error.message || "寻找模型失败。");
    if (data?.error) throw new Error(data.error);

    const models = data?.models || [];
    if (!models.length) throw new Error("没有找到模型。检查 URL 和 Key 是否正确。");

    fillModelSelect("", models);
    fillModelSelect("Room", models);

    if (!config.aiModel && models[0]) {
      const next = { ...config, aiModel: models[0] };
      localStorage.setItem(localKey.aiConfig, JSON.stringify(next));
      fillAiInputs();
    }

    toast(`找到 ${models.length} 个模型。`);
  } catch (err) {
    toast(err.message || "寻找模型失败。");
  } finally {
    setBusy(btn, false);
  }
}

function savePromptsFrom(prefix = "") {
  const suffix = prefix ? "Room" : "";
  const prompts = {
    wordSystemPrompt: $(`wordSystemPrompt${suffix}`).value,
    wordUserPrompt: $(`wordUserPrompt${suffix}`).value,
    hostPrompt: $(`hostPrompt${suffix}`).value,
  };
  localStorage.setItem(localKey.prompts, JSON.stringify(prompts));
  fillPromptTextareas();
  toast("提示词已保存。");
}

function resetPrompts() {
  localStorage.setItem(localKey.prompts, JSON.stringify(defaultPrompts));
  fillPromptTextareas();
  toast("已恢复默认提示词。");
}

function fillPromptTextareas() {
  const p = getPrompts();
  const pairs = [
    ["wordSystemPrompt", p.wordSystemPrompt],
    ["wordUserPrompt", p.wordUserPrompt],
    ["hostPrompt", p.hostPrompt],
    ["wordSystemPromptRoom", p.wordSystemPrompt],
    ["wordUserPromptRoom", p.wordUserPrompt],
    ["hostPromptRoom", p.hostPrompt],
  ];
  for (const [id, value] of pairs) {
    if ($(id)) $(id).value = value;
  }
}

async function forceHome(message = "已返回首页。") {
  unsubscribe();
  clearRoomCache();

  state.room = null;
  state.players = [];
  state.votes = [];
  state.speeches = [];
  state.me = null;
  state.channel = null;
  state.wordVisible = false;

  $("homeView").classList.add("active");
  $("roomView").classList.remove("active");
  $("btnBackHome").classList.add("hidden");
  $("btnCopyRoomTop").classList.add("hidden");
  if ($("floatDock")) $("floatDock").classList.add("hidden");
  state.floatOpen = false;

  const url = new URL(location.href);
  url.searchParams.delete("room");
  history.replaceState({}, "", url.toString());

  toast(message);
}

function showRoom() {
  $("homeView").classList.remove("active");
  $("roomView").classList.add("active");
  $("btnBackHome").classList.remove("hidden");
  $("btnCopyRoomTop").classList.remove("hidden");
}

function switchHomePanel(panel) {
  document.querySelectorAll("[data-home-panel]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.homePanel === panel);
  });
  $("homeCreatePanel").classList.toggle("active", panel === "create");
  $("homeJoinPanel").classList.toggle("active", panel === "join");
  $("homeAiPanel").classList.toggle("active", panel === "ai");
}

function switchRoomPage(page) {
  const isHost = !!state.me?.is_host;
  if (!isHost && ["host", "settings"].includes(page)) {
    page = "desk";
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  const map = {
    desk: "pageDesk",
    host: "pageHost",
    card: "pageCard",
    speak: "pageSpeak",
    discuss: "pageDiscuss",
    players: "pagePlayers",
    vote: "pageVote",
    settings: "pageSettings",
  };
  Object.values(map).forEach((id) => $(id).classList.remove("active"));
  $(map[page]).classList.add("active");
}

function randomRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function assertConfigured() {
  if (!isConfigured) {
    toast("先在 main.js 填 Supabase URL 和 anon key。");
    return false;
  }
  return true;
}

async function createRoom() {
  if (!assertConfigured()) return;

  const btn = $("btnCreateRoom");
  setBusy(btn, true, "创建中...");

  try {
    const nickname = $("createNickname").value.trim();
    if (!nickname) throw new Error("先填你的昵称。");

    const roomCode = randomRoomCode();
    const mode = $("createMode").value;
    // V12：自己想词时，房主就是出题者。出题者知道答案，不能参与本局。
    // 所以手动出题强制使用“房主主持/出题主持”。
    const moderatorMode = mode === "manual" ? "host" : $("createModeratorMode").value;

    const roomPayload = {
      room_code: roomCode,
      mode,
      moderator_mode: moderatorMode,
      speaking_mode: $("createSpeakingMode").value,
      current_speaker_index: 0,
      category: $("createCategory").value,
      difficulty: $("createDifficulty").value,
      requirement: $("createRequirement").value.trim(),
      blank_enabled: $("createBlankEnabled").checked,
      undercover_count: Number($("createUndercoverCount").value || 1),
      phase: "waiting",
      result_text: "",
      winner: null,
    };

    if (mode === "manual") {
      const civilianWord = $("manualCivilianWord").value.trim();
      const undercoverWord = $("manualUndercoverWord").value.trim();
      if (!civilianWord || !undercoverWord) {
        throw new Error("自己想词模式需要填写平民词和卧底词。");
      }
      roomPayload.civilian_word = civilianWord;
      roomPayload.undercover_word = undercoverWord;
    }

    const { data: room, error: roomErr } = await sb.from("rooms").insert(roomPayload).select().single();
    if (roomErr) throw roomErr;

    const { data: player, error: playerErr } = await sb
      .from("players")
      .insert({ room_id: room.id, nickname, is_host: true, is_alive: true, role: "civilian" })
      .select()
      .single();

    if (playerErr) throw playerErr;

    const { error: updateErr } = await sb.from("rooms").update({ host_player_id: player.id }).eq("id", room.id);
    if (updateErr) throw updateErr;

    await enterRoom(room.id, player.id);
    toast(`房间 ${roomCode} 创建好了。`);
  } catch (err) {
    toast(err.message || "创建失败。");
  } finally {
    setBusy(btn, false);
  }
}

async function joinRoom() {
  if (!assertConfigured()) return;

  const btn = $("btnJoinRoom");
  setBusy(btn, true, "加入中...");

  try {
    const nickname = $("joinNickname").value.trim();
    const code = normalizeCode($("joinRoomCode").value);

    if (!nickname) throw new Error("先填你的昵称。");
    if (code.length !== 6) throw new Error("房间码应该是 6 位数字。");

    const { data: room, error: roomErr } = await sb.from("rooms").select("*").eq("room_code", code).maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) throw new Error("没找到这个房间。");
    if (room.phase !== "waiting") throw new Error("这局已经开始了，暂时不能加入。");

    const { data: player, error: playerErr } = await sb
      .from("players")
      .insert({ room_id: room.id, nickname, is_host: false, is_alive: true, role: "civilian" })
      .select()
      .single();

    if (playerErr) throw playerErr;

    await enterRoom(room.id, player.id);
    toast("加入成功。");
  } catch (err) {
    toast(err.message || "加入失败。");
  } finally {
    setBusy(btn, false);
  }
}

async function enterRoom(roomId, playerId) {
  localStorage.setItem(localKey.roomId, roomId);
  localStorage.setItem(localKey.playerId, playerId);
  showRoom();
  await loadAll(roomId, playerId);
  subscribe(roomId, playerId);
}

async function loadAll(roomId = state.room?.id, playerId = state.me?.id, options = {}) {
  if (!sb || !roomId) return;
  if (state.loadingNow) return;
  state.loadingNow = true;

  try {
    const [roomRes, playersRes, speechesRes] = await Promise.all([
    sb.from("rooms").select("*").eq("id", roomId).maybeSingle(),
    sb.from("players").select("*").eq("room_id", roomId).order("joined_at", { ascending: true }),
    sb.from("speeches").select("*").eq("room_id", roomId).order("created_at", { ascending: true }),
  ]);

  if (roomRes.error) {
    toast(roomRes.error.message);
    return;
  }

  if (!roomRes.data) {
    await forceHome("房间不存在或已关闭，已返回首页。");
    return;
  }

  if (playersRes.error) {
    toast(playersRes.error.message);
    return;
  }

  if (speechesRes.error) {
    toast(speechesRes.error.message || "读取记录失败。你可能还没运行 database_v8_patch.sql。");
    return;
  }

  const room = roomRes.data;
  const players = playersRes.data || [];
  const me = players.find((p) => p.id === playerId);

  if (!me) {
    await forceHome("你已不在这个房间，已返回首页。");
    return;
  }

  const votesRes = await sb
    .from("votes")
    .select("*")
    .eq("room_id", roomId)
    .eq("round", room.current_round || 1);

  if (votesRes.error) {
    toast(votesRes.error.message);
    return;
  }

  state.room = room;
  state.players = players;
  state.votes = votesRes.data || [];
  state.speeches = speechesRes.data || [];
  state.me = me;

    render();
  } finally {
    state.loadingNow = false;
  }
}

function subscribe(roomId, playerId) {
  unsubscribe();

  state.channel = sb
    .channel(`room-${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, () => loadAll(roomId, playerId))
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => loadAll(roomId, playerId))
    .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${roomId}` }, () => loadAll(roomId, playerId))
    .on("postgres_changes", { event: "*", schema: "public", table: "speeches", filter: `room_id=eq.${roomId}` }, () => loadAll(roomId, playerId))
    .subscribe();

  // Realtime + 轮询兜底。手机浏览器切后台、网络波动、Pages 缓存时也能自动同步。
  startAutoSync(roomId, playerId);
}

function unsubscribe() {
  if (state.channel && sb) sb.removeChannel(state.channel);
  state.channel = null;
  stopAutoSync();
}

function stopAutoSync() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startAutoSync(roomId, playerId) {
  stopAutoSync();

  // 双保险：Realtime 有时在手机浏览器 / GitHub Pages / 后台切换后会断，
  // 所以这里加一个轻量轮询。这样别人发言、投票、进入讨论后，不刷新也会同步。
  state.pollTimer = setInterval(() => {
    if (!roomId || !playerId) return;
    if (document.hidden) return;
    loadAll(roomId, playerId, { silent: true });
  }, 1800);
}

function aliveContestants() {
  return state.players.filter((p) => p.is_alive && !p.is_moderator);
}

function currentSpeaker() {
  const alive = aliveContestants();
  if (!alive.length) return null;
  const idx = Math.max(0, Math.min(Number(state.room?.current_speaker_index || 0), alive.length - 1));
  return alive[idx] || alive[0];
}

function getBroadcast(room, players, votes) {
  const alive = players.filter((p) => p.is_alive && !p.is_moderator);
  const aliveNames = alive.map((p) => p.nickname).join("、") || "暂无";
  const speaker = currentSpeaker();
  const voteNames = votes.map((v) => players.find((p) => p.id === v.voter_id)?.nickname).filter(Boolean);

  const map = {
    waiting: {
      title: "系统主持 · 等待开局",
      text: `当前已有 ${players.length} 人加入。\n房主确认设置后，点击“开始并发词”。`,
    },
    assigning: {
      title: "系统主持 · 身份确认",
      text: room.mode === "manual"
        ? `身份牌已发放。房主是出题主持，不参与本局。其他玩家进入“身份”页查看自己的词。\n看完后房主点击“开始发言”。`
        : `身份牌已发放。请所有玩家进入“身份”页查看自己的词。\n看完后房主点击“开始发言”。`,
    },
    speaking: {
      title: "系统主持 · 发言阶段",
      text: `第 ${room.current_round || 1} 轮发言开始。\n发言模式：${speakingModeMap[room.speaking_mode] || "顺序文字"}。\n当前发言人：${speaker?.nickname || "暂无"}。\n存活玩家：${aliveNames}。`,
    },
    discussing: {
      title: "系统主持 · 公开讨论",
      text: `现在进入公开讨论阶段。\n所有存活玩家都可以在“讨论”页发消息，所有人都能看到。讨论结束后房主开始投票。`,
    },
    voting: {
      title: "系统主持 · 投票阶段",
      text: `请进入“投票”页投出你怀疑的人。\n已投票：${voteNames.length ? voteNames.join("、") : "暂无"}。`,
    },
    result: {
      title: "系统主持 · 本轮结果",
      text: room.result_text || "本轮结果已生成。若游戏未结束，房主可以点击下一轮。",
    },
    ended: {
      title: "系统主持 · 游戏结束",
      text: `${winnerName(room.winner)}。\n${room.result_text || ""}\n答案已公开，可以复盘谁最会演。`,
    },
  };

  return map[room.phase] || map.waiting;
}

function render() {
  const { room, players, me, votes } = state;
  if (!room || !me) return;

  $("roomCodeText").textContent = room.room_code;
  $("phaseText").textContent = phaseMap[room.phase] || room.phase;
  $("roundPill").textContent = `第 ${room.current_round || 1} 轮`;
  $("playerCountPill").textContent = `${players.length} 人`;
  $("myStatusPill").textContent = me.is_host ? "房主" : me.is_moderator ? "主持人" : "玩家";

  const broadcast = getBroadcast(room, players, votes);
  $("broadcastTitle").textContent = broadcast.title;
  $("broadcastText").textContent = broadcast.text;

  $("hostPanel").classList.toggle("hidden", !me.is_host);
  document.querySelectorAll(".host-only").forEach((el) => el.classList.toggle("hidden", !me.is_host));

  renderHostControls();
  renderMyCard();
  renderPlayers();
  renderHostManage();
  renderSpeechPage();
  renderDiscussionPage();
  renderVotePanel();
  renderResultPanel();
  renderFlow();
  updateHostButtons();
  renderFloatDock();
}

function renderFlow() {
  const phase = state.room?.phase;
  document.querySelectorAll(".flow-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.phaseName === phase);
  });
}

function renderHostControls() {
  const { room, players } = state;
  if (!room || !state.me?.is_host) return;

  $("roomMode").value = room.mode || "manual";
  $("roomModeratorMode").value = room.moderator_mode || "system";
  $("roomSpeakingMode").value = room.speaking_mode || "ordered_text";
  $("roomCategory").value = room.category || "";
  $("roomDifficulty").value = room.difficulty || "中等";
  $("roomUndercoverCount").value = room.undercover_count || 1;
  $("roomBlankEnabled").checked = !!room.blank_enabled;
  $("roomRequirement").value = room.requirement || "";
  $("roomManualCivilianWord").value = room.civilian_word || "";
  $("roomManualUndercoverWord").value = room.undercover_word || "";

  syncRoomQuestionMasterUI();

  const sel = $("roomModeratorSelect");
  sel.innerHTML = players
    .map((p) => `<option value="${p.id}" ${room.moderator_player_id === p.id ? "selected" : ""}>${escapeHtml(p.nickname)}</option>`)
    .join("");

  syncRoomQuestionMasterUI();
  $("preStartControls").classList.toggle("hidden", room.phase !== "waiting");
}

function renderMyCard() {
  const { room, me } = state;
  const locked = !state.wordVisible;

  $("myCard").classList.toggle("locked", locked);
  $("moderatorWords").classList.toggle("hidden", !me.is_moderator);
  $("modCivilianWord").textContent = room.civilian_word || "-";
  $("modUndercoverWord").textContent = room.undercover_word || "-";

  if (room.phase === "waiting") {
    $("myRoleText").textContent = "等待开始";
    $("myWordText").textContent = "未发词";
    $("myCardTip").textContent = "等房主点击开始。";
    return;
  }

  if (locked) {
    $("myRoleText").textContent = "身份已生成";
    $("myWordText").textContent = "点击查看";
    $("myCardTip").textContent = "别人靠近时别点。";
    return;
  }

  if (me.is_moderator) {
    $("myRoleText").textContent = room.mode === "manual" && me.is_host ? "出题主持" : "主持人";
    $("myWordText").textContent = "不参与本局";
    $("myCardTip").textContent = room.mode === "manual" && me.is_host
      ? "你是出题者，知道答案，所以不参与猜词。"
      : "你可以查看两组词，负责控场。";
    return;
  }

  if (me.role === "blank") {
    $("myRoleText").textContent = "白板";
    $("myWordText").textContent = "没有词";
    $("myCardTip").textContent = "你要靠别人发言猜词。";
  } else {
    $("myRoleText").textContent = "你的词";
    $("myWordText").textContent = me.word || "未分配";
    $("myCardTip").textContent = me.role === "undercover" ? "保持镇定，别被抓。" : "描述它，但别直接说出来。";
  }
}

function playerBadges(p, room = state.room) {
  const badges = [];
  if (p.is_host) badges.push(`<span class="badge host">房主</span>`);
  if (p.is_moderator) badges.push(`<span class="badge">主持</span>`);
  if (!p.is_alive && !p.is_moderator) badges.push(`<span class="badge dead">出局</span>`);
  if (room.phase === "ended" || room.winner) badges.push(`<span class="badge">${roleName(p.role)}</span>`);
  return badges.join("");
}

function renderPlayers() {
  const { players } = state;
  $("playersList").innerHTML = players.map((p, index) => `
    <div class="item ${!p.is_alive && !p.is_moderator ? "dead" : ""}">
      <div class="player-left">
        <div class="avatar">${escapeHtml(p.nickname.slice(0, 1))}</div>
        <div>
          <div class="name">${escapeHtml(p.nickname)}</div>
          <div class="meta">玩家席 #${index + 1}</div>
        </div>
      </div>
      <div class="badges">${playerBadges(p)}</div>
    </div>
  `).join("");
}

function renderHostManage() {
  if (!state.me?.is_host) return;

  $("hostManageList").innerHTML = state.players.map((p) => {
    const isMe = p.id === state.me.id;
    return `
      <div class="item ${!p.is_alive && !p.is_moderator ? "dead" : ""}">
        <div class="player-left">
          <div class="avatar">${escapeHtml(p.nickname.slice(0, 1))}</div>
          <div>
            <div class="name">${escapeHtml(p.nickname)}</div>
            <div class="meta">${isMe ? "这是你" : "可管理玩家"}</div>
          </div>
        </div>
        <div class="item-actions">
          ${!isMe ? `<button class="small-btn" data-transfer="${p.id}">转让房主</button>` : ""}
          ${!isMe ? `<button class="small-btn danger-small" data-kick="${p.id}">踢人</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-transfer]").forEach((btn) => {
    btn.addEventListener("click", () => transferHost(btn.dataset.transfer));
  });

  document.querySelectorAll("[data-kick]").forEach((btn) => {
    btn.addEventListener("click", () => kickPlayer(btn.dataset.kick));
  });
}

function renderSpeechPage() {
  const { room, me, speeches } = state;
  const mode = room.speaking_mode || "ordered_text";
  const speaker = currentSpeaker();
  const currentRound = Number(room.current_round || 1);
  const currentRoundSpeeches = speeches.filter((s) => Number(s.round) === currentRound && (s.kind || "speech") === "speech");
  const isMyTurn = speaker?.id === me.id;
  const canSpeakNow =
    room.phase === "speaking" &&
    me.is_alive &&
    !me.is_moderator &&
    (mode === "free_text" || isMyTurn);

  $("speakingModePill").textContent = speakingModeMap[mode] || "文字发言";
  $("currentSpeakerName").textContent =
    room.phase === "speaking"
      ? mode === "free_text"
        ? "自由发言"
        : speaker?.nickname || "暂无"
      : "未到发言阶段";

  $("speakerHint").textContent = getSpeakerHint(mode, isMyTurn);
  $("currentSpeechCount").textContent = `${currentRoundSpeeches.length} 条`;

  $("speechInput").disabled = !canSpeakNow;
  $("btnSubmitSpeech").disabled = !canSpeakNow || mode === "offline";
  $("btnVoiceInput").disabled = !canSpeakNow || !["ordered_voice", "free_text"].includes(mode);
  $("btnSkipSpeech").disabled = room.phase !== "speaking" || !(me.is_host || isMyTurn);

  $("speechInputBox").classList.toggle("hidden", mode === "offline" && !state.me?.is_host);

  $("currentRoundSpeeches").innerHTML = currentRoundSpeeches.length
    ? currentRoundSpeeches.map(renderSpeechEntry).join("")
    : `<p class="sub">本轮还没有发言记录。</p>`;

  $("roundSummaries").innerHTML = renderRoundSummaries();
}

function renderDiscussionPage() {
  const { room, me, speeches } = state;
  const currentRound = Number(room.current_round || 1);
  const discussions = speeches.filter((s) => Number(s.round) === currentRound && s.kind === "discussion");

  $("discussionCountPill").textContent = `${discussions.length} 条`;
  $("discussionInput").disabled = !(room.phase === "discussing" && me.is_alive && !me.is_moderator);
  $("btnSendDiscussion").disabled = $("discussionInput").disabled;

  $("discussionList").innerHTML = discussions.length
    ? discussions.map(renderDiscussionEntry).join("")
    : `<p class="sub">本轮还没有讨论消息。进入讨论阶段后，大家发的消息都会显示在这里。</p>`;
}

function getSpeakerHint(mode, isMyTurn) {
  if (state.room.phase !== "speaking") return "房主开始发言后，这里会显示发言操作。";
  if (mode === "offline") return "线下口头发言模式不会记录文字，房主可手动点击跳过 / 下一个。";
  if (mode === "free_text") return "自由发言模式，存活玩家都可以提交发言。";
  if (isMyTurn) return "轮到你了，可以打字，也可以用语音转文字后提交。";
  return "还没轮到你。可以看本轮其他人的发言记录。";
}

function renderSpeechEntry(speech) {
  const p = state.players.find((x) => x.id === speech.player_id);
  const dead = p && !p.is_alive && !p.is_moderator;
  return `
    <div class="item speech-entry ${dead ? "dead" : ""}">
      <div class="speech-left">
        <div class="avatar">${escapeHtml((p?.nickname || "?").slice(0, 1))}</div>
        <div>
          <div class="name">${escapeHtml(p?.nickname || "未知玩家")}</div>
          <div class="meta">第 ${speech.round} 轮发言${dead ? " · 已出局" : ""}</div>
        </div>
      </div>
      <div class="speech-content">${escapeHtml(speech.content || "（无内容）")}</div>
    </div>
  `;
}

function renderDiscussionEntry(msg) {
  const p = state.players.find((x) => x.id === msg.player_id);
  const dead = p && !p.is_alive && !p.is_moderator;
  const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return `
    <div class="discussion-message ${dead ? "dead" : ""}">
      <div class="discussion-left">
        <div class="avatar">${escapeHtml((p?.nickname || "?").slice(0, 1))}</div>
        <div>
          <div class="name">${escapeHtml(p?.nickname || "未知玩家")}</div>
          <div class="meta">${time}${dead ? " · 已出局" : ""}</div>
        </div>
      </div>
      <div class="discussion-content">${escapeHtml(msg.content || "（空消息）")}</div>
    </div>
  `;
}

function renderRoundSummaries() {
  const speechOnly = state.speeches.filter((s) => (s.kind || "speech") === "speech");
  const rounds = [...new Set(speechOnly.map((s) => Number(s.round)))].sort((a, b) => a - b);
  if (!rounds.length) return `<p class="sub">还没有可以总结的发言。</p>`;

  return rounds.map((round) => {
    const list = speechOnly.filter((s) => Number(s.round) === round);
    const playersAtLeast = state.players.filter((p) => !p.is_moderator);
    const rows = playersAtLeast.map((p) => {
      const spoken = list.filter((s) => s.player_id === p.id).map((s) => s.content).join("\n");
      const dead = !p.is_alive;
      return `
        <div class="summary-player ${dead ? "dead" : ""}">
          <b>${escapeHtml(p.nickname)}${dead ? "（已出局）" : ""}</b>
          <p>${escapeHtml(spoken || "本轮未记录发言。")}</p>
        </div>
      `;
    }).join("");

    return `
      <div class="summary-card">
        <h4>第 ${round} 轮发言总结</h4>
        ${rows}
      </div>
    `;
  }).join("");
}

function renderVotePanel() {
  const { room, players, votes, me } = state;
  $("voteCountPill").textContent = `${votes.length} 票`;

  if (room.phase !== "voting") {
    $("voteList").innerHTML = `<p class="sub">还没进入投票阶段。</p>`;
    return;
  }

  if (!me.is_alive || me.is_moderator) {
    $("voteList").innerHTML = `<p class="sub">你不在本轮投票内。</p>`;
    return;
  }

  const alivePlayers = players.filter((p) => p.is_alive && !p.is_moderator && p.id !== me.id);
  const myVote = votes.find((v) => v.voter_id === me.id);

  $("voteList").innerHTML = alivePlayers.map((p) => `
    <div class="item">
      <div class="vote-left">
        <div class="avatar">${escapeHtml(p.nickname.slice(0, 1))}</div>
        <div>
          <div class="name">${escapeHtml(p.nickname)}</div>
          <div class="meta">${myVote?.target_id === p.id ? "你当前投给了 TA" : "可投票"}</div>
        </div>
      </div>
      <button class="normal-btn" data-vote="${p.id}">${myVote?.target_id === p.id ? "已投" : "投票"}</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", () => submitVote(btn.dataset.vote));
  });
}

function renderResultPanel() {
  const { room, players } = state;
  const show = room.phase === "result" || room.phase === "ended" || !!room.winner;
  $("resultPanel").classList.toggle("hidden", !show);
  if (!show) return;

  $("winnerPill").textContent = room.winner ? winnerName(room.winner) : "RESULT";
  $("resultText").textContent = room.result_text || "暂无结果。";

  const reveal = $("revealBox");
  const shouldReveal = room.phase === "ended" || !!room.winner;
  reveal.classList.toggle("hidden", !shouldReveal);

  if (shouldReveal) {
    reveal.innerHTML = `
      <b>答案公开</b>
      <p>平民词：${escapeHtml(room.civilian_word || "-")}</p>
      <p>卧底词：${escapeHtml(room.undercover_word || "-")}</p>
      <p>卧底：${escapeHtml(players.filter((p) => p.role === "undercover").map((p) => p.nickname).join("、") || "无")}</p>
      <p>白板：${escapeHtml(players.filter((p) => p.role === "blank").map((p) => p.nickname).join("、") || "无")}</p>
    `;
  }
}

function updateHostButtons() {
  const { room, me } = state;
  if (!room || !me?.is_host) return;

  $("btnStartGame").disabled = room.phase !== "waiting";
  $("btnStartSpeaking").disabled = room.phase !== "assigning" && room.phase !== "result";
  $("btnStartDiscussing").disabled = room.phase !== "speaking";
  $("btnStartVoting").disabled = room.phase !== "discussing" && room.phase !== "speaking";
  $("btnResolveVote").disabled = room.phase !== "voting";
  $("btnNextRound").disabled = room.phase !== "result" || !!room.winner;
  $("btnResetRoom").disabled = false;
}

function roleName(role) {
  return { civilian: "平民", undercover: "卧底", blank: "白板", moderator: "主持" }[role] || "玩家";
}

function winnerName(winner) {
  return { civilian: "平民胜利", undercover: "卧底胜利", blank: "白板胜利" }[winner] || "游戏结束";
}

async function syncRoomSettingsFromHostPanel() {
  const mode = $("roomMode").value;
  const moderatorMode = mode === "manual" ? "host" : $("roomModeratorMode").value;
  const payload = {
    mode,
    moderator_mode: moderatorMode,
    speaking_mode: $("roomSpeakingMode").value,
    current_speaker_index: 0,
    category: $("roomCategory").value.trim() || "日常",
    difficulty: $("roomDifficulty").value,
    undercover_count: Number($("roomUndercoverCount").value || 1),
    blank_enabled: $("roomBlankEnabled").checked,
    requirement: $("roomRequirement").value.trim(),
    moderator_player_id: moderatorMode === "select" ? $("roomModeratorSelect").value : null,
  };

  if (mode === "manual") {
    const civilianWord = $("roomManualCivilianWord").value.trim();
    const undercoverWord = $("roomManualUndercoverWord").value.trim();
    if (!civilianWord || !undercoverWord) throw new Error("自己想词模式要填平民词和卧底词。");
    payload.civilian_word = civilianWord;
    payload.undercover_word = undercoverWord;
  }

  const { error } = await sb.from("rooms").update(payload).eq("id", state.room.id);
  if (error) throw error;
  await loadAll();
}

async function getAiWords(room, playerCount) {
  const prompts = getPrompts();
  const aiConfig = getAiConfig();

  const { data, error } = await sb.functions.invoke("generate-words", {
    body: {
      category: room.category || "日常",
      difficulty: room.difficulty || "中等",
      requirement: room.requirement || "",
      playerCount,
      wordSystemPrompt: prompts.wordSystemPrompt,
      wordUserPrompt: prompts.wordUserPrompt,
      aiBaseUrl: aiConfig.aiBaseUrl,
      aiApiKey: aiConfig.aiApiKey,
      aiUid: aiConfig.aiUid,
      aiModel: aiConfig.aiModel,
    },
  });

  if (error) throw new Error(error.message || "AI 出词失败。你可能还没部署 generate-words Edge Function。");

  const civilianWord = data?.civilianWord || data?.civilian_word;
  const undercoverWord = data?.undercoverWord || data?.undercover_word;

  if (!civilianWord || !undercoverWord) throw new Error("AI 没有返回可用的平民词/卧底词。");

  return {
    civilianWord: String(civilianWord).trim(),
    undercoverWord: String(undercoverWord).trim(),
  };
}

async function startGame() {
  const btn = $("btnStartGame");
  setBusy(btn, true, "发词中...");

  try {
    await syncRoomSettingsFromHostPanel();

    let room = state.room;
    let players = [...state.players];

    if (players.length < 3) throw new Error("建议至少 3 人开始。");

    let moderatorId = null;

    // V12：自己想词时，房主就是出题者，必须作为主持/旁观，不参与猜词。
    // 如果房主也想玩，应该使用 AI 出词，因为 AI 出词没有玩家提前知道答案。
    if (room.mode === "manual") {
      moderatorId = room.host_player_id;
    } else if (room.moderator_mode === "host") {
      moderatorId = room.host_player_id;
    } else if (room.moderator_mode === "select") {
      moderatorId = room.moderator_player_id;
    } else if (room.moderator_mode === "random") {
      moderatorId = shuffle(players)[0]?.id || null;
    }

    let words = { civilianWord: room.civilian_word, undercoverWord: room.undercover_word };
    if (room.mode === "ai") words = await getAiWords(room, players.length);

    if (!words.civilianWord || !words.undercoverWord) throw new Error("还没有平民词和卧底词。");

    const contestants = players.filter((p) => p.id !== moderatorId);
    if (contestants.length < 3) {
      if (room.mode === "manual") {
        throw new Error("自己想词模式里，房主是出题主持，不能参与。本局至少需要 3 个参与玩家 + 1 个出题主持。");
      }
      throw new Error("主持人不参与时，至少还需要 3 个玩家。");
    }

    const undercoverCount = Math.max(1, Math.min(Number(room.undercover_count || 1), Math.max(1, contestants.length - 1)));
    const shuffled = shuffle(contestants);
    const blankId = room.blank_enabled && shuffled.length > undercoverCount + 1 ? shuffled[0].id : null;
    const availableForUndercover = shuffled.filter((p) => p.id !== blankId);
    const undercoverIds = new Set(availableForUndercover.slice(0, undercoverCount).map((p) => p.id));

    const updates = players.map((p) => {
      let role = "civilian";
      let word = words.civilianWord;
      let isModerator = false;
      let isAlive = true;

      if (p.id === moderatorId) {
        role = "moderator";
        word = null;
        isModerator = true;
        isAlive = false;
      } else if (p.id === blankId) {
        role = "blank";
        word = "";
      } else if (undercoverIds.has(p.id)) {
        role = "undercover";
        word = words.undercoverWord;
      }

      return sb.from("players").update({ role, word, is_moderator: isModerator, is_alive: isAlive }).eq("id", p.id);
    });

    const results = await Promise.all(updates);
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) throw firstErr;

    await sb.from("votes").delete().eq("room_id", room.id);
    await sb.from("speeches").delete().eq("room_id", room.id);

    const { error: roomErr } = await sb
      .from("rooms")
      .update({
        civilian_word: words.civilianWord,
        undercover_word: words.undercoverWord,
        moderator_player_id: moderatorId,
        current_round: 1,
        current_speaker_index: 0,
        phase: "assigning",
        result_text: "",
        winner: null,
        last_eliminated_player_id: null,
      })
      .eq("id", room.id);

    if (roomErr) throw roomErr;

    state.wordVisible = false;
    switchRoomPage("card");
    toast("身份和词已经发好了。");
    await loadAll();
  } catch (err) {
    toast(err.message || "开始失败。");
  } finally {
    setBusy(btn, false);
  }
}

async function setPhase(phase) {
  const patch = { phase };
  if (phase === "speaking") patch.current_speaker_index = 0;

  const { error } = await sb.from("rooms").update(patch).eq("id", state.room.id);
  if (error) {
    toast(error.message);
    return;
  }
  if (phase === "voting") switchRoomPage("vote");
  if (phase === "speaking") switchRoomPage("speak");
  if (phase === "discussing") switchRoomPage("discuss");
  toast(`已进入：${phaseMap[phase] || phase}`);
}

async function submitSpeech() {
  const { room, me } = state;
  const content = $("speechInput").value.trim();

  if (!content) {
    toast("先写点发言内容。");
    return;
  }

  if (room.phase !== "speaking") {
    toast("现在不是发言阶段。");
    return;
  }

  const mode = room.speaking_mode || "ordered_text";
  const speaker = currentSpeaker();
  const isMyTurn = speaker?.id === me.id;

  if (!me.is_alive || me.is_moderator) {
    toast("你不在本轮发言内。");
    return;
  }

  if (mode !== "free_text" && !isMyTurn) {
    toast("还没轮到你发言。");
    return;
  }

  const { error } = await sb.from("speeches").insert({
    room_id: room.id,
    player_id: me.id,
    round: room.current_round || 1,
    kind: "speech",
    content,
  });

  if (error) {
    toast(error.message);
    return;
  }

  $("speechInput").value = "";

  if (mode !== "free_text") {
    await nextSpeaker();
  }

  await loadAll(room.id, me.id, { silent: true });
  toast("发言已提交。");
}

async function sendDiscussion() {
  const { room, me } = state;
  const content = $("discussionInput").value.trim();

  if (!content) {
    toast("先写讨论内容。");
    return;
  }

  if (room.phase !== "discussing") {
    toast("现在不是讨论阶段。");
    return;
  }

  if (!me.is_alive || me.is_moderator) {
    toast("你不在本轮讨论内。");
    return;
  }

  const { error } = await sb.from("speeches").insert({
    room_id: room.id,
    player_id: me.id,
    round: room.current_round || 1,
    kind: "discussion",
    content,
  });

  if (error) {
    toast(error.message);
    return;
  }

  $("discussionInput").value = "";
  await loadAll(room.id, me.id, { silent: true });
  toast("讨论已发送，所有玩家都能看到。");
}

async function nextSpeaker() {
  const alive = aliveContestants();
  if (!alive.length) return;

  const current = Number(state.room.current_speaker_index || 0);
  const next = Math.min(current + 1, alive.length - 1);

  const { error } = await sb.from("rooms").update({ current_speaker_index: next }).eq("id", state.room.id);
  if (error) toast(error.message);
}

async function skipSpeech() {
  if (state.room.phase !== "speaking") return;
  const speaker = currentSpeaker();
  if (!state.me.is_host && speaker?.id !== state.me.id) {
    toast("只有当前发言人或房主可以跳到下一个。");
    return;
  }
  await nextSpeaker();
}

async function submitVote(targetId) {
  const { room, me } = state;
  if (!room || !me) return;

  if (!me.is_alive || me.is_moderator) {
    toast("你不在本轮投票内。");
    return;
  }

  const { error } = await sb.from("votes").upsert(
    { room_id: room.id, voter_id: me.id, target_id: targetId, round: room.current_round || 1 },
    { onConflict: "room_id,voter_id,round" }
  );

  if (error) toast(error.message);
  else {
    toast("投票成功。");
    await loadAll(room.id, me.id, { silent: true });
  }
}

async function resolveVote() {
  const btn = $("btnResolveVote");
  setBusy(btn, true, "统计中...");

  try {
    const { room, players, votes } = state;
    const alivePlayers = players.filter((p) => p.is_alive && !p.is_moderator);

    if (votes.length === 0) throw new Error("还没有人投票。");

    const counts = {};
    votes.forEach((v) => {
      counts[v.target_id] = (counts[v.target_id] || 0) + 1;
    });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topVotes = entries[0]?.[1] || 0;
    const topTargets = entries.filter(([, count]) => count === topVotes);

    let resultText = "";
    let winner = null;
    let eliminatedId = null;

    if (topTargets.length > 1) {
      resultText = `本轮最高票平票：${topTargets.map(([id]) => players.find((p) => p.id === id)?.nickname || "未知玩家").join("、")}。\n本轮无人出局，继续下一轮。`;
    } else {
      eliminatedId = topTargets[0][0];
      const eliminated = players.find((p) => p.id === eliminatedId);

      const { error: elimErr } = await sb.from("players").update({ is_alive: false }).eq("id", eliminatedId);
      if (elimErr) throw elimErr;

      resultText = `${eliminated?.nickname || "某位玩家"} 被投票出局。TA 的身份暂时不公开。`;

      const afterAlive = alivePlayers.filter((p) => p.id !== eliminatedId);
      const aliveUndercover = afterAlive.filter((p) => p.role === "undercover").length;
      const aliveCivilian = afterAlive.filter((p) => p.role === "civilian").length;

      if (aliveUndercover <= 0) {
        winner = "civilian";
        resultText += `\n卧底已全部出局，平民胜利。`;
      } else if (aliveUndercover >= aliveCivilian) {
        winner = "undercover";
        resultText += `\n卧底人数已经形成优势，卧底胜利。`;
      } else {
        resultText += `\n游戏还没结束。`;
      }
    }

    const { error: roomErr } = await sb
      .from("rooms")
      .update({ phase: winner ? "ended" : "result", result_text: resultText, winner, last_eliminated_player_id: eliminatedId })
      .eq("id", room.id);

    if (roomErr) throw roomErr;

    switchRoomPage("desk");
    toast("投票统计完成。");
  } catch (err) {
    toast(err.message || "统计失败。");
  } finally {
    setBusy(btn, false);
  }
}

async function nextRound() {
  const { room } = state;
  const next = Number(room.current_round || 1) + 1;
  const { error } = await sb
    .from("rooms")
    .update({ current_round: next, current_speaker_index: 0, phase: "speaking", result_text: "", last_eliminated_player_id: null })
    .eq("id", room.id);

  if (error) toast(error.message);
  else {
    switchRoomPage("speak");
    toast(`进入第 ${next} 轮。`);
  }
}

async function resetRoom() {
  const ok = confirm("确定重开吗？玩家会保留，但身份、词语、投票、发言和讨论记录会清空。");
  if (!ok) return;

  const { room, players } = state;
  await sb.from("votes").delete().eq("room_id", room.id);
  await sb.from("speeches").delete().eq("room_id", room.id);

  await Promise.all(players.map((p) =>
    sb.from("players").update({ role: "civilian", word: null, is_alive: true, is_moderator: false }).eq("id", p.id)
  ));

  const { error } = await sb
    .from("rooms")
    .update({
      phase: "waiting",
      current_round: 1,
      current_speaker_index: 0,
      civilian_word: null,
      undercover_word: null,
      moderator_player_id: null,
      result_text: "",
      winner: null,
      last_eliminated_player_id: null,
    })
    .eq("id", room.id);

  if (error) toast(error.message);
  else {
    state.wordVisible = false;
    switchRoomPage("host");
    toast("已重开。");
  }
}

async function transferHost(targetId) {
  if (!state.me?.is_host) return;
  const target = state.players.find((p) => p.id === targetId);
  if (!target) return;

  const ok = confirm(`确定把房主转让给 ${target.nickname} 吗？`);
  if (!ok) return;

  const results = await Promise.all([
    sb.from("players").update({ is_host: false }).eq("id", state.me.id),
    sb.from("players").update({ is_host: true }).eq("id", targetId),
    sb.from("rooms").update({ host_player_id: targetId }).eq("id", state.room.id),
  ]);

  const err = results.find((r) => r.error)?.error;
  if (err) toast(err.message);
  else toast("房主已转让。");
}

async function kickPlayer(targetId) {
  if (!state.me?.is_host) return;
  const target = state.players.find((p) => p.id === targetId);
  if (!target) return;

  const ok = confirm(`确定把 ${target.nickname} 踢出房间吗？`);
  if (!ok) return;

  const { error } = await sb.from("players").delete().eq("id", targetId);
  if (error) toast(error.message);
  else toast("已踢出玩家。");
}

async function leaveRoom() {
  const { room, players, me } = state;
  clearRoomCache();

  if (!room || !me || !sb) {
    await forceHome("已返回首页。");
    return;
  }

  const ok = confirm("确定退出并返回首页吗？");
  if (!ok) {
    localStorage.setItem(localKey.roomId, room.id);
    localStorage.setItem(localKey.playerId, me.id);
    return;
  }

  try {
    const others = players.filter((p) => p.id !== me.id);

    if (me.is_host && others.length > 0) {
      const nextHost = others[0];
      await sb.from("players").update({ is_host: true }).eq("id", nextHost.id);
      await sb.from("rooms").update({ host_player_id: nextHost.id }).eq("id", room.id);
    }

    if (me.is_host && others.length === 0) {
      await sb.from("rooms").delete().eq("id", room.id);
    } else {
      await sb.from("players").delete().eq("id", me.id);
    }
  } catch (err) {
    console.warn(err);
  }

  await forceHome("已退出房间并返回首页。");
}

async function copyInvite() {
  const code = state.room?.room_code;
  if (!code) return;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  const text = `来玩谁是卧底，房间码：${code}\n${url}`;

  try {
    await navigator.clipboard.writeText(text);
    toast("邀请信息已复制。");
  } catch {
    toast(`房间码：${code}`);
  }
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast("这个浏览器不支持语音识别，请直接打字。");
    return;
  }

  if (state.recognizing && state.recognition) {
    state.recognition.stop();
    return;
  }

  const recognition = new SpeechRecognition();
  state.recognition = recognition;
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    state.recognizing = true;
    $("voiceStatus").textContent = "正在听你说话……说完后会自动填到输入框。";
    $("btnVoiceInput").textContent = "停止识别";
  };

  recognition.onresult = (event) => {
    let finalText = "";
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += text;
      else interim += text;
    }

    const current = $("speechInput").value.trim();
    const next = [current, finalText || interim].filter(Boolean).join(current ? "\n" : "");
    $("speechInput").value = next;
  };

  recognition.onerror = () => {
    toast("语音识别失败，可以直接打字。");
  };

  recognition.onend = () => {
    state.recognizing = false;
    $("voiceStatus").textContent = "语音识别已结束，可以确认后提交。";
    $("btnVoiceInput").textContent = "语音转文字";
  };

  recognition.start();
}


function setupMobileKeyboardFix() {
  const root = document.documentElement;

  function updateViewportVars() {
    const vv = window.visualViewport;
    const viewportHeight = vv ? vv.height : window.innerHeight;
    const fullHeight = window.innerHeight;
    const keyboardHeight = vv ? Math.max(0, fullHeight - vv.height - vv.offsetTop) : 0;

    root.style.setProperty("--real-vh", `${viewportHeight}px`);
    root.style.setProperty("--keyboard-height", `${keyboardHeight}px`);
  }

  function scrollFocusedIntoView(target) {
    if (!target || !target.matches?.("input, textarea, select")) return;

    // 等键盘动画先弹出来，再滚动；iOS Safari 太早滚动会对不准
    setTimeout(() => {
      try {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      } catch {
        target.scrollIntoView(false);
      }
    }, 280);

    setTimeout(() => {
      try {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      } catch {
        target.scrollIntoView(false);
      }
    }, 650);
  }

  updateViewportVars();

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportVars);
    window.visualViewport.addEventListener("scroll", updateViewportVars);
  }

  window.addEventListener("resize", updateViewportVars);
  window.addEventListener("orientationchange", () => {
    setTimeout(updateViewportVars, 300);
  });

  document.addEventListener("focusin", (event) => {
    scrollFocusedIntoView(event.target);
  });

  document.addEventListener("click", (event) => {
    if (event.target?.matches?.("input, textarea, select")) {
      scrollFocusedIntoView(event.target);
    }
  });
}


function getCurrentRoundDiscussions() {
  const round = Number(state.room?.current_round || 1);
  return state.speeches.filter((s) => Number(s.round) === round && s.kind === "discussion");
}

function renderFloatDock() {
  const dock = $("floatDock");
  if (!dock) return;

  const inRoom = !!state.room && !!state.me;
  dock.classList.toggle("hidden", !inRoom);
  if (!inRoom) return;

  const isHost = !!state.me?.is_host;
  document.querySelectorAll("#floatPanel .host-only").forEach((el) => {
    el.classList.toggle("hidden", !isHost);
  });

  $("floatRoomPhase").textContent = `${phaseMap[state.room.phase] || state.room.phase} · 第 ${state.room.current_round || 1} 轮`;
  $("floatHostPhase").textContent = phaseMap[state.room.phase] || state.room.phase;
  $("floatHostHint").textContent = getFloatHostHint();

  renderFloatChat();
  updateFloatHostButtons();

  const unread = state.unreadDiscussion || 0;
  $("floatUnread").textContent = unread > 99 ? "99+" : String(unread);
  $("floatUnread").classList.toggle("hidden", unread <= 0);
}

function renderFloatChat() {
  const list = $("floatChatList");
  if (!list || !state.room) return;

  const discussions = getCurrentRoundDiscussions();
  if (!state.floatOpen && discussions.length > state.lastSeenDiscussionCount) {
    state.unreadDiscussion += discussions.length - state.lastSeenDiscussionCount;
  }
  state.lastSeenDiscussionCount = discussions.length;

  if (!discussions.length) {
    list.innerHTML = `<div class="float-chat-empty">本轮还没有聊天。<br>可以像微信一样随时打开这里讨论。</div>`;
    return;
  }

  list.innerHTML = discussions.map((msg) => {
    const p = state.players.find((x) => x.id === msg.player_id);
    const mine = msg.player_id === state.me?.id;
    const dead = p && !p.is_alive && !p.is_moderator;
    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div class="float-msg ${mine ? "mine" : ""} ${dead ? "dead" : ""}">
        <div class="float-msg-name">${escapeHtml(p?.nickname || "未知玩家")} · ${time}${dead ? " · 已出局" : ""}</div>
        <div class="float-msg-bubble">${escapeHtml(msg.content || "")}</div>
      </div>
    `;
  }).join("");

  if (state.floatOpen) {
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }
}

function getFloatHostHint() {
  const phase = state.room?.phase;
  const map = {
    waiting: "点击下一步会开始并发词。",
    assigning: "玩家看完身份后，点击下一步进入发言。",
    speaking: "发言差不多后，点击下一步进入公开讨论。",
    discussing: "讨论结束后，点击下一步进入投票。",
    voting: "点击下一步会统计投票。",
    result: "如果没结束，点击下一步进入下一轮。",
    ended: "本局已结束，可以重开房间。",
  };
  return map[phase] || "可以用这里快速推进流程。";
}

function updateFloatHostButtons() {
  if (!$("btnFloatNextStep") || !state.room) return;

  const phase = state.room.phase;
  const labelMap = {
    waiting: "下一步：开始并发词",
    assigning: "下一步：开始发言",
    speaking: "下一步：开始讨论",
    discussing: "下一步：开始投票",
    voting: "下一步：统计投票",
    result: state.room.winner ? "本局结束：重开" : "下一步：进入下一轮",
    ended: "重开房间",
  };
  $("btnFloatNextStep").textContent = labelMap[phase] || "下一步";

  const isHost = !!state.me?.is_host;
  ["btnFloatNextStep", "btnFloatStartSpeaking", "btnFloatStartDiscussing", "btnFloatStartVoting", "btnFloatResolveVote", "btnFloatNextRound", "btnFloatResetRoom"].forEach((id) => {
    if ($(id)) $(id).disabled = !isHost;
  });

  $("btnFloatStartSpeaking").disabled = !isHost || !(phase === "assigning" || phase === "result");
  $("btnFloatStartDiscussing").disabled = !isHost || phase !== "speaking";
  $("btnFloatStartVoting").disabled = !isHost || !(phase === "discussing" || phase === "speaking");
  $("btnFloatResolveVote").disabled = !isHost || phase !== "voting";
  $("btnFloatNextRound").disabled = !isHost || phase !== "result" || !!state.room.winner;
}

function switchFloatTab(tab) {
  document.querySelectorAll(".float-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.floatTab === tab);
  });
  $("floatChatPage").classList.toggle("active", tab === "chat");
  $("floatHostPage").classList.toggle("active", tab === "host");
}

function openFloatPanel(tab = "chat") {
  state.floatOpen = true;
  $("floatPanel").classList.remove("hidden");
  $("floatBubble").classList.add("hidden");
  switchFloatTab(tab);
  state.unreadDiscussion = 0;
  renderFloatDock();

  setTimeout(() => {
    const list = $("floatChatList");
    if (list) list.scrollTop = list.scrollHeight;
  }, 80);
}

function closeFloatPanel() {
  state.floatOpen = false;
  $("floatPanel").classList.add("hidden");
  $("floatBubble").classList.remove("hidden");
  renderFloatDock();
}

async function sendFloatChat() {
  const input = $("floatChatInput");
  const content = input.value.trim();
  if (!content) {
    toast("先写点讨论内容。");
    return;
  }

  if (!state.room || !state.me) {
    toast("还没进入房间。");
    return;
  }

  if (!state.me.is_alive && !state.me.is_host) {
    toast("你已经出局，只能看聊天记录。");
    return;
  }

  const { error } = await sb.from("speeches").insert({
    room_id: state.room.id,
    player_id: state.me.id,
    round: state.room.current_round || 1,
    kind: "discussion",
    content,
  });

  if (error) {
    toast(error.message);
    return;
  }

  input.value = "";
  await loadAll(state.room.id, state.me.id, { silent: true });
  renderFloatDock();
}

async function floatNextStep() {
  if (!state.me?.is_host || !state.room) return;

  const phase = state.room.phase;
  if (phase === "waiting") return startGame();
  if (phase === "assigning") return setPhase("speaking");
  if (phase === "speaking") return setPhase("discussing");
  if (phase === "discussing") return setPhase("voting");
  if (phase === "voting") return resolveVote();
  if (phase === "result") {
    if (state.room.winner) return resetRoom();
    return nextRound();
  }
  if (phase === "ended") return resetRoom();
}

function applyFloatPosition() {
  const dock = $("floatDock");
  if (!dock) return;
  try {
    const pos = JSON.parse(localStorage.getItem(localKey.floatPos) || "null");
    if (!pos) return;
    dock.style.left = `${pos.left}px`;
    dock.style.top = `${pos.top}px`;
    dock.style.right = "auto";
    dock.style.bottom = "auto";
  } catch {}
}

function saveFloatPosition(left, top) {
  localStorage.setItem(localKey.floatPos, JSON.stringify({ left, top }));
}

function setupFloatDrag() {
  const dock = $("floatDock");
  const bubble = $("floatBubble");
  const header = $("floatPanelHeader");
  if (!dock || !bubble || !header) return;

  applyFloatPosition();

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;

  function startDrag(event) {
    const point = event.touches?.[0] || event;
    dragging = true;
    moved = false;
    startX = point.clientX;
    startY = point.clientY;
    const rect = dock.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    dock.style.left = `${startLeft}px`;
    dock.style.top = `${startTop}px`;
    dock.style.right = "auto";
    dock.style.bottom = "auto";
  }

  function moveDrag(event) {
    if (!dragging) return;
    const point = event.touches?.[0] || event;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;

    const rect = dock.getBoundingClientRect();
    const width = rect.width || 60;
    const height = rect.height || 60;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);

    const left = Math.min(maxLeft, Math.max(8, startLeft + dx));
    const top = Math.min(maxTop, Math.max(8, startTop + dy));

    dock.style.left = `${left}px`;
    dock.style.top = `${top}px`;
    dock.style.right = "auto";
    dock.style.bottom = "auto";
    event.preventDefault?.();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    const rect = dock.getBoundingClientRect();
    saveFloatPosition(rect.left, rect.top);
    setTimeout(() => {
      moved = false;
    }, 0);
  }

  bubble.addEventListener("pointerdown", startDrag);
  header.addEventListener("pointerdown", startDrag);
  window.addEventListener("pointermove", moveDrag, { passive: false });
  window.addEventListener("pointerup", endDrag);

  bubble.addEventListener("touchstart", startDrag, { passive: false });
  header.addEventListener("touchstart", startDrag, { passive: false });
  window.addEventListener("touchmove", moveDrag, { passive: false });
  window.addEventListener("touchend", endDrag);

  bubble.addEventListener("click", (event) => {
    if (moved) {
      event.preventDefault();
      return;
    }
    openFloatPanel("chat");
  });
}


function syncCreateQuestionMasterUI() {
  const mode = $("createMode")?.value;
  if (!$("createModeratorMode")) return;

  if (mode === "manual") {
    $("createModeratorMode").value = "host";
    $("createModeratorMode").disabled = true;
  } else {
    $("createModeratorMode").disabled = false;
  }

  if ($("manualWordsBox")) {
    $("manualWordsBox").classList.toggle("hidden", mode !== "manual");
  }
}

function syncRoomQuestionMasterUI() {
  const mode = $("roomMode")?.value;
  if (!$("roomModeratorMode")) return;

  if (mode === "manual") {
    $("roomModeratorMode").value = "host";
    $("roomModeratorMode").disabled = true;
    if ($("selectModeratorWrap")) $("selectModeratorWrap").classList.add("hidden");
  } else {
    $("roomModeratorMode").disabled = false;
    if ($("selectModeratorWrap")) {
      $("selectModeratorWrap").classList.toggle("hidden", $("roomModeratorMode").value !== "select");
    }
  }

  if ($("roomManualWordsBox")) {
    $("roomManualWordsBox").classList.toggle("hidden", mode !== "manual");
  }
}

function bindEvents() {
  $("btnCreateRoom").addEventListener("click", createRoom);
  $("btnJoinRoom").addEventListener("click", joinRoom);
  $("btnBackHome").addEventListener("click", leaveRoom);
  $("btnCopyRoomTop").addEventListener("click", copyInvite);

  document.querySelectorAll("[data-home-panel]").forEach((btn) => {
    btn.addEventListener("click", () => switchHomePanel(btn.dataset.homePanel));
  });

  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => switchRoomPage(btn.dataset.page));
  });

  $("createMode").addEventListener("change", syncCreateQuestionMasterUI);

  $("roomMode").addEventListener("change", syncRoomQuestionMasterUI);

  $("roomModeratorMode").addEventListener("change", syncRoomQuestionMasterUI);

  $("btnToggleWord").addEventListener("click", () => {
    state.wordVisible = !state.wordVisible;
    renderMyCard();
  });

  $("btnStartGame").addEventListener("click", startGame);
  $("btnStartSpeaking").addEventListener("click", () => setPhase("speaking"));
  $("btnStartDiscussing").addEventListener("click", () => setPhase("discussing"));
  $("btnStartVoting").addEventListener("click", () => setPhase("voting"));
  $("btnResolveVote").addEventListener("click", resolveVote);
  $("btnNextRound").addEventListener("click", nextRound);
  $("btnResetRoom").addEventListener("click", resetRoom);
  $("btnLeaveRoom").addEventListener("click", leaveRoom);
  $("btnLeaveRoomHost").addEventListener("click", leaveRoom);

  $("btnSubmitSpeech").addEventListener("click", submitSpeech);
  $("btnSkipSpeech").addEventListener("click", skipSpeech);
  $("btnVoiceInput").addEventListener("click", startVoiceInput);
  $("btnSendDiscussion").addEventListener("click", sendDiscussion);

  $("joinRoomCode").addEventListener("input", (e) => {
    e.target.value = normalizeCode(e.target.value);
  });

  $("btnSavePrompts").addEventListener("click", () => savePromptsFrom(""));
  $("btnSavePromptsRoom").addEventListener("click", () => savePromptsFrom("Room"));
  $("btnResetPrompts").addEventListener("click", resetPrompts);
  $("btnResetPromptsRoom").addEventListener("click", resetPrompts);

  $("btnSaveAiConfig").addEventListener("click", () => saveAiConfigFrom(""));
  $("btnSaveAiConfigRoom").addEventListener("click", () => saveAiConfigFrom("Room"));
  $("btnFindModels").addEventListener("click", () => findModels(""));

  $("btnCloseFloat").addEventListener("click", closeFloatPanel);
  $("floatTabChat").addEventListener("click", () => switchFloatTab("chat"));
  $("floatTabHost").addEventListener("click", () => switchFloatTab("host"));
  $("btnSendFloatChat").addEventListener("click", sendFloatChat);
  $("floatChatInput").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      sendFloatChat();
    }
  });
  $("btnFloatNextStep").addEventListener("click", floatNextStep);
  $("btnFloatStartSpeaking").addEventListener("click", () => setPhase("speaking"));
  $("btnFloatStartDiscussing").addEventListener("click", () => setPhase("discussing"));
  $("btnFloatStartVoting").addEventListener("click", () => setPhase("voting"));
  $("btnFloatResolveVote").addEventListener("click", resolveVote);
  $("btnFloatNextRound").addEventListener("click", nextRound);
  $("btnFloatResetRoom").addEventListener("click", resetRoom);

  $("btnFindModelsRoom").addEventListener("click", () => findModels("Room"));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.room?.id && state.me?.id) {
      loadAll(state.room.id, state.me.id, { silent: true });
    }
  });

  window.addEventListener("pageshow", () => {
    if (state.room?.id && state.me?.id) {
      loadAll(state.room.id, state.me.id, { silent: true });
    }
  });

  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.room?.id && state.me?.id) {
        setTimeout(() => loadAll(state.room.id, state.me.id, { silent: true }), 80);
      }
    });
  });
}

async function boot() {
  bindEvents();
  setupMobileKeyboardFix();
  setupFloatDrag();
  fillPromptTextareas();
  fillAiInputs();
  switchHomePanel("create");
  syncCreateQuestionMasterUI();
  syncRoomQuestionMasterUI();

  if (!isConfigured) $("configWarning").classList.remove("hidden");

  const roomFromUrl = new URLSearchParams(location.search).get("room");
  if (roomFromUrl) {
    $("joinRoomCode").value = normalizeCode(roomFromUrl);
    switchHomePanel("join");
  }

  const cachedRoomId = localStorage.getItem(localKey.roomId);
  const cachedPlayerId = localStorage.getItem(localKey.playerId);

  if (isConfigured && cachedRoomId && cachedPlayerId && !roomFromUrl) {
    try {
      await enterRoom(cachedRoomId, cachedPlayerId);
    } catch {
      await forceHome("已清除旧房间缓存。");
    }
  }
}

boot();
