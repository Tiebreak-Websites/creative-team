"""LP Builder — the ONE compositor.

Both the builder canvas (POST /compose -> iframe srcdoc) and the ZIP export
run through compose_page(), so the editor preview and the shipped site can
never drift. mode:
  "editor"  — data-lp-* kept + the editor runtime injected (selection,
              inline editing, drop indicator) — builder canvas only.
  "preview" — data-lp-* kept (override CSS targets them; they are inert,
              valid data attributes), NO runtime — Preview mode + export.

Export additionally resolves every image to a local `assets/<hash>.<ext>`
file and bundles index.html + styles.css + script.js + assets/ into a ZIP.
"""
from __future__ import annotations

import hashlib
import html as html_mod
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Callable, Dict, List, Optional

from . import core

# ---------------------------------------------------------------------------
# Shared page chrome
# ---------------------------------------------------------------------------
BASE_CSS = """*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--lp-font);color:var(--lp-text);background:var(--lp-bg);-webkit-font-smoothing:antialiased}
img{max-width:100%}
.lp-wrap{max-width:1140px;margin:0 auto;padding:0 32px}
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;background:var(--lp-primary);color:#fff;font-weight:700;border:0;cursor:pointer;border-radius:999px;padding:1rem 2.4rem;font-size:1.06rem;text-decoration:none;font-family:inherit;transition:filter .15s ease,transform .15s ease}
.lp-btn:hover{filter:brightness(1.08)}
.lp-btn:active{transform:scale(.98)}
@media (max-width:575px){.lp-wrap{padding:0 20px}.lp-btn{width:100%;}}
"""

SCRIPT_JS = """// Internovus Creative Builder - LP runtime (dependency-free)
(function () {
  // Idempotent bind, re-runnable after the builder morphs the DOM in place.
  function bind() {
  // FAQ accordion
  document.querySelectorAll('[data-lp-acc]').forEach(function (item) {
    if (item.__lpAcc) return; item.__lpAcc = true;
    var q = item.querySelector('.faq-q');
    if (q) q.addEventListener('click', function () { item.classList.toggle('open'); });
  });
  // Signup forms
  document.querySelectorAll('form[data-lp-form]').forEach(function (form) {
    if (form.__lpForm) return; form.__lpForm = true;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var action = form.getAttribute('action') || '';
      var success = form.getAttribute('data-success-url') || '';
      var btn = form.querySelector('[type="submit"]');
      function done(ok) {
        if (ok && success) { window.location.href = success; return; }
        var note = form.querySelector('.lp-form-note');
        if (!note) {
          note = document.createElement('p');
          note.className = 'lp-form-note';
          note.style.cssText = 'margin:10px 0 0;text-align:center;font-size:.9rem;';
          form.appendChild(note);
        }
        note.textContent = ok ? '\\u2713 Thank you! We\\u2019ll be in touch shortly.'
                              : 'Something went wrong \\u2014 please try again.';
        note.style.color = ok ? '#16A34A' : '#DC2626';
        if (btn) btn.disabled = false;
      }
      if (!action) { done(true); return; } // no endpoint configured: demo success
      if (btn) btn.disabled = true;
      fetch(action, { method: 'POST', body: new FormData(form) })
        .then(function (r) { done(r.ok); })
        .catch(function () { done(false); });
    });
  });
  }
  window.__lpBind = bind;
  bind();
})();
"""

# Injected ONLY in mode="editor": selection, hover outlines, inline text
# editing and the drop indicator. Talks to the builder via postMessage.
# The JS half is served as an EXTERNAL same-origin script
# (GET /api/tools/lp-builder/editor.js) — the app's production CSP is
# script-src 'self' (no 'unsafe-inline'), and a srcdoc iframe INHERITS the
# parent CSP, so an inline <script> here silently never runs on prod (the
# exact "canvas doesn't react to clicks" failure). Inline <style> is fine
# (style-src keeps 'unsafe-inline').
EDITOR_CSS = """<style id="lp-editor-css">
[data-lp-text],[data-lp-rich],[data-lp-img],[data-lp-link]{cursor:pointer}
[data-lp-text]:hover,[data-lp-rich]:hover,[data-lp-img]:hover,[data-lp-link]:hover{outline:1.5px dashed rgba(37,99,235,.75);outline-offset:2px}
.lp-ed-selected{outline:2px solid #2563EB !important;outline-offset:2px}
section[data-iid].lp-ed-selected{outline-offset:-2px}
.lp-ed-droptarget{outline:3px solid #16A34A !important;outline-offset:-3px}
#lp-drop-line{position:absolute;left:0;right:0;height:4px;background:#2563EB;border-radius:2px;display:none;z-index:9999;pointer-events:none;box-shadow:0 0 0 3px rgba(37,99,235,.25)}
#lp-sec-toolbar{position:absolute;display:none;z-index:9998;gap:2px;background:#101623;border-radius:10px;padding:3px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
#lp-sec-toolbar button{border:0;background:transparent;color:#E7ECF5;width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center}
#lp-sec-toolbar button:hover{background:#2563EB}
#lp-sec-toolbar button.lp-del:hover{background:#DC2626}
[contenteditable]{outline:2px solid #F59E0B !important;outline-offset:2px}
</style>"""

