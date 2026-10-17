import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { routingContext } from '../src/router/context.mjs';

const u = (content) => ({ role: 'user', content });
const f = (t) => classifyHeuristic([u(t)]);
/** @param {Record<string, string[]>} byFormat */
const expectAll = (byFormat) => {
  for (const [want, texts] of Object.entries(byFormat)) {
    for (const t of texts) {
      const d = f(t);
      const got = d.component && want.includes(':') ? `${d.format}:${d.component}` : d.format;
      assert.equal(got, want, t);
    }
  }
};

test('multilingual heuristic: English', () => {
  expectAll({
    places: ['Any good sushi spots near me?', 'Where can I get a proper espresso around here?', 'Find me a bike shop in Bristol that does repairs.', 'Is the nearest supermarket still open?'],
    'products:compare': ['Kindle Paperwhite or Kobo Libra for reading in bed?', 'PS5 or Switch 2 for a ten year old?'],
    timer: ['Remind me in half an hour to check the oven.'],
    text: ['Where can I find the settings for dark mode?', 'I need to charge my phone, where is the cable?', 'Wake me at 6 tomorrow.', 'Remind me in 2 weeks to renew the passport.'],
  });
});

test('multilingual heuristic: Spanish', () => {
  expectAll({
    'checklist:shopping': ['Hazme una lista de la compra para el fin de semana', 'Haz la lista del súper para la semana'],
    'checklist:todo': ['Hazme una lista de tareas para la mudanza'],
    'products:compare': ['iPhone 17 o Pixel 11, ¿cuál me compro?', 'Compárame el Galaxy S26 con el iPhone 17'],
    products: ['¿Cuál es la mejor freidora de aire calidad-precio?', '¿Qué móvil me compro por menos de 300 euros?'],
    places: ['Recomiéndame un sitio para tapear en Sevilla', '¿Dónde puedo cenar algo rico en Valencia?', '¿Cuál es el supermercado más cercano?'],
    weather: ['¿Qué tiempo va a hacer mañana en Bilbao?', '¿Hará frío el sábado en Burgos?'],
    compare: ['Ventajas e inconvenientes de alquilar o comprar piso', '¿Qué diferencia hay entre ser autónomo y montar una SL?'],
    recipe: ['Dame una receta de lentejas para cuatro.'],
    timer: ['Avísame dentro de 20 minutos para sacar la ropa.'],
    changes: ['¿Qué archivos has tocado?'],
    text: ['Necesito el número de móvil de Ana', '¿Me pasas la receta del médico?', '¿Cómo paso fotos del iPhone o el iPad al PC?', 'Sincronizar el iPhone o el iPad con el Mac', '¿Por qué en Canarias hace buen tiempo todo el año?', 'Ponme una alarma a las siete.'],
  });
});

test('multilingual heuristic: French (shopping, products, places, weather, timer)', () => {
  expectAll({
    'checklist:shopping': ['Fais-moi une liste de courses pour la semaine', 'Ajoute du beurre à ma liste des courses'],
    'checklist:packing': ["Qu'est-ce que je dois mettre dans ma valise pour Rome ?"],
    products: ['Les meilleurs écouteurs sans fil à moins de 100 € ?', 'Quel aspirateur robot acheter pour un studio ?', 'Il me faut un casque bluetooth pas cher'],
    'products:compare': ['iPhone 17 ou Pixel 11, tu prendrais lequel ?', 'Compare le MacBook Air et le Dell XPS 13'],
    places: ["Tu connais une bonne boulangerie près d'ici ?", 'Trouve-moi un resto italien dans le 11e', 'Il y a une pharmacie de garde dans le coin ?', 'Où manger une bonne galette à Rennes ?'],
    weather: ['Quel temps fera-t-il demain à Lyon ?', "Est-ce qu'il va pleuvoir ce week-end ?", 'Météo de Brest pour samedi'],
    timer: ['Mets un minuteur de 12 minutes', 'Rappelle-moi dans 15 minutes de sortir le gâteau', 'Lance un compte à rebours de 3 minutes'],
    text: ["C'est le meilleur café à mon avis", "Rappelle-moi dans 2 jours d'appeler Paul", 'Pourquoi la météo se trompe autant ?', 'Pourquoi il pleut autant en Bretagne ?',
      'Près de la moitié des boulangeries ferment le lundi', 'La meilleure période pour tomber enceinte', "Écris une critique du restaurant où on a mangé hier à Lyon", 'Réveille-moi demain à 6 h 30.', 'Salut, ça va ?'],
  });
});

