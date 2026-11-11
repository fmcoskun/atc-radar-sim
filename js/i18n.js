"use strict";
/* ==========================================================================
   i18n.js — UI language (English default, Turkish optional)
   Aviation phraseology (HDG, FL, readbacks, SYS/MODE values) stays English.
   ========================================================================== */

const I18N = {
  en: {
    // static UI
    "panel.targets": "TARGET LIST",
    "panel.log": "EVENT LOG",
    "panel.detail": "TARGET DATA",
    "panel.cmd": "CLEARANCE",
    "panel.squawk": "SQUAWK / EMERGENCY",
    "panel.conflicts": "CONFLICT ANALYSIS",
    "btn.csv": "CSV ⇩",
    "btn.csvTitle": "Download as CSV",
    "btn.apply": "APPLY",
    "btn.nav": "NAV",
    "btn.navTitle": "Return to the route flown before vectoring",
    "btn.res": "RES SPD",
    "btn.resTitle": "Cancel speed restriction (RES)",
    "btn.normal": "NORMAL",
    "dct.placeholder": "DCT …",
    "dct.aria": "Direct-to fix",
    "cmd.linePlaceholder": "HDG 270 FL 240 SPD 280 · DCT TUZLA · NAV · ILS",
    "ctl.range": "RANGE",
    "ctl.sweep": "SWEEP",
    "ctl.sim": "SIM",
    "ctl.layers": "LAYERS",
    "ctl.scenario": "SCENARIO",
    "layer.map": "MAP",
    "layer.wx": "WX",
    "layer.areas": "AREAS",
    "layer.clutter": "CLUTTER",
    "fl.minAria": "Lower FL",
    "fl.maxAria": "Upper FL",
    "scn.aria": "Scenario",
    "scn.reloadTitle": "Restart the selected scenario",
    "scn.load": "LOAD…",
    "scn.save": "SAVE",
    "timeline.aria": "Recording timeline",
    "radar.aria": "Radar display",
    "lang.title": "Türkçe'ye geç",

    // buttons with state
    "btn.pause": "❚❚ PAUSE",
    "btn.play": "▶ PLAY",
    "btn.ruler": "⟷ RULER",
    "btn.sound": "♪ SOUND: {s}",
    "btn.training": "◎ TRAINING: {s}",
    "btn.source": "⇄ SOURCE: {s}",
    "btn.now": "● NOW",
    "on": "ON",
    "off": "OFF",
    "src.sim": "SIM",
    "src.live": "LIVE",

    // scenarios
    "scn.random": "Random traffic",
    "scn.crossing": "Crossing airways",
    "scn.approach": "Approach rush",
    "scn.emergency": "Emergency",
    "scn.custom": "Custom scenario",
    "scn.file": "File: {name}",
    "scn.savedName": "{name} (saved T+{t})",

    // hints
    "hint.default": "Click: select · Drag selected target: HDG · Click speed leader: projection · Drag label (double-click: reset) · R: ruler · /: command · Space: pause",
    "hint.ruler": "RULER: click two targets in turn · click empty space: reset · Esc: exit",

    // panels
    "score.detail": "R{r} V{v} A{a}",
    "score.title": "Resolved / Separation losses / Area infringements",
    "detail.empty": "Select a target on the scope or in the list.",
    "detail.primary": "PRIMARY ONLY",
    "detail.noModeC": "--- (no Mode C)",
    "nav.replay": "— (recording)",
    "nav.vfr": "VFR · no transponder",
    "nav.departure": "DEPARTURE · RWY HDG → {exit}",
    "nav.wx": " · WX DEVIATION",
    "nav.resume": " · NAV → {to}",
    "proj": "PROJECTION 1/3/5 MIN: {s}",
    "cf.none": "No conflicts.",
    "cf.loss": "{dh} NM · {dv} FT · SEPARATION LOSS",
    "cf.traffic": "CPA {t}s · {d} NM · NOW {now} NM",
    "cf.hint": "HINT (−{cost})",
    "cf.noAdvice": "No single-clearance solution found",
    "cf.advice": "ADVICE",
    "cf.advTitle": "Click to apply · hover to preview",
    "log.empty": "No events yet.",
    "tl.replay": "REPLAY T+{t} / {end}",
    "tl.now": "NOW · REC {rec}",

    // clearance preview
    "probe.clear": "PREVIEW {cs} {rb}: no conflict within {min} min ✓",
    "probe.ongoing": "PREVIEW: separation loss with {cs} continues, restored at {when}",
    "probe.ongoingNever": "PREVIEW: separation loss with {cs} not restored within {min} min",
    "probe.conflict": "PREVIEW: conflict with {cs} in {t} ({d} NM)",
    "probe.more": " · +{n} more",
    "probe.noPath": "PREVIEW: no path forecast for this clearance (ILS)",

    // command errors
    "cmd.notCommandable": "This target cannot be given clearances.",
    "cmd.landed": "{cs} has landed.",
    "cmd.nordo": "{cs}: RADIO FAILURE (7600) — no reply.",
    "cmd.empty": "Empty clearance.",
    "cmd.hdgRange": "HDG must be 001–360.",
    "cmd.flRange": "FL must be 010–450.",
    "cmd.spdRange": "SPD must be 120–500.",
    "cmd.unknownFix": "Unknown fix: {fix}",
    "cmd.noNav": "{cs}: no route to return to (give a DCT).",
    "cmd.unknown": "Unknown command: {tok}",
    "cmd.enterValue": "Enter HDG, FL or SPD.",

    // errors
    "err.badScenario": "Invalid scenario: no 'planes' array.",
    "err.fileTooBig": "File too large (max 1 MB).",
    "err.noProxy": "No proxy — open the page via 'node server.js'",
    "err.rateLimit": "OpenSky rate limit reached, try again later",

    // event log
    "log.area": "{cs} infringed restricted area {area}",
    "log.dep": "{cs} departed runway {rwy} → {exit}",
    "log.ils": "{cs} established on ILS {rwy} localizer",
    "log.goAround": "{cs} going around",
    "log.wxLeft": "{cs} deviating left for weather",
    "log.wxRight": "{cs} deviating right for weather",
    "log.emergency": "{cs} SQUAWK {code} ({label})",
    "log.emergencyEnd": "{cs} emergency cancelled",
    "log.cmd": "{cs} {rb}",
    "log.hint": "{pair} resolution advice taken (−{cost})",
    "log.traffic": "{pair} predicted conflict · CPA {t}s {d}NM",
    "log.conflict": "{pair} SEPARATION LOSS · {dh}NM {dv}FT",
    "log.clear": "{pair} separation restored",
    "log.resolved": "{pair} conflict resolved by clearance",
    "log.resolvedPts": "{pair} conflict resolved by clearance (+{pts})",
    "log.landed": "{cs} landed runway {rwy}",
    "log.scnLoaded": "Scenario loaded: {name} ({n} targets)",
    "log.scnSkipped": "Unknown fixes skipped: {fixes}",
    "log.scnFailed": "Scenario could not be loaded: {err}",
    "log.trainingOn": "Training mode on: resolve conflicts with clearances, clear arrivals for the ILS.",
    "log.trainingOff": "Training mode off.",
    "log.liveStart": "Live data: OpenSky · {r} NM around {icao} · every {s}s",
    "log.liveRestored": "Live data connection restored",
    "log.liveError": "Live data error: {err}",
  },

  tr: {
    "panel.targets": "HEDEF LİSTESİ",
    "panel.log": "OLAY GÜNLÜĞÜ",
    "panel.detail": "HEDEF BİLGİSİ",
    "panel.cmd": "KOMUT",
    "panel.squawk": "SQUAWK / ACİL DURUM",
    "panel.conflicts": "ÇAKIŞMA ANALİZİ",
    "btn.csv": "CSV ⇩",
    "btn.csvTitle": "CSV olarak indir",
    "btn.apply": "UYGULA",
    "btn.nav": "NAV",
    "btn.navTitle": "Vektörden önce izlediği rotaya geri döner",
    "btn.res": "RES SPD",
    "btn.resTitle": "Hız kısıtlamasını kaldır (RES)",
    "btn.normal": "NORMAL",
    "dct.placeholder": "DCT …",
    "dct.aria": "Direkt nokta",
    "cmd.linePlaceholder": "HDG 270 FL 240 SPD 280 · DCT TUZLA · NAV · ILS",
    "ctl.range": "MENZİL",
    "ctl.sweep": "TARAMA",
    "ctl.sim": "SİM",
    "ctl.layers": "KATMAN",
    "ctl.scenario": "SENARYO",
    "layer.map": "HARİTA",
    "layer.wx": "WX",
    "layer.areas": "SAHA",
    "layer.clutter": "CLUTTER",
    "fl.minAria": "Alt FL",
    "fl.maxAria": "Üst FL",
    "scn.aria": "Senaryo",
    "scn.reloadTitle": "Seçili senaryoyu yeniden başlat",
    "scn.load": "YÜKLE…",
    "scn.save": "KAYDET",
    "timeline.aria": "Kayıt zaman çizgisi",
    "radar.aria": "Radar ekranı",
    "lang.title": "Switch to English",

    "btn.pause": "❚❚ DURDUR",
    "btn.play": "▶ OYNAT",
    "btn.ruler": "⟷ CETVEL",
    "btn.sound": "♪ SES: {s}",
    "btn.training": "◎ EĞİTİM: {s}",
    "btn.source": "⇄ KAYNAK: {s}",
    "btn.now": "● ŞİMDİ",
    "on": "AÇIK",
    "off": "KAPALI",
    "src.sim": "SİM",
    "src.live": "CANLI",

    "scn.random": "Rastgele trafik",
    "scn.crossing": "Kesişen hava yolları",
    "scn.approach": "Yoğun yaklaşma",
    "scn.emergency": "Acil durum",
    "scn.custom": "Özel senaryo",
    "scn.file": "Dosya: {name}",
    "scn.savedName": "{name} (kayıt T+{t})",

    "hint.default": "Tıkla: seç · Seçili hedefi sürükle: HDG · Hız çizgisine tıkla: projeksiyon · Etiketi sürükle (çift tık: sıfırla) · R: cetvel · /: komut · Space: durdur",
    "hint.ruler": "CETVEL: iki hedefe sırayla tıkla · boşluğa tıkla: sıfırla · Esc: çık",

    "score.detail": "Ç{r} İ{v} S{a}",
    "score.title": "Çözülen / Ayrım ihlali / Saha ihlali",
    "detail.empty": "Radarda veya listede bir hedef seçin.",
    "detail.primary": "YALNIZ PRİMER",
    "detail.noModeC": "--- (Mode C yok)",
    "nav.replay": "— (kayıt)",
    "nav.vfr": "VFR · transponder yok",
    "nav.departure": "KALKIŞ · PİST BAŞI → {exit}",
    "nav.wx": " · WX SAPMA",
    "nav.resume": " · NAV → {to}",
    "proj": "PROJEKSİYON 1/3/5 DK: {s}",
    "cf.none": "Çakışma yok.",
    "cf.loss": "{dh} NM · {dv} FT · AYRIM İHLALİ",
    "cf.traffic": "CPA {t}s · {d} NM · ŞU AN {now} NM",
    "cf.hint": "İPUCU (−{cost})",
    "cf.noAdvice": "Tek komutla çözüm bulunamadı",
    "cf.advice": "ÖNERİ",
    "cf.advTitle": "Tıkla: uygula · üzerine gel: önizleme",
    "log.empty": "Henüz olay yok.",
    "tl.replay": "REPLAY T+{t} / {end}",
    "tl.now": "ŞİMDİ · KAYIT {rec}",

    "probe.clear": "ÖNİZLEME {cs} {rb}: {min} dk içinde çakışma yok ✓",
    "probe.ongoing": "ÖNİZLEME: {cs} ile ayrım ihlali sürüyor, {when}'de sağlanıyor",
    "probe.ongoingNever": "ÖNİZLEME: {cs} ile ayrım ihlali {min} dk içinde düzelmiyor",
    "probe.conflict": "ÖNİZLEME: {cs} ile {t} sonra çakışma ({d} NM)",
    "probe.more": " · +{n} hedef",
    "probe.noPath": "ÖNİZLEME: bu komut için yol tahmini yok (ILS)",

    "cmd.notCommandable": "Bu hedefe komut verilemez.",
    "cmd.landed": "{cs} indi.",
    "cmd.nordo": "{cs}: TELSİZ ARIZASI (7600) — yanıt yok.",
    "cmd.empty": "Boş komut.",
    "cmd.hdgRange": "HDG 001–360 olmalı.",
    "cmd.flRange": "FL 010–450 olmalı.",
    "cmd.spdRange": "SPD 120–500 olmalı.",
    "cmd.unknownFix": "Bilinmeyen nokta: {fix}",
    "cmd.noNav": "{cs}: dönülecek rota yok (DCT verin).",
    "cmd.unknown": "Bilinmeyen komut: {tok}",
    "cmd.enterValue": "HDG, FL veya SPD girin.",

    "err.badScenario": "Geçersiz senaryo: 'planes' dizisi bulunamadı.",
    "err.fileTooBig": "Dosya çok büyük (en fazla 1 MB).",
    "err.noProxy": "Proxy yok — sayfayı 'node server.js' ile açın",
    "err.rateLimit": "OpenSky istek limiti doldu, daha sonra deneyin",

    "log.area": "{cs} {area} sahasına izinsiz girdi",
    "log.dep": "{cs} {rwy} pistinden kalktı → {exit}",
    "log.ils": "{cs} ILS {rwy} localizer'ı yakaladı",
    "log.goAround": "{cs} pas geçti (go-around)",
    "log.wxLeft": "{cs} hava durumu nedeniyle sola sapıyor",
    "log.wxRight": "{cs} hava durumu nedeniyle sağa sapıyor",
    "log.emergency": "{cs} SQUAWK {code} ({label})",
    "log.emergencyEnd": "{cs} acil durum sona erdi",
    "log.cmd": "{cs} {rb}",
    "log.hint": "{pair} çözüm önerisi alındı (−{cost})",
    "log.traffic": "{pair} öngörülen çakışma · CPA {t}s {d}NM",
    "log.conflict": "{pair} AYRIM İHLALİ · {dh}NM {dv}FT",
    "log.clear": "{pair} ayrım yeniden sağlandı",
    "log.resolved": "{pair} çakışma komutla çözüldü",
    "log.resolvedPts": "{pair} çakışma komutla çözüldü (+{pts})",
    "log.landed": "{cs} {rwy} pistine indi",
    "log.scnLoaded": "Senaryo yüklendi: {name} ({n} hedef)",
    "log.scnSkipped": "Bilinmeyen noktalar atlandı: {fixes}",
    "log.scnFailed": "Senaryo yüklenemedi: {err}",
    "log.trainingOn": "Eğitim modu açık: çakışmaları komutla çöz, gelen trafiğe ILS ver.",
    "log.trainingOff": "Eğitim modu kapalı.",
    "log.liveStart": "Canlı veri: OpenSky · {icao} çevresi {r} NM · {s} sn'de bir",
    "log.liveRestored": "Canlı veri bağlantısı yeniden kuruldu",
    "log.liveError": "Canlı veri hatası: {err}",
  },
};

const LANGS = ["en", "tr"];
let LANG = "en";
try {
  const saved = localStorage.getItem("radar.lang");
  if (LANGS.includes(saved)) LANG = saved;
} catch { /* storage unavailable: keep English */ }

/**
 * Translate `key`, filling {placeholders} from `params`. A param value of the form
 * "@some.key" is itself translated, so stored log entries follow language changes.
 */
function i18n(key, params = {}) {
  const s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (v == null) return "";
    return typeof v === "string" && v.startsWith("@") ? i18n(v.slice(1)) : String(v);
  });
}

/** Fill elements marked with data-i18n / data-i18n-title / -placeholder / -aria. */
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((e) => (e.textContent = i18n(e.dataset.i18n)));
  document.querySelectorAll("[data-i18n-title]").forEach((e) => (e.title = i18n(e.dataset.i18nTitle)));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((e) => (e.placeholder = i18n(e.dataset.i18nPlaceholder)));
  document.querySelectorAll("[data-i18n-aria]").forEach((e) => e.setAttribute("aria-label", i18n(e.dataset.i18nAria)));
}

function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  LANG = lang;
  try { localStorage.setItem("radar.lang", lang); } catch { /* ignore */ }
}