EDITOR_JS = """(function(){
  var P = window.parent;
  function post(m){ try { P.postMessage(Object.assign({lp:1}, m), '*'); } catch(e){} }
  var ATTRS = ['data-lp-text','data-lp-rich','data-lp-img','data-lp-link'];
  var SEL = ATTRS.map(function(a){return '['+a+']'}).join(',');
  function fieldsOf(el){
    var out = [];
    for (var i=0;i<ATTRS.length;i++){ var v = el.getAttribute(ATTRS[i]); if (v) out.push({kind:ATTRS[i].slice(8), key:v}); }
    return out;
  }
  function fieldOf(el){ var f = fieldsOf(el); return f.length ? f[0] : null; }
  var selected = null;
  // floating section toolbar (move up/down, duplicate, delete) — Figma-style
  var tb = document.createElement('div'); tb.id = 'lp-sec-toolbar';
  tb.innerHTML = '<button data-a="up" title="Move section up">\\u2191</button>'
    + '<button data-a="down" title="Move section down">\\u2193</button>'
    + '<button data-a="duplicate" title="Duplicate section">\\u29C9</button>'
    + '<button class="lp-del" data-a="delete" title="Delete section">\\u2715</button>';
  document.body.appendChild(tb);
  tb.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b || !tb._iid) return;
    e.preventDefault(); e.stopPropagation();
    post({type:'sectionAction', action: b.getAttribute('data-a'), iid: tb._iid});
  });
  function placeToolbar(sec){
    if (!sec) { tb.style.display='none'; tb._iid=null; return; }
    var r = sec.getBoundingClientRect();
    tb.style.display='flex'; tb._iid = sec.getAttribute('data-iid');
    tb.style.top = Math.max(6, r.top + window.scrollY + 8) + 'px';
    tb.style.left = Math.max(6, r.right - 140) + 'px';
  }
  function clearSel(){ document.querySelectorAll('.lp-ed-selected').forEach(function(n){n.classList.remove('lp-ed-selected')}); selected=null; placeToolbar(null); }
  function select(el){
    clearSel(); if (!el) { post({type:'select', iid:null}); return; }
    el.classList.add('lp-ed-selected'); selected = el;
    var sec = el.closest('section[data-iid]');
    placeToolbar(sec);
    var fs = el.matches(SEL) ? fieldsOf(el) : [];
    post({type:'select', iid: sec ? sec.getAttribute('data-iid') : null,
          fields: fs, tag: el.tagName.toLowerCase()});
  }
  window.addEventListener('scroll', function(){ if (selected) placeToolbar(selected.closest('section[data-iid]')); });
  document.addEventListener('click', function(e){
    if (e.target.closest('#lp-sec-toolbar')) return; // toolbar handles itself
    if (e.target.closest('[contenteditable]')) return;
    e.preventDefault();
    var el = e.target.closest(SEL) || e.target.closest('section[data-iid]');
    select(el);
  }, true);
  document.addEventListener('dblclick', function(e){
    var el = e.target.closest('[data-lp-text],[data-lp-rich]');
    if (!el || el.tagName === 'INPUT') return;
    e.preventDefault();
    el.setAttribute('contenteditable', 'plaintext-only');
    el.focus();
    var f = fieldOf(el), sec = el.closest('section[data-iid]');
    function send(){ post({type:'text', iid: sec.getAttribute('data-iid'), key: f.key, value: el.innerText}); }
    el.addEventListener('input', send);
    el.addEventListener('blur', function(){ el.removeAttribute('contenteditable'); send(); }, {once:true});
  }, true);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') { document.activeElement && document.activeElement.blur && document.activeElement.blur(); select(null); } });
  // drag & drop: sections from the Add tab (insertion line) and ASSETS from
  // the Assets tab (highlight the image slot under the cursor).
  var line = document.createElement('div'); line.id = 'lp-drop-line'; document.body.appendChild(line);
  function insertionAt(y){
    var secs = Array.prototype.slice.call(document.querySelectorAll('section[data-iid]'));
    for (var i=0;i<secs.length;i++){ var r = secs[i].getBoundingClientRect();
      if (y < r.top + r.height/2) return {index:i, y: r.top + window.scrollY}; }
    var last = secs[secs.length-1];
    return {index: secs.length, y: last ? last.getBoundingClientRect().bottom + window.scrollY : 8};
  }
  function isAssetDrag(e){
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'text/lp-asset') !== -1;
  }
  function clearDropTarget(){ document.querySelectorAll('.lp-ed-droptarget').forEach(function(n){n.classList.remove('lp-ed-droptarget')}); }
  function imgAt(e){
    var el = document.elementFromPoint(e.clientX, e.clientY);
    return el ? el.closest('[data-lp-img]') : null;
  }
  document.addEventListener('dragover', function(e){ e.preventDefault();
    if (isAssetDrag(e)) {
      line.style.display='none';
      clearDropTarget();
      var img = imgAt(e);
      if (img) img.classList.add('lp-ed-droptarget');
      return;
    }
    var at = insertionAt(e.clientY); line.style.top = at.y + 'px'; line.style.display='block'; });
  document.addEventListener('dragleave', function(e){ if (!e.relatedTarget) { line.style.display='none'; clearDropTarget(); } });
  document.addEventListener('drop', function(e){ e.preventDefault(); line.style.display='none';
    if (isAssetDrag(e)) {
      var url = e.dataTransfer.getData('text/lp-asset');
      var img = imgAt(e);
      clearDropTarget();
      if (url && img) {
        var sec = img.closest('section[data-iid]');
        post({type:'dropImage', iid: sec ? sec.getAttribute('data-iid') : null,
              key: img.getAttribute('data-lp-img'), url: url});
      }
      return;
    }
    post({type:'drop', index: insertionAt(e.clientY).index}); });
  // scroll preservation across re-renders
  var st; window.addEventListener('scroll', function(){ clearTimeout(st); st = setTimeout(function(){ post({type:'scroll', y: window.scrollY}); }, 120); });
  window.addEventListener('message', function(e){
    var m = e.data || {};
    if (m.type === 'scrollTo') window.scrollTo(0, m.y || 0);
    if (m.type === 'highlight') { var el = m.key
        ? document.querySelector('[data-iid="'+m.iid+'"] [data-lp-text="'+m.key+'"],[data-iid="'+m.iid+'"] [data-lp-rich="'+m.key+'"],[data-iid="'+m.iid+'"] [data-lp-img="'+m.key+'"],[data-iid="'+m.iid+'"] [data-lp-link="'+m.key+'"]')
        : document.querySelector('section[data-iid="'+m.iid+'"]');
      clearSel(); if (el) { el.classList.add('lp-ed-selected'); selected = el; placeToolbar(el.closest('section[data-iid]')); } }
    if (m.type === 'deselect') clearSel();
    // IN-PLACE morph: swap the page content + styles WITHOUT reloading the
    // document — scroll position, image cache and focus all survive, so the
    // canvas never jumps to the top while editing.
    if (m.type === 'update' && m.html) {
      var doc = new DOMParser().parseFromString(m.html, 'text/html');
      var ncss = doc.querySelector('#lp-main-css');
      var ocss = document.querySelector('#lp-main-css');
      if (ncss && ocss) ocss.textContent = ncss.textContent;
      selected = null;
      var frag = document.createDocumentFragment();
      Array.prototype.slice.call(doc.body.children).forEach(function(n){
        if (n.tagName === 'SCRIPT' || n.id === 'lp-drop-line' || n.id === 'lp-sec-toolbar') return;
        frag.appendChild(document.importNode(n, true));
      });
      document.body.innerHTML = '';
      document.body.appendChild(frag);
      document.body.appendChild(line);
      document.body.appendChild(tb);
      tb.style.display = 'none';
      if (window.__lpBind) { try { window.__lpBind(); } catch(err){} }
      post({type:'updated'});
    }
  });
  post({type:'ready'});
})();
"""

