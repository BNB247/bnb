#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
রুট পেজ তৈরির স্ক্রিপ্ট (ঐচ্ছিক)

index.html হলো সাইটের মূল কাঠামো (নেভিগেশন, ফুটার, পপ-আপ সব এখানে)।
প্রতিটি রুট পেজ (how-it-works/, news/, hospitals/ ...) একই কাঠামোর কপি, শুধু
নিজস্ব title, description, canonical লিংক, শিরোনাম (h1) আর ভূমিকা-লেখা আলাদা।

index.html এর নেভিগেশন/ফুটার/পপ-আপে কিছু বদলালে এই স্ক্রিপ্ট চালান:

    python3 _tools/build_pages.py

এতে সব রুট পেজ আবার তৈরি হবে এবং sitemap.xml নতুন করে লেখা হবে।
নতুন পেজ যোগ করতে চাইলে নিচের PAGES এ একটি এন্ট্রি দিন।

অ্যাপ-মোড (পেজ রিলোড ছাড়া নেভিগেশন): index.html এর প্রতিটি <section class="routePage">-এ
data-path / data-title / data-desc / data-desc-en / data-h1 অ্যাট্রিবিউট থাকে।
app.js এগুলো পড়ে ট্যাব বদলের সময় শিরোনাম, মেটা ও পেজের ভূমিকা-লেখা ঠিক করে।
এই অ্যাট্রিবিউটগুলো স্ক্রিপ্টই বসায় — নিজে হাতে বদলাবেন না, PAGES বদলে স্ক্রিপ্ট চালান।
"""
import html
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://ourbnb.org"
SUFFIX = " | Blood Network Baraikhali"

# key = app.js এর রুটের নাম (<section id="route-KEY"> আর data-nav-route এর সাথে মিলতে হবে)
PAGES = {
    "process": {
        "folder": "how-it-works",
        "title": "কীভাবে কাজ করে — রক্ত খুঁজুন বা রক্তদাতা হোন" + SUFFIX,
        "desc": "জরুরি প্রয়োজনে রক্ত খুঁজতে বা রক্তদাতা হতে কী করবেন, ধাপে ধাপে জানুন। Blood Network Baraikhali-এর সেবা সম্পূর্ণ বিনামূল্যে।",
        "desc_en": "Step by step: what to do to find blood in an emergency or to become a donor. Blood Network Baraikhali is completely free.",
        "h1": "কীভাবে কাজ করে",
        "intro": "জরুরি প্রয়োজনে রক্ত খুঁজতে চাইলে, কিংবা স্বেচ্ছায় রক্তদাতা হতে চাইলে নিচের ধাপগুলো অনুসরণ করুন। এই সেবা সম্পূর্ণ বিনামূল্যে।",
        "sitemap": True,
    },
    "blood-group": {
        "folder": "blood-group-chart",
        "title": "রক্তের গ্রুপ চার্ট — কোন গ্রুপ কাকে রক্ত দিতে পারে" + SUFFIX,
        "desc": "রক্তের গ্রুপ চার্ট: A+, A-, B+, B-, AB+, AB-, O+, O- — কোন গ্রুপের দাতা কোন গ্রুপের রোগীকে রক্ত দিতে পারেন, এক নজরে দেখুন।",
        "desc_en": "Blood group chart for A+, A-, B+, B-, AB+, AB-, O+ and O- — see at a glance which donor group can give blood to which recipient group.",
        "h1": "রক্তের গ্রুপ চার্ট",
        "intro": "কোন রক্তের গ্রুপের দাতা কোন গ্রুপের রোগীকে রক্ত দিতে পারেন, তা নিচের চার্টে দেখুন। O- গ্রুপের রক্ত সব গ্রুপের রোগীকে দেওয়া যায়, আর AB+ গ্রুপের রোগী সব গ্রুপের রক্ত নিতে পারেন। তবে রক্ত দেওয়ার আগে চিকিৎসকের পরামর্শ ও ক্রস-ম্যাচিং জরুরি।",
        "sitemap": True,
    },
    "donations": {
        "folder": "donations",
        "title": "রক্তদান রেকর্ড — সকল রক্তদানের তালিকা" + SUFFIX,
        "desc": "Blood Network Baraikhali-এর মাধ্যমে হওয়া সকল রক্তদানের রেকর্ড। নাম, ID বা হাসপাতাল দিয়ে খুঁজুন ও রক্তের গ্রুপ অনুযায়ী ফিল্টার করুন।",
        "desc_en": "Records of all blood donations made through Blood Network Baraikhali. Search by name, ID or hospital and filter by blood group.",
        "h1": "সকল রক্তদান রেকর্ড",
        "intro": "আমাদের নেটওয়ার্কের মাধ্যমে হওয়া রক্তদানের তালিকা। নাম, ID বা হাসপাতালের নাম লিখে খুঁজুন, অথবা রক্তের গ্রুপ অনুযায়ী ফিল্টার করুন।",
        "sitemap": True,
    },
    "news": {
        "folder": "news",
        "title": "সংবাদ ও আপডেট" + SUFFIX,
        "desc": "Blood Network Baraikhali-এর সর্বশেষ সংবাদ, ঘোষণা ও রক্তদান কার্যক্রমের আপডেট।",
        "desc_en": "The latest news, announcements and blood donation updates from Blood Network Baraikhali.",
        "h1": "সংবাদ ও আপডেট",
        "intro": "Blood Network Baraikhali-এর সর্বশেষ সংবাদ, ঘোষণা ও আপডেট।",
        "sitemap": True,
    },
    "hospitals": {
        "folder": "hospitals",
        "title": "হাসপাতাল ও ব্লাড ব্যাংক" + SUFFIX,
        "desc": "জরুরি প্রয়োজনে যোগাযোগের জন্য হাসপাতাল ও ব্লাড ব্যাংকের তালিকা — Blood Network Baraikhali।",
        "desc_en": "A list of hospitals and blood banks to contact in an emergency — Blood Network Baraikhali.",
        "h1": "হাসপাতাল ও ব্লাড ব্যাংক",
        "intro": "জরুরি প্রয়োজনে যোগাযোগ করার জন্য হাসপাতাল ও ব্লাড ব্যাংকের তালিকা।",
        "sitemap": True,
    },
    "about": {
        "folder": "about",
        "title": "আমাদের সম্পর্কে ও যোগাযোগ" + SUFFIX,
        "desc": "Blood Network Baraikhali (B.N.B) — স্বেচ্ছাসেবী রক্তদাতাদের নেটওয়ার্ক। আমরা কারা, কী করি এবং জরুরি প্রয়োজনে কীভাবে যোগাযোগ করবেন।",
        "desc_en": "Blood Network Baraikhali (B.N.B) — a network of volunteer blood donors. Who we are, what we do and how to contact us in an emergency.",
        "h1": "আমাদের সম্পর্কে ও যোগাযোগ",
        "intro": "আমরা স্বেচ্ছাসেবী রক্তদাতাদের একটি নেটওয়ার্ক — জরুরি রক্তের প্রয়োজনে পাশে থাকাই আমাদের কাজ।",
        "sitemap": True,
    },
    "privacy": {
        "folder": "privacy",
        "title": "গোপনীয়তা নীতি" + SUFFIX,
        "desc": "Blood Network Baraikhali আপনার কোন তথ্য সংগ্রহ করে, কীভাবে ব্যবহার ও সুরক্ষিত রাখে এবং আপনার কী কী অধিকার আছে।",
        "desc_en": "What information Blood Network Baraikhali collects, how it is used and protected, and what rights you have.",
        "h1": "গোপনীয়তা নীতি",
        "intro": "আপনার কোন তথ্য আমরা কীভাবে সংগ্রহ, ব্যবহার ও সুরক্ষিত রাখি — সহজ ভাষায়।",
        "sitemap": True,
    },
    "gallery": {
        "folder": "gallery",
        "title": "রক্তদানের ছবি" + SUFFIX,
        "desc": "Blood Network Baraikhali-এর মাধ্যমে হওয়া রক্তদানের মুহূর্তের ছবির সংগ্রহ।",
        "desc_en": "A collection of photos from blood donations made through Blood Network Baraikhali.",
        "h1": "সব রক্তদানের ছবি",
        "intro": "আমাদের নেটওয়ার্কের মাধ্যমে হওয়া রক্তদানের মুহূর্তের ছবি।",
        "sitemap": False,   # ছবির তালিকা, লেখা কম — সাইটম্যাপে দেওয়া হয়নি
    },
}


def fail(msg):
    sys.exit("ত্রুটি: " + msg)


def sub_once(text, old, new):
    n = text.count(old)
    if n != 1:
        fail("index.html এ এই অংশটি ঠিক একবার থাকার কথা ছিল, পাওয়া গেছে %d বার: %r" % (n, old[:80]))
    return text.replace(old, new)


def set_meta(text, attr, name, value):
    pat = re.compile(r'(<meta %s="%s" content=")[^"]*(")' % (attr, re.escape(name)))
    if len(pat.findall(text)) != 1:
        fail("meta ট্যাগ পাওয়া যায়নি বা একাধিক আছে: " + name)
    return pat.sub(lambda m: m.group(1) + html.escape(value, quote=True) + m.group(2), text)


def prepare_home(home):
    """index.html এর প্রতিটি রুট সেকশনে data-* অ্যাট্রিবিউট বসায় (বারবার চালালেও একই ফল)।"""
    esc = lambda s: html.escape(s, quote=True)
    for key, cfg in PAGES.items():
        pat = re.compile(r'<section class="routePage" id="route-%s"[^>]*>' % re.escape(key))
        if len(pat.findall(home)) != 1:
            fail("index.html এ route-%s সেকশন ঠিক একটি থাকার কথা" % key)
        tag = ('<section class="routePage" id="route-%s" data-path="%s/" data-title="%s" data-desc="%s" '
               'data-desc-en="%s" data-h1="%s">') % (
            key, cfg["folder"], esc(cfg["title"]), esc(cfg["desc"]), esc(cfg["desc_en"]), esc(cfg["h1"]))
        home = pat.sub(lambda m: tag, home, count=1)

    # হোম পেজের নিজের title/description — অন্য পেজ থেকে হোমে ফিরলে app.js এগুলো ব্যবহার করে।
    # (সবসময় মূল index.html থেকে নেওয়া হয়; রুট পেজের কপিতে এগুলো হোমেরই থাকে।)
    mt = re.search(r"<title>(.*?)</title>", home, flags=re.S)
    md = re.search(r'<meta name="description" content="([^"]*)"(?: data-en="([^"]*)")?', home)
    if not mt or not md:
        fail("index.html এ <title> বা meta description পাওয়া যায়নি")
    hero = '<header class="hero" id="top" data-title="%s" data-desc="%s" data-desc-en="%s">' % (
        esc(html.unescape(mt.group(1).strip())), md.group(1), md.group(2) or "")
    hp = re.compile(r'<header class="hero" id="top"[^>]*>')
    if len(hp.findall(home)) != 1:
        fail('index.html এ <header class="hero" id="top"> ঠিক একটি থাকার কথা')
    home = hp.sub(lambda m: hero, home, count=1)
    return home


def build_page(home, key, cfg):
    esc = lambda s: html.escape(s, quote=True)
    url = "%s/%s/" % (SITE, cfg["folder"])
    t = home

    t, n = re.subn(r"<title>.*?</title>", lambda m: "<title>%s</title>" % html.escape(cfg["title"], quote=False), t, count=1, flags=re.S)
    if n != 1:
        fail("<title> পাওয়া যায়নি")
    t, n = re.subn(r'<meta name="description"[^>]*>',
                   lambda m: '<meta name="description" content="%s" data-en="%s">' % (esc(cfg["desc"]), esc(cfg["desc_en"])), t, count=1)
    if n != 1:
        fail("meta description পাওয়া যায়নি")
    t = sub_once(t, '<link rel="canonical" href="%s/">' % SITE, '<link rel="canonical" href="%s">' % url)
    t = set_meta(t, "property", "og:title", cfg["title"])
    t = set_meta(t, "property", "og:description", cfg["desc"])
    t = set_meta(t, "property", "og:url", url)
    t = set_meta(t, "name", "twitter:title", cfg["title"])
    t = set_meta(t, "name", "twitter:description", cfg["desc"])

    t = sub_once(t, "<body>", '<body data-route="%s">' % key)

    sec = re.compile(r'<section class="routePage" id="route-%s"([^>]*)>\n  <div class="routePageInner">\n' % re.escape(key))
    if len(sec.findall(t)) != 1:
        fail("route-%s সেকশন পাওয়া যায়নি" % key)
    t = sec.sub(lambda m: ('<section class="routePage active" id="route-%s"%s>\n  <div class="routePageInner">\n'
           '    <header class="routeIntro">\n'
           '      <h1 class="routeIntroTitle">%s</h1>\n'
           '    </header>\n') % (key, m.group(1), esc(cfg["h1"])), t, count=1)

    # "উপরে ফিরে যান" — রুট পেজে হোমের #top লুকানো থাকে, তাই এই পেজের উপরে নিয়ে যায়
    t = sub_once(t, '<a href="#top">উপরে ফিরে যান</a>', '<a href="#route-%s">উপরে ফিরে যান</a>' % key)

    # index.html এর লিংকগুলো রুট থেকে relative (assets/..., news/index.html ...)।
    # সাবফোল্ডারের পেজ এক ধাপ নিচে, তাই এগুলোর সামনে "../" বসে।
    t = re.sub(r'(href|src)="(?!https?:|//|#|mailto:|tel:|data:|javascript:|\.\./|/)([^"]*[^"#][^"]*)"',
               lambda m: '%s="../%s"' % (m.group(1), m.group(2)), t)
    return t


def main():
    src = ROOT / "index.html"
    if not src.exists():
        fail("index.html পাওয়া যায়নি: %s" % src)
    home = src.read_text(encoding="utf-8")
    prepared = prepare_home(home)
    if prepared != home:
        src.write_text(prepared, encoding="utf-8")
        print("আপডেট: index.html (রুট সেকশনের data-* অ্যাট্রিবিউট)")
    home = prepared

    for key, cfg in PAGES.items():
        out_dir = ROOT / cfg["folder"]
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(build_page(home, key, cfg), encoding="utf-8")
        print("তৈরি: %s/index.html" % cfg["folder"])

    today = date.today().isoformat()
    urls = [SITE + "/"] + ["%s/%s/" % (SITE, c["folder"]) for c in PAGES.values() if c["sitemap"]]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        lines.append("  <url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>\n  </url>" % (u, today))
    lines.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("তৈরি: sitemap.xml (%d টি URL)" % len(urls))


if __name__ == "__main__":
    main()
