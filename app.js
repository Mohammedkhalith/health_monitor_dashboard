/* ═══════════════════════════════════════════════════════════════
   VR Emotion Analysis — app.js
   WebSocket client + live sensor simulation + Chart.js + PDF
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════ CONFIG ══════════════════════════ */
const WS_RECONNECT_DELAY = 3000;
const CHART_WINDOW       = 80;   // points shown in rolling window
const LOG_INTERVAL_MS    = 5000; // log a row every 5 s
const SIM_TICK_MS        = 40;   // ~25 fps simulation

/* ══════════════════════════ STATE ══════════════════════════ */
let ws          = null;
let simMode     = false;
let simTimer    = null;
let logTimer    = null;
let activeScene = 'none';

const state = {
  ecgHr  : 0,
  pulseHr: 0,
  spo2   : 0,
  gsr    : 0,
  resp   : 0,
  temp   : 0,
  leadsOn: false,
  fingerOn: false,
  stressIndex: 0
};

/* ══════════════════════════ DOM REFS ══════════════════════════ */
const $ = id => document.getElementById(id);

const DOM = {
  clock       : $('live-clock'),
  connDot     : $('conn-dot'),
  connLabel   : $('conn-label'),
  valEcgHr    : $('val-ecg-hr'),
  valPulseHr  : $('val-pulse-hr'),
  valSpo2     : $('val-spo2'),
  valGsr      : $('val-gsr'),
  valResp     : $('val-resp'),
  valTemp     : $('val-temp'),
  leadsStatus : $('leads-status'),
  fingerStatus: $('finger-status'),
  spo2Status  : $('spo2-status'),
  spo2Arc     : $('spo2-arc'),
  stressBadge : $('stress-badge'),
  stressBarFill: $('stress-bar-fill'),
  stressPctLbl : $('stress-pct-label'),
  bpmSceneTag : $('bpm-scene-tag'),
  logTbody    : $('log-tbody'),
  footerWs    : $('footer-ws-url'),
  wsModal     : $('ws-modal'),
  wsIpInput   : $('ws-ip-input'),
  btnSimulate : $('btn-simulate'),
  btnPdf      : $('btn-pdf'),
  btnWsConnect: $('btn-ws-connect'),
  btnWsDemo   : $('btn-ws-demo'),
  btnClearLog : $('btn-clear-log'),
  scenePills  : document.querySelectorAll('.scene-pill')
};

/* ══════════════════════════ CHART SETUP ══════════════════════════ */
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.color        = '#64748b';

function makeRolling(n, fill = 0) {
  return Array(n).fill(fill);
}

const sparkCfg = (color) => ({
  type: 'line',
  data: { labels: makeRolling(40), datasets: [{ data: makeRolling(40), borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true, backgroundColor: hexAlpha(color, 0.08) }] },
  options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } }
});

const sparkEcg  = new Chart($('spark-ecg'),   sparkCfg('#ff4d6d'));
const sparkPulse= new Chart($('spark-pulse'), sparkCfg('#ff9a3c'));
const sparkGsr  = new Chart($('spark-gsr'),  sparkCfg('#a78bfa'));
const sparkResp = new Chart($('spark-resp'), sparkCfg('#10b981'));

/* — ECG Full Waveform — */
const ecgData = { labels: makeRolling(CHART_WINDOW), datasets: [{ data: makeRolling(CHART_WINDOW), borderColor: '#ff4d6d', borderWidth: 1.8, pointRadius: 0, tension: 0, fill: false }] };
const chartEcg = new Chart($('chart-ecg'), {
  type: 'line',
  data: ecgData,
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 5, font: { size: 10 }, color: '#334155' }, border: { display: false } }
    }
  }
});

/* — BPM History — */
const bpmData = { labels: makeRolling(CHART_WINDOW), datasets: [
  { label: 'ECG BPM',   data: makeRolling(CHART_WINDOW), borderColor: '#ff4d6d', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false },
  { label: 'Pulse BPM', data: makeRolling(CHART_WINDOW), borderColor: '#ff9a3c', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: false, borderDash: [4,4] }
] };
const chartBpm = new Chart($('chart-bpm'), {
  type: 'line', data: bpmData,
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: true, labels: { color: '#64748b', boxWidth: 16, padding: 12, font: { size: 11 } } }, tooltip: { enabled: true, backgroundColor: '#0d1220', titleColor: '#e2e8f0', bodyColor: '#64748b', borderColor: '#1e293b', borderWidth: 1 } },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 5, font: { size: 10 }, color: '#334155' }, border: { display: false } }
    }
  }
});