PLACEHOLDER_IMG = ("data:image/svg+xml," + "%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E"
                   "%3Crect width='100%25' height='100%25' fill='%23E5E9F2'/%3E"
                   "%3Ctext x='50%25' y='50%25' fill='%239AA3B5' font-family='sans-serif' font-size='28'"
                   " text-anchor='middle' dominant-baseline='middle'%3EDrop an image%3C/text%3E%3C/svg%3E")

# Whitelisted style props -> CSS
_PROP_CSS = {
    "fontSize": "font-size", "fontWeight": "font-weight", "color": "color",
    "align": "text-align", "lineHeight": "line-height", "letterSpacing": "letter-spacing",
    "transform": "text-transform", "marginTop": "margin-top", "marginBottom": "margin-bottom",
    "bg": "background", "radius": "border-radius", "fit": "object-fit",
    "height": "height", "gap": "gap",
}
_BUCKET_MQ = {"base": None, "tablet": "@media (max-width:1199px)", "mobile": "@media (max-width:575px)"}


def _esc(s: str) -> str:
    return html_mod.escape(str(s or ""), quote=False)


def _texts_for(tpl: dict, lang: str) -> Dict[str, str]:
    t = dict((tpl.get("texts") or {}).get("en") or {})
    if lang != "en":
        t.update((tpl.get("texts") or {}).get(lang) or {})
    return t


