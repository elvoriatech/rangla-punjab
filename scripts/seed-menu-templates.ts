import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Seed Elvoria's starter menu templates (German, matching the launch
 * market). Idempotent: upserts by `key`, so re-running refreshes
 * content without duplicating. Prices in cents.
 *
 *   pnpm exec tsx --env-file=.env scripts/seed-menu-templates.ts
 */

type Item = {
  name: string;
  description?: string;
  priceCents: number;
  dietary?: string[];
  allergens?: string[];
  spice?: number;
};
type Cat = { name: string; items: Item[] };
type Template = {
  key: string;
  name: string;
  cuisine: string;
  emoji: string;
  sortIndex: number;
  categories: Cat[];
};

const V = ["vegetarian"];
const VG = ["vegan"];

const TEMPLATES: Template[] = [
  {
    key: "indian-pakistani",
    name: "Indisch / Pakistanisch",
    cuisine: "Indian / Pakistani",
    emoji: "🍛",
    sortIndex: 10,
    categories: [
      {
        name: "Vorspeisen",
        items: [
          {
            name: "Gemüse-Samosa",
            description: "Zwei knusprige Teigtaschen mit Kartoffeln und Erbsen",
            priceCents: 590,
            dietary: V,
            spice: 1,
          },
          {
            name: "Onion Bhaji",
            description: "Frittierte Zwiebelbällchen im Kichererbsenteig",
            priceCents: 550,
            dietary: VG,
            spice: 1,
          },
          {
            name: "Hähnchen-Pakora",
            description: "Hähnchenstücke im würzigen Teigmantel",
            priceCents: 690,
            spice: 2,
          },
        ],
      },
      {
        name: "Tandoori & Grill",
        items: [
          {
            name: "Chicken Tikka",
            description: "Marinierte Hähnchenstücke aus dem Tandoor",
            priceCents: 1290,
            spice: 2,
          },
          {
            name: "Lamm Seekh Kebab",
            description: "Gewürztes Lammhack vom Spieß",
            priceCents: 1390,
            spice: 2,
          },
          {
            name: "Paneer Tikka",
            description: "Marinierter Frischkäse mit Paprika und Zwiebeln",
            priceCents: 1190,
            dietary: V,
            spice: 1,
          },
        ],
      },
      {
        name: "Currys",
        items: [
          {
            name: "Butter Chicken",
            description: "Hähnchen in cremiger Tomaten-Butter-Sauce",
            priceCents: 1490,
            allergens: ["milk"],
            spice: 1,
          },
          {
            name: "Chicken Karahi",
            description: "Hähnchen mit frischem Ingwer und Tomaten",
            priceCents: 1490,
            spice: 2,
          },
          {
            name: "Lamm Rogan Josh",
            description: "Zartes Lamm in aromatischer Kashmiri-Sauce",
            priceCents: 1590,
            spice: 2,
          },
          {
            name: "Dal Makhani",
            description: "Schwarze Linsen, über Nacht sanft geköchelt",
            priceCents: 1090,
            dietary: V,
            allergens: ["milk"],
            spice: 1,
          },
          {
            name: "Palak Paneer",
            description: "Frischkäse in cremigem Spinat",
            priceCents: 1190,
            dietary: V,
            allergens: ["milk"],
            spice: 1,
          },
          {
            name: "Chana Masala",
            description: "Kichererbsen in würziger Tomatensauce",
            priceCents: 990,
            dietary: VG,
            spice: 2,
          },
        ],
      },
      {
        name: "Reis & Brot",
        items: [
          { name: "Basmati Reis", priceCents: 390, dietary: VG },
          {
            name: "Chicken Biryani",
            description: "Safranreis mit Hähnchen und Röstzwiebeln",
            priceCents: 1390,
            spice: 2,
          },
          {
            name: "Naan",
            description: "Frisch aus dem Tandoor",
            priceCents: 350,
            dietary: V,
            allergens: ["gluten"],
          },
          { name: "Knoblauch-Naan", priceCents: 420, dietary: V, allergens: ["gluten"] },
        ],
      },
      {
        name: "Getränke",
        items: [
          {
            name: "Mango Lassi",
            description: "Joghurtgetränk mit Mango",
            priceCents: 450,
            dietary: V,
            allergens: ["milk"],
          },
          { name: "Masala Chai", priceCents: 350, dietary: V, allergens: ["milk"] },
        ],
      },
    ],
  },
  {
    key: "pizzeria",
    name: "Pizzeria",
    cuisine: "Italian / Pizza",
    emoji: "🍕",
    sortIndex: 20,
    categories: [
      {
        name: "Antipasti",
        items: [
          {
            name: "Bruschetta",
            description: "Geröstetes Brot mit Tomaten und Basilikum",
            priceCents: 690,
            dietary: VG,
            allergens: ["gluten"],
          },
          {
            name: "Caprese",
            description: "Tomaten, Mozzarella, Basilikum",
            priceCents: 890,
            dietary: V,
            allergens: ["milk"],
          },
        ],
      },
      {
        name: "Pizza",
        items: [
          {
            name: "Margherita",
            description: "Tomate, Mozzarella, Basilikum",
            priceCents: 890,
            dietary: V,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Salame",
            description: "Tomate, Mozzarella, Salami",
            priceCents: 1050,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Funghi",
            description: "Tomate, Mozzarella, Champignons",
            priceCents: 990,
            dietary: V,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Prosciutto",
            description: "Tomate, Mozzarella, Schinken",
            priceCents: 1090,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Quattro Formaggi",
            description: "Vier Käsesorten",
            priceCents: 1190,
            dietary: V,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Vegetariana",
            description: "Tomate, Mozzarella, gegrilltes Gemüse",
            priceCents: 1090,
            dietary: V,
            allergens: ["gluten", "milk"],
          },
        ],
      },
      {
        name: "Pasta",
        items: [
          { name: "Spaghetti Bolognese", priceCents: 1090, allergens: ["gluten"] },
          {
            name: "Penne Arrabbiata",
            description: "Scharfe Tomatensauce",
            priceCents: 990,
            dietary: VG,
            allergens: ["gluten"],
            spice: 2,
          },
          { name: "Lasagne", priceCents: 1190, allergens: ["gluten", "milk"] },
        ],
      },
      {
        name: "Dolci & Getränke",
        items: [
          { name: "Tiramisù", priceCents: 590, dietary: V, allergens: ["gluten", "milk", "eggs"] },
          { name: "Espresso", priceCents: 250, dietary: VG },
          { name: "San Pellegrino 0,5 l", priceCents: 390, dietary: VG },
        ],
      },
    ],
  },
  {
    key: "sushi",
    name: "Sushi / Japanisch",
    cuisine: "Japanese / Sushi",
    emoji: "🍣",
    sortIndex: 30,
    categories: [
      {
        name: "Vorspeisen",
        items: [
          {
            name: "Edamame",
            description: "Gedämpfte Sojabohnen mit Meersalz",
            priceCents: 490,
            dietary: VG,
            allergens: ["soybeans"],
          },
          { name: "Miso-Suppe", priceCents: 390, dietary: VG, allergens: ["soybeans"] },
          {
            name: "Gyoza",
            description: "Gebratene Teigtaschen mit Hähnchenfüllung",
            priceCents: 690,
            allergens: ["gluten", "soybeans"],
          },
        ],
      },
      {
        name: "Maki",
        items: [
          { name: "Maki Lachs", description: "6 Stück", priceCents: 590, allergens: ["fish"] },
          { name: "Maki Gurke", description: "6 Stück", priceCents: 490, dietary: VG },
          {
            name: "California Roll",
            description: "8 Stück, Surimi, Avocado, Gurke",
            priceCents: 790,
            allergens: ["crustaceans", "fish"],
          },
        ],
      },
      {
        name: "Nigiri & Sashimi",
        items: [
          { name: "Nigiri Lachs", description: "2 Stück", priceCents: 550, allergens: ["fish"] },
          {
            name: "Nigiri Thunfisch",
            description: "2 Stück",
            priceCents: 650,
            allergens: ["fish"],
          },
          { name: "Sashimi Mix", description: "9 Stück", priceCents: 1390, allergens: ["fish"] },
        ],
      },
      {
        name: "Getränke",
        items: [
          { name: "Grüner Tee", priceCents: 300, dietary: VG },
          { name: "Ramune", description: "Japanische Limonade", priceCents: 420, dietary: VG },
        ],
      },
    ],
  },
  {
    key: "kebab",
    name: "Kebab / Döner",
    cuisine: "Turkish / Kebab",
    emoji: "🥙",
    sortIndex: 40,
    categories: [
      {
        name: "Döner & Dürüm",
        items: [
          {
            name: "Döner Kebab",
            description: "Im Fladenbrot mit Salat und Sauce",
            priceCents: 650,
            allergens: ["gluten"],
          },
          {
            name: "Dürüm Döner",
            description: "Im dünnen Wrap gerollt",
            priceCents: 700,
            allergens: ["gluten"],
          },
          {
            name: "Falafel Dürüm",
            description: "Mit Kichererbsenbällchen",
            priceCents: 650,
            dietary: VG,
            allergens: ["gluten", "sesame"],
          },
        ],
      },
      {
        name: "Teller",
        items: [
          {
            name: "Döner Teller",
            description: "Mit Reis oder Pommes und Salat",
            priceCents: 1090,
            allergens: ["gluten"],
          },
          {
            name: "Adana Teller",
            description: "Gegrillter Hackfleischspieß",
            priceCents: 1190,
            spice: 1,
          },
        ],
      },
      {
        name: "Vorspeisen & Beilagen",
        items: [
          { name: "Sucuk", description: "Gegrillte türkische Knoblauchwurst", priceCents: 590 },
          { name: "Pommes", priceCents: 390, dietary: VG },
          { name: "Hummus", priceCents: 490, dietary: VG, allergens: ["sesame"] },
        ],
      },
      {
        name: "Getränke",
        items: [
          { name: "Ayran", priceCents: 250, dietary: V, allergens: ["milk"] },
          { name: "Cola 0,33 l", priceCents: 290, dietary: VG },
        ],
      },
    ],
  },
  {
    key: "burger",
    name: "Burger",
    cuisine: "Burgers / American",
    emoji: "🍔",
    sortIndex: 50,
    categories: [
      {
        name: "Burger",
        items: [
          {
            name: "Classic Cheeseburger",
            description: "Rindfleisch, Cheddar, Salat, Tomate, Sauce",
            priceCents: 990,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Bacon Burger",
            description: "Mit knusprigem Speck",
            priceCents: 1150,
            allergens: ["gluten", "milk"],
          },
          {
            name: "Veggie Burger",
            description: "Gemüse-Patty mit Avocado",
            priceCents: 1050,
            dietary: V,
            allergens: ["gluten"],
          },
          {
            name: "Chicken Burger",
            description: "Knuspriges Hähnchenfilet",
            priceCents: 1090,
            allergens: ["gluten"],
          },
        ],
      },
      {
        name: "Beilagen",
        items: [
          { name: "Pommes", priceCents: 390, dietary: VG },
          { name: "Süßkartoffel-Pommes", priceCents: 490, dietary: VG },
          { name: "Onion Rings", priceCents: 450, dietary: V, allergens: ["gluten"] },
        ],
      },
      {
        name: "Getränke",
        items: [
          { name: "Hausgemachte Limonade", priceCents: 420, dietary: VG },
          { name: "Milkshake Vanille", priceCents: 550, dietary: V, allergens: ["milk"] },
        ],
      },
    ],
  },
  {
    key: "cafe-bakery",
    name: "Café & Bäckerei",
    cuisine: "Café / Bakery",
    emoji: "☕",
    sortIndex: 60,
    categories: [
      {
        name: "Kaffee",
        items: [
          { name: "Espresso", priceCents: 220, dietary: VG },
          { name: "Cappuccino", priceCents: 320, dietary: V, allergens: ["milk"] },
          { name: "Latte Macchiato", priceCents: 360, dietary: V, allergens: ["milk"] },
        ],
      },
      {
        name: "Gebäck & Kuchen",
        items: [
          {
            name: "Butter-Croissant",
            priceCents: 220,
            dietary: V,
            allergens: ["gluten", "milk", "eggs"],
          },
          {
            name: "Käsekuchen",
            priceCents: 390,
            dietary: V,
            allergens: ["gluten", "milk", "eggs"],
          },
          { name: "Apfelstrudel", priceCents: 420, dietary: V, allergens: ["gluten"] },
        ],
      },
      {
        name: "Frühstück",
        items: [
          {
            name: "Frühstücksteller",
            description: "Aufschnitt, Käse, Ei, Brötchen",
            priceCents: 890,
            dietary: V,
            allergens: ["gluten", "milk", "eggs"],
          },
          { name: "Avocado-Toast", priceCents: 750, dietary: VG, allergens: ["gluten"] },
        ],
      },
    ],
  },
];

async function main(): Promise<void> {
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL (or DATABASE_URL) is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    for (const t of TEMPLATES) {
      const content = { categories: t.categories };
      await prisma.menuTemplate.upsert({
        where: { key: t.key },
        create: {
          key: t.key,
          name: t.name,
          cuisine: t.cuisine,
          emoji: t.emoji,
          locale: "de",
          sortIndex: t.sortIndex,
          content,
        },
        update: {
          name: t.name,
          cuisine: t.cuisine,
          emoji: t.emoji,
          sortIndex: t.sortIndex,
          content,
        },
      });
      const items = t.categories.reduce((n, c) => n + c.items.length, 0);
      console.log(`✓ ${t.emoji} ${t.name} — ${t.categories.length} categories, ${items} items`);
    }
    console.log(`\n${TEMPLATES.length} templates seeded.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
