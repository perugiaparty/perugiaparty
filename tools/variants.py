"""Builds /it and /erasmus from the homepage (public/index.html), so all three share one design.
Run after every homepage change:  python3 tools/variants.py"""
import re, json, sys, os
ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
SRC = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

def build(path, lang, pairs, hero_art, hero_alt, post=None):
    s, miss = SRC, []
    for a, b in pairs:
        if a not in s: miss.append(a[:60])
        s = s.replace(a, b)
    # hero: own illustration instead of the example ticket
    s = re.sub(r'<a class="ticket".*?</a>', f'<img class="hero-art" src="/ill/{hero_art}.svg" alt="{hero_alt}" width="360" height="200" fetchpriority="high">', s, count=1, flags=re.S)
    s = s.replace('<link rel="preload" href="/logo.png" as="image">', f'<link rel="preload" href="/ill/{hero_art}.svg" as="image">')
    s = s.replace("</style>", ".hero-art{display:block;width:100%;height:auto;border-radius:24px;box-shadow:12px 12px 0 var(--red);transform:rotate(-2deg)}\n</style>", 1)
    if post: s = post(s)
    # structured data: this page + its own visible FAQ
    if 'class="hd-chat"' in s:
        hd = s[s.index('class="hd-chat"'):]; hd = hd[:hd.index("</ul>")]
        faq = [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in re.findall(r'<p class="q">(.*?)</p><p class="a"><b>PerugiaParty</b>(.*?)</p>', hd)]
    else:
      sec = s[s.index('id="faq"'):]
      faq = [{"@type": "Question", "name": re.sub("<[^>]+>", "", q), "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", a)).strip()}}
             for q, a in re.findall(r"<summary>(.*?)</summary>(.*?)</details>", sec[:sec.index("</section>")], re.S)]
    title = re.search(r"<title>(.*?)</title>", s).group(1).replace("&amp;", "&")
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": f"https://perugiaparty.com{path}#page", "url": f"https://perugiaparty.com{path}", "name": title, "inLanguage": lang,
         "isPartOf": {"@id": "https://perugiaparty.com/#website"}, "about": {"@id": "https://perugiaparty.com/#org"}},
        {"@type": "FAQPage", "@id": f"https://perugiaparty.com{path}#faq", "mainEntity": faq}]}
    if ".o-faq,.o-nights{display:none" in s and 'class="hd-chat"' not in s: ld["@graph"].pop()  # FAQ hidden on this landing page
    s = re.sub(r'<script type="application/ld\+json">.*?</script>', '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False).replace("<", "\\u003c") + "</script>", s, count=1, flags=re.S)
    open(os.path.join(ROOT, path.strip("/") + ".html"), "w", encoding="utf-8").write(s)
    if miss: print(path, "not found:", *miss, sep="\n  ", file=sys.stderr)

COMMON_HEAD = lambda path, title, desc, ogt, ogd, loc: [
    ('<title>PerugiaParty · Student &amp; Erasmus parties in Perugia</title>', f"<title>{title}</title>"),
    ('<meta name="description" content="Private student and Erasmus parties in Perugia’s city centre (feste universitarie). Open bar, DJs and new people to meet, at a student price. Request your place, 18+.">', f'<meta name="description" content="{desc}">'),
    ('<link rel="canonical" href="https://perugiaparty.com/">', f'<link rel="canonical" href="https://perugiaparty.com{path}">'),
    ('<meta property="og:url" content="https://perugiaparty.com/">', f'<meta property="og:url" content="https://perugiaparty.com{path}">'),
    ('<meta property="og:title" content="PerugiaParty · Your people. Your night.">', f'<meta property="og:title" content="{ogt}">'),
    ('<meta property="og:description" content="Club night. Centro vibes. Best of both. Private student parties in Perugia, open bar, student prices. 18+.">', f'<meta property="og:description" content="{ogd}">'),
    ('<meta property="og:locale" content="en_GB">', f'<meta property="og:locale" content="{loc}">'),
]


# ---------- Erasmus: a "new here" guide and an FAQ for people who have never been to Perugia
NEW_HERE = [
    ("When do bars close here?", "Around 01:30 in the centre, and you're standing outside."),
    ("Can I go to a club?", "They're out of town. No car, no club."),
    ("Where is PerugiaParty?", "In the centre, walking distance. The exact place is on your ticket."),
    ("Do I need Italian?", "No. The site, your ticket and our DMs are in English."),
    ("Why DM my code?", "That's how we check you're a real person."),
    ("My bank isn't Italian.", "No problem: a SEPA transfer in euro works from any European account."),
]
ER_FAQ = [
    ("I just arrived. What is PerugiaParty?", "Private parties for university and Erasmus students in Perugia’s centre: open bar, DJs and new people, at a student price. Run by volunteers. 18+."),
    ("Do I need to speak Italian?", "No. The website, your ticket and our Instagram are in English."),
    ("How do I join?", "Request a place on this page, then DM your code to @perugiaparty on Instagram. We check every request and send you your ticket page."),
    ("I don’t have an Italian bank account.", "No problem. A normal SEPA transfer in euro from any European account works. Use your name and code as the reference."),
    ("How do I get there?", "It’s in the city centre, so you can walk from most student areas in town. The exact place is on your ticket after payment."),
    ("What do I bring?", "Your ticket QR on your phone and a photo ID (passport or ID card). You must be 18+."),
]
def erasmus_post(s):
    rows = "".join(f'<li><p class="q">{h}</p><p class="a"><b>PerugiaParty</b>{p}</p></li>' for h, p in NEW_HERE)
    guide = f"""<div class="wrap o-new"><section class="sec hd" id="new" aria-labelledby="new-h">
      <div class="hd-top"><span class="hd-dot"></span><div><p class="hd-k">Erasmus help desk</p><h2 id="new-h">New in <span>Perugia?</span></h2></div></div>
      <p class="hd-sub">The questions every new student asks us.</p>
      <ul class="hd-chat">{rows}</ul>
      <div class="hd-foot"><span>Still lost?</span><a class="btn" href="https://ig.me/m/perugiaparty" target="_blank" rel="noopener">Ask us on Instagram ↗</a></div>
    </section></div>
"""
    s = s.replace('  <section class="band-red o-next" id="next"', guide + '  <section class="band-red o-next" id="next"', 1)
    assert 'id="new"' in s
    s = s.replace("</style>", """.hd{background:var(--ink);color:var(--cream);border-radius:28px;padding:clamp(22px,4vw,44px);margin-block:12px}
.hd-top{display:flex;align-items:center;gap:14px}
.hd-dot{width:12px;height:12px;border-radius:50%;background:#7bd389;box-shadow:0 0 0 5px rgba(123,211,137,.18);flex:none}
.hd-k{font-family:var(--f-mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#7bd389;margin:0 0 4px}
.hd h2{font-size:clamp(32px,4.6vw,54px);line-height:.95;margin:0}.hd h2 span{color:#ff4a3d}
.hd-sub{color:#b9ab98;margin:12px 0 24px}
.hd-chat{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}
.hd-chat li{display:grid;gap:6px;background:#1f1a17;border-radius:20px;padding:14px}
.hd-chat .q{justify-self:end;max-width:90%;background:var(--red);color:var(--cream);border-radius:16px 16px 4px 16px;padding:9px 13px;font-weight:700;font-size:15px;margin:0}
.hd-chat .a{justify-self:start;max-width:92%;background:#2e2723;color:var(--cream);border-radius:16px 16px 16px 4px;padding:9px 13px;font-size:15px;line-height:1.4;margin:0}
.hd-chat .a b{display:block;font-family:var(--f-mono);font-weight:500;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#ffd23f;margin-bottom:3px}
.hd-foot{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:24px;color:#b9ab98}
@media (max-width:760px){.hd-chat{grid-template-columns:1fr}}
</style>""", 1)
    cta = """<div class="wrap o-go"><section class="go" aria-labelledby="go-h">
      <h2 id="go-h">Ready for your <span>first night?</span></h2>
      <p>Everything else, the next date and the request form, is on our main page.</p>
      <div class="go-b"><a class="btn" href="/#request">Request a place</a><a class="btn outline" href="/">Go to PerugiaParty →</a></div>
    </section></div>
"""
    s = s.replace('<div class="wrap o-why">', cta + '<div class="wrap o-why">', 1)
    s = s.replace("</style>", """.o-go{order:2}.o-why,.o-main,.o-faq,.o-nights{display:none!important}
.go{text-align:center;padding:clamp(40px,7vw,80px) 0 clamp(56px,8vw,96px)}
.go h2{font-size:clamp(34px,5vw,58px);line-height:.95;margin:0 0 12px}.go h2 span{color:var(--red)}
.go p{color:var(--muted);margin:0 auto 24px;max-width:40ch}
.go-b{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
</style>""", 1)
    s = s.replace('href="#request"', 'href="/#request"').replace('a.href = "#request"', 'a.href = "/#request"')
    # Erasmus page: no club / centro comparison, keep the mission as "Who we are"
    a = s.index('<h2 id="why-h"'); b = s.index('<h3 class="why-q">', a)
    s = s[:a] + s[b:]
    s = s.replace('<h3 class="why-q">But <span>why?</span></h3>', '<h2 class="why-q" id="why-h">Who <span>we are.</span></h2>', 1)
    a = s.index('<div class="faq">', s.index('id="faq"')); b = s.index('<details id="rules">', a)
    s = s[:a] + '<div class="faq">\n' + "".join(f"        <details><summary>{q}</summary><p>{x}</p></details>\n" for q, x in ER_FAQ) + "        " + s[b:]
    return s


# Alternative Erasmus block: the three places cards, with the help desk answers built in
def erasmus_cards(s):
    vs = s[s.index('<div class="vs">'):]; vs = vs[:vs.index('</div>\n') + 6]
    svgs = re.findall(r"<svg.*?</svg>", vs, re.S)
    def card(cls, svg, title, items, mark):
        li = "".join(f"<li><i>{mark}</i>{x}</li>" for x in items)
        return f'<figure class="ec {cls}">{svg}<figcaption><p class="vs-t">{title}</p><ul>{li}</ul></figcaption></figure>'
    club = card("", svgs[0], "The club", ["Expensive", "Light drinks", "Out of town: no car, no club"], "✕")
    us = card("us", svgs[1], "PerugiaParty", ["Student prices", "Open bar", "In the centre, walk there", "Till late", "All in English", "Pay from any European bank", "Real guests, checked on Instagram"], "✓")
    centro = card("", svgs[2], "The centro", ["Outside, in the cold", "No music", "Bars close around 01:30"], "✕")
    return f"""<div class="wrap o-new"><section class="sec" id="new" aria-labelledby="new-h">
      <p class="hd-k2">New in Perugia?</p><h2 id="new-h" class="why-big">Three ways to go out. <span>One makes sense.</span></h2>
      <div class="ecs">{club}{us}{centro}</div>
      <p class="ec-help">Still lost? <a href="https://ig.me/m/perugiaparty" target="_blank" rel="noopener">Ask us on Instagram ↗</a></p>
    </section></div>
""", """.hd-k2{font-family:var(--f-mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--red);margin:0 0 10px}
.ecs{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:clamp(8px,2vw,22px);align-items:center}
.ec{margin:0;border-radius:20px;overflow:hidden;background:#e9dfcc;color:#6d6252}
.ec svg{display:block;width:100%;height:auto}
.ec figcaption{padding:clamp(10px,1.6vw,20px)}
.ec ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.ec li{display:grid;grid-template-columns:18px 1fr;gap:6px;font-weight:700;font-size:clamp(12px,1.5vw,16px);line-height:1.3}
.ec li i{font-style:normal;color:#a5776a}
.ec.us{background:var(--ink);color:var(--cream);box-shadow:0 0 0 2px var(--red),0 18px 40px -16px rgba(232,57,43,.6)}
.ec.us .vs-t{color:#ffd23f}.ec.us li i{color:#7bd389}
.ec .vs-t{margin-bottom:10px}
.ec-help{margin:22px 0 0;color:var(--muted)}.ec-help a{color:var(--red-deep);font-weight:700}
@media (max-width:640px){.ecs{grid-template-columns:1fr}.ec{display:grid;grid-template-columns:40% 1fr;align-items:center}.ec.us{order:-1}}
"""

# ---------- Erasmus (English)
build("/erasmus", "en", COMMON_HEAD("/erasmus", "Erasmus parties in Perugia · PerugiaParty",
        "New in Perugia on Erasmus? PerugiaParty runs private student parties in the city centre: open bar, DJs and people from all over the world, at a student price. 18+.",
        "Erasmus parties in Perugia · PerugiaParty", "New in town? Open bar, DJs and people from all over the world, at a student price. 18+.", "en_GB") + [
    ('<link rel="alternate" hreflang="en" href="https://perugiaparty.com/">\n<link rel="alternate" hreflang="it" href="https://perugiaparty.com/it">\n<link rel="alternate" hreflang="x-default" href="https://perugiaparty.com/">\n', ""),
    ('Student parties <em>in Perugia.</em>', 'Erasmus parties <em>in Perugia.</em>'),
    ('Your people. Your night. Open bar, DJs and new people to meet, at a student price.', 'Just arrived in Perugia? Meet students from here and from all over the world. Open bar, DJs, student price.'),
    ('<p>Six steps to the door.</p>', '<p>From your phone to the party. No Italian needed.</p>'),
    ('<h3>Request</h3><p>Fill in 30 seconds.</p>', '<h3>Request</h3><p>Your name and Instagram. 30 seconds.</p>'),
    ('<h3>DM the code</h3><p>Send it on Instagram.</p>', '<h3>DM the code</h3><p>Send it to @perugiaparty on Instagram.</p>'),
    ('<h3>Approved</h3><p>We check every request.</p>', '<h3>Approved</h3><p>We reply in your DMs with your page.</p>'),
    ('<h3>Pay</h3><p>Bank transfer, tap to copy.</p>', '<h3>Pay</h3><p>Bank transfer in euro, any European bank.</p>'),
    ('<h3>Your QR</h3><p>Ticket and place unlock.</p>', '<h3>Your QR</h3><p>Your ticket and the address appear.</p>'),
    ('<h3>Party</h3><p>QR and photo ID at the door.</p>', '<h3>Party</h3><p>Show the QR and your passport or ID card.</p>'),
], "hero-erasmus", "People from all over the world meeting in Perugia", erasmus_post)


# Italian page: the comparison is the hook, so it comes right after the title
def it_post(s):
    s = re.sub(r'<img class="hero-art"[^>]*>', '', s, count=1)
    s = re.sub(r'\s*<div class="ctas">.*?</div>', '', s, count=1, flags=re.S)  # no button under the title
    s = s.replace('<link rel="preload" href="/ill/hero-it.svg" as="image">', "")
    cta = """<div class="wrap o-go"><section class="go" aria-labelledby="go-h">
      <h2 id="go-h">Pronto per la <span>prossima notte?</span></h2>
      <p>Data, richiesta del posto e tutto il resto sono sulla pagina principale.</p>
      <div class="go-b"><a class="btn" href="/#request">Richiedi un posto</a><a class="btn outline" href="/">Vai a PerugiaParty →</a></div>
    </section></div>
"""
    s = s.replace('<div class="wrap o-main">', cta + '<div class="wrap o-main">', 1)
    s = s.replace('href="#request"', 'href="/#request"').replace('a.href = "#request"', 'a.href = "/#request"')
    s = s.replace("</style>", """.o-go{order:3}.o-main,.o-faq,.o-nights{display:none!important}
.go{text-align:center;padding:clamp(40px,7vw,80px) 0 clamp(56px,8vw,96px)}
.go h2{font-size:clamp(34px,5vw,58px);line-height:.95;margin:0 0 12px}.go h2 span{color:var(--red)}
.go p{color:var(--muted);margin:0 auto 24px;max-width:40ch}
.go-b{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
</style>""", 1)
    s = s.replace("</style>", """.hero{grid-template-columns:1fr!important;padding-block:clamp(36px,6vw,72px) clamp(40px,6vw,72px)!important;gap:0!important}
.hero .lede{max-width:46ch}
.o-why #why{padding-top:clamp(28px,4vw,44px)}
.o-why .why-big{font-size:clamp(28px,4vw,48px);margin-bottom:clamp(18px,3vw,32px)}
</style>""", 1)
    return s

# ---------- Italiano
IT = [
    ('<html lang="en">', '<html lang="it">'),
    ('Request a place</a>', 'Richiedi un posto</a>'),
    ('Student parties <em>in Perugia.</em>', 'Feste universitarie <em>a Perugia.</em>'),
    ('Your people. Your night. Open bar, DJs and new people to meet, at a student price.', 'La tua gente. La tua notte. Open bar, DJ e gente nuova da conoscere, a prezzo studenti.'),
    ('<h2>Next party.</h2>', '<h2>Prossima festa.</h2>'),
    ('<p>New list every edition.</p>', '<p>Lista nuova a ogni edizione.</p>'),
    ('Announcing soon', 'In arrivo'),
    ('<h3>The next edition is in the works.</h3>', '<h3>La prossima edizione è in preparazione.</h3>'),
    ('<p>Date and theme drop on Instagram first.</p>', '<p>Data e tema escono prima su Instagram.</p>'),
    ('Follow on Instagram ↗', 'Seguici su Instagram ↗'),
    ('Club night. Centro vibes. <span>Best of both.</span>', 'Serata da club. Vibe da centro. <span>Il meglio dei due mondi.</span>'),
    ('<p class="vs-t">The club</p>', '<p class="vs-t">La discoteca</p>'),
    ('Expensive.<br>Light drinks.<br>Far away.', 'Prezzi alti.<br>Drink annacquati.<br>Fuori mano.'),
    ('Student prices.<br>Open bar.<br>In the centre.<br>Till late.', 'Prezzi bassi.<br>Open bar.<br>In centro.<br>Fino a tardi.'),
    ('<p class="vs-t">The centro</p>', '<p class="vs-t">Il centro</p>'),
    ('In the cold.<br>No music.<br>Ends early.', 'Al freddo.<br>Niente musica.<br>Chiude presto.'),
    ('But <span>why?</span>', 'Ma <span>perché?</span>'),
    ('PerugiaParty is run by volunteers who want to make student life in Perugia a little more open and inclusive. Through music and a welcoming space, we bring people from Umbria and from all over the world together, Italian and Erasmus students alike, to share one night.',
     'PerugiaParty è organizzata da volontari che vogliono rendere la vita da studenti a Perugia un po’ più aperta e inclusiva. Con la musica e un posto accogliente uniamo gente dell’Umbria e di tutto il mondo, studenti italiani ed Erasmus, per condividere una notte.'),
    ('<h2 id="how-h">How it works.</h2>', '<h2 id="how-h">Come funziona.</h2>'),
    ('<p>Six steps to the door.</p>', '<p>Sei passi fino alla porta.</p>'),
    ('<h3>Request</h3><p>Fill in 30 seconds.</p>', '<h3>Richiesta</h3><p>30 secondi.</p>'),
    ('<h3>DM the code</h3><p>Send it on Instagram.</p>', '<h3>Manda il codice</h3><p>In DM su Instagram.</p>'),
    ('<h3>Approved</h3><p>We check every request.</p>', '<h3>Approvato</h3><p>Controlliamo ogni richiesta.</p>'),
    ('<h3>Pay</h3><p>Bank transfer, tap to copy.</p>', '<h3>Paga</h3><p>Bonifico, tocca per copiare.</p>'),
    ('<h3>Your QR</h3><p>Ticket and place unlock.</p>', '<h3>Il tuo QR</h3><p>Biglietto e luogo si sbloccano.</p>'),
    ('<h3>Party</h3><p>QR and photo ID at the door.</p>', '<h3>Festa</h3><p>QR e documento alla porta.</p>'),
    ('<h2 id="req-h">Request a place.</h2>', '<h2 id="req-h">Richiedi un posto.</h2>'),
    ('<p>We check every request on Instagram.</p>', '<p>Controlliamo ogni richiesta su Instagram.</p>'),
    ('<label for="f-name">Full name</label>', '<label for="f-name">Nome e cognome</label>'),
    ('placeholder="As on your ID"', 'placeholder="Come sul documento"'),
    ('placeholder="@yourhandle"', 'placeholder="@iltuoprofilo"'),
    ('<small>(optional)</small>', '<small>(facoltativo)</small>'),
    ('<label for="f-intro">Say hi', '<label for="f-intro">Presentati'),
    ('placeholder="Who you are, who you\'ll know there"', 'placeholder="Chi sei, chi conosci alla festa"'),
    ("I'm 18+, I'll bring photo ID and I accept the <a href=\"#rules\">house rules</a>.", 'Ho 18+ anni, porto un documento e accetto le <a href="#rules">regole della casa</a>.'),
    ('id="f-send">Send request</button>', 'id="f-send">Invia richiesta</button>'),
    ('We only use your name, Instagram and WhatsApp to run our guest lists. DM us anytime to have them deleted.', 'Usiamo nome, Instagram e WhatsApp solo per le liste ospiti. Scrivici quando vuoi per cancellarli.'),
    ('<p class="dim" id="pv-ev">Guest request</p>', '<p class="dim" id="pv-ev">Richiesta ospite</p>'),
    ('<p class="pv-name" id="pv-name">Your name</p>', '<p class="pv-name" id="pv-name">Il tuo nome</p>'),
    ('<span>☐</span> 18+ with photo ID', '<span>☐</span> 18+ con documento'),
    ('<span>☐</span> House rules read', '<span>☐</span> Regole lette'),
    ('<p class="tiny" id="pv-tiny">Your code arrives after approval</p>', '<p class="tiny" id="pv-tiny">Il codice arriva dopo l’approvazione</p>'),
    ('<li>Send it: you get a personal link straight away.</li>', '<li>Inviala: ricevi subito un link personale.</li>'),
    ('<li>We check your request on Instagram.</li>', '<li>Controlliamo la richiesta su Instagram.</li>'),
    ('<li>Once approved, your page shows your price and code.</li>', '<li>Se approvato, la tua pagina mostra prezzo e codice.</li>'),
    ('<h3>Not sent yet: DM us this code.</h3>', '<h3>Non ancora inviata: mandaci questo codice.</h3>'),
    ('id="copy-link">Copy code</button>', 'id="copy-link">Copia codice</button>'),
    ('Send code on Instagram ↗', 'Manda il codice su Instagram ↗'),
    ('<h2 id="nights-h">Nights you missed.</h2>', '<h2 id="nights-h">Le notti che ti sei perso.</h2>'),
    ('See everything on Instagram ↗', 'Vedi tutto su Instagram ↗'),
    ('<p class="when">Last edition</p>', '<p class="when">Ultima edizione</p>'),
    ('<p class="when">Past edition</p>', '<p class="when">Edizione passata</p>'),
    ('<h2 id="faq-h">Good to know.</h2>', '<h2 id="faq-h">Da sapere.</h2>'),
    ('<summary>Why is it so cheap?</summary><p>Clubs in Perugia are expensive and far away, and the centre ends early. PerugiaParty is run by volunteers, so we keep the price low and every student can come.</p>',
     '<summary>Perché costa così poco?</summary><p>Le discoteche a Perugia sono care e lontane, e il centro finisce presto. PerugiaParty è organizzata da volontari: teniamo il prezzo basso perché ogni studente possa venire.</p>'),
    ('<summary>Who can come?</summary><p>Students, Erasmus and anyone aged 18+. Every party needs a new request, even if you came before. Friends request their own place. Bring photo ID.</p>',
     '<summary>Chi può venire?</summary><p>Studenti, Erasmus e chiunque abbia 18+ anni. Ogni festa richiede una nuova richiesta, anche se sei già venuto. Gli amici fanno la loro richiesta. Porta un documento.</p>'),
    ('<summary>How do I get on the list?</summary><p>Request a place here, then DM your code to @perugiaparty on Instagram. We check every request; a request isn’t a guaranteed place.</p>',
     '<summary>Come entro in lista?</summary><p>Richiedi un posto qui, poi manda il tuo codice in DM a @perugiaparty su Instagram. Controlliamo ogni richiesta: richiedere non garantisce il posto.</p>'),
    ('<summary>How much is it and how do I pay?</summary><p>Your price appears on your ticket page once you’re approved. Pay by bank transfer with your name and code as the reference.</p>',
     '<summary>Quanto costa e come pago?</summary><p>Il prezzo appare sulla tua pagina dopo l’approvazione. Paghi con bonifico, con nome e codice come causale.</p>'),
    ('<summary>Where is the party?</summary><p>In Perugia’s city centre. The exact place appears on your ticket once we confirm your payment.</p>',
     '<summary>Dove si fa la festa?</summary><p>Nel centro di Perugia. Il luogo esatto appare sul biglietto dopo la conferma del pagamento.</p>'),
    ('<summary>Lost my ticket, refunds?</summary><p>Lost the link? Go to <a href="/ticket">perugiaparty.com/ticket</a> and log in with your Instagram and code. Tickets are personal and can’t be transferred or refunded. If we cancel, we contact you directly.</p>',
     '<summary>Biglietto perso, rimborsi?</summary><p>Link perso? Vai su <a href="/ticket">perugiaparty.com/ticket</a> e accedi con Instagram e codice. I biglietti sono personali, non trasferibili né rimborsabili. Se annulliamo, ti contattiamo noi.</p>'),
    ('<summary>What are the house rules?</summary>', '<summary>Quali sono le regole della casa?</summary>'),
    ('<b>On the list or not in.</b> No list, no entry. Tickets are personal.', '<b>In lista o fuori.</b> Niente lista, niente ingresso. I biglietti sono personali.'),
    ('<b>Pay before you come.</b> Bank transfer with your name and PP code as the reference.', '<b>Paga prima di venire.</b> Bonifico con nome e codice PP come causale.'),
    ("<b>Pace yourself.</b> One drink at a time. Don't waste them.", '<b>Con calma.</b> Un drink alla volta. Non sprecarli.'),
    ('<b>Leave the music alone.</b> Respect the vibe and whoever is playing.', '<b>La musica non si tocca.</b> Rispetta la vibe e chi suona.'),
    ('<b>No mess.</b> Use the bags. Leave the place as you found it.', '<b>Niente casino.</b> Usa i sacchi. Lascia il posto come l’hai trovato.'),
    ("<b>Respect the staff.</b> They're the reason the night happens.", '<b>Rispetta lo staff.</b> È grazie a loro che la notte esiste.'),
    ('<p>Independent nights · Perugia, Italia</p>', '<p>Serate indipendenti · Perugia, Italia</p>'),
    ('rel="noopener">Contact ↗</a>', 'rel="noopener">Contatti ↗</a>'),
    # live texts from the script
    ('ev.sold_out ? "Join the waitlist" : a.dataset.label', 'ev.sold_out ? "Entra in lista d’attesa" : a.dataset.label'),
    ('mb.textContent = ev.sold_out ? "Join the waitlist" : "Request a place"', 'mb.textContent = ev.sold_out ? "Entra in lista d’attesa" : "Richiedi un posto"'),
    ('<span class="hm-red" id="proof">Invite only</span>', '<span class="hm-red" id="proof">Solo su invito</span>'),
    ('"Join the waitlist" : "Request a place"', '"Entra in lista d’attesa" : "Richiedi un posto"'),
    ('"Join the waitlist" : "Send request"', '"Entra in lista d’attesa" : "Invia richiesta"'),
    ('<p>Request below. Once approved, pay to unlock your ticket.</p>', '<p>Richiedi qui sotto. Se approvato, paghi e sblocchi il biglietto.</p>'),
]
build("/it", "it", COMMON_HEAD("/it", "Feste universitarie ed Erasmus a Perugia · PerugiaParty",
        "Feste private per studenti universitari ed Erasmus nel centro di Perugia. Open bar, DJ e gente nuova da conoscere, a prezzo studenti. 18+.",
        "Feste universitarie a Perugia · PerugiaParty", "Serata da club. Vibe da centro. Il meglio dei due mondi. Open bar, prezzi bassi. 18+.", "it_IT") + IT,
      "hero-it", "Perugia di notte, con una festa accesa", it_post)
print("built /it and /erasmus")
