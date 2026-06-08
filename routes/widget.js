// public/widget.js – Cardmarket-Preis-Widget für die Produktseite.
//
// Einbau (Shopify-Produkt-Template):
//   <div id="cardpulse-widget"
//        data-slug="{{ product.metafields.cardpulse.cardmarket_slug }}"
//        data-shop-price="{{ product.price | money_without_currency }}"></div>
//   <script src="https://app.card-pulse.com/widget.js"
//           data-key="{{ shop.metafields.cardpulse.api_key }}"></script>
//
// Design: dezent & minimal. Pro Shop individuell über das in der DB
// hinterlegte `theme`-JSON (kommt mit der API-Antwort) anpassbar.

(function () {
  "use strict";

  var API_BASE = (function () {
    var cur = document.currentScript;
    if (cur && cur.src) { try { return new URL(cur.src).origin; } catch (e) {} }
    return "";
  })();

  var SHOP_KEY = (function () {
    var cur = document.currentScript;
    return cur ? cur.getAttribute("data-key") : null;
  })();

  function fmtEUR(n) {
    if (n == null) return "–";
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function parseShopPrice(raw) {
    if (!raw) return null;
    // Shopify money_without_currency: "340,00" oder "340.00"
    var s = String(raw).trim().replace(/\s/g, "");
    if (s.indexOf(",") > -1 && s.indexOf(".") > -1) {
      s = s.replace(/\./g, "").replace(",", ".");      // 1.340,00 → 1340.00
    } else if (s.indexOf(",") > -1) {
      s = s.replace(",", ".");                          // 340,00 → 340.00
    }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // ── Theme ────────────────────────────────────────────────────────────
  // Default = dezent, neutral. Wird vom Shop-Theme (DB) überschrieben.
  var DEFAULT_THEME = {
    accent: "#111111",        // Akzent (Linien, Hervorhebung)
    text: "#1a1a1a",          // Haupttext
    muted: "#8a8a8a",         // Labels / Sekundärtext
    bg: "transparent",        // Hintergrund der Karte
    border: "#e6e6e6",        // Rahmen / Trennlinien
    radius: "10px",           // Eckenradius
    font: "inherit",          // Schriftart (inherit = Shop-Schrift übernehmen)
    layout: "inline",         // "inline" (schlanke Zeile) | "card" (kleine Karte)
    label: "Marktpreis",      // Überschrift links
    brand: "CardPulse",       // Markenhinweis rechts
    showBrand: true,          // Markenhinweis anzeigen?
    showAverages: true,       // 7/30-Tage-Schnitt zeigen?
    cheaperText: "Du sparst", // Text wenn Shop günstiger ist
    note: ""                  // optionaler Fußnoten-Text
  };

  function mergeTheme(t) {
    var out = {};
    for (var k in DEFAULT_THEME) out[k] = DEFAULT_THEME[k];
    if (t) for (var j in t) if (t[j] != null) out[j] = t[j];
    return out;
  }

  var STYLE_ID = "cp-shop-style";
  function injectStyle(th) {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      ".cp-w{font-family:" + th.font + ";color:" + th.text + ";box-sizing:border-box;" +
        "border:1px solid " + th.border + ";border-radius:" + th.radius + ";background:" + th.bg + ";" +
        "padding:12px 14px;margin:14px 0;max-width:100%;font-size:14px;line-height:1.4}" +
      ".cp-w *{box-sizing:border-box}" +
      ".cp-w-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}" +
      ".cp-w-label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:" + th.muted + "}" +
      ".cp-w-brand{font-size:10px;color:" + th.muted + ";opacity:.8}" +
      ".cp-w-brand b{color:" + th.accent + ";font-weight:600}" +
      ".cp-w-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}" +
      ".cp-w-cmp{font-size:13px;color:" + th.muted + "}" +
      ".cp-w-cmp b{color:" + th.text + ";font-weight:600;font-size:15px}" +
      ".cp-w-save{font-size:12px;font-weight:600;color:#1a8a4a;background:rgba(26,138,74,.1);" +
        "padding:2px 8px;border-radius:999px;white-space:nowrap}" +
      ".cp-w-over{font-size:12px;color:" + th.muted + "}" +
      ".cp-w-trend{display:flex;gap:16px;font-size:11px;color:" + th.muted + ";margin-top:8px;" +
        "border-top:1px solid " + th.border + ";padding-top:8px}" +
      ".cp-w-trend .v{color:" + th.text + ";font-weight:600}" +
      ".cp-w-trend .up{color:#1a8a4a;font-weight:600}" +
      ".cp-w-trend .dn{color:#c4341a;font-weight:600}" +
      ".cp-w-note{font-size:10px;color:" + th.muted + ";margin-top:6px;opacity:.85}" +
      ".cp-w--card{padding:16px}";
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  function render(container, data, shopPriceRaw) {
    var th = mergeTheme(data.theme);
    injectStyle(th);

    var p = data.price || {};
    var cm = p.lowest;
    var shopPrice = parseShopPrice(shopPriceRaw);

    var card = document.createElement("div");
    card.className = "cp-w" + (th.layout === "card" ? " cp-w--card" : "");

    // Kopfzeile: Label links, Marke rechts
    var top = '<div class="cp-w-top"><span class="cp-w-label">' + esc(th.label) + "</span>";
    if (th.showBrand) {
      top += '<span class="cp-w-brand">via <b>' + esc(th.brand) + "</b></span>";
    }
    top += "</div>";

    // Hauptzeile: Cardmarket-Preis + Spar-Hinweis (NUR wenn Shop günstiger)
    var row = '<div class="cp-w-row">';
    row += '<span class="cp-w-cmp">Cardmarket ab <b>' + fmtEUR(cm) + "</b></span>";
    if (shopPrice != null && cm != null) {
      var diff = cm - shopPrice;
      if (diff > 0.01) {
        row += '<span class="cp-w-save">' + esc(th.cheaperText) + " " + fmtEUR(diff) + "</span>";
      }
      // teurer-Fall: bewusst KEIN Hinweis – nur der Marktpreis steht da.
    }
    row += "</div>";

    var html = top + row;

    // Durchschnitte als Abweichung des aktuellen Preises vom 7-/30-Tage-Schnitt.
    // Ehrlich aus vorhandenen TCGGO-Daten (kein erfundener Trend).
    if (th.showAverages && cm != null && (p.avg7d != null || p.avg30d != null)) {
      html += '<div class="cp-w-trend">';
      if (p.avg7d != null)  html += "<span>vs. 7-Tage Ø: " + pctTag(cm, p.avg7d) + "</span>";
      if (p.avg30d != null) html += "<span>vs. 30-Tage Ø: " + pctTag(cm, p.avg30d) + "</span>";
      html += "</div>";
    }

    // Fußnote (optional, aus Theme)
    if (th.note) {
      html += '<div class="cp-w-note">' + esc(th.note) + "</div>";
    }

    card.innerHTML = html;
    container.innerHTML = "";
    container.appendChild(card);
  }

  // Abweichung des aktuellen Preises vom Durchschnitt, als Pillen-Text.
  // current > avg  → Preis liegt über dem Schnitt (grün ↗), sonst (rot ↘).
  function pctTag(current, avg) {
    if (current == null || avg == null || avg === 0) return '<span class="v">–</span>';
    var pct = ((current - avg) / avg) * 100;
    var rounded = Math.round(pct * 10) / 10;
    if (Math.abs(rounded) < 0.05) return '<span class="v">±0 %</span>';
    var cls = rounded > 0 ? "up" : "dn";
    var arrow = rounded > 0 ? "↗" : "↘";
    var sign = rounded > 0 ? "+" : "";
    return '<span class="' + cls + '">' + arrow + " " + sign + rounded.toLocaleString("de-DE") + " %</span>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function init() {
    var container = document.getElementById("cardpulse-widget");
    if (!container || !SHOP_KEY) return;

    var slug = container.getAttribute("data-slug");
    var shopPrice = container.getAttribute("data-shop-price");
    if (!slug) { container.style.display = "none"; return; }

    fetch(API_BASE + "/widget/sealed?slug=" + encodeURIComponent(slug), {
      headers: { "X-Shop-Key": SHOP_KEY },
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      })
      .then(function (res) {
        if (res.ok) render(container, res.body, shopPrice);
        else container.style.display = "none"; // bei Fehler still verbergen
      })
      .catch(function () { container.style.display = "none"; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
