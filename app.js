/* 优势测评 H5 - 页面交互与渲染 */
(function () {
  const QUIZ_SHARE_URL = "https://strengths-quiz.app.workbuddy.host/?sharecode=DMNGNIYAI5";
  const $ = (sel) => document.querySelector(sel);
  /* 数字安全格式化：任何 null/undefined/NaN 都不抛错 */
  const f1 = (x) => (x == null || !isFinite(Number(x))) ? "–" : Number(x).toFixed(1);
  const state = {
    idx: 0,
    answers: {},        // {qid: 1-5}
    startTime: null,
    sameStreak: 0,
    maxSameStreak: 0,
    lastPick: null
  };

  /* ---------- 存档：续答 ---------- */
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
    catch (e) { return null; }
  }
  function saveSession() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers: state.answers,
      startTime: state.startTime,
      idx: state.idx,
      maxSameStreak: state.maxSameStreak
    }));
  }

  function show(viewId) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    $(viewId).classList.add("active");
    window.scrollTo(0, 0);
  }

  /* ---------- 落地页 ---------- */
  function initLanding() {
    const s = loadSession();
    const tip = $("#resume-tip");
    const startBtn = $("#btn-start");
    if (s && Object.keys(s.answers || {}).length > 0 && Object.keys(s.answers).length < QUESTIONS.length) {
      tip.textContent = "检测到上次未完成的作答，将为你继续";
      startBtn.textContent = "继续测评";
    } else if (s && Object.keys(s.answers).length >= QUESTIONS.length) {
      tip.textContent = "上次已完成测评，可查看报告或重新测评";
      startBtn.textContent = "查看我的报告";
    }
    startBtn.addEventListener("click", () => {
      reportEvent("start");
      const s2 = loadSession();
      if (s2 && Object.keys(s2.answers || {}).length >= QUESTIONS.length) {
        location.hash = "#report"; renderReport(); show("#view-report"); return;
      }
      if (s2 && Object.keys(s2.answers || {}).length > 0) {
        state.answers = s2.answers;
        state.startTime = s2.startTime || Date.now();
        state.maxSameStreak = s2.maxSameStreak || 0;
        state.idx = Math.min(Object.keys(s2.answers).length, QUESTIONS.length - 1);
      } else {
        state.startTime = Date.now();
      }
      renderQuestion();
      show("#view-quiz");
    });
  }

  /* ---------- 测评页 ---------- */
  function renderQuestion() {
    const q = QUESTIONS[state.idx];
    const answered = Object.keys(state.answers).length;
    $("#q-count").textContent = (state.idx + 1) + " / " + QUESTIONS.length;
    $("#progress-fill").style.width = (answered / QUESTIONS.length * 100).toFixed(1) + "%";
    $("#domain-chip").textContent = q.d ? DOMAINS[q.d].name : "最后几题";
    $("#q-text").textContent = q.t;
    const scale = $("#scale");
    scale.innerHTML = "";
    SCALE_LABELS.forEach((label, i) => {
      const b = document.createElement("button");
      b.className = "scale-btn" + (state.answers[q.id] === i + 1 ? " picked" : "");
      b.textContent = label;
      b.addEventListener("click", () => pick(i + 1, b));
      scale.appendChild(b);
    });
  }

  function pick(val, btn) {
    const q = QUESTIONS[state.idx];
    state.answers[q.id] = val;
    if (state.lastPick === val) { state.sameStreak++; } else { state.sameStreak = 1; }
    state.lastPick = val;
    state.maxSameStreak = Math.max(state.maxSameStreak, state.sameStreak);
    btn.classList.add("picked");
    saveSession();
    setTimeout(() => {
      if (state.idx < QUESTIONS.length - 1) {
        state.idx++;
        renderQuestion();
      } else {
        finishQuiz();
      }
    }, 180);
  }

  function goBack() {
    if (state.idx > 0) {
      state.idx--;
      const q = QUESTIONS[state.idx];
      delete state.answers[q.id];
      renderQuestion();
      saveSession();
    } else {
      show("#view-landing");
    }
  }

  function finishQuiz() {
    const meta = {
      durationSec: Math.round((Date.now() - state.startTime) / 1000),
      maxSameStreak: state.maxSameStreak
    };
    let result;
    try {
      result = computeResult(state.answers, meta);
    } catch (e) {
      // 计分异常兜底：所有题目按中性 3 分重算，保证报告一定出得来
      console.warn("[quiz] 计分异常，使用兜底计分:", e && e.message);
      const fallback = {};
      QUESTIONS.forEach(q => { if (!(q.id in fallback)) fallback[q.id] = 3; });
      QUESTIONS.forEach(q => { if (state.answers[q.id] != null) fallback[q.id] = state.answers[q.id]; });
      result = computeResult(fallback, meta);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers: state.answers, meta: meta, result: result, finishedAt: Date.now()
    }));
    try { reportSubmission(result, meta); } catch (e) { /* 上报失败不影响报告 */ }
    renderReport();
    show("#view-report");
  }

  /* ---------- 报告页 ---------- */
  function renderReport() {
    const s = loadSession();
    if (!s || !s.result) { show("#view-landing"); return; }
    const r = s.result;

    // 效度提示
    const inv = $("#invalid-box");
    if (r.invalid) {
      inv.style.display = "block";
      inv.textContent = "检测到本次作答可能不够稳定（" + r.warnings.join("、") + "），结果仅供参考，建议重新测评。";
    } else { inv.style.display = "none"; }

    $("#dual-badge").style.display = r.dualCore ? "inline-block" : "none";
    $("#report-date").textContent = new Date().toLocaleDateString("zh-CN",
      { year: "numeric", month: "long", day: "numeric" });

    renderRadar(r.domainScores);

    // 优势灵魂动物人格卡（趣味解读）
    const p = PERSONAS[r.top5[0]];
    $("#persona-emoji").textContent = p.emoji;
    $("#persona-name").textContent = "你的优势灵魂动物 · " + p.animal;
    $("#persona-why").textContent = p.animalWhy;

    // Top 5 卡片（附趣味人设标签）
    const list = $("#top-list");
    list.innerHTML = "";
    r.top5.forEach((key, i) => {
      const d = DOMAINS[key];
      const pc = PERSONAS[key];
      const card = document.createElement("div");
      card.className = "top-card";
      card.innerHTML =
        '<div class="rank-row">' +
          '<span class="rank' + (i === 0 ? ' r1' : '') + '">TOP ' + (i + 1) + "</span>" +
          '<span class="dname">' + d.name + "</span>" +
          '<span class="score">' + f1(r.domainScores[key]) + "</span>" +
        "</div>" +
        '<div class="kw">' + d.keywords + "</div>" +
        '<div class="fun-chip"><span class="fc-emoji">' + pc.emoji + "</span>" + pc.animal + " · 同款名人：" + pc.figure + "</div>" +
        '<div class="desc">' + INTERPRETATIONS[key] + "</div>";
      list.appendChild(card);
    });

    // 趣味彩蛋：灵魂动物 + 历史人物双解读
    $("#fun-animal").textContent = p.emoji + " " + p.animal + "：" + p.animalWhy;
    $("#fun-figure").textContent = "📜 同款历史人物 " + p.figure + "：" + p.figureWhy;

    // 优势组合分析（Top1 × Top2）
    const comboKey = [r.sorted[0], r.sorted[1]].sort().join("|");
    $("#combo-text").textContent = COMBOS[comboKey] || "";

    // 场景行动卡（基于 Top1 优势域）
    const acts = ACTIONS[r.top5[0]];
    const actMap = [
      ["📚 学习场景", acts.study],
      ["💼 求职 / 工作场景", acts.work],
      ["🤝 人际场景", acts.social]
    ];
    const actBox = $("#action-list");
    actBox.innerHTML = "";
    actMap.forEach(function (item) {
      const el = document.createElement("div");
      el.className = "action-card";
      el.innerHTML = '<p class="at">' + item[0] + '</p><p class="ad">' + item[1] + "</p>";
      actBox.appendChild(el);
    });

    // 8 维条形
    const bars = $("#bar-list");
    bars.innerHTML = "";
    r.sorted.forEach(key => {
      const pct = ((r.domainScores[key] - 1) / 4 * 100).toFixed(0);
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML =
        '<span class="bname">' + DOMAINS[key].name + "</span>" +
        '<span class="track"><span class="bfill" style="width:' + pct + '%"></span></span>' +
        '<span class="bval">' + f1(r.domainScores[key]) + "</span>";
      bars.appendChild(row);
    });

    // 核心优势盲点
    $("#blind-text").textContent = BLINDSPOTS[r.top5[0]];
  }

  /* SVG 八维雷达图（无外部依赖） */
  function renderRadar(scores) {
    const cx = 160, cy = 150, R = 110, N = 8;
    const keys = Object.keys(DOMAINS);
    const angle = (i) => (Math.PI * 2 * i) / N - Math.PI / 2;
    let svg = '<svg viewBox="0 0 320 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="八维优势雷达图">';

    // 网格（3 圈）
    [0.33, 0.66, 1].forEach(f => {
      let pts = [];
      for (let i = 0; i < N; i++) pts.push((cx + R * f * Math.cos(angle(i))).toFixed(1) + "," + (cy + R * f * Math.sin(angle(i))).toFixed(1));
      svg += '<polygon points="' + pts.join(" ") + '" fill="none" stroke="#E4E4DE" stroke-width="1"/>';
    });
    // 轴线 + 标签
    keys.forEach((k, i) => {
      const x = cx + R * Math.cos(angle(i)), y = cy + R * Math.sin(angle(i));
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#E4E4DE" stroke-width="1"/>';
      const lx = cx + (R + 22) * Math.cos(angle(i)), ly = cy + (R + 18) * Math.sin(angle(i));
      svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="12" fill="#8A938F" text-anchor="middle" dominant-baseline="central">' + DOMAINS[k].name + "</text>";
    });
    // 数据多边形（分值钳制在 0-1，防异常值把图形画飞）
    let dataPts = [];
    keys.forEach((k, i) => {
      const v = Math.max(0, Math.min(1, ((Number(scores[k]) || 3) - 1) / 4));
      dataPts.push((cx + R * v * Math.cos(angle(i))).toFixed(1) + "," + (cy + R * v * Math.sin(angle(i))).toFixed(1));
    });
    svg += '<polygon points="' + dataPts.join(" ") + '" fill="rgba(47,125,109,0.25)" stroke="#2F7D6D" stroke-width="2"/>';
    keys.forEach((k, i) => {
      const v = Math.max(0, Math.min(1, ((Number(scores[k]) || 3) - 1) / 4));
      const x = cx + R * v * Math.cos(angle(i)), y = cy + R * v * Math.sin(angle(i));
      svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5" fill="#2F7D6D"/>';
    });
    svg += "</svg>";
    $("#radar").innerHTML = svg;
  }

  /* ---------- 分享海报（canvas 合成，750×1334） ---------- */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  /* 海报二维码绘制（qrcode-generator，失败不影响海报其余部分） */
  function drawQr(ctx, text, x, y, size) {
    try {
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      const cell = size / n;
      ctx.fillStyle = "#1F5A4E";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(x + c * cell, y + r * cell, Math.ceil(cell) + 0.5, Math.ceil(cell) + 0.5);
          }
        }
      }
    } catch (e) { /* 二维码绘制失败时跳过 */ }
  }

  function buildPosterDataURL(r) {
    const W = 750, H = 1334;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const p = PERSONAS[r.top5[0]];

    // 背景渐变
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#2F7D6D"); g.addColorStop(1, "#1F5A4E");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 装饰圆
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.arc(660, 130, 190, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(70, 1080, 150, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(216,90,48,0.18)";
    ctx.beginPath(); ctx.arc(110, 210, 60, 0, Math.PI * 2); ctx.fill();

    // 顶部品牌标签
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    rr(ctx, (W - 340) / 2, 80, 340, 64, 32); ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 26px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("优势测评 · 天赋优势报告", W / 2, 114);

    // 灵魂动物 emoji + 称号
    ctx.font = "150px " + EMOJI_FONT;
    ctx.fillText(p.emoji, W / 2, 300);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "26px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText("我的优势灵魂动物", W / 2, 428);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 60px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText(p.animal, W / 2, 500);
    ctx.fillStyle = "rgba(216,90,48,0.95)";
    rr(ctx, (W - 200) / 2, 560, 200, 8, 4); ctx.fill();

    // Top 5 列表
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "28px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText("我的 Top 5 天赋优势", W / 2, 632);
    r.top5.forEach(function (key, i) {
      const y = 690 + i * 82;
      // 排名徽章
      const badge = i === 0 ? "#D85A30" : "rgba(255,255,255,0.18)";
      ctx.fillStyle = badge;
      rr(ctx, 96, y, 108, 52, 26); ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "700 24px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText("TOP" + (i + 1), 150, y + 27);
      // 域名
      ctx.textAlign = "left";
      ctx.font = "600 34px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(DOMAINS[key].name, 232, y + 27);
      // 关键词
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "22px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(DOMAINS[key].keywords, 232 + DOMAINS[key].name.length * 34 + 24, y + 26);
      ctx.textAlign = "center";
    });

    // 底部：二维码 + 行动文案
    ctx.fillStyle = "#FFFFFF";
    rr(ctx, 88, 1086, 190, 190, 16); ctx.fill();
    drawQr(ctx, QUIZ_SHARE_URL, 100, 1098, 166);

    ctx.textAlign = "left";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 34px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText("8 分钟，测测你的", 310, 1140);
    ctx.fillText("天赋优势是什么", 310, 1186);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "22px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText("扫码立即开始", 310, 1234);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "20px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText(new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }), 662, 1266);
    ctx.textAlign = "center";

    return canvas.toDataURL("image/png");
  }

  function renderPoster() {
    const s = loadSession();
    if (!s || !s.result) { alert("还没有测评报告，请先完成测评"); return; }
    reportEvent("poster");
    $("#poster-img").src = buildPosterDataURL(s.result);
    $("#poster-overlay").style.display = "flex";
  }
  function closePoster() { $("#poster-overlay").style.display = "none"; }
  function savePoster() {
    const a = document.createElement("a");
    a.href = $("#poster-img").src;
    a.download = "我的优势海报.png";
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- 重测 ---------- */
  function restart() {
    localStorage.removeItem(STORAGE_KEY);
    state.idx = 0; state.answers = {}; state.sameStreak = 0; state.maxSameStreak = 0; state.lastPick = null;
    state.startTime = Date.now();
    renderQuestion();
    show("#view-quiz");
  }

  /* ---------- 启动 ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    // 彻底禁用手势缩放（iOS Safari 忽略 user-scalable=no，需事件兜底）
    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });

    // 空安全的绑定助手：元素缺失时告警而不是抛错中断后续绑定
    const bind = (sel, fn) => {
      const el = document.querySelector(sel);
      if (el) el.addEventListener("click", fn);
      else console.warn("[quiz] 元素缺失，跳过绑定:", sel);
    };
    const safe = (fn) => () => { try { fn(); } catch (e) { console.error("[quiz]", e); alert("操作失败，请重试"); } };

    try { initLanding(); } catch (e) { console.error("[quiz] initLanding 失败:", e); }
    bind("#btn-back", goBack);
    bind("#btn-restart", restart);
    bind("#btn-restart2", restart);
    // 教练入口由 coach.js 负责（含对话与付费逻辑）
    // 海报
    bind("#btn-poster", safe(renderPoster));
    bind("#btn-poster-close", closePoster);
    bind("#btn-poster-save", safe(savePoster));
    bind("#poster-overlay", (e) => { if (e.target.id === "poster-overlay") closePoster(); });
  });
})();
