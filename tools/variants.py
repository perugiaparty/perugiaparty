"""Builds /italian and /erasmus from the homepage (public/index.html), so all three share one design.
Run after every homepage change:  python3 tools/variants.py"""
import re, json, sys, os
ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
SRC = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

def build(path, lang, pairs, post=None):
    s, miss = SRC, []
    for a, b in pairs:
        if a not in s: miss.append(a[:60])
        s = s.replace(a, b)
    if post: s = post(s)
    # structured data: this page + its own visible FAQ
    faq = []
    if 'id="faq"' in s and "rules-sec" not in s:
        sec = s[s.index('id="faq"'):]
        faq = [{"@type": "Question", "name": re.sub("<[^>]+>", "", q), "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", a)).strip()}}
               for q, a in re.findall(r"<summary>(.*?)</summary>(.*?)</details>", sec[:sec.index("</section>")], re.S)]
    title = re.search(r"<title>(.*?)</title>", s).group(1).replace("&amp;", "&")
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": f"https://perugiaparty.com{path}#page", "url": f"https://perugiaparty.com{path}", "name": title, "inLanguage": lang,
         "isPartOf": {"@id": "https://perugiaparty.com/#website"}, "about": {"@id": "https://perugiaparty.com/#org"}},
        {"@type": "FAQPage", "@id": f"https://perugiaparty.com{path}#faq", "mainEntity": faq}]}
    if not faq: ld["@graph"].pop()
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

HERO_TICKET = r'<a class="ticket[^"]*".*?</a>\s*'


# ---------- Erasmus: the starter kit sits next to the title, the FAQ answers the "new here" questions
ER_FAQ = [
    ("I just arrived. What is PerugiaParty?", "Private parties for university and Erasmus students in Perugia’s centre: open bar, DJs and new people, at a student price. Run by volunteers. 18+."),
    ("Do I need to speak Italian?", "No. The website, your ticket and our Instagram are in English."),
    ("How do I join?", "Request a place on this page, then DM your code to @perugiaparty on Instagram. We check every request and send you your ticket page."),
    ("I don’t have an Italian bank account.", "No problem. A normal SEPA transfer in euro from any European account works. Use your name and code as the reference."),
    ("How do I get there?", "It’s in the city centre, so you can walk from most student areas in town. The exact place is on your ticket after payment."),
    ("What do I bring?", "Your ticket QR on your phone and a photo ID (passport or ID card). You must be 18+."),
]
def erasmus_post(s):
    # the hero keeps the receipt; a help link sits next to the button
    s = s.replace('<a class="btn" href="#request" data-req>Request a place</a>\n        </div>',
                  '<a class="btn" href="#request" data-req>Request a place</a>\n          <a class="ask" href="#how">How it works</a>\n        </div>', 1)
    # three options, then how it works, then the questions
    s = s.replace("</style>", """.o-why{order:1}.o-main{order:2}.o-faq{order:3}.o-nights{display:none!important}
#request{display:none!important}
#how{border-top:1.5px solid var(--line)}
#faq h2 span{color:var(--red)}
.ask{font-weight:800;color:#ff8a7d;text-underline-offset:3px;align-self:center}
</style>""", 1)
    s = s.replace('href="#request"', 'href="/#request"').replace('a.href = "#request"', 'a.href = "/#request"')
    # the questions a newcomer actually has
    a = s.index('<div class="faq">', s.index('id="faq"')); b = s.index('<details id="rules">', a)
    s = s[:a] + '<div class="faq">\n' + "".join(f"        <details><summary>{q}</summary><p>{x}</p></details>\n" for q, x in ER_FAQ) + "        " + s[b:]
    return s

