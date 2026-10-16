// Prose answers of the demo that the "reformat" chips (Shorter / As a list / As a table / Explain simpler / For
// experts / More detail / Translate) can reshape. Each answer is described once as facts; the scripted answer and
// every reformatted version are rendered from the same facts, so the chips always produce a matching follow-up.
// All values are made up. Pure data (tested in demo.test.ts).
import type { DemoLang } from './kit.ts';

export type S3 = Record<DemoLang, string>;
/** [label, detail, short tag for the table's third column] */
export type FactPoint = readonly [string, string, string];

export type Facts = {
  intro: S3;
  points: Record<DemoLang, readonly FactPoint[]>;
  outro: S3;
  /** table header: label / detail / tag column */
  head: Record<DemoLang, readonly [string, string, string]>;
  short: S3;
  simple: S3;
  expert: S3;
  /** extra paragraph for "More detail" */
  more: S3;
  /** the short version in the other target languages of the "Translate" menu */
  translated: Record<'en' | 'de' | 'es' | 'fr' | 'it', string>;
};

export type FactsId = 'explain' | 'status' | 'connect';

export const FACTS: Record<FactsId, Facts> = {
  explain: {
    intro: {
      en: 'A heat pump does not *make* heat, it *moves* it – like a fridge running in reverse. This is the cycle:',
      de: 'Eine Wärmepumpe *erzeugt* keine Wärme, sie *verschiebt* sie – wie ein Kühlschrank, der rückwärts läuft. So sieht der Kreislauf aus:',
      es: 'Una bomba de calor no *produce* calor, lo *traslada*, como una nevera que funciona al revés. Este es el ciclo:',
    },
    points: {
      en: [
        ['Collect', 'A refrigerant in the outdoor unit is colder than the air, so it absorbs heat from it and evaporates – even at 0 °C.', 'from outside, in'],
        ['Compress', 'A compressor squeezes the gas. Squeezing heats it up, well above the temperature of your heating water.', 'gets hotter'],
        ['Release', 'In the condenser the hot gas hands its heat to the heating circuit and turns back into a liquid.', 'into your home'],
        ['Expand', 'An expansion valve drops the pressure, the liquid becomes cold again and the cycle starts over.', 'cools down'],
      ],
      de: [
        ['Aufnehmen', 'Ein Kältemittel im Außengerät ist kälter als die Luft, nimmt deren Wärme auf und verdampft – selbst bei 0 °C.', 'von außen nach innen'],
        ['Verdichten', 'Ein Verdichter presst das Gas zusammen. Dabei wird es heiß, deutlich wärmer als dein Heizwasser.', 'wird heißer'],
        ['Abgeben', 'Im Verflüssiger gibt das heiße Gas seine Wärme an den Heizkreis ab und wird wieder flüssig.', 'ins Haus'],
        ['Entspannen', 'Ein Expansionsventil senkt den Druck, die Flüssigkeit wird wieder kalt und der Kreislauf beginnt von vorn.', 'kühlt ab'],
      ],
      es: [
        ['Absorber', 'Un refrigerante en la unidad exterior está más frío que el aire, absorbe su calor y se evapora, incluso a 0 °C.', 'de fuera hacia dentro'],
        ['Comprimir', 'Un compresor comprime el gas. Al comprimirse se calienta, mucho más que el agua de tu calefacción.', 'se calienta'],
        ['Ceder', 'En el condensador el gas caliente cede su calor al circuito de calefacción y vuelve a ser líquido.', 'a tu casa'],
        ['Expandir', 'Una válvula de expansión baja la presión, el líquido vuelve a enfriarse y el ciclo empieza de nuevo.', 'se enfría'],
      ],
    },
    outro: {
      en: 'That is why one unit of electricity can deliver three to four units of heat (illustrative figures). It works best with low flow temperatures, such as underfloor heating.',
      de: 'Darum kann eine Einheit Strom drei bis vier Einheiten Wärme liefern (Richtwerte). Am besten funktioniert das mit niedrigen Vorlauftemperaturen, etwa bei Fußbodenheizung.',
      es: 'Por eso una unidad de electricidad puede dar de tres a cuatro unidades de calor (cifras orientativas). Funciona mejor con temperaturas de ida bajas, como el suelo radiante.',
    },
    head: { en: ['Step', 'What happens', 'Heat'], de: ['Schritt', 'Was passiert', 'Wärme'], es: ['Paso', 'Qué ocurre', 'Calor'] },
    short: {
      en: 'A heat pump moves heat from outside to inside with a refrigerant cycle: evaporate, compress, release, expand. One unit of electricity yields roughly three to four units of heat.',
      de: 'Eine Wärmepumpe holt mit einem Kältemittelkreislauf Wärme von draußen nach drinnen: verdampfen, verdichten, abgeben, entspannen. Aus einer Einheit Strom werden etwa drei bis vier Einheiten Wärme.',
      es: 'Una bomba de calor lleva calor de fuera a dentro con un ciclo de refrigerante: evaporar, comprimir, ceder, expandir. Una unidad de electricidad da unas tres o cuatro de calor.',
    },
    simple: {
      en: 'Think of a fridge: it pulls heat out of its inside and dumps it at the back. A heat pump plays the same trick, only the “inside” is the outdoors and the “back” is your home.',
      de: 'Stell dir einen Kühlschrank vor: Er zieht die Wärme aus seinem Inneren und gibt sie hinten ab. Die Wärmepumpe macht dasselbe, nur ist das „Innere“ draußen und die „Rückseite“ dein Zuhause.',
      es: 'Piensa en una nevera: saca el calor de su interior y lo suelta por detrás. La bomba de calor hace lo mismo, pero el «interior» es la calle y la «parte de atrás» es tu casa.',
    },
    expert: {
      en: 'It is a vapour-compression cycle: evaporation at the source temperature, compression, condensation at the sink temperature, isenthalpic expansion. The coefficient of performance (COP ≈ Q_heat / W_el) drops as the temperature lift grows, so the seasonal figure depends on low flow temperatures and a well-sized heat source.',
      de: 'Es ist ein Kaltdampf-Kompressionskreislauf: Verdampfung auf Quellentemperatur, Verdichtung, Kondensation auf Senkentemperatur, isenthalpe Entspannung. Die Leistungszahl (COP ≈ Q_Heizung / W_el) sinkt mit wachsendem Temperaturhub, die Jahresarbeitszahl hängt also von niedriger Vorlauftemperatur und gut dimensionierter Quelle ab.',
      es: 'Es un ciclo de compresión de vapor: evaporación a la temperatura de la fuente, compresión, condensación a la temperatura del sumidero y expansión isoentálpica. El COP (≈ Q_calor / W_el) baja al aumentar el salto de temperatura, así que el rendimiento estacional depende de una temperatura de ida baja y de una fuente bien dimensionada.',
    },
    more: {
      en: 'There are three kinds of heat source: air, ground (brine) and groundwater. Ground and water are steadier in winter but cost more to install. Air units lose some efficiency on very cold days and now and then defrost their outdoor coil. A buffer tank and weather-compensated control smooth out the running.',
      de: 'Es gibt drei Arten von Wärmequellen: Luft, Erdreich (Sole) und Grundwasser. Erdreich und Wasser sind im Winter gleichmäßiger, kosten aber mehr in der Installation. Luftgeräte verlieren an sehr kalten Tagen etwas Effizienz und müssen ab und zu ihren Außenverdampfer abtauen. Ein Pufferspeicher und eine wetterabhängige Regelung glätten den Betrieb.',
      es: 'Hay tres tipos de fuente de calor: aire, subsuelo (salmuera) y agua subterránea. Subsuelo y agua son más estables en invierno, pero cuesta más instalarlos. Las unidades de aire pierden algo de eficiencia en días muy fríos y a veces desescarchan su serpentín exterior. Un depósito de inercia y una regulación según la temperatura exterior suavizan el funcionamiento.',
    },
    translated: {
      en: 'A heat pump moves heat from outside to inside with a refrigerant cycle: evaporate, compress, release, expand. One unit of electricity yields roughly three to four units of heat.',
      de: 'Eine Wärmepumpe holt mit einem Kältemittelkreislauf Wärme von draußen nach drinnen: verdampfen, verdichten, abgeben, entspannen. Aus einer Einheit Strom werden etwa drei bis vier Einheiten Wärme.',
      es: 'Una bomba de calor lleva calor de fuera a dentro con un ciclo de refrigerante: evaporar, comprimir, ceder, expandir. Una unidad de electricidad da unas tres o cuatro de calor.',
      fr: 'Une pompe à chaleur transporte la chaleur de l’extérieur vers l’intérieur grâce à un cycle de fluide frigorigène : évaporer, comprimer, céder, détendre. Une unité d’électricité fournit environ trois à quatre unités de chaleur.',
      it: 'Una pompa di calore porta il calore da fuori a dentro con un ciclo di refrigerante: evaporare, comprimere, cedere, espandere. Un’unità di elettricità fornisce circa tre o quattro unità di calore.',
    },
  },

  status: {
    intro: {
      en: 'Here is where things stand (all values are made up for the demo):',
      de: 'So steht es um das Projekt (alle Werte sind für die Demo erfunden):',
      es: 'Así está el proyecto (todos los valores están inventados para la demo):',
    },
    points: {
      en: [
        ['System', 'Up for 12 days, the load is low and the disk is 41 % full.', 'OK'],
        ['Release', 'The release notes list one new version, 1.4.2, with two bug fixes.', 'New'],
        ['Notes', 'Your notes file names 3 open items; the oldest is from last Tuesday.', '3 open'],
        ['Tests', 'All 42 API tests pass, the run took 2.5 seconds.', 'Green'],
      ],
      de: [
        ['System', 'Läuft seit 12 Tagen, die Last ist niedrig und die Platte zu 41 % voll.', 'OK'],
        ['Release', 'Das Changelog nennt eine neue Version, 1.4.2, mit zwei Fehlerbehebungen.', 'Neu'],
        ['Notizen', 'Deine Notizen nennen 3 offene Punkte, der älteste stammt vom letzten Dienstag.', '3 offen'],
        ['Tests', 'Alle 42 API-Tests sind grün, der Lauf dauerte 2,5 Sekunden.', 'Grün'],
      ],
      es: [
        ['Sistema', 'Lleva 12 días activo, la carga es baja y el disco está al 41 %.', 'OK'],
        ['Versión', 'Las notas de la versión citan una nueva, la 1.4.2, con dos correcciones.', 'Nueva'],
        ['Notas', 'Tus notas mencionan 3 puntos abiertos; el más antiguo es del martes pasado.', '3 abiertos'],
        ['Pruebas', 'Pasan las 42 pruebas de la API; la ejecución tardó 2,5 segundos.', 'Verde'],
      ],
    },
    outro: {
      en: 'Nothing needs your attention right now. I can work through the 3 open items if you like.',
      de: 'Im Moment braucht nichts deine Aufmerksamkeit. Die 3 offenen Punkte kann ich gern abarbeiten.',
      es: 'Ahora mismo nada requiere tu atención. Si quieres, me ocupo de los 3 puntos abiertos.',
    },
    head: { en: ['Area', 'Status', 'State'], de: ['Bereich', 'Stand', 'Zustand'], es: ['Área', 'Estado', 'Situación'] },
    short: {
      en: 'All good: the system has been up for 12 days, all 42 tests pass, a new version 1.4.2 is out and 3 notes are still open.',
      de: 'Alles im grünen Bereich: das System läuft seit 12 Tagen, alle 42 Tests sind grün, Version 1.4.2 ist neu und 3 Notizen sind noch offen.',
      es: 'Todo bien: el sistema lleva 12 días activo, pasan las 42 pruebas, hay una versión nueva, la 1.4.2, y quedan 3 notas abiertas.',
    },
    simple: {
      en: 'Short version: everything works. There is one new update, and you wrote down 3 things you still want to do.',
      de: 'Kurz gesagt: Alles funktioniert. Es gibt ein neues Update, und du hast dir 3 Dinge notiert, die noch zu tun sind.',
      es: 'En pocas palabras: todo funciona. Hay una actualización nueva y apuntaste 3 cosas que aún quieres hacer.',
    },
    expert: {
      en: 'Host uptime 12 d, load average and disk (41 %) nominal. Upstream tag 1.4.2 (two patch fixes) is not yet deployed. The API suite (42 tests) is green in 2.5 s wall-clock. Backlog: 3 items in the notes file, oldest 7 days.',
      de: 'Host-Uptime 12 d, Load Average und Datenträger (41 %) unauffällig. Upstream-Tag 1.4.2 (zwei Patch-Fixes) ist noch nicht ausgerollt. Die API-Suite (42 Tests) ist in 2,5 s grün. Backlog: 3 Einträge in der Notizdatei, der älteste 7 Tage alt.',
      es: 'Uptime del host 12 d; carga media y disco (41 %) normales. La etiqueta 1.4.2 (dos correcciones) aún no está desplegada. La suite de la API (42 pruebas) pasa en 2,5 s. Pendientes: 3 entradas en el archivo de notas, la más antigua de 7 días.',
    },
    more: {
      en: 'Details: the load has stayed below 0.3 all week and memory use is flat. The two fixes in 1.4.2 touch the pairing endpoint and the session list; neither changes the API. The open notes are “rotate the logs”, “update the README” and “answer the pending review”.',
      de: 'Details: Die Last blieb die ganze Woche unter 0,3, der Speicherverbrauch ist konstant. Die beiden Fixes in 1.4.2 betreffen den Pairing-Endpunkt und die Sitzungsliste, die API bleibt gleich. Die offenen Notizen lauten „Logs rotieren“, „README aktualisieren“ und „offenes Review beantworten“.',
      es: 'Detalles: la carga se mantuvo por debajo de 0,3 toda la semana y el uso de memoria es constante. Las dos correcciones de la 1.4.2 afectan al punto de emparejamiento y a la lista de sesiones; la API no cambia. Las notas abiertas son «rotar los registros», «actualizar el README» y «responder la revisión pendiente».',
    },
    translated: {
      en: 'All good: the system has been up for 12 days, all 42 tests pass, a new version 1.4.2 is out and 3 notes are still open.',
      de: 'Alles im grünen Bereich: das System läuft seit 12 Tagen, alle 42 Tests sind grün, Version 1.4.2 ist neu und 3 Notizen sind noch offen.',
      es: 'Todo bien: el sistema lleva 12 días activo, pasan las 42 pruebas, hay una versión nueva, la 1.4.2, y quedan 3 notas abiertas.',
      fr: 'Tout va bien : le système tourne depuis 12 jours, les 42 tests passent, la version 1.4.2 est sortie et 3 notes sont encore ouvertes.',
      it: 'Tutto a posto: il sistema è attivo da 12 giorni, passano tutti i 42 test, è uscita la versione 1.4.2 e restano 3 note aperte.',
    },
  },

  connect: {
    intro: {
      en: 'Connecting your own Hermes takes a few minutes. This is the way:',
      de: 'Dein eigenes Hermes zu verbinden dauert ein paar Minuten. So geht es:',
      es: 'Conectar tu propio Hermes lleva unos minutos. Así se hace:',
    },
    points: {
      en: [
        ['Run Hermes', 'Start Hermes Agent on a machine you control – a home server, a laptop or a small VPS – with its API server switched on.', 'Server'],
        ['Make it reachable', 'Your phone has to reach that machine: the same Wi-Fi or a private VPN. Do not expose it to the open internet without HTTPS.', 'Network'],
        ['Pair', 'Ask Hermes for a pairing link or QR code, tap **Connect Hermes** in the bar at the top of this chat and choose “I have a QR code or link”.', 'App'],
        ['Say yes', 'Before your first message the app asks for your consent to send data to your own server. Allow it and you are live.', 'Consent'],
      ],
      de: [
        ['Hermes starten', 'Starte Hermes Agent auf einem Rechner, den du kontrollierst – Heimserver, Laptop oder ein kleiner VPS – mit eingeschaltetem API-Server.', 'Server'],
        ['Erreichbar machen', 'Dein Handy muss diesen Rechner erreichen: im selben WLAN oder über ein privates VPN. Ohne HTTPS nicht ins offene Internet stellen.', 'Netzwerk'],
        ['Koppeln', 'Lass dir von Hermes einen Kopplungslink oder QR-Code geben, tippe oben in diesem Chat auf **Hermes verbinden** und wähle „Ich habe einen QR-Code oder Link“.', 'App'],
        ['Zustimmen', 'Vor deiner ersten Nachricht fragt die App um Erlaubnis, Daten an deinen eigenen Server zu senden. Erlaube es, und du bist live.', 'Einwilligung'],
      ],
      es: [
        ['Arranca Hermes', 'Inicia Hermes Agent en un equipo que controles (servidor doméstico, portátil o un VPS pequeño) con el servidor de API activado.', 'Servidor'],
        ['Hazlo accesible', 'Tu móvil tiene que llegar a ese equipo: la misma wifi o una VPN privada. No lo expongas a internet sin HTTPS.', 'Red'],
        ['Vincula', 'Pídele a Hermes un enlace de emparejamiento o un código QR, toca **Conectar Hermes** en la barra de arriba de este chat y elige «Tengo un código QR o un enlace».', 'App'],
        ['Acepta', 'Antes de tu primer mensaje la app pide tu consentimiento para enviar datos a tu propio servidor. Acepta y ya estás conectado.', 'Consentimiento'],
      ],
    },
    outro: {
      en: 'The demo stays available as a separate profile, so you can come back to it. Tap **Connect Hermes** at the top whenever you are ready.',
      de: 'Die Demo bleibt als eigenes Profil erhalten, du kannst jederzeit zu ihr zurück. Tippe oben auf **Hermes verbinden**, wenn du so weit bist.',
      es: 'La demo sigue disponible como perfil aparte, así que puedes volver a ella. Toca **Conectar Hermes** arriba cuando estés listo.',
    },
    head: { en: ['Step', 'What to do', 'Where'], de: ['Schritt', 'Was zu tun ist', 'Wo'], es: ['Paso', 'Qué hacer', 'Dónde'] },
    short: {
      en: 'Run Hermes Agent on your own machine, make it reachable from your phone, pair with a link or QR code via the Connect Hermes button, and allow the data consent.',
      de: 'Starte Hermes Agent auf deinem eigenen Rechner, mach ihn vom Handy aus erreichbar, koppele per Link oder QR-Code über den Knopf „Hermes verbinden“ und erlaube die Datenübertragung.',
      es: 'Inicia Hermes Agent en tu propio equipo, hazlo accesible desde el móvil, vincula con un enlace o QR mediante el botón Conectar Hermes y acepta el consentimiento de datos.',
    },
    simple: {
      en: 'Three things: start Hermes on a computer of yours, get your phone onto the same network, and scan the code Hermes shows you. The app walks you through the rest.',
      de: 'Drei Dinge: Hermes auf einem eigenen Rechner starten, das Handy ins gleiche Netz bringen und den Code scannen, den Hermes dir zeigt. Der Rest führt dich durch die App.',
      es: 'Tres cosas: arranca Hermes en un ordenador tuyo, pon el móvil en la misma red y escanea el código que te muestra Hermes. La app te guía en el resto.',
    },
    expert: {
      en: 'Enable the Hermes API server, expose it on a private interface (LAN or VPN, TLS if it leaves the trusted network), create a pairing link or QR code, redeem it in the client (Connect Hermes → “I have a QR code or link”) and accept the data-transfer consent. The client then talks OpenAI-compatible HTTP plus the Hermes event stream to your base URL.',
      de: 'API-Server von Hermes aktivieren, auf einer privaten Schnittstelle bereitstellen (LAN oder VPN, TLS sobald es das vertraute Netz verlässt), Kopplungslink oder QR-Code erzeugen, im Client einlösen (Hermes verbinden → „Ich habe einen QR-Code oder Link“) und die Einwilligung zur Datenübertragung erteilen. Der Client spricht dann OpenAI-kompatibles HTTP samt Hermes-Eventstream mit deiner Basis-URL.',
      es: 'Activa el servidor de API de Hermes, exponlo en una interfaz privada (LAN o VPN, con TLS si sale de la red de confianza), genera un enlace o QR de emparejamiento, canjéalo en el cliente (Conectar Hermes → «Tengo un código QR o un enlace») y acepta el consentimiento de transferencia de datos. El cliente habla entonces HTTP compatible con OpenAI y el flujo de eventos de Hermes con tu URL base.',
    },
    more: {
      en: 'If something does not connect, the app’s connection check tells you which step failed: the address, the network or the pairing code. Everything you type afterwards goes only to your own server and to the AI providers you configured there.',
      de: 'Wenn etwas nicht verbindet, zeigt dir die Verbindungsprüfung der App, welcher Schritt hakt: die Adresse, das Netzwerk oder der Kopplungscode. Alles, was du danach schreibst, geht nur an deinen eigenen Server und an die KI-Anbieter, die du dort eingerichtet hast.',
      es: 'Si algo no conecta, la comprobación de conexión de la app te dice qué paso falla: la dirección, la red o el código de emparejamiento. Todo lo que escribas después va solo a tu propio servidor y a los proveedores de IA que configuraste allí.',
    },
    translated: {
      en: 'Run Hermes Agent on your own machine, make it reachable from your phone, pair with a link or QR code via the Connect Hermes button, and allow the data consent.',
      de: 'Starte Hermes Agent auf deinem eigenen Rechner, mach ihn vom Handy aus erreichbar, koppele per Link oder QR-Code über den Knopf „Hermes verbinden“ und erlaube die Datenübertragung.',
      es: 'Inicia Hermes Agent en tu propio equipo, hazlo accesible desde el móvil, vincula con un enlace o QR mediante el botón Conectar Hermes y acepta el consentimiento de datos.',
      fr: 'Lancez Hermes Agent sur votre propre machine, rendez-le joignable depuis votre téléphone, appairez-le avec un lien ou un code QR via le bouton Connecter et acceptez le consentement aux données.',
      it: 'Avvia Hermes Agent sul tuo computer, rendilo raggiungibile dal telefono, abbinalo con un link o un codice QR tramite il pulsante Connect Hermes e accetta il consenso sui dati.',
    },
  },
};

/** which prose answer a scenario name stands for (used to find "the last answer" of a reformat chip) */
export const FACTS_OF_SCENARIO: Record<string, FactsId> = { explain: 'explain', werkzeuge: 'status', connect: 'connect' };
