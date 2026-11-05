import { safeHtml } from './lib.mjs';

const escape = safeHtml;

export function sceneHtml(scene, sceneIndex, total) {
  const bullets = (scene.bullets ?? []).slice(0, 4).map(b => '<li>' + escape(b) + '</li>').join('');
  let visual = '';
  if (scene.proof) {
    // These are presentation cards derived from previously authenticated
    // Mattermost API records, not reconstructed or fabricated chat screenshots.
    const p = scene.proof;
    const fields = (p.fields ?? []).slice(0, 4).map(field =>
      '<div class="proof-row"><div class="proof-key">' + escape(field.label) +
      '</div><div class="proof-value">' + escape(field.value) + '</div></div>'
    ).join('');
    const captured = scene.imageData
      ? '<div class="proof-capture"><div class="proof-capture-label">REAL POST SCREENSHOT</div>' +
        '<img alt="Screen capture of the verified Mattermost post" src="data:image/png;base64,' +
        scene.imageData + '"/></div>'
      : '';
    visual = '<div class="proof-panel"><div class="proof-label">' +
      escape(p.source ?? 'AUTHENTICATED MATTERMOST API · PRESENTATION RENDER') +
      '</div><div class="proof-status">' + escape(p.headline) +
      '</div><div class="proof-explain">' + escape(p.explanation ?? '') +
      '</div><div class="proof-rows">' + fields + '</div><div class="proof-bottom">' +
      escape(p.disclaimer ?? 'Values taken from verified source metadata. Not a chat screenshot.') +
      '</div>' + captured + '</div>';
  } else if (scene.flowSteps) {
    const nodes = scene.flowSteps.map((v,i) =>
      '<div class="flow-node"><div class="flow-number">0' + (i+1) +
      '</div><div class="flow-name">' + escape(v.name) +
      '</div><div class="flow-desc">' + escape(v.detail) +
      '</div></div>'
    ).join('<div class="flow-arrow">→</div>');
    visual = '<div class="flow-panel"><div class="flow-label">A REAL HUMAN–AGENT WORKFLOW</div><div class="flow-nodes">' +
      nodes + '</div><div class="flow-bottom">' +
      escape(scene.flowSummary ?? '') + '</div></div>';
  } else if (scene.imageData) {
    visual = '<div class="screen"><img alt="Verified Mattermost screen capture" src="data:image/png;base64,' +
      scene.imageData + '"/></div>';
  } else if (scene.code) {
    visual = '<div class="codebox"><div class="codehead"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span><span class="code-label">' +
      escape(scene.codeLabel ?? 'READ-ONLY EVIDENCE') + '</span></div><pre>' + escape(scene.code) + '</pre></div>';
  } else {
    visual = '<div class="hero"><div class="hero-shape"><span></span><span></span><span></span></div>' +
      '<div class="hero-word">CASCADE</div><div class="hero-sub">COMMITMENT RECOVERY ENGINE</div>' +
      '<div class="hero-line"></div><p>' + escape(scene.hero ?? 'Human decisions. Deterministic recovery. One shared room.') + '</p></div>';
  }

  const css = [
    '<style>',
    '*{box-sizing:border-box}html,body{width:1920px;height:1080px;margin:0;overflow:hidden}',
    'body{background:#0b1420;color:#f1f2ef;font-family:"Segoe UI",Arial,sans-serif}',
    '.glow{position:absolute;width:900px;height:900px;border-radius:50%;top:-570px;right:-230px;background:radial-gradient(circle,#17485b88,transparent 70%)}',
    '.outline{position:absolute;inset:36px;border:1px solid #ffffff1a;border-radius:23px;pointer-events:none}',
    '.top{position:absolute;left:95px;right:95px;top:70px;display:flex;justify-content:space-between;align-items:center}',
    '.brand{font-size:24px;font-weight:800;letter-spacing:5px}.brand b{color:#67c9d7}',
    '.eyebrow{font-size:17px;letter-spacing:2px;font-weight:650;color:#90abba}',
    '.heading{position:absolute;top:140px;left:95px;right:95px;font-size:62px;line-height:1.06;font-weight:760;letter-spacing:-2px}',
    '.subtitle{position:absolute;top:223px;left:97px;right:100px;font-size:27px;color:#bac7cd;line-height:1.3}',
    '.visual{position:absolute;left:92px;right:510px;top:313px;height:625px;display:flex;align-items:center;justify-content:center}',
    '.screen{background:#101b29;border:1px solid #354b5e;border-radius:22px;padding:12px;width:100%;height:100%;box-shadow:0 32px 75px #0009;overflow:hidden}',
    '.screen img{width:100%;height:100%;object-fit:contain;display:block;border-radius:12px}',
    '.rail{position:absolute;right:96px;top:330px;width:358px;height:560px;background:#112333;border:1px solid #294255;border-radius:20px;padding:31px}',
    '.rail-label{color:#6ed1db;font-size:14px;letter-spacing:2.5px;font-weight:850}',
    '.rail ul{list-style:none;margin:28px 0 0;padding:0}',
    '.rail li{font-size:24px;line-height:1.35;color:#eef1ef;padding:17px 0;border-bottom:1px solid #ffffff14}',
    '.rail li:before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:#6dcbd1;margin-right:13px;vertical-align:middle}',
    '.rail .foot{position:absolute;bottom:32px;color:#839bab;font-size:14px;line-height:1.5;right:31px;left:31px}',
    '.footer{position:absolute;bottom:64px;left:96px;right:98px;display:flex;align-items:center;justify-content:space-between}',
    '.footnote{font-size:17px;color:#90a7b5;letter-spacing:.2px}',
    '.progress{height:5px;border-radius:99px;width:380px;background:#2e4756;overflow:hidden}',
    '.bar{height:100%;background:#6ed1db}',
    '.codebox{height:100%;width:100%;overflow:hidden;background:#0c1016;border:1px solid #3d5264;border-radius:22px;box-shadow:0 32px 70px #0007}',
    '.codehead{height:60px;border-bottom:1px solid #263443;background:#162330;padding:20px 26px}',
    '.dot{height:11px;width:11px;border-radius:50%;display:inline-block;margin-right:12px}.red{background:#fa6c6e}.yellow{background:#f4c661}.green{background:#7acfad}',
    '.code-label{margin-left:20px;font-size:14px;color:#a3b6c3;letter-spacing:2px}',
    'pre{margin:28px 36px;color:#d6f5f3;font:27px/1.55 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.hero{width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(120deg,#133245,#0f1a29);border:1px solid #345366;border-radius:22px}',
    '.hero-word{font-size:116px;letter-spacing:18px;font-weight:850;color:#f1f4ed;text-shadow:0 10px 40px #0005}',
    '.hero-sub{font-size:18px;letter-spacing:7px;color:#6ec8d0;margin-top:0}',
    '.hero-line{background:#6ec8d0;width:110px;height:4px;margin-top:42px}',
    '.hero p{font-size:27px;color:#d4e2e4;margin-top:32px;max-width:850px;text-align:center}',
    '.hero-shape{height:80px;display:flex;gap:16px;align-items:flex-end}',
    '.hero-shape span{width:20px;background:#6ed1db;border-radius:5px}',
    '.hero-shape span:nth-child(1){height:32px}.hero-shape span:nth-child(2){height:59px}.hero-shape span:nth-child(3){height:79px}',
    '.proof-panel{height:100%;width:100%;position:relative;background:linear-gradient(150deg,#0c2636,#102f40);border:1px solid #3c7681;border-radius:20px;padding:35px;overflow:hidden;box-shadow:0 28px 60px #0007}',
    '.proof-label{font-size:17px;letter-spacing:2px;font-weight:800;color:#78d7dd}',
    '.proof-status{font-size:55px;font-weight:800;letter-spacing:-1px;margin-top:25px;color:#f7f5e9;max-width:870px}',
    '.proof-explain{font-size:24px;line-height:1.4;color:#c6d8e1;margin-top:12px;max-width:930px}',
    '.proof-rows{margin-top:35px;max-width:1180px;display:grid;grid-template-columns:1fr 1fr;gap:22px 29px}',
    '.proof-row{border:1px solid #3b6070;background:#0f2534;border-radius:14px;padding:18px 21px;min-height:100px}',
    '.proof-key{font-size:16px;letter-spacing:1.5px;color:#7ebdc8;font-weight:750;text-transform:uppercase}',
    '.proof-value{margin-top:10px;font-size:27px;color:#f3f5f1;font-weight:720;overflow-wrap:anywhere}',
    '.proof-bottom{position:absolute;bottom:22px;left:36px;right:36px;font-size:15px;color:#b1c6cf}',
    '.proof-capture{position:absolute;right:24px;top:24px;width:294px;height:121px;background:#fff;border:2px solid #7ed5dc;border-radius:10px;overflow:hidden}',
    '.proof-capture-label{position:absolute;top:0;left:0;background:#0d2d3b;color:#e5ffff;padding:5px 10px;font-size:11px;letter-spacing:1px;z-index:2}',
    '.proof-capture img{width:100%;height:100%;object-fit:cover;object-position:center top}',
    '.flow-panel{height:100%;width:100%;background:linear-gradient(130deg,#112e41,#091b2b);border:1px solid #38596c;border-radius:20px;padding:40px;display:flex;flex-direction:column;justify-content:center}',
    '.flow-label{color:#75d7e1;letter-spacing:2px;font-size:19px;font-weight:850;margin-bottom:38px}',
    '.flow-nodes{display:flex;justify-content:space-between;align-items:stretch;gap:8px}',
    '.flow-node{flex:1;background:#112f41;border:1px solid #4a7a84;border-radius:17px;padding:22px 15px;min-height:220px}',
    '.flow-number{color:#63d5dd;font-size:17px;font-weight:800}',
    '.flow-name{font-size:28px;font-weight:850;line-height:1.2;margin-top:17px}',
    '.flow-desc{font-size:18px;color:#aecbd5;line-height:1.45;margin-top:10px}',
    '.flow-arrow{align-self:center;font-size:41px;font-weight:800;color:#76d9dc}',
    '.flow-bottom{margin-top:36px;font-size:21px;color:#b9d7dd;line-height:1.4}',
    '.noimage .visual{right:96px}.noimage .rail{display:none}',
    '</style>',
  ].join('');

  const progress = Math.round((sceneIndex + 1) / total * 100);
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>', css,
    '</head><body class="', scene.type === 'title' ? 'noimage' : '', '">',
    '<div class="glow"></div><div class="outline"></div>',
    '<div class="top"><div class="brand">CAS<b>CADE</b></div><div class="eyebrow">',
      escape(scene.label ?? 'SWITCH × HUMAN × ENGINE'), '</div></div>',
    '<div class="heading">', escape(scene.title), '</div>',
    '<div class="subtitle">', escape(scene.subtitle), '</div>',
    '<div class="visual">', visual, '</div>',
    '<aside class="rail"><div class="rail-label">WHY THIS MATTERS</div><ul>',
      bullets, '</ul><div class="foot">',
      escape(scene.sourceNote ?? 'Synthetic scenario · Authenticated local evidence'),
    '</div></aside>',
    '<div class="footer"><div class="footnote">',
      escape(scene.footnote ?? 'NO EXTERNAL ACTIONS · LOCAL RECOVERY ONLY'),
    '</div><div class="progress"><div class="bar" style="width:', String(progress), '%"></div></div></div>',
    '</body></html>',
  ].join('');
}
