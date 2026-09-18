import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Dietary } from "@prisma/client";

/**
 * Seeds a real restaurant menu (German Indian restaurant), venue slug `indisches-restaurant`.
 * Idempotent: re-running is a no-op once the slug exists. Uses the
 * migration-privilege connection because this is operator-imported fixture
 * data, not tenant-authored content via the app.
 *
 * Prices come from the printed menu. "ab X €" ("from X €") prices store the
 * base price in `priceCents` and set `flags.fromPrice = true` so a future
 * renderer can show the "ab" prefix. Allergen data is NOT on the printed
 * menu and is intentionally left empty — the restaurant owner must fill it
 * in before relying on it (EU LMIV requires accurate allergen labelling).
 */

const VENUE_SLUG = "indisches-restaurant";
const OWNER_EMAIL = "owner@indisches-restaurant.local";

type RawItem = {
  name: string;
  description: string | null;
  price: string;
  dietary?: Dietary[];
};

type RawCategory = {
  name: string;
  dietary?: Dietary[]; // applied to every item in the category
  items: RawItem[];
};

function parsePrice(price: string): { cents: number; fromPrice: boolean } {
  const fromPrice = /^ab\s/i.test(price.trim());
  const match = price.match(/(\d+),(\d{2})/);
  if (!match) throw new Error(`Unparseable price: ${price}`);
  return { cents: Number(match[1]) * 100 + Number(match[2]), fromPrice };
}

