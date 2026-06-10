// public/widget.js – Cardmarket-Preis-Widget für die Produktseite.
//
// Einbau (Shopify-Produkt-Template):
//   <div id="cardpulse-widget"
//        data-slug="{{ product.metafields.cardpulse.cardmarket_slug }}"
//        data-shop-price="{{ product.price | money_without_currency }}"></div>
//   <script src="https://app.card-pulse.com/widget.js"
//           data-key="{{ shop.metafields.cardpulse.api_key }}"></script>
//
// Optionale Design-Overrides am <div> (übersteuern das pro-Shop-Theme):
//   data-size="kompakt|normal|gross"
//   data-max-width="400px"          (px/rem/em/%, begrenzt die Breite)
//   data-accent="#6c63ff"          (Hex, rgb(), oder benannte Farbe)
//   data-radius="12px"             (px/rem/em oder 0)
//   data-show-brand="true|false"
//
// Design: dezent & minimal. Reihenfolge: Default < DB-Theme < data-Attribute.

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
    accent: "#6c63ff",        // Akzent (Markenhinweis, Hervorhebung)
    text: "#1a1a1a",          // Haupttext / Preise
    muted: "#8a8a8a",         // Labels / Sekundärtext
    bg: "#ffffff",            // Hintergrund der Karte
    border: "#e6e6e6",        // Rahmen / Box-Linien
    radius: "12px",           // Eckenradius der Karte
    font: "inherit",          // Schriftart (inherit = Shop-Schrift übernehmen)
    size: "normal",           // "kompakt" | "normal" | "gross"
    maxWidth: "",             // z.B. "400px" – begrenzt die Breite (leer = volle Breite, responsiv)
    label: "Marktpreis-Vergleich", // Überschrift links
    brand: "CardPulse",       // Markenhinweis rechts
    showBrand: true,          // Markenhinweis anzeigen?
    cheaperText: "Du sparst", // Text wenn Shop günstiger ist
    note: ""                  // optionaler Fußnoten-Text
  };

  // Drei Größenvarianten. Jede definiert Abstände und Schriftgrößen.
  var SIZE_PRESETS = {
    kompakt: { pad: "11px 13px", gap: "8px",  boxGap: "7px",  boxPad: "8px 10px",  boxRadius: "8px",
               labelFs: "10px", blFs: "9px",  prFs: "15px", footFs: "11px" },
    normal:  { pad: "14px 16px", gap: "11px", boxGap: "9px",  boxPad: "10px 12px", boxRadius: "9px",
               labelFs: "11px", blFs: "10px", prFs: "18px", footFs: "12.5px" },
    gross:   { pad: "18px 20px", gap: "14px", boxGap: "10px", boxPad: "12px 13px", boxRadius: "10px",
               labelFs: "12px", blFs: "11px", prFs: "20px", footFs: "14px" }
  };

  // Theme-Reihenfolge (späteres gewinnt):
  //   1. DEFAULT_THEME  2. DB-Theme (pro Shop)  3. data-Attribute vom Shop
  // Nur SICHERE Optionen sind per data-Attribut übersteuerbar.
  function mergeTheme(dbTheme, container) {
    var out = {};
    for (var k in DEFAULT_THEME) out[k] = DEFAULT_THEME[k];
    if (dbTheme) for (var j in dbTheme) if (dbTheme[j] != null) out[j] = dbTheme[j];

    // Sichere Overrides aus data-Attributen des Containers.
    if (container) {
      var get = function (name) {
        var v = container.getAttribute(name);
        return v == null || v === "" ? null : v;
      };
      // Akzentfarbe: nur gültige CSS-Farbwerte (Hex / rgb / benannte) zulassen
      var accent = get("data-accent");
      if (accent && isSafeColor(accent)) out.accent = accent;

      // Eckenradius: nur Zahl + px/rem/em oder 0 zulassen
      var radius = get("data-radius");
      if (radius && /^(\d+(\.\d+)?(px|rem|em)|0)$/.test(radius)) out.radius = radius;

      // Markenhinweis-Schalter
      var brand = get("data-show-brand");
      if (brand === "true") out.showBrand = true;
      if (brand === "false") out.showBrand = false;

      // Größen-Variante: nur bekannte Werte zulassen
      var size = get("data-size");
      if (size === "kompakt" || size === "normal" || size === "gross") out.size = size;

      // Max-Breite: nur Zahl + px/rem/em oder % zulassen
      var mw = get("data-max-width");
      if (mw && /^(\d+(\.\d+)?(px|rem|em|%))$/.test(mw)) out.maxWidth = mw;
    }
    return out;
  }

  // Erlaubt nur unkritische Farbformate: #hex, rgb()/rgba(), benannte Farben.
  // Verhindert CSS-Injection (kein ";", keine url(), kein Whitespace-Tricks).
  function isSafeColor(v) {
    v = String(v).trim();
    if (/[;{}()<>]/.test(v) && !/^rgba?\([\d.,\s%]+\)$/i.test(v)) return false;
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
           /^rgba?\([\d.,\s%]+\)$/i.test(v) ||
           /^[a-z]{3,20}$/i.test(v); // benannte Farben wie "purple", "navy"
  }

  var STYLE_ID = "cp-shop-style";
  function injectStyle(th) {
    if (document.getElementById(STYLE_ID)) return;
    var sz = SIZE_PRESETS[th.size] || SIZE_PRESETS.normal;
    var maxW = th.maxWidth ? th.maxWidth : "100%";
    var css =
      ".cp-w{font-family:" + th.font + ";color:" + th.text + ";box-sizing:border-box;" +
        "border:1px solid " + th.border + ";border-radius:" + th.radius + ";background:" + th.bg + ";" +
        "padding:" + sz.pad + ";margin:14px 0;max-width:" + maxW + ";line-height:1.4}" +
      ".cp-w *{box-sizing:border-box}" +
      ".cp-w-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:" + sz.gap + "}" +
      ".cp-w-label{font-size:" + sz.labelFs + ";font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:" + th.muted + "}" +
      ".cp-w-brand{font-size:10px;color:" + th.muted + ";opacity:.85;white-space:nowrap}" +
      ".cp-w-brand b{color:" + th.accent + ";font-weight:600}" +
      // Grid der Preis-Boxen – passt sich der Box-Zahl an, bricht responsiv um
      ".cp-w-grid{display:grid;gap:" + sz.boxGap + "}" +
      ".cp-w-grid--2{grid-template-columns:1fr 1fr}" +
      ".cp-w-grid--3{grid-template-columns:1fr 1fr 1fr}" +
      ".cp-w-grid--1{grid-template-columns:1fr}" +
      ".cp-w-box{border-radius:" + sz.boxRadius + ";padding:" + sz.boxPad + ";background:#f6f6f9;border:1px solid " + th.border + ";min-width:0}" +
      ".cp-w-box--shop{background:#f6f6f9}" +
      ".cp-w-box--shop.is-good{background:rgba(26,138,74,.08);border-color:rgba(26,138,74,.3)}" +
      ".cp-w-bl{font-size:" + sz.blFs + ";text-transform:uppercase;letter-spacing:.03em;color:" + th.muted + ";margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".cp-w-pr{font-size:" + sz.prFs + ";font-weight:700;color:" + th.text + ";white-space:nowrap}" +
      ".cp-w-box--shop.is-good .cp-w-pr{color:#1a8a4a}" +
      ".cp-w-foot{font-size:" + sz.footFs + ";font-weight:600;margin-top:" + sz.gap + ";text-align:center;color:" + th.muted + "}" +
      ".cp-w-foot.is-good{color:#1a8a4a}" +
      ".cp-w-note{font-size:10px;color:" + th.muted + ";margin-top:6px;opacity:.85;text-align:center}" +
      // Responsive: auf schmalen Containern Boxen untereinander stapeln
      "@container (max-width:340px){.cp-w-grid--2,.cp-w-grid--3{grid-template-columns:1fr}}" +
      "@media (max-width:380px){.cp-w-grid--3{grid-template-columns:1fr 1fr}}";
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  function render(container, data, shopPriceRaw) {
    var th = mergeTheme(data.theme, container);
    injectStyle(th);

    var p = data.price || {};
    var cm = (p.lowest != null) ? p.lowest : null;       // Cardmarket (EUR)
    var tcg = (p.tcgplayer != null) ? p.tcgplayer : null; // TCGPlayer (EUR, schon umgerechnet)
    var shopPrice = parseShopPrice(shopPriceRaw);

    // Welche Marktpreise zeigen wir? TCGPlayer nur, wenn vorhanden UND höher als
    // der Shop-Preis (sonst arbeitet er gegen den Shop → weglassen).
    var showTcg = (tcg != null && shopPrice != null && tcg > shopPrice + 0.01);

    // Ist der Shop günstiger als mindestens ein gezeigter Markt? → grün
    var cheaperThanCm  = (shopPrice != null && cm  != null && cm  > shopPrice + 0.01);
    var cheaperThanTcg = (shopPrice != null && showTcg && tcg > shopPrice + 0.01);
    var isCheaper = cheaperThanCm || cheaperThanTcg;

    var card = document.createElement("div");
    card.className = "cp-w cp-w--" + (th.size || "normal");

    // Kopfzeile
    var html = '<div class="cp-w-top"><span class="cp-w-label">' + esc(th.label) + "</span>";
    if (th.showBrand) {
      html += '<span class="cp-w-brand">via <b>' + esc(th.brand) + "</b></span>";
    }
    html += "</div>";

    // Preis-Boxen: Shop (falls bekannt) + Cardmarket (+ TCGPlayer falls sinnvoll)
    var boxes = [];
    if (shopPrice != null) {
      boxes.push('<div class="cp-w-box cp-w-box--shop' + (isCheaper ? " is-good" : "") + '">' +
        '<div class="cp-w-bl">Dieser Shop</div><div class="cp-w-pr">' + fmtEUR(shopPrice) + "</div></div>");
    }
    if (cm != null) {
      boxes.push('<div class="cp-w-box"><div class="cp-w-bl">Cardmarket</div>' +
        '<div class="cp-w-pr">' + fmtEUR(cm) + "</div></div>");
    }
    if (showTcg) {
      boxes.push('<div class="cp-w-box"><div class="cp-w-bl">TCGplayer</div>' +
        '<div class="cp-w-pr">' + fmtEUR(tcg) + "</div></div>");
    }
    html += '<div class="cp-w-grid cp-w-grid--' + boxes.length + '">' + boxes.join("") + "</div>";

    // Spar-Hinweis (nur wenn günstiger als mind. ein Markt)
    if (isCheaper) {
      // höchster Markt, den der Shop unterbietet → größtmögliche Ersparnis ehrlich zeigen
      var refs = [];
      if (cheaperThanCm)  refs.push(cm);
      if (cheaperThanTcg) refs.push(tcg);
      var maxRef = Math.max.apply(null, refs);
      var saving = maxRef - shopPrice;
      var label;
      if (cheaperThanCm && cheaperThanTcg) {
        label = "✓ Günstiger als beide Marktpreise – bis zu " + fmtEUR(saving) + " gespart";
      } else if (cheaperThanTcg && !cheaperThanCm) {
        label = "✓ " + fmtEUR(saving) + " günstiger als auf TCGplayer";
      } else {
        label = "✓ " + esc(th.cheaperText) + " " + fmtEUR(saving) + " gegenüber dem Marktpreis";
      }
      html += '<div class="cp-w-foot is-good">' + label + "</div>";
    } else if (shopPrice == null && cm != null) {
      // Kein Shop-Preis bekannt → neutrale Marktpreis-Info
      html += '<div class="cp-w-foot">Aktueller Marktpreis zum Vergleich</div>';
    }

    // Fußnote (optional)
    if (th.note) {
      html += '<div class="cp-w-note">' + esc(th.note) + "</div>";
    }

    card.innerHTML = html;
    container.innerHTML = "";
    container.appendChild(card);
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
