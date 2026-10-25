/* 优势测评 H5 - AI 优势教练「小悠」
   设计铁律：不给建议、只引导；优势视角解读根因；情绪先共情后引导；
   免费 1 次由服务端（coach_claim_free）强制执行，客户端只做展示。 */
(function () {
  const COACH_STORAGE_KEY = "sq_coach_v1";
  const MODEL_PREFERENCE = ["glm-5.3-flash", "minimax-m3.1-flash", "deepseek-v4.1-flash", "hunyuan-2.0-thinking"];
  /* 思考型模型需显式降思考档位，否则思考过程会耗尽 max_tokens 导致回复为空。
     实测：glm-5.3-flash effort=low 思考 chunk 为 0；deepseek 支持 enabled:false；glm-4.x 非思考不可用（网关拒参）。 */
  const REASONING_PARAMS = {
    "glm-5.3-flash": { reasoning: { effort: "low" } },
    "minimax-m3.1-flash": { reasoning: { effort: "low" } },
    "deepseek-v4.1-flash": { reasoning: { enabled: false } }
  };
  const FREE_MAX_ROUNDS = 30;     // 免费会话轮次上限
  const PAID_DAILY_ROUNDS = 60;   // 付费用户每日轮次上限
  const HISTORY_WINDOW = 16;      // 送入模型的最大历史消息数（成本护栏）
  const MAX_TOKENS = 600;         // 单次回复上限（成本护栏）

  /* 危机关键词 → 固定安全响应（不经过大模型） */
  const CRISIS_KEYWORDS = ["自杀", "自残", "不想活", "轻生", "伤害自己", "活不下去", "结束生命"];
  const CRISIS_REPLY =
    "听到你说这些，我很心疼，也很谢谢你愿意告诉我。\n\n" +
    "你现在的感受很重要，但它太重了，不该由我们两个人单独扛。请一定让专业的人陪你一起：\n\n" +
    "· 全国心理援助热线：12356（24 小时）\n" +
    "· 也可以告诉身边你信任的人，哪怕只是坐在一起待一会儿。\n\n" +
    "你的存在本身就有价值。我在这儿，但你值得更多人的陪伴。";

  const $ = (sel) => document.querySelector(sel);

  /* 本地助手（app.js 的同名函数在其闭包内，不可直接访问） */
  function sqShow(viewId) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
    $(viewId).classList.add("active");
    window.scrollTo(0, 0);
  }
  function sqLoadSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
    catch (e) { return null; }
  }

  /* ---------- 会话状态 ---------- */
  const state = {
    messages: [],       // {role:'user'|'assistant', content}
    rounds: 0,          // 本会话轮次
    dayKey: "",         // 每日轮次计数键
    dailyRounds: 0,
    modelId: null,
    conversationId: null,
    entitled: false,    // 是否有有效付费权益
    planName: null,
    expiresAt: null
  };

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(COACH_STORAGE_KEY)) || null; }
    catch (e) { return null; }
  }
  function saveLocal() {
    localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      messages: state.messages.slice(-HISTORY_WINDOW),
      rounds: state.rounds, dayKey: state.dayKey, dailyRounds: state.dailyRounds,
      conversationId: state.conversationId
    }));
  }
  function todayKey() { return new Date().toISOString().slice(0, 10); }

  /* ---------- 系统提示词（注入测评结果） ---------- */
  function buildSystemPrompt(result) {
    const top5 = result.top5.map(function (k, i) {
      return (i + 1) + ". " + DOMAINS[k].name + "（" + DOMAINS[k].keywords + "，得分 " + Number(result.domainScores[k]).toFixed(1) + "）";
    }).join("\n");
    const p = PERSONAS[result.top5[0]];
    return [
      "你是「小悠」，一位温暖的优势教练，基于积极心理学性格优势理念工作。",
      "用户刚完成了天赋优势测评，以下是 TA 的结果：",
      "Top5 优势：\n" + top5,
      "灵魂动物：" + p.animal + "（" + p.animalWhy + "）",
      "",
      "你的核心信念：每个人本自具足。你的角色是陪伴者与引导者，不是老师，不是顾问。",
      "",
      "铁律（必须遵守）：",
      "1. 绝不直接给建议。不说「你应该」「建议你」「你可以试试」。只用开放式提问引导用户自己看清自己。",
      "2. 每次回复不超过 120 字，口语化、温和、像朋友聊天。一次最多问一个问题，不连环追问。",
      "3. 用户描述最近做的事情时，从 TA 的 Top5 优势解读行为根因：为什么 TA 会这么做；并具体指出哪些地方是优势的正面发挥，哪些地方是优势过头带来的盲点。",
      "4. 用户带着情绪来（焦虑、迷茫、委屈、自我怀疑）时：先共情接住情绪，陪伴，再温和引导 TA 看见情绪背后的需求。不强行正能量，不说教，不否定 TA 的感受。",
      "5. 不评价对错，不拿 TA 和别人比较，不用「但是」转折否定用户刚说的话。",
      "6. 用户问「我该怎么做」时，把问题还给 TA：例如「你心里其实更倾向哪个方向？」——帮 TA 看见自己已有的答案。",
      "7. 超出优势陪伴范围的问题（医疗、法律、投资、技术等），温和说明这不是你能帮的，建议找对应的专业人士。",
      "8. 如果对话中出现自伤、伤人等内容，停下常规对话，温和而坚定地建议 TA 拨打心理援助热线 12356 并告诉信任的人。"
    ].join("\n");
  }

  /* ---------- UI 辅助 ---------- */
  function addBubble(role, text) {
    const wrap = $("#coach-chat");
    const el = document.createElement("div");
    el.className = "bubble " + (role === "user" ? "b-user" : "b-ai");
    el.textContent = text;
    wrap.appendChild(el);
    wrap.scrollTop = wrap.scrollHeight;
    return el;
  }
  function setGenerating(on) {
    $("#coach-send").disabled = on;
    $("#coach-input").disabled = on;
    $("#coach-status").textContent = on ? "小悠正在想…" : "";
  }
  function showPaywall() {
    $("#coach-paywall").style.display = "flex";
  }

  /* ---------- 入口 ---------- */
  function showCoach() {
    const s = sqLoadSession();
    if (!s || !s.result) { alert("请先完成测评，AI 教练需要你的优势画像作为对话基础"); return; }
    reportEvent("coach");
    sqShow("#view-coach");
    initCoach(s.result);
  }

  async function initCoach(result) {
    const chat = $("#coach-chat");
    chat.innerHTML = "";
    state.modelId = null; state.entitled = false;

    // 恢复本地会话
    const saved = loadLocal();
    if (saved && saved.messages && saved.messages.length) {
      state.messages = saved.messages;
      state.rounds = saved.rounds || 0;
      if (saved.dayKey === todayKey()) { state.dayKey = saved.dayKey; state.dailyRounds = saved.dailyRounds || 0; }
      state.conversationId = saved.conversationId || null;
      state.messages.forEach(function (m) { addBubble(m.role, m.content); });
    } else {
      // 欢迎语本地生成（不耗 token）
      const p = PERSONAS[result.top5[0]];
      const hello = "我看过你的优势画像了🦊 你的 Top1 是「" + DOMAINS[result.top5[0]].name + "」，很像" + p.animal + "。\n\n最近有什么想聊的？发生了什么都行，我在这儿。";
      state.messages = []; state.rounds = 0;
      state.conversationId = "cv_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      addBubble("assistant", hello);
      state.messages.push({ role: "assistant", content: hello });
      saveLocal();
    }

    // 云端配额检查
    try {
      if (!cloud) { $("#coach-status").textContent = "网络不可用，无法使用 AI 教练"; return; }
      const { data, error } = await cloud.database.rpc("coach_status", { p_client_id: getClientId() });
      if (error) throw error;
      const st = typeof data === "string" ? JSON.parse(data) : data;
      state.entitled = !!(st && st.plan);
      state.planName = st && st.plan;
      state.expiresAt = st && st.expiresAt;
      updateQuotaHint();
    } catch (e) {
      console.warn("[coach] 配额检查失败:", e && e.message);
      $("#coach-status").textContent = "配额检查失败，请稍后重试";
    }

    /* 选模型（按偏好序取第一个可用项）。做成 Promise，防止用户在列表返回前点发送造成 model=null */
    state.modelReady = (async function () {
      try {
        const models = await cloud.llm.models.list();
        for (const pref of MODEL_PREFERENCE) {
          const hit = models.find(function (m) { return m.id === pref && m.disabled !== true; });
          if (hit) { state.modelId = pref; break; }
        }
        if (!state.modelId) {
          const first = models.find(function (m) { return m.disabled !== true; });
          state.modelId = first ? first.id : null;
        }
      } catch (e) {
        console.error("[coach] 模型列表获取失败:", e && (e.stack || e.message || e));
        /* 保持 null，发送时报错提示 */
      }
      if (!state.modelId) $("#coach-status").textContent = "AI 服务暂不可用（获取模型列表失败）";
    })();
  }

  function updateQuotaHint() {
    let hint = "";
    if (state.entitled) {
      hint = state.planName + "会员 · " + (state.expiresAt || "") + " 到期 · 今日 " + state.dailyRounds + "/" + PAID_DAILY_ROUNDS;
    } else {
      hint = "免费体验 · 本会话 " + state.rounds + "/" + FREE_MAX_ROUNDS + " 轮";
    }
    $("#coach-quota").textContent = hint;
  }

  function roundsLimit() { return state.entitled ? PAID_DAILY_ROUNDS : FREE_MAX_ROUNDS; }

  /* ---------- 发送 ---------- */
  async function send() {
    const input = $("#coach-input");
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";

    // 危机关键词：固定安全响应，不经大模型
    if (CRISIS_KEYWORDS.some(function (k) { return text.indexOf(k) >= 0; })) {
      addBubble("user", text);
      state.messages.push({ role: "user", content: text });
      addBubble("assistant", CRISIS_REPLY);
      state.messages.push({ role: "assistant", content: CRISIS_REPLY });
      saveLocal();
      return;
    }

    // 轮次限制
    if (state.rounds >= roundsLimit() || state.dailyRounds >= PAID_DAILY_ROUNDS) {
      if (state.entitled) { alert("今日对话次数已用完，明天再来聊吧"); }
      else { showPaywall(); }
      return;
    }

    // 免费额度抢占（服务端原子执行，仅在第一条用户消息时）
    if (!state.entitled && state.rounds === 0) {
      try {
        const { data, error } = await cloud.database.rpc("coach_claim_free", { p_client_id: getClientId() });
        if (error) throw error;
        const r = typeof data === "string" ? JSON.parse(data) : data;
        if (!r || r.ok !== true) { showPaywall(); return; }
      } catch (e) {
        console.warn("[coach] 额度抢占失败:", e && e.message);
        $("#coach-status").textContent = "网络异常，请稍后重试";
        return;
      }
    }

    addBubble("user", text);
    state.messages.push({ role: "user", content: text });
    setGenerating(true);

    const bubble = addBubble("assistant", "");
    let reply = "";
    try {
      /* 等模型列表就绪（防竞态：用户可能在初始化完成前点发送） */
      if (state.modelReady) await state.modelReady;
      if (!state.modelId) throw new Error("AI 模型未就绪，请稍后重试");
      const s = sqLoadSession();
      const history = state.messages.slice(-HISTORY_WINDOW).slice(0, -1);
      const msgs = [{ role: "system", content: buildSystemPrompt(s.result) }]
        .concat(history)
        .concat([{ role: "user", content: text }]);
      /* 注意：不能传 conversationId —— SDK 会附加 X-Conversation-ID 请求头，
         网关 CORS 白名单不含该头，浏览器预检会直接失败（Node 不受 CORS 影响测不出）。
         对话上下文由前端 messages 数组自行维护，无需服务端会话。 */
      for await (const chunk of cloud.llm.chat.completions.create(Object.assign({
        model: state.modelId,
        messages: msgs,
        stream: true,
        temperature: 0.8,
        max_tokens: MAX_TOKENS
      }, REASONING_PARAMS[state.modelId] || {}))) {
        const d = chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) {
          reply += d.content;
          bubble.textContent = reply;
          $("#coach-chat").scrollTop = $("#coach-chat").scrollHeight;
        }
      }
    } catch (e) {
      console.error("[coach] LLM 调用失败:", e && (e.stack || e.message || e), e && e.error ? JSON.stringify(e.error) : "");
      const code = e && e.error && e.error.code || "";
      if (code.indexOf("quota_") === 0) {
        reply = "（今天的 AI 额度用完了，明天再来～）";
      } else {
        const detail = (e && (e.message || e.error && e.error.message) || "网络异常").slice(0, 60);
        reply = reply || "（AI 连接失败：" + detail + "，请再试一次）";
      }
    }
    if (!reply) reply = "（AI 返回了空回复，请再发一次试试）";
    bubble.textContent = reply;
    state.messages.push({ role: "assistant", content: reply });
    state.rounds++;
    if (state.dayKey !== todayKey()) { state.dayKey = todayKey(); state.dailyRounds = 0; }
    state.dailyRounds++;
    saveLocal();
    setGenerating(false);
    updateQuotaHint();

    // 免费会话到达上限 → 引导付费
    if (!state.entitled && state.rounds >= FREE_MAX_ROUNDS) {
      showPaywall();
    }
  }

  /* ---------- 兑换码 ---------- */
  async function redeem() {
    const code = ($("#coach-code-input").value || "").trim();
    if (!code) { alert("请输入兑换码"); return; }
    try {
      const { data, error } = await cloud.database.rpc("coach_redeem", { p_code: code, p_client_id: getClientId() });
      if (error) throw error;
      const r = typeof data === "string" ? JSON.parse(data) : data;
      if (r && r.ok) {
        state.entitled = true; state.planName = r.plan; state.expiresAt = r.expiresAt;
        $("#coach-paywall").style.display = "none";
        $("#coach-code-input").value = "";
        updateQuotaHint();
        addBubble("assistant", "兑换成功！你是「" + r.plan + "」会员，" + r.expiresAt + " 到期。咱们继续聊～");
        state.messages.push({ role: "assistant", content: "兑换成功！你是「" + r.plan + "」会员，" + r.expiresAt + " 到期。咱们继续聊～" });
        saveLocal();
      } else {
        alert(r && r.reason === "code_used" ? "这个兑换码已被使用" : "兑换码无效，请检查后重试");
      }
    } catch (e) {
      alert("兑换失败，请稍后重试");
    }
  }

  /* ---------- 启动绑定 ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    const bind = function (sel, fn) {
      const el = document.querySelector(sel);
      if (el) el.addEventListener("click", fn);
      else console.warn("[coach] 缺少元素:", sel);
    };
    bind("#btn-coach", showCoach);
    bind("#btn-coach-back", function () { sqShow("#view-report"); });
    bind("#coach-send", send);
    bind("#coach-redeem", redeem);
    bind("#coach-paywall-close", function () { $("#coach-paywall").style.display = "none"; });
    bind("#coach-new-session", function () {
      if (!confirm("开始新会话？当前会话将清空（免费额度仅 1 次会话）")) return;
      localStorage.removeItem(COACH_STORAGE_KEY);
      initCoach(sqLoadSession().result);
    });
    const input = $("#coach-input");
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
  });
})();
