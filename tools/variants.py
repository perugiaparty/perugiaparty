"""Builds /it and /erasmus from the homepage (public/index.html), so all three share one design.
Run after every homepage change:  python3 tools/variants.py"""
import re, json, sys, os
ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
SRC = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

def build(path, lang, pairs, hero_art, hero_alt):
    s, miss = SRC, []
    for a, b in pairs:
        if a not in s: miss.append(a[:60])
        s = s.replace(a, b)
    # hero: own illustration instead of the example ticket
    s = re.sub(r'<a class="ticket".*?</a>', f'<img class="hero-art" src="/ill/{hero_art}.svg" alt="{hero_alt}" width="360" height="200" fetchpriority="high">', s, count=1, flags=re.S)
    s = s.replace('<link rel="preload" href="/logo.png" as="image">', f'<link rel="preload" href="/ill/{hero_art}.svg" as="image">')
    s = s.replace("</style>", ".hero-art{display:block;width:100%;height:auto;border-radius:24px;box-shadow:12px 12px 0 var(--red);transform:rotate(-2deg)}\n</style>", 1)
    # structured data: this page + its own visible FAQ
    sec = s[s.index('id="faq"'):]
    faq = [{"@type": "Question", "name": re.sub("<[^>]+>", "", q), "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", a)).strip()}}
           for q, a in re.findall(r"<summary>(.*?)</summary>(.*?)</details>", sec[:sec.index("</section>")], re.S)]
    title = re.search(r"<title>(.*?)</title>", s).group(1).replace("&amp;", "&")
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": f"https://perugiaparty.com{path}#page", "url": f"https://perugiaparty.com{path}", "name": title, "inLanguage": lang,
         "isPartOf": {"@id": "https://perugiaparty.com/#website"}, "about": {"@id": "https://perugiaparty.com/#org"}},
        {"@type": "FAQPage", "@id": f"https://perugiaparty.com{path}#faq", "mainEntity": faq}]}
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

# ---------- Erasmus (English)
build("/erasmus", "en", COMMON_HEAD("/erasmus", "Erasmus parties in Perugia · PerugiaParty",
        "New in Perugia on Erasmus? PerugiaParty runs private student parties in the city centre: open bar, DJs and people from all over the world, at a student price. 18+.",
        "Erasmus parties in Perugia · PerugiaParty", "New in town? Open bar, DJs and people from all over the world, at a student price. 18+.", "en_GB") + [
    ('<link rel="alternate" hreflang="en" href="https://perugiaparty.com/">\n<link rel="alternate" hreflang="it" href="https://perugiaparty.com/it">\n<link rel="alternate" hreflang="x-default" href="https://perugiaparty.com/">\n', ""),
    ('Student parties <em>in Perugia.</em>', 'Erasmus parties <em>in Perugia.</em>'),
    ('Your people. Your night. Open bar, DJs and new people to meet, at a student price.', 'New in town? Meet people from Umbria and from all over the world. Open bar, DJs, student price.'),
    ('<a href="/erasmus">Erasmus in Perugia →</a>', '<a href="/">Home →</a>'),
], "hero-erasmus", "People from all over the world meeting in Perugia")

# ---------- Italiano
IT = [
    ('<html lang="en">', '<html lang="it">'),
    ('<a class="keep" href="#faq">FAQ</a>', '<a class="keep" href="#faq">Domande</a>'),
    ('Request a place</a>', 'Richiedi un posto</a>'),
    ('<span class="hm-red">Invite only</span>', '<span class="hm-red">Solo su invito</span>'),
    ('Student parties <em>in Perugia.</em>', 'Feste universitarie <em>a Perugia.</em>'),
    ('Your people. Your night. Open bar, DJs and new people to meet, at a student price.', 'La tua gente. La tua notte. Open bar, DJ e gente nuova da conoscere, a prezzo studenti.'),
    ('<p class="ig-note">Questions? DM', '<p class="ig-note">Domande? Scrivi a'),
    ('<h2>Next party.</h2>', '<h2>Prossima festa.</h2>'),
    ('<p>New list every edition.</p>', '<p>Lista nuova a ogni edizione.</p>'),
    ('Announcing soon', 'In arrivo'),
    ('<h3>The next edition is in the works.</h3>', '<h3>La prossima edizione è in preparazione.</h3>'),
    ('<p>Date and theme drop on Instagram first.</p>', '<p>Data e tema escono prima su Instagram.</p>'),
    ('Follow on Instagram ↗', 'Seguici su Instagram ↗'),
    ('Club night. Centro vibes. <span>Best of both.</span>', 'Serata da club. Vibe da centro. <span>Il meglio di entrambi.</span>'),
    ('<p class="vs-t">The club</p>', '<p class="vs-t">La discoteca</p>'),
    ('Expensive.<br>Light drinks.<br>Far away.', 'Cara.<br>Drink leggeri.<br>Lontana.'),
    ('Student prices.<br>Open bar.<br>In the centre.<br>Till late.', 'Prezzi studenti.<br>Open bar.<br>In centro.<br>Fino a tardi.'),
    ('<p class="vs-t">The centro</p>', '<p class="vs-t">Il centro</p>'),
    ('In the cold.<br>No music.<br>Ends early.', 'Al freddo.<br>Niente musica.<br>Finisce presto.'),
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
    ('See the real nights on Instagram ↗', 'Le notti vere su Instagram ↗'),
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
    ('<a href="/it" hreflang="it" lang="it">In italiano: feste universitarie a Perugia →</a>', '<a href="/" hreflang="en" lang="en">In English →</a>'),
    ('<p class="sign">Tonight we party. Tomorrow we forget. <span>Later, it\'s the best night you\'ve ever had.</span></p>', '<p class="sign">Stanotte si balla. Domani si dimentica. <span>Poi è la notte più bella di sempre.</span></p>'),
    ('<p>Independent nights · Perugia, Italia</p>', '<p>Serate indipendenti · Perugia, Italia</p>'),
    ('<a href="#rules">House rules</a>', '<a href="#rules">Regole</a>'),
    ('rel="noopener">Contact ↗</a>', 'rel="noopener">Contatti ↗</a>'),
    # live texts from the script
    ('a.id === "nav-cta" ? "Instagram ↗" : "Follow for the next date ↗"', 'a.id === "nav-cta" ? "Instagram ↗" : "Segui per la prossima data ↗"'),
    ('"Join the waitlist" : "Request a place"', '"Entra in lista d’attesa" : "Richiedi un posto"'),
    ('"Join the waitlist" : "Send request"', '"Entra in lista d’attesa" : "Invia richiesta"'),
    ('<p>Request below. Once approved, pay to unlock your ticket.</p>', '<p>Richiedi qui sotto. Se approvato, paghi e sblocchi il biglietto.</p>'),
]
build("/it", "it", COMMON_HEAD("/it", "Feste universitarie ed Erasmus a Perugia · PerugiaParty",
        "Feste private per studenti universitari ed Erasmus nel centro di Perugia. Open bar, DJ e gente nuova da conoscere, a prezzo studenti. 18+.",
        "Feste universitarie a Perugia · PerugiaParty", "Serata da club. Vibe da centro. Il meglio di entrambi. Open bar, prezzi studenti. 18+.", "it_IT") + IT,
      "hero-it", "Perugia di notte, con una festa accesa")
print("built /it and /erasmus")