/* — GSR Timeline — */
const gsrData = { labels: makeRolling(CHART_WINDOW), datasets: [{
  data: makeRolling(CHART_WINDOW), borderColor: '#a78bfa', borderWidth: 2, pointRadius: 0, tension: 0.5,
  fill: true, backgroundColor: createGradient('gsr')
}] };
const chartGsr = new Chart($('chart-gsr'), {
  type: 'line', data: gsrData,
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: '#0d1220', borderColor: '#1e293b', borderWidth: 1 } },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 4, font: { size: 10 }, color: '#334155', callback: v => v.toFixed(1) + ' μS' }, border: { display: false } }
    }
  }
});

/* — Respiration Wave — */
const respData = { labels: makeRolling(CHART_WINDOW), datasets: [{
  data: makeRolling(CHART_WINDOW), borderColor: '#10b981', borderWidth: 2, pointRadius: 0, tension: 0.6,
  fill: true, backgroundColor: createGradient('resp')
}] };
const chartResp = new Chart($('chart-resp'), {
  type: 'line', data: respData,
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 4, font: { size: 10 }, color: '#334155', callback: v => v.toFixed(0) + ' RPM' }, border: { display: false } }
    }
  }
});

/* helpers */
function createGradient(type) {
  const canvas = type === 'gsr' ? $('chart-gsr') : $('chart-resp');
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 160);
  if (type === 'gsr') {
    grad.addColorStop(0, 'rgba(167,139,250,0.3)');
    grad.addColorStop(1, 'rgba(167,139,250,0)');
  } else {
    grad.addColorStop(0, 'rgba(16,185,129,0.3)');
    grad.addColorStop(1, 'rgba(16,185,129,0)');
  }
  return grad;
}
function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function pushRolling(chart, value, dsIdx = 0) {
  chart.data.labels.shift();
  chart.data.labels.push('');
  chart.data.datasets[dsIdx].data.shift();
  chart.data.datasets[dsIdx].data.push(value);
}