def _repeat_default_count(defaults: Dict[str, str], key: str) -> int:
    n = 0
    rx = re.compile(re.escape(key) + r"\.(\d+)\.")
    for k in defaults:
        m = rx.match(k)
        if m:
            n = max(n, int(m.group(1)) + 1)
    return max(1, n)


def _expand_repeats(tpl_html: str, inst: dict, defaults: Dict[str, str]) -> str:
    def expand(m: "re.Match") -> str:
        key, body = m.group(1), m.group(2)
        count = int((inst.get("repeats") or {}).get(key) or _repeat_default_count(defaults, key))
        count = max(1, min(12, count))
        out = []
        for i in range(count):
            clone = re.sub(r'(data-lp-(?:text|rich|img|link))="([A-Za-z0-9_-]+)"',
                           lambda mm: f'{mm.group(1)}="{key}.{i}.{mm.group(2)}"', body)
            out.append(clone)
        return "".join(out)
    return core.REPEAT_RE.sub(expand, tpl_html)


def _fill_texts(html: str, values: Dict[str, str], rich: bool) -> str:
    attr = "data-lp-rich" if rich else "data-lp-text"
    for key, raw in values.items():
        val = _esc(raw)
        if rich:
            val = val.replace("\n", "<br>")
        # <input ... data-lp-text="k" ... placeholder="..."> -> placeholder attr
        def repl_input(m: "re.Match") -> str:
            tag = m.group(0)
            if 'placeholder="' in tag:
                return re.sub(r'placeholder="[^"]*"', f'placeholder="{val}"', tag)
            return tag[:-1] + f' placeholder="{val}">'
        html = re.sub(rf'<input[^>]*{attr}="{re.escape(key)}"[^>]*>', repl_input, html)
        # normal leaf elements
        html = re.sub(rf'({attr}="{re.escape(key)}"[^>]*>)[^<]*(</)',
                      lambda m: m.group(1) + val + m.group(2), html)
    return html


def _fill_attr(html: str, marker: str, key: str, attr: str, value: str) -> str:
    def repl(m: "re.Match") -> str:
        tag = m.group(0)
        if f'{attr}="' in tag:
            return re.sub(rf'{attr}="[^"]*"', f'{attr}="{value}"', tag)
        return tag[:-1] + f' {attr}="{value}">'
    return re.sub(rf'<[a-zA-Z][^>]*{marker}="{re.escape(key)}"[^>]*>', repl, html)