# ---------- Erasmus (English)
build("/erasmus", "en", COMMON_HEAD("/erasmus", "Erasmus parties in Perugia · PerugiaParty",
        "New in Perugia on Erasmus? PerugiaParty runs private student parties in the city centre: open bar, DJs and people from all over the world, at a student price. 18+.",
        "Erasmus parties in Perugia · PerugiaParty", "New in town? Open bar, DJs and people from all over the world, at a student price. 18+.", "en_GB") + [
    ('<link rel="alternate" hreflang="en" href="https://perugiaparty.com/">\n<link rel="alternate" hreflang="it" href="https://perugiaparty.com/italian">\n<link rel="alternate" hreflang="x-default" href="https://perugiaparty.com/">\n', ""),
    ('Student parties <em>in Perugia.</em>', 'Erasmus parties <em>in Perugia.</em>'),
    ('Your people. Your night. Open bar, DJs and new people to meet, at a student price.', 'Just arrived? Three ways to go out in Perugia. Only one ticks every box.'),
    ('<p>Six steps to the door.</p>', '<p>From your phone to the party. No Italian needed.</p>'),
    ('<h3>Request</h3><p>Fill in 30 seconds.</p>', '<h3>Request</h3><p>Your name and Instagram. 30 seconds.</p>'),
    ('<h3>DM the code</h3><p>Send it on Instagram.</p>', '<h3>DM the code</h3><p>Send it to @perugiaparty on Instagram.</p>'),
    ('<h3>Approved</h3><p>We check every request.</p>', '<h3>Approved</h3><p>We reply in your DMs with your page.</p>'),
    ('<h3>Pay</h3><p>Bank transfer, tap to copy.</p>', '<h3>Pay</h3><p>Bank transfer in euro, any European bank.</p>'),
    ('<h3>Your QR</h3><p>Ticket and place unlock.</p>', '<h3>Your QR</h3><p>Your ticket and the address appear.</p>'),
    ('<h3>Party</h3><p>QR and photo ID at the door.</p>', '<h3>Party</h3><p>Show the QR and your passport or ID card.</p>'),
    ('Club night. Centro vibes. <span>Best of both.</span>', 'Three ways to go out. <span>One makes sense.</span>'),
    ('Expensive.<br>Light drinks.<br>Far away.', 'Out of town.<br>Taxi both ways.<br>Pricey drinks.'),
    ('Student prices.<br>Open bar.<br>In the centre.<br>Till late.', 'Student price.<br>Open bar.<br>Walk there.<br>All in English.'),
    ('In the cold.<br>No music.<br>Ends early.', 'Outside in the cold.<br>No music.<br>Bars shut 01:30.'),
    ('<h3 class="why-q">But <span>why?</span></h3>', '<h3 class="why-q">Who <span>we are.</span></h3>'),
    ('<h2 id="faq-h">Good to know.</h2>', '<h2 id="faq-h">New here? <span>Start with this.</span></h2>'),
    ('<p>We check every request on Instagram.</p>', '<p>We check every request on Instagram.</p>'),
], erasmus_post)


