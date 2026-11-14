"""Builds /biglietto from the guest ticket page (public/ticket.html), so Italian guests
get the whole flow in Italian. Run after every ticket.html change:
    python3 tools/ticket_it.py        (tools/variants.py calls it too)
"""
import os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "public")

PAIRS = [
    # ---------- head ----------
    ('<html lang="en">', '<html lang="it">'),
    ('<title>My ticket · PerugiaParty</title>', '<title>Il mio biglietto · PerugiaParty</title>'),

    # ---------- loading and errors ----------
    ('Loading your ticket…', 'Carico il tuo biglietto…'),
    ('Making your ticket…', 'Preparo il tuo biglietto…'),
    ("Couldn't load your ticket.", 'Non riesco a caricare il biglietto.'),
    ("We couldn't find that ticket link. Log in with your Instagram and code instead.",
     'Non troviamo questo link. Entra con il tuo Instagram e il codice.'),
    ("We couldn't read this ticket. DM us on Instagram and we'll sort it out.",
     'Non riusciamo a leggere questo biglietto. Scrivici su Instagram e lo sistemiamo.'),
    ("We couldn't reach the server. Check your connection and try again.",
     'Non riusciamo a raggiungere il server. Controlla la connessione e riprova.'),
    ("You're offline. Connect to the internet and try again.", 'Sei offline. Collegati a internet e riprova.'),
    ('No connection. Check your internet and try again.', 'Nessuna connessione. Controlla internet e riprova.'),
    ('No connection · not sent', 'Nessuna connessione · non inviato'),
    ('No connection', 'Nessuna connessione'),
    ("Couldn't send. Try again.", 'Invio non riuscito. Riprova.'),
    ("That didn't work. Try again.", 'Non ha funzionato. Riprova.'),
    ("Something's off.", 'Qualcosa non va.'),
    ('>Try again<', '>Riprova<'),

    # ---------- status ----------
    ("You're accepted", 'Sei dentro'),
    ("You're all set", 'È tutto pronto'),
    ("You're checked in", 'Sei entrato'),
    ("You're going", 'Ci sei'),
    ("You're on the waitlist", "Sei in lista d'attesa"),
    ('Request sent', 'Richiesta inviata'),
    ('Request not sent · see below', 'Richiesta non inviata · vedi sotto'),
    ('Not sent yet', 'Non ancora inviata'),
    ('Payment received', 'Pagamento ricevuto'),
    ('<span class="state">Checked in</span>', '<span class="state">Entrato</span>'),
    ('<span class="instamp">CHECKED IN</span>', '<span class="instamp">ENTRATO</span>'),
    ("It's party time.", 'È ora di festa.'),
    ("That's a wrap", 'È finita'),
    ('Not this time.', 'Non questa volta.'),
    ('Your place was cancelled.', 'Il tuo posto è stato annullato.'),
    ('Your place was released.', 'Il tuo posto è stato liberato.'),
    ('Your place went back to the list. DM us on Instagram if you think this is a mistake.',
     'Il tuo posto è tornato in lista. Scrivici su Instagram se pensi sia un errore.'),
    ("We couldn't give you a place for this edition. Keep an eye on Instagram for the next one.",
     'Non siamo riusciti a darti un posto per questa edizione. Segui Instagram per la prossima.'),
    ('<span class="wl-tag">Waitlist</span>', '<span class="wl-tag">Lista d’attesa</span>'),
    ('<span class="live">Live</span>', '<span class="live">Live</span>'),
    ('<span class="tag">Now</span>', '<span class="tag">Ora</span>'),
    ('Your page just updated', 'La pagina si è aggiornata'),
    ('Your request was updated', 'La tua richiesta è stata aggiornata'),

    # ---------- payment ----------
    ('Pay by instant bank transfer', 'Paga con bonifico istantaneo'),
    ('<span class="k">Pay before</span>', '<span class="k">Paga entro</span>'),
    ('<span class="k">Pay before ${when}</span>', '<span class="k">Paga entro ${when}</span>'),
    ('Your time to pay is up.', 'Il tempo per pagare è scaduto.'),
    ('Copy all payment details', 'Copia tutti i dati'),
    ('What this goes to', 'Dove vanno i soldi'),
    ('This is the price for your place.', 'Questo è il prezzo del tuo posto.'),
    ('This is a special price, just for you.', 'Questo è un prezzo speciale, solo per te.'),
    ('You were approved early, so you get the lowest price.',
     'Sei stato approvato presto, quindi hai il prezzo più basso.'),
    ('You were approved at the normal price.', 'Sei stato approvato al prezzo normale.'),
    ('You were approved close to the party, so the late price applies.',
     'Sei stato approvato vicino alla serata, quindi vale il prezzo late.'),
    ('Special price', 'Prezzo speciale'),
    ('Your ticket is on us.', 'Il biglietto te lo offriamo noi.'),
    ('One euro more', 'Un euro in più'),
    ('One euro less', 'Un euro in meno'),
    ('You supported the crew, and the whole team thanks you.',
     'Hai sostenuto la crew, e tutto il team ti ringrazia.'),

    # ---------- the ticket itself ----------
    ('Your entry QR code', "Il tuo codice QR d'ingresso"),
    ('Your entry QR', "Il tuo QR d'ingresso"),
    ('Open your QR full screen', 'Apri il QR a schermo intero'),
    ('Tap the code to open it big', 'Tocca il codice per ingrandirlo'),
    ('Screenshot your QR', 'Fai uno screenshot del QR'),
    ('Save image', 'Salva immagine'),
    ('Saved to your photos, it works without signal at the door.',
     "Salvato nelle foto, funziona anche senza rete all'ingresso."),
    ('Hold the ticket, then tap', 'Tieni premuto sul biglietto, poi tocca'),
    ('Save a copy (PDF)', 'Salva una copia (PDF)'),
    ('Save a copy', 'Salva una copia'),
    ('Want the PDF? Open this page in Safari or Chrome (menu, then Open in browser).',
     'Vuoi il PDF? Apri questa pagina in Safari o Chrome (menu, poi Apri nel browser).'),
    ('Your QR stays on this page: open the link at the door. Bring your photo ID.',
     "Il QR resta su questa pagina: apri il link all'ingresso. Porta un documento."),
    ('PHOTO ID AT THE DOOR · 18+', "DOCUMENTO ALL'INGRESSO · 18+"),
    ('Photo ID at the door · 18+', "Documento all'ingresso · 18+"),
    ('CREW PASS · PHOTO ID AT THE DOOR', "PASS CREW · DOCUMENTO ALL'INGRESSO"),
    ('Crew pass · photo ID at the door', "Pass crew · documento all'ingresso"),
    ('<span class="crewband">Crew pass</span>', '<span class="crewband">Pass crew</span>'),
    ('Crew pass', 'Pass crew'),
    ('Tap to see your ticket', 'Tocca per vedere il biglietto'),
    ('Tap to see your pass', 'Tocca per vedere il pass'),
    ('Entered at', 'Entrato alle'),
    ('When and where', 'Quando e dove'),
    ('Open in Maps', 'Apri in Maps'),
    ('The programme', 'Il programma'),
    ('Your receipt', 'Il tuo scontrino'),
    ('Your progress', 'A che punto sei'),
    ('Save your ticket', 'Salva il biglietto'),
    ('>Calendar<', '>Calendario<'),

    # ---------- save to home screen, notifications ----------
    ('Save this page', 'Salva questa pagina'),
    ('Add to home screen', 'Aggiungi alla schermata Home'),
    ('Keep your ticket one tap away', 'Tieni il biglietto a portata di tocco'),
    ('Works without signal, with a ping for the programme.',
     'Funziona anche senza rete, con una notifica per il programma.'),
    ('Turn on notifications', 'Attiva le notifiche'),
    ('Notifications blocked', 'Notifiche bloccate'),
    ("Notifications aren't available yet.", 'Le notifiche non sono ancora disponibili.'),
    ("Couldn't turn on notifications.", 'Non siamo riusciti ad attivare le notifiche.'),

    # ---------- confirming the Instagram account ----------
    ('DM this code to', 'Manda questo codice a'),
    ("Send us this code on Instagram. Until then your request doesn't count.",
     'Mandaci questo codice su Instagram. Fino ad allora la richiesta non vale.'),
    ('Send us your code on Instagram.', 'Mandaci il tuo codice su Instagram.'),
    ('You get an automatic reply within a minute.', 'Ricevi una risposta automatica entro un minuto.'),
    ('We confirm it as soon as we see it.', 'Confermiamo appena lo vediamo.'),
    ('Send code on Instagram', 'Manda il codice su Instagram'),
    ('Instagram confirmed', 'Instagram confermato'),
    ('Wrong Instagram or code', 'Instagram o codice sbagliato'),
    ('We got this code from a different Instagram account. Send it from',
     'Abbiamo ricevuto questo codice da un altro account Instagram. Mandalo da'),
    ('We got this code from a different account. Send it from',
     'Abbiamo ricevuto questo codice da un altro account. Mandalo da'),
    ('Last step', 'Ultimo passo'),
    ('Copy the link above', 'Copia il link qui sopra'),
    ('Copy link', 'Copia link'),
    ('Long-press to copy', 'Tieni premuto per copiare'),
    ('Hold the code to save it, or screenshot this screen.',
     'Tieni premuto sul codice per salvarlo, o fai uno screenshot.'),
    ('Keep the code: with it you can log in at perugiaparty.com/ticket on any phone.',
     'Tieni il codice: con quello entri su perugiaparty.com/biglietto da qualsiasi telefono.'),
    ('The link is also in your DMs.', 'Il link è anche nei tuoi messaggi.'),

    # ---------- logging in ----------
    ('>Log in<', '>Entra<'),
    ('Lost your code?', 'Perso il codice?'),
    ('Open my request', 'Apri la mia richiesta'),
    ('Add your Instagram.', 'Aggiungi il tuo Instagram.'),
    ('Add your full code, like H26-K7M4QX.', 'Aggiungi il codice completo, tipo H26-K7M4QX.'),
    ('Code (H26-XXXXXX)', 'Codice (H26-XXXXXX)'),
    ('Personal code', 'Codice personale'),
    ('No request yet?', 'Non hai ancora una richiesta?'),
    ('Request my place', 'Richiedi il mio posto'),
    ('Request a place', 'Richiedi un posto'),
    ('You already requested a place for this one.', 'Hai già una richiesta per questa serata.'),
    ("Requests aren't open yet. Follow", 'Le richieste non sono ancora aperte. Segui'),

    # ---------- returning guests ----------
    ('Early access is open for returning guests only.', "L'accesso anticipato è solo per chi è già venuto."),
    ('Returning guests are first in line.', 'Chi è già venuto ha la precedenza.'),
    ('Use my early access', 'Usa il mio accesso anticipato'),
    ('<span class="badge">Priority guest</span>', '<span class="badge">Ospite con precedenza</span>'),
    ('Welcome back, ', 'Bentornato, '),
    ('We look at your request before the new ones.', 'Guardiamo la tua richiesta prima delle nuove.'),
    ('You go first the moment a place opens up.', 'Sei il primo appena si libera un posto.'),

    # ---------- bringing friends ----------
    ('Bring a friend.', 'Porta un amico.'),
    ('Bring your friends anyway.', 'Porta comunque i tuoi amici.'),
    ('Send invite', "Manda l'invito"),
    ('Send to friends', 'Manda agli amici'),
    ('Invite copied', 'Invito copiato'),
    ('Invite used', 'Invito usato'),
    ('Your friend is on it.', 'Il tuo amico ci sta.'),
    ('Free tickets all taken', 'Biglietti gratis esauriti'),
    ('Tell friends', 'Dillo agli amici'),
    ('Share perugiaparty.com', 'Condividi perugiaparty.com'),
    ('Send your photos', 'Manda le tue foto'),
    ('Tell us how it was', "Raccontaci com'è andata"),
    ('Enjoy the night.', 'Buona serata.'),
    ('Next party', 'Prossima festa'),

    # ---------- the line under the page ----------
    ("Tickets are personal and can't be transferred or refunded. If we cancel, we contact you and return your money.",
     'I biglietti sono personali, non cedibili e non rimborsabili. Se annulliamo noi, ti contattiamo e ti restituiamo i soldi.'),
    ('<a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>',
     '<a href="/termini">Termini</a> · <a href="/privacy">Privacy</a>'),
    # ---------- the live screens ----------
    ('const names = ["Request", "Review", "Pay", "Ticket", "Party"];',
     'const names = ["Richiesta", "Verifica", "Paga", "Biglietto", "Festa"];'),
    ('<span class="state">Accepted</span>', '<span class="state">Accettato</span>'),
    ("<h1>You're in, ${first}.</h1>", '<h1>Ci sei, ${first}.</h1>'),
    ('. Pay below to lock your place.', '. Paga qui sotto per bloccare il posto.'),
    ('c.textContent = "My ticket"', 'c.textContent = "Il mio biglietto"'),
    ('<h1>My ticket</h1>', '<h1>Il mio biglietto</h1>'),
    ('${line("1X", "MUSIC", "INCL.")}', '${line("1X", "MUSICA", "INCL.")}'),
    ('${line("1X", "ALL NIGHT", "INCL.")}', '${line("1X", "TUTTA LA NOTTE", "INCL.")}'),
    ('>SUPPORT US<', '>SOSTIENICI<'),
    ('<span>TOTAL</span>', '<span>TOTALE</span>'),
    # 'Special price' is already Italian by the time this runs, so match what is there
    ('const names = { early: "Early bird", normal: "Normal", late: "Late", special: "Prezzo speciale" };',
     'const names = { early: "Early bird", normal: "Normale", late: "Late", special: "Prezzo speciale" };'),
    ('const tierName = names[d.ticket] || "Ticket";', 'const tierName = names[d.ticket] || "Biglietto";'),
    ('"TICKET · " + esc(String(tierName).toUpperCase())', '"BIGLIETTO · " + esc(String(tierName).toUpperCase())'),
    ('new Date(iso).toLocaleDateString("en-GB"', 'new Date(iso).toLocaleDateString("it-IT"'),
    # ---------- the payment block ----------
    ('${copyLine("NAME"', '${copyLine("NOME"'),
    ('copyLine("BANK", country', 'copyLine("BANCA", country'),
    ('${copyLine("REFERENCE"', '${copyLine("CAUSALE"'),
    ('.rc-c i::after{content:"COPY"}', '.rc-c i::after{content:"COPIA"}'),
    ('.rc-c.got i::after{content:"COPIED"}', '.rc-c.got i::after{content:"COPIATO"}'),
    ('new Date(dl).toLocaleString("en-GB"', 'new Date(dl).toLocaleString("it-IT"'),
    ('const CC = {IT:"Italy",LT:"Lithuania",DE:"Germany",NL:"Netherlands",BE:"Belgium",FR:"France",ES:"Spain",IE:"Ireland",GB:"United Kingdom",AT:"Austria",LU:"Luxembourg",PT:"Portugal",EE:"Estonia",LV:"Latvia",FI:"Finland",MT:"Malta",SM:"San Marino",CH:"Switzerland",PL:"Poland"};',
     'const CC = {IT:"Italia",LT:"Lituania",DE:"Germania",NL:"Paesi Bassi",BE:"Belgio",FR:"Francia",ES:"Spagna",IE:"Irlanda",GB:"Regno Unito",AT:"Austria",LU:"Lussemburgo",PT:"Portogallo",EE:"Estonia",LV:"Lettonia",FI:"Finlandia",MT:"Malta",SM:"San Marino",CH:"Svizzera",PL:"Polonia"};'),
    ('Amount: ${euro(total)}\\nIBAN:', 'Importo: ${euro(total)}\\nIBAN:'),
    ('\\nBeneficiary: ${d.beneficiary || ""}', '\\nBeneficiario: ${d.beneficiary || ""}'),
    ('\\nBank country: ${bankCountry}', '\\nPaese banca: ${bankCountry}'),
    ('\\nReference: ${d.reference}', '\\nCausale: ${d.reference}'),
    # ---------- the last pieces ----------
    ('alt="Your PerugiaParty ticket ${esc(d.code)}"', 'alt="Il tuo biglietto PerugiaParty ${esc(d.code)}"'),
    ('esc2("Your ticket: " + (d.link || location.href) + " · Bring photo ID.")',
     'esc2("Il tuo biglietto: " + (d.link || location.href) + " · Porta un documento.")'),
    ('<p>Got photos or videos from the night? Send them our way, the best ones end up on our page. And tell us how it was: we read every message.</p>',
     '<p>Hai foto o video della serata? Mandaceli, i migliori finiscono sulla nostra pagina. E raccontaci com\'è andata: leggiamo ogni messaggio.</p>'),
    ('One tap. We use the same name and Instagram as last time.',
     'Un tocco. Usiamo lo stesso nome e Instagram dell\'ultima volta.'),
    ("so you don't miss it.", 'così non te la perdi.'),
    ('<p class="unlock-h">You\'re<br>crew.</p>', '<p class="unlock-h">Sei<br>crew.</p>'),
    ('<b>Checked in</b>', '<b>Entrato</b>'),
    ('again.textContent = "Try again"', 'again.textContent = "Riprova"'),
    ('location.href = "/ticket.html?t=" + encodeURIComponent(x.token)',
     'location.href = "/biglietto.html?t=" + encodeURIComponent(x.token)'),
    ('<p class="unlock-h">You\'re<br>going.</p>', '<p class="unlock-h">Ci<br>sei.</p>'),
    ("<h1>You're on the list, ${first}.</h1>", '<h1>Sei in lista, ${first}.</h1>'),
    ('`You made it, <em>${first}</em>.`', '`Ce l\'hai fatta, <em>${first}</em>.`'),
    ("`You're crew, ${first}.`", '`Sei crew, ${first}.`'),
    ('<p>Your invite for ${esc(event)} has been used. We\'ll check their request like any other.</p>',
     '<p>Il tuo invito per ${esc(event)} è stato usato. Controlleremo la sua richiesta come tutte le altre.</p>'),
    ('<p>You came before, so you can invite ${v.limit > 1 ? "friends" : "a friend"} to ${esc(event)}. Send them this link. They still need our approval, and we\'ll see they\'re with you.</p>',
     '<p>Sei già venuto, quindi puoi invitare ${v.limit > 1 ? "amici" : "un amico"} a ${esc(event)}. Manda loro questo link. Devono comunque passare dalla nostra approvazione, e vedremo che sono con te.</p>'),
    ('<p>All free tickets for this party have been earned. Your friends can still request a place with your link.</p>',
     '<p>Tutti i biglietti gratis di questa serata sono stati presi. I tuoi amici possono comunque richiedere un posto con il tuo link.</p>'),
    ('"Your request or ticket for this party has been cancelled. DM us on Instagram if you have questions."',
     '"La tua richiesta o il tuo biglietto per questa serata è stato annullato. Scrivici su Instagram se hai domande."'),
    ('c.href = "/ticket.html?t=" + encodeURIComponent(token)', 'c.href = "/biglietto.html?t=" + encodeURIComponent(token)'),
    ('href="/ticket.html?t=${encodeURIComponent(n.token)}"', 'href="/biglietto.html?t=${encodeURIComponent(n.token)}"'),
]


def build():
    src = open(os.path.join(ROOT, "ticket.html"), encoding="utf-8").read()
    s, miss = src, []
    for a, b in PAIRS:
        if a not in s:
            miss.append(a[:64])
        s = s.replace(a, b)
    # an English guest who lands here goes back, and the other way round
    s = s.replace('const LANG = "en";', 'const LANG = "it";')
    open(os.path.join(ROOT, "biglietto.html"), "w", encoding="utf-8").write(s)
    if miss:
        print("/biglietto not found:", *miss, sep="\n  ", file=sys.stderr)
    print("built /biglietto")


if __name__ == "__main__":
    build()