test('multilingual heuristic: Italian (shopping, products, places, weather, timer)', () => {
  expectAll({
    'checklist:shopping': ['Fammi la lista della spesa per la settimana'],
    products: ['Quale robot aspirapolvere mi consigli sotto i 300 euro?', 'Mi serve un portatile leggero per lavoro'],
    'products:compare': ['Confronta iPhone 17 e Pixel 11', 'Meglio la PS5 o la Switch 2 per un bambino?'],
    places: ['Conosci una buona pizzeria qui vicino?', 'Trovami un bar aperto adesso vicino alla stazione', 'Dove posso mangiare un buon sushi a Milano?'],
    weather: ['Che tempo fa domani a Torino?', 'Pioverà questo fine settimana a Roma?', 'Domani piove?'],
    timer: ["Ricordami tra mezz'ora di stendere il bucato", 'Metti un timer di 10 minuti'],
    text: ['Mi consigli una buona libreria Python per i grafici?', 'Perché piove sempre a Milano?', "Scrivi una recensione della pizzeria vicino a casa", 'Mi spieghi la differenza tra let e const in JavaScript?', 'Svegliami domani alle 7.', 'Ciao! Come stai?'],
  });
});

test('multilingual heuristic: Portuguese (shopping, products, places, weather, timer)', () => {
  expectAll({
    'checklist:shopping': ['Faz uma lista de compras pro churrasco de sábado', 'Coloca na lista do mercado: arroz e feijão'],
    products: ['Qual fone bluetooth vale a pena até 300 reais?', 'Preciso de um telemóvel novo até 400 euros'],
    'products:compare': ['iPhone 17 ou Pixel 11, qual compensa mais?', 'Compara o Galaxy S26 com o iPhone 17'],
    places: ['Tem alguma padaria boa aqui perto?', 'Me indica um restaurante japonês em Pinheiros', 'Há alguma farmácia aberta agora perto de mim?'],
    weather: ['Como vai estar o tempo amanhã no Porto?', 'Vai chover no fim de semana em São Paulo?'],
    timer: ['Me lembra daqui a 10 minutos de desligar o forno', 'Põe um cronômetro de 20 minutos'],
    text: ['A receita federal mudou as regras?', 'Perto de 50% dos restaurantes fecharam na pandemia', 'Quanto tempo leva para ir ao Porto?', 'Escreve uma avaliação da padaria aqui perto', 'Por que faz tanto calor no Rio no verão?', 'Me acorda amanhã às 6h.', 'Oi, tudo bem?'],
  });
});

// Every eval set: the heuristic must never put a visual on a message whose only right answer is text.
test('multilingual heuristic: no unwanted visuals on cases, holdout and multilingual', () => {
  for (const name of ['cases', 'holdout', 'multilingual']) {
    const lines = readFileSync(new URL(`../eval/${name}.jsonl`, import.meta.url), 'utf8').split('\n').filter(Boolean);
    const wrong = [];
    for (const k of lines.map((l) => JSON.parse(l))) {
      const ok = [k.expected, ...(k.accept ?? [])];
      const got = classifyHeuristic(routingContext(k.messages)).format;
      if (!ok.includes(got) && ok.includes('text') && got !== 'text') wrong.push(`${k.id}: ${got}`);
    }
    assert.deepEqual(wrong, [], name);
  }
});
