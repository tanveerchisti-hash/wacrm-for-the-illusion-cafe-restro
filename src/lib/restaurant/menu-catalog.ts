/**
 * Official Authoritative Menu Catalog for The Illusion Cafe & Restaurant
 * Total: 56 items across 12 categories.
 */

export interface MenuItem {
  id: string
  name: string
  category: string
  portion?: string
  price: number
  emoji: string
  aliases: string[]
  available: boolean
}

export const OFFICIAL_MENU_CATALOG: MenuItem[] = [
  // ==========================================
  // 1. FRIES (5 items)
  // ==========================================
  {
    id: 'plain-fries-medium',
    name: 'Plan Fries [Medium]',
    category: 'FRIES',
    portion: 'Medium',
    price: 99,
    emoji: '🍟',
    aliases: ['plain fries', 'plan fries', 'fries plain', 'normal fries', 'french fries', 'fries medium'],
    available: true,
  },
  {
    id: 'peri-peri-fries-medium',
    name: 'Peri Peri Fries [Medium]',
    category: 'FRIES',
    portion: 'Medium',
    price: 99,
    emoji: '🍟',
    aliases: ['peri peri fries', 'periperi fries', 'spicy fries', 'peri peri french fries'],
    available: true,
  },
  {
    id: 'butter-masala-fries-medium',
    name: 'Butter Masala Fries [Medium]',
    category: 'FRIES',
    portion: 'Medium',
    price: 99,
    emoji: '🍟',
    aliases: ['butter masala fries', 'butter fries', 'masala fries'],
    available: true,
  },
  {
    id: 'cheese-masala-fries-medium',
    name: 'Cheese Masala Fries [Medium]',
    category: 'FRIES',
    portion: 'Medium',
    price: 129,
    emoji: '🍟',
    aliases: ['cheese masala fries', 'cheese fries', 'cheesy masala fries'],
    available: true,
  },
  {
    id: 'fries-with-chicken-medium',
    name: 'Fries With Chicken [Medium]',
    category: 'FRIES',
    portion: 'Medium',
    price: 149,
    emoji: '🍟',
    aliases: ['fries with chicken', 'chicken fries', 'chicken loaded fries', 'fries chicken'],
    available: true,
  },

  // ==========================================
  // 2. MAGGI & PASTA (4 items)
  // ==========================================
  {
    id: 'cheese-maggi',
    name: 'Cheese Maggi',
    category: 'MAGGI & PASTA',
    price: 79,
    emoji: '🍜',
    aliases: ['cheese maggi', 'cheese maggie', 'cheez maggi', 'maggi cheese', 'plain maggi', 'veg maggi'],
    available: true,
  },
  {
    id: 'maggi-with-chicken',
    name: 'Maggi With Chicken',
    category: 'MAGGI & PASTA',
    price: 99,
    emoji: '🍜',
    aliases: ['maggi with chicken', 'chicken maggi', 'chicken maggie', 'maggie with chicken'],
    available: true,
  },
  {
    id: 'cheese-pasta',
    name: 'Cheese Pasta',
    category: 'MAGGI & PASTA',
    price: 79,
    emoji: '🍝',
    aliases: ['cheese pasta', 'cheesy pasta', 'veg pasta', 'white pasta', 'red pasta', 'pasta'],
    available: true,
  },
  {
    id: 'pasta-with-chicken',
    name: 'Pasta With Chicken',
    category: 'MAGGI & PASTA',
    price: 99,
    emoji: '🍝',
    aliases: ['pasta with chicken', 'chicken pasta', 'non veg pasta'],
    available: true,
  },

  // ==========================================
  // 3. DRINKS (5 items)
  // ==========================================
  {
    id: 'cold-coffee-200ml',
    name: 'Cold Coffee [200 ml]',
    category: 'DRINKS',
    portion: '200 ml',
    price: 99,
    emoji: '☕',
    aliases: ['cold coffee', 'cold coffe', 'cold cofee', 'cold coffee 200ml', 'ice coffee', 'iced coffee', 'coffee'],
    available: true,
  },
  {
    id: 'dry-fruits-shake-200ml',
    name: 'Dry Fruits Shake [200 ml]',
    category: 'DRINKS',
    portion: '200 ml',
    price: 149,
    emoji: '🥤',
    aliases: ['dry fruits shake', 'dry fruit shake', 'dryfruit shake', 'kaju badam shake'],
    available: true,
  },
  {
    id: 'anjeer-shake-200ml',
    name: 'Anjeer Shake [200 ml]',
    category: 'DRINKS',
    portion: '200 ml',
    price: 149,
    emoji: '🥤',
    aliases: ['anjeer shake', 'fig shake'],
    available: true,
  },
  {
    id: 'khajur-shake-200ml',
    name: 'Khajur Shake [200 ml]',
    category: 'DRINKS',
    portion: '200 ml',
    price: 149,
    emoji: '🥤',
    aliases: ['khajur shake', 'dates shake', 'date shake'],
    available: true,
  },
  {
    id: 'gulkand-shake-200ml',
    name: 'Gulkand Shake [200 ml]',
    category: 'DRINKS',
    portion: '200 ml',
    price: 149,
    emoji: '🥤',
    aliases: ['gulkand shake', 'rose shake'],
    available: true,
  },

  // ==========================================
  // 4. SOFT DRINKS (4 items)
  // ==========================================
  {
    id: 'lahori-zeera-150ml',
    name: 'Lahori Zeera [150 ml]',
    category: 'SOFT DRINKS',
    portion: '150 ml',
    price: 10,
    emoji: '🥤',
    aliases: ['lahori zeera', 'lahori jeera', 'zeera soda', 'jeera soda'],
    available: true,
  },
  {
    id: 'campa-200ml',
    name: 'Campa [200 ml]',
    category: 'SOFT DRINKS',
    portion: '200 ml',
    price: 10,
    emoji: '🥤',
    aliases: ['campa 200ml', 'campa cola 200ml', 'campa chhota', 'campa 10 rs', 'campa 10'],
    available: true,
  },
  {
    id: 'campa-500ml',
    name: 'Campa [500 ml]',
    category: 'SOFT DRINKS',
    portion: '500 ml',
    price: 20,
    emoji: '🥤',
    aliases: ['campa 500ml', 'campa cola 500ml', 'campa bada', 'campa 20 rs', 'campa 20', 'campa'],
    available: true,
  },
  {
    id: 'water-bottle-1ltr',
    name: 'Water Bottle [1Ltr]',
    category: 'SOFT DRINKS',
    portion: '1Ltr',
    price: 20,
    emoji: '💧',
    aliases: ['water bottle', 'water bottle 1ltr', 'pani ki botal', 'mineral water', 'water'],
    available: true,
  },

  // ==========================================
  // 5. ILLUSION STARTERS (11 items)
  // ==========================================
  {
    id: 'chicken-malai-box-4pc',
    name: 'Chicken Malai Box [4 Pc]',
    category: 'ILLUSION STARTERS',
    portion: '4 Pc',
    price: 119,
    emoji: '🍗',
    aliases: [
      'chicken malai box',
      'malai box',
      'chicken malai box 4pc',
      'chicken malai box 4 pc',
      'malai box 4pc',
      'malai box 4 pc',
      'malai chicken box',
    ],
    available: true,
  },
  {
    id: 'foil-chicken',
    name: 'Foil Chicken',
    category: 'ILLUSION STARTERS',
    price: 149,
    emoji: '🍗',
    aliases: ['foil chicken', 'foil chiken'],
    available: true,
  },
  {
    id: 'creamy-foil-fish',
    name: 'Creamy Foil Fish',
    category: 'ILLUSION STARTERS',
    price: 149,
    emoji: '🐟',
    aliases: ['creamy foil fish', 'foil fish'],
    available: true,
  },
  {
    id: 'chicken-fry',
    name: 'Chicken Fry',
    category: 'ILLUSION STARTERS',
    price: 149,
    emoji: '🍗',
    aliases: ['chicken fry', 'fry chicken', 'chiken fry'],
    available: true,
  },
  {
    id: 'crispy-boneless-fish-fry',
    name: 'Crispy Boneless Fish Fry',
    category: 'ILLUSION STARTERS',
    price: 179,
    emoji: '🐟',
    aliases: ['crispy boneless fish fry', 'fish fry', 'boneless fish fry', 'crispy fish fry'],
    available: true,
  },
  {
    id: 'butter-masala-kabab-4pc',
    name: 'Butter Masala Kabab [4pc]',
    category: 'ILLUSION STARTERS',
    portion: '4pc',
    price: 149,
    emoji: '🍢',
    aliases: [
      'butter masala kabab',
      'butter masala kebab',
      'butter kabab',
      'butter masala kabab 4pc',
      'butter masala kabab 4 pc',
    ],
    available: true,
  },
  {
    id: 'malai-kabab-4pc',
    name: 'Malai Kabab [4pc]',
    category: 'ILLUSION STARTERS',
    portion: '4pc',
    price: 199,
    emoji: '🍢',
    aliases: ['malai kabab', 'malai kebab', 'malai kabab 4pc', 'malai kabab 4 pc', 'chicken malai kabab'],
    available: true,
  },
  {
    id: 'corn-garlic-bread',
    name: 'Corn Garlic Bread',
    category: 'ILLUSION STARTERS',
    price: 119,
    emoji: '🍞',
    aliases: ['corn garlic bread', 'garlic bread corn', 'garlic bread'],
    available: true,
  },
  {
    id: 'chicken-garlic-bread',
    name: 'Chicken Garlic Bread',
    category: 'ILLUSION STARTERS',
    price: 149,
    emoji: '🍞',
    aliases: ['chicken garlic bread', 'garlic bread chicken'],
    available: true,
  },
  {
    id: 'cheese-chicken-roll-2pc',
    name: 'Cheese Chicken Roll [2pc]',
    category: 'ILLUSION STARTERS',
    portion: '2pc',
    price: 119,
    emoji: '🌯',
    aliases: ['cheese chicken roll', 'chicken cheese roll', 'cheese chicken roll 2pc', 'chicken roll'],
    available: true,
  },
  {
    id: 'veg-spring-roll-2pc',
    name: 'Veg Spring Roll [2pc]',
    category: 'ILLUSION STARTERS',
    portion: '2pc',
    price: 99,
    emoji: '🌯',
    aliases: ['veg spring roll', 'spring roll', 'spring roll veg', 'veg spring roll 2pc'],
    available: true,
  },

  // ==========================================
  // 6. BURGER (4 items)
  // ==========================================
  {
    id: 'cheese-aloo-tikki-burger',
    name: 'Cheese Aloo Tikki Burger',
    category: 'BURGER',
    price: 59,
    emoji: '🍔',
    aliases: [
      'cheese aloo tikki burger',
      'aloo tikki burger',
      'veg burger',
      'aloo burger',
      'cheese burger',
      'burger',
    ],
    available: true,
  },
  {
    id: 'chicken-burger',
    name: 'Chicken Burger',
    category: 'BURGER',
    price: 75,
    emoji: '🍔',
    aliases: ['chicken burger', 'chiken burger', 'non veg burger'],
    available: true,
  },
  {
    id: 'pizza-bun',
    name: 'Pizza Bun',
    category: 'BURGER',
    price: 75,
    emoji: '🍔',
    aliases: ['pizza bun'],
    available: true,
  },
  {
    id: 'malai-chicken-bun',
    name: 'Malai Chicken Bun',
    category: 'BURGER',
    price: 79,
    emoji: '🍔',
    aliases: ['malai chicken bun', 'chicken malai bun', 'malai bun'],
    available: true,
  },

  // ==========================================
  // 7. MOMOS (3 items)
  // ==========================================
  {
    id: 'veg-fry-momos-5pc',
    name: 'Veg Fry Momos [5 Pc]',
    category: 'MOMOS',
    portion: '5 Pc',
    price: 69,
    emoji: '🥟',
    aliases: ['veg fry momos', 'veg momos', 'fried momos', 'veg fried momos', 'momos veg', 'momos'],
    available: true,
  },
  {
    id: 'sweet-corn-fry-momos-5pc',
    name: 'Sweet Corn Fry Momos [5 Pc]',
    category: 'MOMOS',
    portion: '5 Pc',
    price: 79,
    emoji: '🥟',
    aliases: ['sweet corn fry momos', 'corn fry momos', 'corn momos', 'sweet corn momos'],
    available: true,
  },
  {
    id: 'crispy-chicken-momos-5pc',
    name: 'Crispy Chicken Momos [5 Pc]',
    category: 'MOMOS',
    portion: '5 Pc',
    price: 119,
    emoji: '🥟',
    aliases: ['crispy chicken momos', 'chicken momos', 'chicken fry momos', 'chicken fried momos'],
    available: true,
  },

  // ==========================================
  // 8. PIZZA (8 items)
  // ==========================================
  {
    id: 'onion-pizza-7inch',
    name: 'Onion Pizza [7-inch]',
    category: 'PIZZA',
    portion: '7-inch',
    price: 99,
    emoji: '🍕',
    aliases: ['onion pizza', 'onion pizza 7 inch', 'onion pizza 7inch', 'pyaz pizza'],
    available: true,
  },
  {
    id: 'cheese-corn-pizza-7inch',
    name: 'Cheese Corn Pizza [7-inch]',
    category: 'PIZZA',
    portion: '7-inch',
    price: 99,
    emoji: '🍕',
    aliases: ['cheese corn pizza', 'corn pizza', 'cheese corn pizza 7 inch', 'cheese corn pizza 7inch'],
    available: true,
  },
  {
    id: 'mix-veg-pizza-7inch',
    name: 'Mix Veg Pizza [7-inch]',
    category: 'PIZZA',
    portion: '7-inch',
    price: 99,
    emoji: '🍕',
    aliases: ['mix veg pizza', 'veg pizza', 'mix veg pizza 7 inch', 'mix veg pizza 7inch'],
    available: true,
  },
  {
    id: 'malai-chicken-pizza-7inch',
    name: 'Malai Chicken Pizza [7-inch]',
    category: 'PIZZA',
    portion: '7-inch',
    price: 149,
    emoji: '🍕',
    aliases: [
      'malai chicken pizza',
      'chicken malai pizza',
      'malai pizza',
      'malai chicken pizza 7 inch',
      'malai chicken pizza 7inch',
      'malai pizza chicken',
    ],
    available: true,
  },
  {
    id: 'chicken-pizza-7inch',
    name: 'Chicken Pizza [7-inch]',
    category: 'PIZZA',
    portion: '7-inch',
    price: 149,
    emoji: '🍕',
    aliases: [
      'chicken pizza',
      'chicken pizza 7 inch',
      'chicken pizza 7inch',
      'chiken pizza',
      'pizza chicken',
      'pizza chicken wala',
      'chicken wala pizza',
      'regular chicken pizza',
    ],
    available: true,
  },
  {
    id: 'mini-veg-pizza',
    name: 'Mini Veg Pizza',
    category: 'PIZZA',
    price: 69,
    emoji: '🍕',
    aliases: ['mini veg pizza', 'mini pizza veg', 'chhota veg pizza'],
    available: true,
  },
  {
    id: 'mini-cheese-corn-pizza',
    name: 'Mini Cheese Corn Pizza',
    category: 'PIZZA',
    price: 69,
    emoji: '🍕',
    aliases: ['mini cheese corn pizza', 'mini corn pizza'],
    available: true,
  },
  {
    id: 'mini-malai-chicken-pizza',
    name: 'Mini Malai Chicken Pizza',
    category: 'PIZZA',
    price: 99,
    emoji: '🍕',
    aliases: ['mini malai chicken pizza', 'mini chicken malai pizza', 'mini malai pizza'],
    available: true,
  },

  // ==========================================
  // 9. SANDWICH (3 items)
  // ==========================================
  {
    id: 'pizza-sandwich',
    name: 'Pizza Sandwich',
    category: 'SANDWICH',
    price: 79,
    emoji: '🥪',
    aliases: ['pizza sandwich', 'sandwich pizza', 'veg sandwich', 'sandwich'],
    available: true,
  },
  {
    id: 'malai-chicken-sandwich',
    name: 'Malai Chicken Sandwich',
    category: 'SANDWICH',
    price: 99,
    emoji: '🥪',
    aliases: ['malai chicken sandwich', 'chicken malai sandwich'],
    available: true,
  },
  {
    id: 'chicken-sandwich',
    name: 'Chicken Sandwich',
    category: 'SANDWICH',
    price: 99,
    emoji: '🥪',
    aliases: ['chicken sandwich', 'chiken sandwich'],
    available: true,
  },

  // ==========================================
  // 10. DESSERT / SWEET (1 item)
  // ==========================================
  {
    id: 'seviyan-mawa-kheer',
    name: 'Seviyan Mawa Kheer',
    category: 'DESSERT / SWEET',
    price: 59,
    emoji: '🍨',
    aliases: ['seviyan mawa kheer', 'mawa kheer', 'seviyan kheer', 'kheer'],
    available: true,
  },

  // ==========================================
  // 11. TWISTER (4 items)
  // ==========================================
  {
    id: 'malai-kabab-twister',
    name: 'Malai Kabab Twister',
    category: 'TWISTER',
    price: 149,
    emoji: '🌯',
    aliases: ['malai kabab twister', 'malai kebab twister', 'twister malai kabab'],
    available: true,
  },
  {
    id: 'crispy-chicken-twister',
    name: 'Crispy Chicken Twister',
    category: 'TWISTER',
    price: 149,
    emoji: '🌯',
    aliases: ['crispy chicken twister', 'chicken crispy twister'],
    available: true,
  },
  {
    id: 'chicken-twister-shawarma-style',
    name: 'Chicken Twister [Shawarma Style]',
    category: 'TWISTER',
    portion: 'Shawarma Style',
    price: 149,
    emoji: '🌯',
    aliases: ['chicken twister shawarma style', 'chicken twister', 'shawarma twister', 'chicken shawarma'],
    available: true,
  },
  {
    id: 'malai-chicken-twister',
    name: 'Malai Chicken Twister',
    category: 'TWISTER',
    price: 149,
    emoji: '🌯',
    aliases: ['malai chicken twister', 'chicken malai twister'],
    available: true,
  },

  // ==========================================
  // 12. ADD ON / EXTRA (4 items)
  // ==========================================
  {
    id: 'rumali-roti',
    name: 'Rumali Roti',
    category: 'ADD ON / EXTRA',
    price: 15,
    emoji: '🫓',
    aliases: ['rumali roti', 'roomali roti', 'roti'],
    available: true,
  },
  {
    id: 'soft-bun',
    name: 'Soft Bun',
    category: 'ADD ON / EXTRA',
    price: 10,
    emoji: '🍞',
    aliases: ['soft bun', 'bun'],
    available: true,
  },
  {
    id: 'extra-mayo',
    name: 'Extra Mayo',
    category: 'ADD ON / EXTRA',
    price: 10,
    emoji: '🥣',
    aliases: ['extra mayo', 'mayo', 'mayonnaise'],
    available: true,
  },
  {
    id: 'extra-cheese',
    name: 'Extra Cheese',
    category: 'ADD ON / EXTRA',
    price: 20,
    emoji: '🧀',
    aliases: ['extra cheese', 'cheese slice', 'more cheese'],
    available: true,
  },
]

