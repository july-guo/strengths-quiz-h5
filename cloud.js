/* 优势测评 H5 - 云服务接入（作答数据上报）
   初始化配置来自云服务 publicConfig（publishableKey 仅标识应用，无权限；服务端强制 Origin 校验） */
const CLOUD_PUBLIC_CONFIG = {
  endpoint: "https://strengths-quiz.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_7VablHer3tSbU4ug8vLdZD_8fxWB2cJPHR8mnBI9tmkjU3FV4CunYZW"
};

let cloud = null;
try {
  if (window.WorkBuddyCloud && typeof WorkBuddyCloud.createWorkBuddyCloud === "function") {
    cloud = WorkBuddyCloud.createWorkBuddyCloud(CLOUD_PUBLIC_CONFIG);
  }
} catch (e) { cloud = null; }

/* 匿名设备标识：用于去重统计（不采集任何个人信息） */
function getClientId() {
  try {
    let cid = localStorage.getItem("sq_client_id");
    if (!cid) {
      cid = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
      localStorage.setItem("sq_client_id", cid);
    }
    return cid;
  } catch (e) { return "unknown"; }
}

/* 上报一次完成的测评（失败静默，不影响用户体验） */
function reportSubmission(result, meta) {
  if (!cloud || !result) return;
  cloud.database.from("quiz_submissions").insert({
    client_id: getClientId(),
    domain_scores: result.domainScores,
    top5: result.top5,
    warnings: result.warnings,
    invalid: !!result.invalid,
    duration_sec: meta && meta.durationSec != null ? meta.durationSec : null
  }).then(function (res) {
    if (res && res.error) console.warn("[cloud] 上报失败:", res.error.code || res.error.message || "");
  }).catch(function () { /* 网络失败静默 */ });
}

/* 上报行为事件：start(开始作答) / poster(生成海报) / coach(点击教练) */
function reportEvent(eventType) {
  if (!cloud || !eventType) return;
  cloud.database.from("quiz_events").insert({ client_id: getClientId(), event_type: eventType })
    .then(function (res) {
      if (res && res.error) console.warn("[cloud] 事件上报失败:", res.error.code || "");
    })
    .catch(function () { /* 静默 */ });
}