/* ══════════════════════════ CLOCK ══════════════════════════ */
function updateClock() {
  const now = new Date();
  DOM.clock.textContent = now.toLocaleTimeString('en-IN', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

/* ══════════════════════════ SCENE SELECTOR ══════════════════════════ */
DOM.scenePills.forEach(pill => {
  pill.addEventListener('click', () => {
    DOM.scenePills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeScene = pill.dataset.scene;
    document.body.setAttribute('data-scene', activeScene);
    DOM.bpmSceneTag.textContent = pill.textContent.trim() || '--';
    if (simMode) updateSimParams();
    logEvent();
  });
});

/* ══════════════════════════ UPDATE UI ══════════════════════════ */
let simT = 0;
let prevEcg = 0;

function updateUI(data) {
  /* ── values ── */
  const ecgHr = Math.round(data.ecgHr);
  const pulseHr = Math.round(data.pulseHr);
  const spo2   = Math.round(data.spo2);
  const gsr    = parseFloat(data.gsr.toFixed(2));
  const resp   = Math.round(data.resp);
  const temp   = parseFloat(data.temp.toFixed(1));
  const ecgRaw = data.ecgRaw;

  state.ecgHr = ecgHr; state.pulseHr = pulseHr; state.spo2 = spo2;
  state.gsr = gsr; state.resp = resp; state.temp = temp;
  state.leadsOn = data.leadsOn; state.fingerOn = data.fingerOn;

  /* ── DOM ── */
  DOM.valEcgHr.textContent   = ecgHr || '--';
  DOM.valPulseHr.textContent = pulseHr || '--';
  DOM.valSpo2.textContent    = spo2 || '--';
  DOM.valGsr.textContent     = gsr || '--';
  DOM.valResp.textContent    = resp || '--';
  DOM.valTemp.textContent    = temp || '--';

  DOM.leadsStatus.textContent  = data.leadsOn  ? 'On ✓'  : 'Off ✗';
  DOM.fingerStatus.textContent = data.fingerOn ? 'Detected ✓' : 'Not detected';

  /* SpO2 ── ring */
  const spo2Pct = Math.max(0, Math.min(100, spo2));
  const circum  = 2 * Math.PI * 30; // r=30
  DOM.spo2Arc.style.strokeDashoffset = circum - (spo2Pct / 100) * circum;
  DOM.spo2Status.textContent = spo2 >= 95 ? 'Normal' : spo2 >= 90 ? 'Low' : 'Critical';

  /* Stress Index */
  const stressRaw = calcStressIndex(ecgHr, gsr, resp);
  state.stressIndex = stressRaw;
  DOM.stressBarFill.style.width = stressRaw + '%';
  DOM.stressPctLbl.textContent  = stressRaw + '%';
  const stressLabel = stressRaw < 35 ? 'CALM' : stressRaw < 65 ? 'ANXIOUS' : 'STRESSED';
  DOM.stressBadge.textContent = stressLabel;
  DOM.stressBadge.className   = 'stress-state-badge' + (stressRaw >= 65 ? ' stressed' : stressRaw >= 35 ? ' anxious' : '');

  /* ECG BPM colour */
  DOM.valEcgHr.style.color = ecgHr > 100 ? '#ff4d6d' : ecgHr < 50 ? '#fbbf24' : '#e2e8f0';

  /* ── Charts ── */
  pushRolling(sparkEcg,   ecgHr);
  pushRolling(sparkPulse, pulseHr);
  pushRolling(sparkGsr,   gsr);
  pushRolling(sparkResp,  resp);
  pushRolling(chartEcg,  ecgRaw, 0);
  pushRolling(chartBpm,  ecgHr,  0);
  pushRolling(chartBpm,  pulseHr,1);
  pushRolling(chartGsr,  gsr,    0);
  pushRolling(chartResp, resp,   0);

  sparkEcg.update();
  sparkPulse.update();
  sparkGsr.update();
  sparkResp.update();
  chartEcg.update();
  chartBpm.update();
  chartGsr.update();
  chartResp.update();
}

function calcStressIndex(hr, gsr, resp) {
  let score = 0;
  score += Math.min(40, Math.max(0, (hr - 60) / 1.0));
  score += Math.min(35, gsr * 3.5);
  score += Math.min(25, Math.max(0, (resp - 14) / 0.6));
  return Math.min(100, Math.round(score));
}

/* ══════════════════════════ SIMULATION ENGINE ══════════════════════════ */
const sceneSim = {
  none   : { hr:72, hrVar:4, gsr:1.5, gsrVar:0.3, resp:14, respVar:1, spo2:98 },
  calm   : { hr:65, hrVar:3, gsr:1.0, gsrVar:0.2, resp:12, respVar:0.5, spo2:99 },
  dark   : { hr:82, hrVar:6, gsr:3.5, gsrVar:0.8, resp:16, respVar:1.5, spo2:97 },
  horror : { hr:112,hrVar:18, gsr:7.5, gsrVar:2.0, resp:22, respVar:4,  spo2:96 },
  action : { hr:95, hrVar:12, gsr:5.0, gsrVar:1.5, resp:20, respVar:3,  spo2:97 },
  relax  : { hr:60, hrVar:2, gsr:0.8, gsrVar:0.15, resp:10, respVar:0.5, spo2:99 }
};

let simParams = { ...sceneSim.none };

function updateSimParams() {
  const p = sceneSim[activeScene] || sceneSim.none;
  simParams = { ...p };
}

function rand(base, variation) {
  return base + (Math.random() - 0.5) * 2 * variation;
}

/* ECG waveform generator: P-QRS-T */
let ecgPhase = 0;
function nextEcgSample(hrBpm) {
  const period = (60 / hrBpm) * (1000 / SIM_TICK_MS);
  ecgPhase = (ecgPhase + 1) % period;
  const t = ecgPhase / period;
  let v = 0;
  if (t < 0.1)       v = 0.2 * Math.sin(t / 0.1 * Math.PI);
  else if (t < 0.14) v = -0.1;
  else if (t < 0.15) v = -0.3;
  else if (t < 0.16) v = 3.2;
  else if (t < 0.17) v = -0.8;
  else if (t < 0.18) v = 0.1;
  else if (t < 0.28) v = 0;
  else if (t < 0.42) v = 0.35 * Math.sin((t - 0.28) / 0.14 * Math.PI);
  else               v = 0;
  return v + (Math.random() - 0.5) * 0.05;
}

let respPhase = 0;
function nextRespSample(rpm) {
  const period = (60 / rpm) * (1000 / SIM_TICK_MS);
  respPhase = (respPhase + 1) % period;
  return rpm + Math.sin((respPhase / period) * 2 * Math.PI) * 2;
}

let gsrBase = 1.5;
function nextGsr(target, variation) {
  gsrBase += (target - gsrBase) * 0.02 + (Math.random() - 0.5) * variation * 0.5;
  return Math.max(0, gsrBase);
}

let hrSmooth = 72;
function nextHr(target, variation) {
  hrSmooth += (target - hrSmooth) * 0.03 + (Math.random() - 0.5) * variation;
  return Math.max(40, hrSmooth);
}

function simTick() {
  const p = simParams;
  const ecgHr = nextHr(p.hr, p.hrVar);
  const gsr   = nextGsr(p.gsr, p.gsrVar);
  const resp  = nextRespSample(p.resp + rand(0, p.respVar));
  updateUI({
    ecgHr,
    pulseHr: ecgHr + rand(0, 3),
    spo2    : p.spo2 + rand(0, 0.5),
    gsr,
    resp,
    temp    : 36.5 + rand(0, 0.3),
    ecgRaw  : nextEcgSample(ecgHr),
    leadsOn : true,
    fingerOn: true
  });
}

function startSim() {
  stopSim();
  updateSimParams();
  simTimer = setInterval(simTick, SIM_TICK_MS);
}
function stopSim() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
}

/* ══════════════════════════ WEBSOCKET ══════════════════════════ */
function connectWs(ip) {
  const url = `ws://${ip}/ws`;
  DOM.footerWs.textContent = url;
  setConn('connecting', 'Connecting…');
  try {
    ws = new WebSocket(url);
    ws.onopen  = () => { setConn('connected', `Connected — ${ip}`); stopSim(); };
    ws.onclose = () => { setConn('disconnected', 'Disconnected'); scheduleReconnect(ip); };
    ws.onerror = () => { setConn('disconnected', 'Connection Error'); };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        updateUI({
          ecgHr   : data.ecg_hr     || 0,
          pulseHr : data.pulse_hr   || 0,
          spo2    : data.spo2       || 0,
          gsr     : data.gsr        || 0,
          resp    : data.resp_rpm   || 0,
          temp    : data.temp_c     || 0,
          ecgRaw  : data.ecg_raw    || 0,
          leadsOn : data.leads_on   || false,
          fingerOn: data.finger_on  || false
        });
      } catch(err) { console.warn('WS parse error', err); }
    };
  } catch(e) { setConn('disconnected', 'Invalid URL'); }
}

