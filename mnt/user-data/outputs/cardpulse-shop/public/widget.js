// public/widget.js – Wird vom Shopify-Theme eingebunden und rendert das
// Cardmarket-Preis-Widget auf der Produktseite.
//
// Einbau im Shopify-Theme (Produkt-Template), z.B.:
//
//   <div id="cardpulse-widget"
//        data-slug="{{ product.metafields.cardpulse.cardmarket_slug }}"
//        data-shop-price="{{ product.price | money_without_currency }}"
//        data-lang="{{ product.metafields.cardpulse.product_language }}"></div>
//   <script src="https://DEINE-API.onrender.com/widget.js"
//           data-key="{{ shop.metafields.cardpulse.api_key }}"></script>
//
// Der Key liegt als Shop-Metafield, nicht im Quelltext einzelner Seiten.

(function () {
  "use strict";

  var API_BASE = (function () {
    // Basis-URL aus dem <script src> ableiten
    var cur = document.currentScript;
    if (cur && cur.src) {
      try { return new URL(cur.src).origin; } catch (e) {}
    }
    return "";
  })();

  var SHOP_KEY = (function () {
    var cur = document.currentScript;
    return cur ? cur.getAttribute("data-key") : null;
  })();

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function fmtEUR(n) {
    if (n == null) return "–";
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  // Sprach-Hinweis nur wenn nötig (EN/JP = 1:1, sonst Hinweis)
  function langNote(lang) {
    var L = (lang || "").toUpperCase().trim();
    if (L === "" ) return null;
    // Cardmarket-Preise sind sprachübergreifend pro Produkt-ID – wir geben
    // einen kurzen, ehrlichen Hinweis statt eines harten Sprach-Disclaimers.
    return "Cardmarket-Marktpreis über alle Sprachversionen dieses Produkts.";
  }

  function render(container, data, shopPriceRaw, lang) {
    var p = data.price || {};
    var prod = data.product || {};
    var shopPrice = shopPriceRaw != null ? parseFloat(shopPriceRaw) : null;

    var note = langNote(lang);

    container.innerHTML = "";
    var card = el("div", { class: "cp-shop-card" });

    // Kopf
    card.appendChild(el("div", { class: "cp-shop-head" },
      '<span class="cp-shop-eyebrow">Cardmarket Marktpreis</span>' +
      '<span class="cp-shop-brand">via CardPulse</span>'));

    // Preiszeile(n)
    var prices = el("div", { class: "cp-shop-prices" });
    if (shopPrice != null) {
      prices.appendChild(el("div", { class: "cp-shop-pbox cp-shop-pbox--own" },
        '<div class="cp-shop-plabel">Dieser Shop</div>' +
        '<div class="cp-shop-pval">' + fmtEUR(shopPrice) + '</div>' +
        '<div class="cp-shop-psub">inkl. MwSt.</div>'));
    }
    prices.appendChild(el("div", { class: "cp-shop-pbox" },
      '<div class="cp-shop-plabel">Cardmarket ab</div>' +
      '<div class="cp-shop-pval">' + fmtEUR(p.lowest) + '</div>' +
      '<div class="cp-shop-psub">niedrigstes Angebot</div>'));
    card.appendChild(prices);

    // Schnitt-Werte
    if (p.avg7d != null || p.avg30d != null) {
      card.appendChild(el("div", { class: "cp-shop-avgs" },
        '<span>7-Tage Ø: <b>' + fmtEUR(p.avg7d) + '</b></span>' +
        '<span>30-Tage Ø: <b>' + fmtEUR(p.avg30d) + '</b></span>'));
    }

    if (note) {
      card.appendChild(el("div", { class: "cp-shop-note" }, note));
    }

    container.appendChild(card);
    injectStyles();
  }

  function renderError(container, code) {
    var msg = {
      PRODUCT_NOT_MAPPED: "Für dieses Produkt liegen noch keine Marktdaten vor.",
      LIMIT_REACHED: "",      // dem Endkunden nichts zeigen
      INVALID_SHOP_KEY: "",
      ORIGIN_NOT_ALLOWED: "",
    }[code];
    // Bei Key-/Limit-Problemen Widget einfach ausblenden (kein Kunden-Ärger)
    if (!msg) { container.style.display = "none"; return; }
    container.innerHTML = '<div class="cp-shop-card"><div class="cp-shop-note">' + msg + "</div></div>";
    injectStyles();
  }

  var _styled = false;
  function injectStyles() {
    if (_styled) return; _styled = true;
    var css =
      ".cp-shop-card{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border:1px solid #e5e5e5;border-radius:12px;padding:16px;max-width:420px;background:#fff;color:#1a1a1a}" +
      ".cp-shop-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}" +
      ".cp-shop-eyebrow{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#666}" +
      ".cp-shop-brand{font-size:10px;color:#999}" +
      ".cp-shop-prices{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      ".cp-shop-pbox{background:#f6f6f6;border-radius:8px;padding:10px}" +
      ".cp-shop-pbox--own{outline:1px solid #d0d0d0}" +
      ".cp-shop-plabel{font-size:11px;color:#666;margin-bottom:2px}" +
      ".cp-shop-pval{font-size:20px;font-weight:600}" +
      ".cp-shop-psub{font-size:11px;color:#888;margin-top:2px}" +
      ".cp-shop-avgs{display:flex;gap:16px;font-size:12px;color:#555;margin-top:10px}" +
      ".cp-shop-note{font-size:11px;color:#777;margin-top:10px;line-height:1.5}";
    document.head.appendChild(el("style", null, css));
  }

  function init() {
    var container = document.getElementById("cardpulse-widget");
    if (!container || !SHOP_KEY) return;

    var slug = container.getAttribute("data-slug");
    var shopPrice = container.getAttribute("data-shop-price");
    var lang = container.getAttribute("data-lang");

    if (!slug) { container.style.display = "none"; return; }

    fetch(API_BASE + "/widget/sealed?slug=" + encodeURIComponent(slug), {
      headers: { "X-Shop-Key": SHOP_KEY },
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      })
      .then(function (res) {
        if (res.ok) render(container, res.body, shopPrice, lang);
        else renderError(container, res.body && res.body.error);
      })
      .catch(function () { container.style.display = "none"; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