def compose_section(tpl: dict, inst: dict, lang: str, tokens: dict,
                    resolve_img: Callable[[str], str]) -> str:
    defaults = _texts_for(tpl, lang)
    html = _expand_repeats(tpl.get("html") or "", inst, defaults)

    # value resolution: user override -> language default -> authored default
    parsed = core.parse_fields(html)
    text_vals: Dict[str, str] = {}
    rich_vals: Dict[str, str] = {}
    user_texts = inst.get("texts") or {}
    for f in parsed["fields"]:
        if f["kind"] in ("text", "rich"):
            base_key = re.sub(r"^([A-Za-z0-9_-]+)\.\d+\.", lambda m: m.group(0), f["key"])
            val = user_texts.get(f["key"])
            if val is None:
                val = defaults.get(f["key"])
                if val is None and "." in f["key"]:  # clone beyond defaults: reuse item 0
                    parts = f["key"].split(".")
                    val = defaults.get(f"{parts[0]}.0.{parts[-1]}")
            if val is not None:
                (rich_vals if f["kind"] == "rich" else text_vals)[f["key"]] = val
        elif f["kind"] == "img":
            raw = (inst.get("images") or {}).get(f["key"])
            if raw is None:
                base = f["key"].split(".")[-1] if "." in f["key"] else f["key"]
                raw = (tpl.get("assets") or {}).get(f["key"]) or (tpl.get("assets") or {}).get(base) or ""
            if raw == "token:logo":
                raw = tokens.get("logo") or ""
            url = resolve_img(raw) if raw else ""
            html = _fill_attr(html, "data-lp-img", f["key"], "src", url or PLACEHOLDER_IMG)
        elif f["kind"] == "link":
            href = (inst.get("links") or {}).get(f["key"])
            if href:
                html = _fill_attr(html, "data-lp-link", f["key"], "href", _esc(href))
    html = _fill_texts(html, text_vals, rich=False)
    html = _fill_texts(html, rich_vals, rich=True)

    # stamp the instance id on the section root
    html = re.sub(r"<section\b", f'<section data-iid="{inst["iid"]}"', html, count=1)
    return html


def overrides_css(project: dict) -> str:
    buckets: Dict[str, List[str]] = {"base": [], "tablet": [], "mobile": []}
    for inst in project.get("sections") or []:
        iid = inst.get("iid")
        for field, per_bp in (inst.get("props") or {}).items():
            for bp, props in (per_bp or {}).items():
                if bp not in buckets or not isinstance(props, dict):
                    continue
                decls = []
                for p, v in props.items():
                    if p == "hidden":
                        if v:
                            decls.append("display:none !important")
                        continue
                    if p == "padY":
                        decls.append(f"padding-top:{v} !important")
                        decls.append(f"padding-bottom:{v} !important")
                        continue
                    if p == "maxWidth":
                        buckets[bp].append(f'[data-iid="{iid}"] .lp-wrap{{max-width:{v} !important}}')
                        continue
                    css = _PROP_CSS.get(p)
                    if css:
                        decls.append(f"{css}:{v} !important")
                if not decls:
                    continue
                if field == "_section":
                    sel = f'[data-iid="{iid}"]'
                else:
                    sel = ",".join(
                        f'[data-iid="{iid}"] [data-lp-{k}="{field}"]'
                        for k in ("text", "rich", "img", "link"))
                buckets[bp].append(sel + "{" + ";".join(decls) + "}")
    parts = []
    for bp, rules in buckets.items():
        if not rules:
            continue
        body = "\n".join(rules)
        mq = _BUCKET_MQ[bp]
        parts.append(f"{mq}{{\n{body}\n}}" if mq else body)
    return "\n".join(parts)


def tokens_css(tokens: dict) -> str:
    t = {**core.DEFAULT_TOKENS, **(tokens or {})}
    return (":root{" + ";".join(f"--lp-{k}:{v}" for k, v in t.items() if k != "logo" and v) + "}")


_GOOGLE_FONTS = ("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800"
                 "&family=Space+Grotesk:wght@500;700&family=Urbanist:wght@400;500;600;700"
                 "&family=Noto+Sans+JP:wght@400;700"
                 "&family=Noto+Sans+Thai:wght@400;700&display=swap")