function scheduleReconnect(ip) {
  setTimeout(() => { if (!simMode) connectWs(ip); }, WS_RECONNECT_DELAY);
}

function setConn(type, label) {
  DOM.connDot.className  = 'conn-dot ' + type;
  DOM.connLabel.textContent = label;
}

/* ══════════════════════════ EVENT LOG ══════════════════════════ */
let logRows = [];
let lastLogTs = 0;

function logEvent(force = false) {
  const now = Date.now();
  if (!force && now - lastLogTs < LOG_INTERVAL_MS) return;
  lastLogTs = now;
  const ts  = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const row = { ts, scene: getSceneLabel(), ecgHr: state.ecgHr, spo2: state.spo2, gsr: state.gsr, resp: state.resp, stressState: getStressLabel() };
  logRows.unshift(row);
  if (logRows.length > 200) logRows.pop();
  renderLog();
}

function getSceneLabel() {
  const p = document.querySelector('.scene-pill.active');
  return p ? p.textContent.trim() : 'None';
}
function getStressLabel() {
  return state.stressIndex < 35 ? 'Calm' : state.stressIndex < 65 ? 'Anxious' : 'Stressed';
}

function renderLog() {
  if (!logRows.length) { DOM.logTbody.innerHTML = '<tr class="log-empty-row"><td colspan="7">No events yet.</td></tr>'; return; }
  DOM.logTbody.innerHTML = logRows.slice(0, 100).map(r => {
    const cls = r.stressState === 'Stressed' ? 'td-stressed' : r.stressState === 'Anxious' ? 'td-anxious' : 'td-calm';
    return `<tr>
      <td>${r.ts}</td>
      <td>${r.scene}</td>
      <td>${r.ecgHr || '--'}</td>
      <td>${r.spo2 || '--'}</td>
      <td>${r.gsr || '--'}</td>
      <td>${r.resp || '--'}</td>
      <td class="${cls}">${r.stressState}</td>
    </tr>`;
  }).join('');
}

logTimer = setInterval(logEvent, LOG_INTERVAL_MS);