# ---------- Italiano: the whole homepage in Italian, without the FAQ
def italian_post(s):
    # the receipt, in Italian
    for a, b in ((">Student night", ">Serata studenti"), (">Real DJs<", ">DJ veri<"),
                 (">In the centre<", ">In centro<"), (">Till late<", ">Fino a tardi<"), (">New friends<", ">Gente nuova<"),
                 (">Best night of the month<", ">La notte del mese<"), (">Total<", ">Totale<"), (">Student price<", ">Prezzo studenti<"),
                 (">YES<", ">SÌ<"), (">FREE<", ">GRATIS<"), (">INCL.<", ">INCL.<"),
                 ('aria-label="Request a place: what a night includes"', 'aria-label="Richiedi un posto: cosa include la serata"')):
        s = s.replace(a, b)
    # the band: why this is not the usual student party
    FATTI = [("Open bar vero", "Bevi quanto vuoi."), ("DJ veri", "Niente playlist dal telefono."),
             ("Lista privata", "Chiedi il posto su Instagram."), ("In centro", "Ci arrivi a piedi.")]
    fatti = "".join(f'<li><i aria-hidden="true"></i><b>{h}</b><span>{x}</span></li>' for h, x in FATTI)
    band = f'''  <section class="band-ink o-fat" aria-labelledby="fat-h"><div class="wrap"><div class="fat">
      <div><p class="fat-k">Perugia · 18+</p><h2 id="fat-h">Non la <span>solita</span> festa universitaria.</h2>
      <p class="fat-b"><a class="btn" href="#request" data-req>Richiedi un posto</a></p></div>
      <ul>{fatti}</ul>
    </div></div></section>
'''
    s = s.replace('  <div class="wrap o-main">', band + '  <div class="wrap o-main">', 1)
    # no FAQ on this page; the house rules live on the English homepage
    a = s.index('<div class="wrap o-faq">')
    b = s.index("</div>", s.index("</section>", a)) + 6
    s = s[:a] + s[b:]
    s = s.replace('href="#rules"', 'href="/#rules"').replace('a[href="/#rules"]', 'a[href="#rules"]')
    s = s.replace("</style>", """.o-fat{order:3}.o-next{order:4}.o-main{order:5}.o-faq{order:6}.o-nights{order:7}
.band-ink{background:var(--ink);color:var(--cream)}
.fat{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:clamp(30px,5vw,68px);align-items:center;padding-block:clamp(52px,7vw,92px)}
.fat-k{font-family:var(--f-mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#ff4a3d;margin:0 0 14px}
.fat h2{font-size:clamp(30px,4.2vw,52px);line-height:.98;margin:0;max-width:13ch}.fat h2 span{color:#ff4a3d}
.fat .fat-b{margin:26px 0 0}
.fat ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fat li{background:#1c1816;border:1px solid #2d2724;border-radius:16px;padding:18px}
.fat li i{display:block;width:9px;height:9px;border-radius:50%;background:#ff4a3d;margin-bottom:13px}
.fat li b{display:block;font-size:17px;font-weight:800;margin-bottom:5px}
.fat li span{color:#b9ab98;font-size:14.5px;line-height:1.45}
@media (max-width:820px){.fat{grid-template-columns:1fr;gap:28px}}
@media (max-width:420px){.fat ul{grid-template-columns:1fr}}
</style>""", 1)
    return s

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
    ('Follow on Instagram', 'Seguici su Instagram'),
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
    ('Your details are only used for the guest list.', 'I tuoi dati servono solo per la lista ospiti.'),
    ('<p class="rc-s" id="pv-ev">Guest request</p>', '<p class="rc-s" id="pv-ev">Richiesta ospite</p>'),
    ('<p class="pv-name" id="pv-name">Your name</p>', '<p class="pv-name" id="pv-name">Il tuo nome</p>'),
    ('<span></span> 18+ with photo ID', '<span></span> 18+ con documento'),
    ('<span></span> House rules read', '<span></span> Regole lette'),
    ('<p class="tiny" id="pv-tiny">Your code arrives after approval</p>', '<p class="tiny" id="pv-tiny">Il codice arriva dopo l’approvazione</p>'),
    ('<h3>Not sent yet: DM us this code.</h3>', '<h3>Non ancora inviata: mandaci questo codice.</h3>'),
    ('id="copy-link">Copy code</button>', 'id="copy-link">Copia codice</button>'),
    ('Send code on Instagram', 'Manda il codice su Instagram'),
    ('<h2 id="nights-h">Nights you missed.</h2>', '<h2 id="nights-h">Le notti che ti sei perso.</h2>'),
    ('See everything on Instagram', 'Vedi tutto su Instagram'),
    ('<p class="when">Last edition</p>', '<p class="when">Ultima edizione</p>'),
    ('<p class="when">Past edition</p>', '<p class="when">Edizione passata</p>'),
    ('<summary>What are the house rules?</summary>', '<summary>Regole della casa</summary>'),
    ('<b>On the list or not in.</b> No list, no entry. Tickets are personal.', '<b>In lista o fuori.</b> Niente lista, niente ingresso. I biglietti sono personali.'),
    ('<b>Pay before you come.</b> Bank transfer with your name and PP code as the reference.', '<b>Paga prima di venire.</b> Bonifico con nome e codice PP come causale.'),
    ("<b>Pace yourself.</b> One drink at a time. Don't waste them.", '<b>Con calma.</b> Un drink alla volta. Non sprecarli.'),
    ('<b>Leave the music alone.</b> Respect the vibe and whoever is playing.', '<b>La musica non si tocca.</b> Rispetta la vibe e chi suona.'),
    ('<b>No mess.</b> Use the bags. Leave the place as you found it.', '<b>Niente casino.</b> Usa i sacchi. Lascia il posto come l’hai trovato.'),
    ("<b>Respect the staff.</b> They're the reason the night happens.", '<b>Rispetta lo staff.</b> È grazie a loro che la notte esiste.'),
    ('<p>Independent nights · Perugia, Italia</p>', '<p>Serate indipendenti · Perugia, Italia</p>'),
    ('<a href="/italian" hreflang="it">Italiano</a>', '<a href="/" hreflang="en">English</a>'),
    ('rel="noopener">Contact</a>', 'rel="noopener">Contatti</a>'),
    ('Tonight we party. Tomorrow we forget. <span>Later, it\'s the best night you\'ve ever had.</span>',
     'Stanotte si balla. Domani non ricordiamo. <span>Poi diventa la notte più bella di sempre.</span>'),
    # live texts from the script
    ('ev.sold_out ? "Join the waitlist" : a.dataset.label', 'ev.sold_out ? "Entra in lista d’attesa" : a.dataset.label'),
    ('mb.textContent = ev.sold_out ? "Join the waitlist" : "Request a place"', 'mb.textContent = ev.sold_out ? "Entra in lista d’attesa" : "Richiedi un posto"'),
    ('<span class="hm-red" id="proof">Invite only</span>', '<span class="hm-red" id="proof">Solo su invito</span>'),
    ('"Join the waitlist" : "Request a place"', '"Entra in lista d’attesa" : "Richiedi un posto"'),
    ('"Join the waitlist" : "Send request"', '"Entra in lista d’attesa" : "Invia richiesta"'),
    ('<p class="next-sub">Request below. Once approved, pay to unlock your ticket.</p>', '<p class="next-sub">Richiedi qui sotto. Se approvato, paghi e sblocchi il biglietto.</p>'),
    ('[["Date", ev.date_label], ["Doors", ev.doors], ["Tickets", price]]', '[["Data", ev.date_label], ["Porte", ev.doors], ["Biglietti", price]]'),
    ('"From " + euro(ev.price.min)', '"Da " + euro(ev.price.min)'),
    ('[[d,"days"],[p(h),"hours"],[p(m),"min"],[p(s),"sec"]]', '[[d,"giorni"],[p(h),"ore"],[p(m),"min"],[p(s),"sec"]]'),
    ('<b style="font-size:22px">The party has started.</b>', '<b style="font-size:22px">La festa è iniziata.</b>'),
]
build("/italian", "it", COMMON_HEAD("/italian", "Feste universitarie ed Erasmus a Perugia · PerugiaParty",
        "Feste private per studenti universitari ed Erasmus nel centro di Perugia. Open bar, DJ e gente nuova da conoscere, a prezzo studenti. 18+.",
        "Feste universitarie a Perugia · PerugiaParty", "Serata da club. Vibe da centro. Il meglio dei due mondi. Open bar, prezzi bassi. 18+.", "it_IT") + IT,
      italian_post)
print("built /italian and /erasmus")