/**
 * Return all 56 official items.
 */
export function getOfficialMenuCatalog(): MenuItem[] {
  return OFFICIAL_MENU_CATALOG
}

/**
 * Clean and normalize text for catalog matching.
 */
function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[\[\](),.\-_*#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Match a raw query against the official menu catalog.
 * Strict matching rules prioritize specific items over generic substrings:
 * E.g.:
 * - 'malai chicken pizza' -> 'malai-chicken-pizza-7inch' (not 'chicken-pizza-7inch')
 * - 'mini malai chicken pizza' -> 'mini-malai-chicken-pizza' (not 7-inch)
 * - 'malai kabab twister' -> 'malai-kabab-twister' (not starter kabab)
 * - 'chicken malai box' -> 'chicken-malai-box-4pc' (not starter kabab)
 */
export function findCatalogItem(rawQuery: string): MenuItem | null {
  const query = normalizeQuery(rawQuery)
  if (!query || query.length < 2) return null

  // Pass 1: Exact name or alias match
  for (const item of OFFICIAL_MENU_CATALOG) {
    if (normalizeQuery(item.name) === query) return item
    for (const alias of item.aliases) {
      if (normalizeQuery(alias) === query) return item
    }
  }

  // Sorted candidates by alias specificity (longer aliases first)
  const sortedItems = [...OFFICIAL_MENU_CATALOG].sort((a, b) => {
    const maxLenA = Math.max(...a.aliases.map((al) => al.length))
    const maxLenB = Math.max(...b.aliases.map((al) => al.length))
    return maxLenB - maxLenA
  })

  // Pass 2: Check if query contains an alias or alias contains query
  for (const item of sortedItems) {
    for (const alias of item.aliases) {
      const normAlias = normalizeQuery(alias)
      // Disallow overly short generic words like 'bun' matching 'soft bun' unless exact
      if (normAlias.length < 4 && normAlias !== query) continue

      if (query.includes(normAlias) || normAlias.includes(query)) {
        // Guard tricky pairs:
        // If query does NOT mention twister, do not match twisters
        if (item.category === 'TWISTER' && !query.includes('twister') && !query.includes('shawarma')) {
          continue
        }
        // If query does NOT mention mini, do not match mini pizzas
        if (item.id.startsWith('mini-') && !query.includes('mini') && !query.includes('chhot')) {
          continue
        }
        // If query mentions malai, do not match non-malai chicken pizza
        if (item.id === 'chicken-pizza-7inch' && query.includes('malai')) {
          continue
        }
        // If query mentions box, do not match kababs
        if (item.id.includes('kabab') && query.includes('box')) {
          continue
        }
        return item
      }
    }
  }

  return null
}

/**
 * Compact, structured text format of the full menu catalog
 * for injecting into AI system context.
 */
export function getMenuCatalogFormattedForAi(): string {
  const grouped: Record<string, MenuItem[]> = {}
  for (const item of OFFICIAL_MENU_CATALOG) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  const sections: string[] = []
  for (const [cat, items] of Object.entries(grouped)) {
    const lines = items.map((i) => `• ${i.name} — ₹${i.price}`)
    sections.push(`### ${cat}\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}