/* ══════════════════════════ PDF REPORT ══════════════════════════ */
function generatePdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const W = 210, M = 18;

  /* Header */
  doc.setFillColor(8, 12, 20);
  doc.rect(0, 0, W, 40, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(0, 229, 255);
  doc.text('VR Emotion Analysis', M, 18);
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text('Biometric Stress Indicator Report — ESP32-S3', M, 26);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, M, 33);

  /* Current Scene */
  doc.setFillColor(13, 18, 32);
  doc.rect(0, 40, W, 16, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(200, 220, 240);
  doc.text(`Active VR Scene: ${getSceneLabel()}`, M, 51);

  /* Vitals */
  let y = 66;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text('Current Biometric Readings', M, y);
  y += 4;
  doc.setLineWidth(0.3);
  doc.setDrawColor(0, 229, 255);
  doc.line(M, y, W - M, y);
  y += 8;

  const vitals = [
    ['ECG Heart Rate', `${state.ecgHr} BPM`, 'Lead Electrodes (ADS1115 + AD8232)'],
    ['Pulse (Finger)', `${state.pulseHr} BPM`, 'Finger Oximeter (MAX30102)'],
    ['Blood Oxygen SpO₂', `${state.spo2} %`, 'MAX30102 IR/Red Ratio'],
    ['GSR Stress Level', `${state.gsr} μS`, 'Galvanic Skin Response (ADS1115 AIN1)'],
    ['Respiration Rate', `${state.resp} RPM`, 'NTC Thermistor (ADS1115 AIN2)'],
    ['Body Temperature', `${state.temp} °C`, 'NTC 10kΩ Thermistor'],
    ['Stress Index', `${state.stressIndex}%`, 'Composite Score (HR + GSR + Resp)'],
    ['Stress State', getStressLabel(), 'Derived Classification']
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  vitals.forEach(([label, value, source]) => {
    doc.setFillColor(248, 250, 252);
    doc.rect(M, y - 4, W - M*2, 10, 'F');
    doc.setTextColor(51, 65, 85);
    doc.text(label, M + 2, y + 2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 229, 255);
    doc.text(value, 95, y + 2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(source, 130, y + 2);
    y += 12;
  });

  /* Session Log Table */
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text('Session Event Log', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 8;

  const headers = ['Time', 'Scene', 'ECG BPM', 'SpO₂', 'GSR μS', 'Resp', 'State'];
  const colW    = [22, 32, 20, 14, 18, 14, 22];
  let x = M;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 229, 255);
  headers.forEach((h, i) => { doc.text(h, x, y); x += colW[i]; });
  y += 2;
  doc.setDrawColor(30, 41, 59);
  doc.line(M, y, W - M, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const rows = logRows.slice(0, 40);
  rows.forEach((r, idx) => {
    if (y > 270) { doc.addPage(); y = 20; }
    if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 3.5, W - M*2, 6.5, 'F'); }
    doc.setTextColor(51, 65, 85);
    const cells = [r.ts, r.scene.replace(/[^\x00-\x7F]/g,'').trim(), String(r.ecgHr), String(r.spo2)+'%', String(r.gsr), String(r.resp), r.stressState];
    x = M;
    cells.forEach((c, i) => { doc.text(c, x, y); x += colW[i]; });
    y += 7;
  });

  /* Footer */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`VR Emotion Analysis System — ESP32-S3 + ADS1115 + MAX30102 + AD8232`, M, 288);
    doc.text(`Page ${i}/${pages}`, W - M - 10, 288);
  }

  doc.save(`VR-BiometricReport-${Date.now()}.pdf`);
}

/* ══════════════════════════ BUTTON HANDLERS ══════════════════════════ */
DOM.btnSimulate.addEventListener('click', () => {
  if (!simMode) {
    simMode = true;
    if (ws) { ws.close(); ws = null; }
    setConn('demo', 'Demo Mode');
    DOM.footerWs.textContent = 'Demo Mode (Simulated ESP32-S3)';
    DOM.wsModal.style.display = 'none';
    startSim();
  } else {
    simMode = false;
    stopSim();
    setConn('', 'Not Connected');
    showModal();
  }
});

DOM.btnPdf.addEventListener('click', generatePdf);

DOM.btnWsConnect.addEventListener('click', () => {
  const ip = DOM.wsIpInput.value.trim();
  if (!ip) return;
  DOM.wsModal.style.display = 'none';
  simMode = false;
  connectWs(ip);
});

DOM.btnWsDemo.addEventListener('click', () => {
  simMode = true;
  DOM.wsModal.style.display = 'none';
  setConn('demo', 'Demo Mode');
  DOM.footerWs.textContent = 'Demo Mode (Simulated ESP32-S3)';
  startSim();
});

DOM.btnClearLog.addEventListener('click', () => {
  logRows = [];
  renderLog();
});

function showModal() { DOM.wsModal.style.display = 'flex'; }

/* ══════════════════════════ INIT ══════════════════════════ */
showModal();