def compose_page(project: dict, sections_map: Dict[str, dict], mode: str,
                 resolve_img: Callable[[str], str],
                 css_href: Optional[str] = None, js_href: Optional[str] = None) -> Dict[str, str]:
    """Returns {"html":…, "css":…, "js":…}. When css_href/js_href are given the
    HTML links to them (export); otherwise CSS is inlined (canvas srcdoc)."""
    lang = project.get("language") or "en"
    tokens = project.get("tokens") or {}
    body_parts: List[str] = []
    used_css: List[str] = [BASE_CSS]
    seen_tpl = set()
    for inst in project.get("sections") or []:
        tpl = sections_map.get(inst.get("template_key") or "")
        if not tpl:
            continue
        body_parts.append(compose_section(tpl, inst, lang, tokens, resolve_img))
        if tpl["key"] not in seen_tpl:
            seen_tpl.add(tpl["key"])
            used_css.append(tpl.get("css") or "")
    css = tokens_css(tokens) + "\n" + "\n".join(used_css) + "\n/* per-element overrides */\n" + overrides_css(project)

    body_html = "\n".join(body_parts)
    # wire the signup form(s)
    form = project.get("form") or {}
    action = _esc(form.get("action_url") or "")
    success = _esc(form.get("success_url") or "")
    body_html = body_html.replace(
        "<form ", f'<form action="{action}" data-success-url="{success}" method="post" ')

    needs_js = ("data-lp-acc" in body_html) or ("data-lp-form" in body_html)
    js = SCRIPT_JS if needs_js else ""

    fonts_link = f'<link rel="stylesheet" href="{_GOOGLE_FONTS}">' if project.get("fonts") == "google" else ""
    title = _esc(project.get("meta_title") or project.get("name") or "Landing page")
    desc = _esc(project.get("meta_description") or "")
    style_or_link = (f'<link rel="stylesheet" href="{css_href}">' if css_href
                     else f'<style id="lp-main-css">{css}</style>')
    # NO inline <script> anywhere the builder renders this document: the app's
    # production CSP (script-src 'self') is inherited by srcdoc iframes and
    # silently kills inline JS. In-app canvas/preview reference same-origin
    # endpoints instead; the ZIP export references its bundled script.js file.
    script_tag = ""
    if js:
        script_tag = (f'<script src="{js_href}"></script>' if js_href
                      else '<script src="/api/tools/lp-builder/page.js" defer></script>')
    runtime = (EDITOR_CSS + '\n<script src="/api/tools/lp-builder/editor.js" defer></script>'
               if mode == "editor" else "")
    html_doc = f"""<!doctype html>
<html lang="{_esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
{f'<meta name="description" content="{desc}">' if desc else ''}
{fonts_link}
{style_or_link}
<!-- generated by Internovus Creative Builder -->
</head>
<body>
{body_html}
{script_tag}
{runtime}
</body>
</html>"""
    return {"html": html_doc, "css": css, "js": js}


# ---------------------------------------------------------------------------
# Asset resolution
# ---------------------------------------------------------------------------
def resolve_asset_path(value: str) -> Optional[Path]:
    """Map a stored image value to a local file, when it is one of ours."""
    if not value:
        return None
    if re.fullmatch(r"[a-f0-9]{32}", value):  # lp-builder asset id
        p = core.ASSETS_DIR / f"{value}.png"
        return p if p.is_file() else None
    m = re.fullmatch(r"/api/tools/lp-builder/assets/([a-f0-9]{32})\.png", value)
    if m:
        p = core.ASSETS_DIR / f"{m.group(1)}.png"
        return p if p.is_file() else None
    return None


def serve_url_for(value: str) -> str:
    """Canvas/preview resolver: asset ids -> serving URLs; everything else as-is."""
    if re.fullmatch(r"[a-f0-9]{32}", value):
        return f"/api/tools/lp-builder/assets/{value}.png"
    return value


def build_zip(project: dict, sections_map: Dict[str, dict]) -> bytes:
    collected: Dict[str, bytes] = {}

    def resolve_for_export(value: str) -> str:
        path = resolve_asset_path(value)
        data: Optional[bytes] = None
        ext = "png"
        if path is not None:
            data = path.read_bytes()
        elif value.startswith("/api/"):
            # a server URL we cannot map (e.g. campaign asset never imported) —
            # leave it out rather than shipping a broken absolute link
            return PLACEHOLDER_IMG
        else:
            return value  # data: URI or external http(s) — keep as-is
        h = hashlib.sha1(data).hexdigest()[:12]
        name = f"assets/{h}.{ext}"
        collected[name] = data
        return name

    out = compose_page(project, sections_map, mode="preview",
                       resolve_img=resolve_for_export,
                       css_href="styles.css", js_href="script.js" )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.html", out["html"])
        z.writestr("styles.css", out["css"])
        if out["js"]:
            z.writestr("script.js", out["js"])
        for name, data in collected.items():
            z.writestr(name, data)
    return buf.getvalue()