const MENU: RawCategory[] = [
  {
    name: "Warme Vorspeisen",
    items: [
      {
        name: "Pakoras",
        description: "gemischtes Gemüse in Kichererbsenmehl gewendet und frittiert",
        price: "ab 6,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Mix Pakora Groß",
        description: "mit Hähnchen, Paneer, Gemüse und Soße (für 2-3 Personen)",
        price: "ab 15,90 €",
      },
      {
        name: "Paneer Pakora",
        description: "hausgemachter Rahmkäse in Kichererbsenmehl gewendet und frittiert",
        price: "ab 9,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Chicken Pakora",
        description: "Hähnchenfiletstücke in Kichererbsenmehl gewendet und frittiert",
        price: "ab 7,90 €",
      },
      {
        name: "Jhinga Pakora",
        description: "Garnelen in Kichererbsenmehl gewendet und frittiert",
        price: "ab 18,90 €",
      },
      {
        name: "Samosa",
        description: "2 gefüllte und frittierte Kartoffel-Erbsen-Teigtaschen",
        price: "ab 6,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Gemischte Tikkas",
        description: "frittierte Hariyali Tikka, Chicken Tikka und Garlic Chicken Tikka",
        price: "ab 9,90 €",
      },
      { name: "Pommes frites", description: null, price: "5,00 €", dietary: ["vegetarian"] },
      { name: "Extra Reis", description: null, price: "4,00 €", dietary: ["vegetarian"] },
      {
        name: "Chutneys",
        description: "mit verschiedenen Saucen",
        price: "3,50 €",
        dietary: ["vegetarian"],
      },
      { name: "Pani Puri", description: null, price: "7,90 €", dietary: ["vegetarian"] },
      {
        name: "Chaat Papri",
        description:
          "mit Kichererbsen, Paprika, frischen Tomaten, gemischten Saucen und Granatapfel",
        price: "7,90 €",
        dietary: ["vegetarian"],
      },
    ],
  },
  {
    name: "Tagessuppen",
    items: [
      { name: "Dal", description: "Linsensuppe", price: "7,50 €", dietary: ["vegetarian"] },
      { name: "Sabzi", description: "Gemüsesuppe", price: "8,50 €", dietary: ["vegetarian"] },
      { name: "Hühnersuppe", description: "mit Huhn", price: "9,90 €" },
      {
        name: "Tomatensuppe",
        description: "mit Tomaten",
        price: "8,90 €",
        dietary: ["vegetarian"],
      },
    ],
  },
  {
    name: "Kindergerichte",
    items: [
      { name: "Chicken Korma - Kinder", description: "Hähnchen und Basmatireis", price: "11,90 €" },
      {
        name: "Sabzi Curry - Kinder",
        description: "Gemüse mit Käse und Basmatireis",
        price: "9,90 €",
        dietary: ["vegetarian"],
      },
    ],
  },
  {
    name: "Salate",
    items: [
      {
        name: "Raita",
        description: "Joghurt mit Gurke, Karotten und Zwiebeln",
        price: "4,00 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Gemischter Salat",
        description: "Blattsalat mit Gurken, Tomaten, Mais und Granatapfelkernen",
        price: "9,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Chicken Salat",
        description: "Gemischter Salat mit gebratenem Hähnchenfilet, Tandoori und Paprika",
        price: "14,90 €",
      },
      {
        name: "Paneer Salat",
        description: "Gemischter Salat mit gebratenem Rahmkäse",
        price: "14,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Jhinga Salat",
        description: "Gemischter Salat mit gebratenen Garnelen",
        price: "17,90 €",
      },
    ],
  },
  {
    name: "Fladenbrot",
    items: [
      {
        name: "Tandoori Roti",
        description: "Indisches Fladenbrot aus Vollkornmehl",
        price: "3,50 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Naan",
        description: "Indisches Fladenbrot",
        price: "3,50 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Garlic Naan",
        description: "mit Knoblauch",
        price: "4,50 €",
        dietary: ["vegetarian"],
      },
      { name: "Butter Naan", description: "mit Butter", price: "4,50 €", dietary: ["vegetarian"] },
      {
        name: "Hariyali Naan",
        description: "mit Koriander, Spinat, Gewürzen und Raita",
        price: "4,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Aloo Paratha",
        description: "mit würzigen Kartoffeln und Raita",
        price: "7,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Paneer Naan",
        description: "mit hausgemachtem Käse gefüllt und Raita",
        price: "8,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Papadam",
        description: "Kichererbsen-Brot",
        price: "4,50 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Mix Naan",
        description: "Tandoori Roti, Garlic Naan, Saada Naan, Butter Naan und Raita",
        price: "14,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Cheese Naan",
        description: "mit Spinat und Gouda-Käse",
        price: "8,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Peshiwari Naan",
        description: "gefüllt mit Mandeln, Rosinen, Kokosnuss und Honig",
        price: "8,90 €",
        dietary: ["vegetarian"],
      },
      { name: "Lamm Keema Naan", description: "mit Lammfleisch", price: "10,90 €" },
      { name: "Hähnchen Keema Naan", description: "mit Hähnchenfleisch", price: "9,90 €" },
    ],
  },
  {
    name: "Vegetarische Gerichte",
    dietary: ["vegetarian"],
    items: [
      {
        name: "Sabzi Makhani",
        description: "Gemüse mit Butter, Cashewnüssen und Tomatensoße",
        price: "15,90 €",
      },
      {
        name: "Sabzi Curry",
        description: "Curry aus frischem Gemüse der Saison, Cashewnüssen und Zwiebeln",
        price: "15,90 €",
      },
      {
        name: "Matter Paneer",
        description: "hausgemachter frischer Rahmkäse mit grünen Erbsen",
        price: "15,90 €",
      },
      {
        name: "Palak Paneer",
        description: "hausgemachter frischer Rahmkäse mit Spinat",
        price: "15,90 €",
      },
      {
        name: "Alu Saag",
        description: "Kartoffeln, Spinat, Zwiebeln und Ingwer gebraten",
        price: "15,90 €",
      },
      {
        name: "Alu Chana Masala",
        description: "Kartoffeln und Kichererbsen mit typisch indischen Gewürzen",
        price: "15,90 €",
      },
      {
        name: "Karahi Paneer",
        description: "hausgemachter Rahmkäse, Currysoße, Paprika, Tomaten und Zwiebeln",
        price: "17,50 €",
      },
      {
        name: "Shahi Paneer",
        description: "hausgemachter Rahmkäse mit Cashewnüssen in Sahnesoße",
        price: "17,50 €",
      },
      {
        name: "Malai Kofta",
        description: "Röllchen aus Kartoffeln und Rahmkäse mit Cashewnüssen in einer Sahnesoße",
        price: "17,50 €",
      },
      {
        name: "Paneer Kashmiri",
        description: "hausgemachter Rahmkäse, Cashewnüssen und Tomaten in einer leicht süßen Soße",
        price: "17,50 €",
      },
      {
        name: "Dal Tarka",
        description: 'Linsengericht "Indische Art" mit Currysoße',
        price: "14,90 €",
      },
      {
        name: "Sabzi Jhalfrezi",
        description:
          "Saisonales frisches Gemüse, Ingwer, Knoblauch und Paprika in einer scharf gewürzten Soße",
        price: "15,90 €",
      },
      {
        name: "Paneer Butter Masala",
        description: "hausgemachter Käse mit Butter, Tomaten und indischen Gewürzen",
        price: "17,90 €",
      },
      {
        name: "Bengen Ka Bharta",
        description: "gegrillte Auberginen mit Currysoße",
        price: "18,90 €",
      },
      {
        name: "Bhindi Masala",
        description: "Okraschoten, gebraten mit Ingwer, Tomaten, indischen Gewürzen und Zwiebeln",
        price: "16,90 €",
      },
      {
        name: "Dal Palak",
        description: "Linsen mit Spinat, Zwiebeln und indischen Gewürzen",
        price: "15,50 €",
      },
      {
        name: "Alu Bengen",
        description: "gegrillte Auberginen und Kartoffeln in Currysoße",
        price: "15,90 €",
      },
      {
        name: "Dal Makhni",
        description: "schwarze Linsen mit Sahne, Butter, Tomaten und Knoblauch",
        price: "17,90 €",
      },
      { name: "Kola Puri", description: "Paneer mit Gemüse", price: "15,50 €" },
    ],
  },
  {
    name: "Vegane Gerichte",
    dietary: ["vegan", "vegetarian"],
    items: [
      { name: "Palak Tofu", description: "mit Spinat und Kokosmilch", price: "15,90 €" },
      { name: "Shahi Tofu", description: "mit Cashewnüssen in Kokosmilch", price: "15,90 €" },
      {
        name: "Mango Tofu",
        description: "mit Mango, Cashewnüssen, Kokosmilch und indischen Gewürzen",
        price: "15,90 €",
      },
      {
        name: "Karahi Tofu",
        description: "mit Paprika, Tomaten und Zwiebeln in Currysoße",
        price: "15,90 €",
      },
      {
        name: "Tikka Masala Tofu",
        description: "mit Zwiebeln, Tomaten, Koriander, frischem Ingwer und roter Currysoße",
        price: "15,90 €",
      },
      {
        name: "Chili Tofu",
        description:
          "panierter Tofu in Kichererbsenmehl mit Paprika, süß-saure Tomaten- und Sojasoße",
        price: "15,90 €",
      },
      { name: "Tofu Madrasi", description: 'mit Kokosmilch "Südindische Art"', price: "15,90 €" },
    ],
  },
  {
    name: "Hähnchen",
    items: [
      { name: "Chicken Curry", description: '"Nordindische Art" in Currysoße', price: "17,50 €" },
      {
        name: "Chicken Sabzi",
        description: "mit saisonalem, frischem Gemüse in Currysoße",
        price: "17,50 €",
      },
      {
        name: "Chicken Saag",
        description: "in Spinat mit frischem Ingwer und Knoblauch",
        price: "17,50 €",
      },
      {
        name: "Chicken Vindaloo",
        description: '"Südliche Hähnchenspezialität" mit Kartoffeln',
        price: "17,50 €",
      },
      {
        name: "Chicken Korma",
        description: "in einer milden Soße aus Gewürzen, Cashewnüssen und Sahne",
        price: "18,90 €",
      },
      { name: "Chicken Mango", description: "in Cashewnuss-Soße mit Mango", price: "18,90 €" },
      {
        name: "Chicken Kashmiri",
        description:
          "in einer Soße aus Zwiebeln, Tomaten, Sahne und frischem Apfel und Granatapfel",
        price: "18,90 €",
      },
      {
        name: "Chicken Karahi",
        description: "in Currysoße mit Paprika, Tomaten und Zwiebeln",
        price: "18,90 €",
      },
      {
        name: "Chicken Madrasi",
        description: '"Südindische Art" mit Kokosmilch',
        price: "18,90 €",
      },
      {
        name: "Chicken Jahlfrezi",
        description: "scharf gewürzt mit frischem Ingwer, Knoblauch, Paprika und Tomaten",
        price: "18,90 €",
      },
      {
        name: "Chicken Dopiaza",
        description: "in Currysoße mit gebratenen Zwiebeln",
        price: "18,90 €",
      },
      {
        name: "Butter Chicken",
        description: "gebraten mit Tomatensoße, Butter, Sahne, Mandeln und Cashewnüssen",
        price: "18,90 €",
      },
      {
        name: "Chicken Tikka Masala",
        description:
          "gebraten mit Zwiebeln, Tomaten, roter Currysoße, Koriander, frischem Ingwer und indischen Masala",
        price: "18,90 €",
      },
      {
        name: "Chili Chicken",
        description:
          "gebraten paniert in Kichererbsenmehl, Paprika, Soja-Soße und süß-saure Tomatensoße",
        price: "18,90 €",
      },
      {
        name: "Nawabi Chicken",
        description: "in einer Kokos-Mandel-Soße und Paneer",
        price: "18,90 €",
      },
      {
        name: "Chicken Chana Masala",
        description: "mit Kichererbsen und indisch gewürzt",
        price: "18,90 €",
      },
      { name: "Chicken Hyberabadi", description: "mit Cashewnuss- und Minzsoße", price: "18,90 €" },
      {
        name: "Gulabi Chicken",
        description: "mit Kardamom, Rosenblüten, Cashewnüssen, Pistazien und Mandeln",
        price: "18,90 €",
      },
      {
        name: "Sookha Chicken",
        description: "mit Kokosnuss, Minze, Koriander, Kashmir-Masala und würziger Soße",
        price: "18,90 €",
      },
    ],
  },
  {
    name: "Lamm",
    items: [
      {
        name: "Lamm Curry",
        description: "in Currysoße mit frischem Ingwer, Knoblauch und Zwiebeln",
        price: "19,90 €",
      },
      {
        name: "Lamm Saag",
        description: "in Spinat mit frischem Ingwer und Knoblauch",
        price: "19,90 €",
      },
      {
        name: "Lamm Makhani Wala",
        description:
          "in würziger Mischung aus Zwiebeln, Knoblauch, Tomatencurry und Salt-Sweet-Soße",
        price: "19,90 €",
      },
      { name: "Lamm Sabzi Curry", description: "mit saisonalem Gemüse", price: "19,90 €" },
      {
        name: "Lamm Vindaloo",
        description: '"Südindische Art" mit Kartoffeln in exotischer Soße',
        price: "19,90 €",
      },
      { name: "Lamm Madrasi", description: '"Südindische Art" mit Kokos', price: "19,90 €" },
      {
        name: "Lamm Korma",
        description:
          "in einer milden Soße aus Gewürzen, Sahne, Mandeln, Cashewnüssen, frischem Apfel und Granatapfel",
        price: "19,90 €",
      },
      {
        name: "Lamm Dal",
        description: "mit Linsen in einer indischen Gewürz-Kombination",
        price: "19,90 €",
      },
      {
        name: "Kashmiri Kofta",
        description:
          "Lammhackfleischbällchen mit Kashmiri Chili, Garam Masala, Anis, frischem Apfel und Granatapfel",
        price: "19,90 €",
      },
      {
        name: "Lamm Karahi",
        description: "mit Paprika, Tomaten und Zwiebeln in würziger Soße",
        price: "19,90 €",
      },
      {
        name: "Lamm Kashmiri",
        description: "in einer leicht süßen Soße mit Trockenfrüchten und frischen Früchten",
        price: "19,90 €",
      },
      {
        name: "Peshawari Seek Masala",
        description: 'Lammhackfleisch "Pakistanische Art" mit Tomaten und feiner Soße',
        price: "19,90 €",
      },
      {
        name: "Lamm Bindi Masala",
        description:
          "mit indischen Okraschoten, Tomaten, Zwiebelsoße, Gewürzen, frischem Ingwer und Koriander",
        price: "19,90 €",
      },
    ],
  },
  {
    name: "Tandoori Spezialitäten",
    items: [
      {
        name: "Peshawari Seekh Kabab",
        description: "Lammhackfleisch am Spieß gegrillt, dazu Chutneys - leicht scharf",
        price: "18,90 €",
      },
      {
        name: "Haryali Tikka",
        description: "Hähnchen am Spieß gegrillt, mariniert mit Minz-Joghurt, dazu Chutneys",
        price: "18,90 €",
      },
      {
        name: "Chicken Tikka",
        description: "Hähnchenfilet am Spieß gegrillt mit Tandoori Masala, dazu Chutneys",
        price: "18,90 €",
      },
      {
        name: "Lahori King Prawn",
        description:
          "gegrillte Garnelen nach Punjab-Art, mit feinen Gewürzen und Joghurt mariniert, dazu Chutneys",
        price: "22,90 €",
      },
      {
        name: "Garlic Chicken Tikka",
        description:
          "Hähnchenbrust im Tandoori gegrillt mit Knoblauch-Cashewnuss-Marinade, dazu Chutneys",
        price: "18,90 €",
      },
      {
        name: "Lamm Boti Tikka",
        description: "Lamm aus der Keule am Spieß gegrillt, mit indischen Gewürzen",
        price: "19,90 €",
      },
      {
        name: "Tandoori Chicken",
        description:
          "gegrillte Hähnchenschenkel mit Tandoor Masala, in einer Joghurt-Cashewnuss-Marinade",
        price: "18,90 €",
      },
      {
        name: "Paneer Tikka",
        description: "gegrillter hausgemachter Käse mit Gemüse-Spießen, dazu Sauce",
        price: "19,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Afghani Tandoori Chicken",
        description:
          "würzig, gegrillte Hähnchenschenkel mit weißem Pfeffer, mariniert, in Joghurt-Quark-Cashewnuss-Marinade, dazu Chutneys",
        price: "18,90 €",
      },
      {
        name: "Mix Grill-Teller",
        description:
          "Hariyali Tikka, Garlic Chicken Tikka, Peshawari Seekh und Chicken Tikka, dazu Chutneys",
        price: "24,90 €",
      },
      {
        name: "Jambo Grill-Teller (für 2 Personen)",
        description:
          "Hariyali Tikka, Garlic Chicken Tikka, Tandoori Chicken, Peshawari Seekh und Chicken Tikka, dazu Chutneys",
        price: "47,90 €",
      },
      {
        name: "Fisch Tikka",
        description: "Seelachsfilet am Spieß gegrillt im Tandoori",
        price: "19,90 €",
      },
      {
        name: "Fisch Garlic",
        description: "Seelachsfilet gegrillt mit Knoblauch-Cashewnuss-Marinade, dazu Chutneys",
        price: "19,90 €",
      },
    ],
  },
  {
    name: "Fisch & Meeresfrüchte",
    items: [
      {
        name: "Fisch Curry",
        description: "Seelachsfilet mit Cashewnüssen, Zwiebeln und Currysoße",
        price: "22,90 €",
      },
      {
        name: "Fisch Masala",
        description:
          "Seelachsfilet in einer Zubereitung aus Zwiebeln, frischem Ingwer, Knoblauch, Tomaten, Mandeln und Cashewnüssen",
        price: "22,90 €",
      },
      {
        name: "Fisch Madrasi",
        description: 'Seelachsfilet "Südindische Art" mit Tomatensoße und Kokosmilch',
        price: "22,90 €",
      },
      {
        name: "Jhinga Masala",
        description:
          "Garnelen mit feinen indischen Gewürzen gebraten, Ingwer, Knoblauch und Kräutern",
        price: "22,90 €",
      },
      { name: "Jhinga Curry", description: "Garnelen in Currysoße", price: "22,90 €" },
      {
        name: "Jhinga Kashmiri",
        description: "Garnelen mit Cashewnüssen, frischem Apfel, Granatapfelkernen und Tomatensoße",
        price: "22,90 €",
      },
      { name: "Jhinga Dal", description: "Garnelen mit Linsen", price: "22,90 €" },
    ],
  },
  {
    name: "Reisgerichte",
    items: [
      {
        name: "Sabzi Biryani",
        description:
          "garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln, Nüssen und feinen indischen Gewürzen",
        price: "17,50 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Chicken Biryani",
        description: "garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln und Hähnchenfilet",
        price: "18,50 €",
      },
      {
        name: "Lamm Biryani",
        description: "garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln und Lammfleisch",
        price: "19,50 €",
      },
      {
        name: "Jhinga Biryani",
        description:
          "garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln und gebratenen Krabben",
        price: "22,50 €",
      },
      {
        name: "Matter Paneer Pulao",
        description: "mit gebratenem Käse, Erbsen, frischem Apfel, Granatapfel und Datteln",
        price: "17,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Rangla Chicken Pulao",
        description:
          "mit Hühnchenfilet, Datteln, Rosinen, Mandeln, Cashewnüssen, frischem Apfel und Granatapfelkernen",
        price: "17,90 €",
      },
      {
        name: "Rangla Lamm Pulao",
        description:
          "mit Lamm, Datteln, Rosinen, Mandeln, Cashewnüssen, frischem Apfel und Granatapfelkernen",
        price: "17,90 €",
      },
    ],
  },
  {
    name: "Dessert",
    items: [
      {
        name: "Indisches Halwa",
        description: "Grieß mit gemischten Trockenfrüchten",
        price: "5,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Indisches Vermicelles",
        description: "mit Milch, Kardamom und Rosinen",
        price: "5,90 €",
        dietary: ["vegetarian"],
      },
      {
        name: "Indisches Kulfieis",
        description: "mit Pistazien, Kardamom, dazu Sahne und Pistazien-Soße",
        price: "7,50 €",
        dietary: ["vegetarian"],
      },
      { name: "Gulab Jamun", description: null, price: "5,90 €", dietary: ["vegetarian"] },
      {
        name: "Kheer",
        description: "mit Reis, Milch, Zucker, gemischten Früchten und Rosenblüten",
        price: "5,90 €",
        dietary: ["vegetarian"],
      },
    ],
  },
  {
    name: "Lassi",
    dietary: ["vegetarian"],
    items: [
      { name: "Rosen Lassi 0,5l", description: "mit Kokosraspeln", price: "ab 5,00 €" },
      { name: "Mango Lassi 0,5l", description: null, price: "ab 5,00 €" },
      { name: "Kokos Lassi 0,5l", description: null, price: "ab 5,00 €" },
      { name: "Granatapfel Lassi 0,5l", description: null, price: "ab 5,00 €" },
      { name: "Erdbeer Lassi 0,5l", description: null, price: "ab 5,00 €" },
      { name: "Salziges Lassi 0,5l", description: null, price: "ab 5,00 €" },
    ],
  },
  {
    name: "Getränke",
    items: [
      { name: "Mineralwasser Still 0,75l", description: null, price: "4,90 €" },
      { name: "Mineralwasser Classic 0,75l", description: null, price: "4,90 €" },
      { name: "Sprite 0,33l", description: null, price: "3,50 €" },
      { name: "Sprite 1,0l", description: null, price: "4,50 €" },
      { name: "Mezzo Mix 0,33l", description: null, price: "3,50 €" },
      { name: "Mezzo Mix 1,0l", description: null, price: "4,50 €" },
      { name: "Coca Cola 0,33l", description: null, price: "3,50 €" },
      { name: "Coca Cola 1,0l", description: null, price: "4,50 €" },
      { name: "Coca Cola Zero 0,33l", description: null, price: "3,50 €" },
      { name: "Coca Cola Zero 1,0l", description: null, price: "4,50 €" },
      { name: "Fanta 0,33l", description: null, price: "3,50 €" },
      { name: "Fanta 1,0l", description: null, price: "4,50 €" },
      { name: "Mangosaft 1,0l", description: null, price: "3,90 €" },
      { name: "Orangensaft 1,0l", description: null, price: "3,90 €" },
      { name: "Apfelsaft 1,0l", description: null, price: "3,90 €" },
      { name: "Johannisbeersaft 1,0l", description: null, price: "3,90 €" },
      { name: "Ananassaft 1,0l", description: null, price: "3,90 €" },
      { name: "Maracujasaft 1,0l", description: null, price: "3,90 €" },
      { name: "Traubensaft 1,0l", description: null, price: "3,90 €" },
      { name: "Eistee Pfirsich 0,4l", description: null, price: "3,90 €" },
      { name: "Fürstenberg Pils alkoholfrei 0,5l", description: null, price: "4,00 €" },
      { name: "Radler Alkoholfrei 0,5l", description: "süßgespritzt", price: "4,00 €" },
      { name: "Rothaus Hefeweizen alkoholfrei 0,5l", description: null, price: "4,00 €" },
    ],
  },
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const existing = await prisma.venue.findUnique({
    where: { slug: VENUE_SLUG },
    select: { id: true },
  });
  if (existing) {
    process.stdout.write(
      `✓ seed-indian-restaurant: venue "${VENUE_SLUG}" already exists (${existing.id})\n`,
    );
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: "Indisches Restaurant",
        onboardingState: { step: 4 },
        onboardingCompletedAt: new Date(),
      },
    });

    // Placeholder owner — a syntactically valid argon2id string no one can
    // log in with. Replace via the real signup flow when handing over.
    const user = await tx.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {}, // keep any password already set on re-seed
      create: {
        email: OWNER_EMAIL,
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$demo-seed-not-a-real-hash$xxxxxxxxxxxxxx",
        emailVerifiedAt: new Date(),
      },
    });
    await tx.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "owner" },
    });

    const venue = await tx.venue.create({
      data: {
        tenantId: tenant.id,
        name: "Indisches Restaurant",
        slug: VENUE_SLUG,
        defaultLocale: "de",
        enabledLocales: ["de"],
        currency: "EUR",
        branding: { primaryColor: "#7a2e1d", logoKey: null },
      },
    });

    const menu = await tx.menu.create({
      data: {
        tenantId: tenant.id,
        venueId: venue.id,
        name: "Speisekarte",
        isDefault: true,
      },
    });

    // The dashboard editor works on the persistent `draft` version and
    // `publishDraft` snapshots it into a new `published` version. Seed both
    // so the venue is public AND editable from day one.
    async function fillVersion(versionId: string): Promise<number> {
      let count = 0;
      for (const [categoryIndex, rawCategory] of MENU.entries()) {
        const category = await tx.category.create({
          data: {
            tenantId: tenant.id,
            menuVersionId: versionId,
            name: rawCategory.name,
            orderIndex: categoryIndex,
          },
        });

        await tx.item.createMany({
          data: rawCategory.items.map((rawItem, itemIndex) => {
            const { cents, fromPrice } = parsePrice(rawItem.price);
            const dietary = [
              ...new Set([...(rawCategory.dietary ?? []), ...(rawItem.dietary ?? [])]),
            ];
            return {
              tenantId: tenant.id,
              categoryId: category.id,
              name: rawItem.name,
              description: rawItem.description,
              priceCents: cents,
              currency: "EUR",
              orderIndex: itemIndex,
              dietary,
              isAvailable: true,
              flags: fromPrice ? { fromPrice: true } : {},
            };
          }),
        });
        count += rawCategory.items.length;
      }
      return count;
    }

    const draft = await tx.menuVersion.create({
      data: { tenantId: tenant.id, menuId: menu.id, status: "draft" },
    });
    await fillVersion(draft.id);

    const published = await tx.menuVersion.create({
      data: {
        tenantId: tenant.id,
        menuId: menu.id,
        status: "published",
        publishedAt: new Date(),
      },
    });
    const itemCount = await fillVersion(published.id);

    await tx.menu.update({
      where: { id: menu.id },
      data: { publishedVersion: published.id },
    });

    process.stdout.write(
      `✓ seed-indian-restaurant: created venue "${VENUE_SLUG}" — ${MENU.length} categories, ${itemCount} items (tenant=${tenant.id}, venue=${venue.id})\n`,
    );
  });

  await prisma.$disconnect();
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `✗ seed-indian-restaurant failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
