import { describe, it, expect } from 'vitest'
import { parseCustomerOrder } from './order-parser'
import { OFFICIAL_MENU_CATALOG, findCatalogItem } from './menu-catalog'

describe('Official Menu Catalog (56 Items)', () => {
  it('contains exactly 56 official menu items across 12 categories', () => {
    expect(OFFICIAL_MENU_CATALOG).toHaveLength(56)

    const categories = new Set(OFFICIAL_MENU_CATALOG.map((i) => i.category))
    expect(categories.size).toBe(12)
    expect(categories).toContain('FRIES')
    expect(categories).toContain('MAGGI & PASTA')
    expect(categories).toContain('DRINKS')
    expect(categories).toContain('SOFT DRINKS')
    expect(categories).toContain('ILLUSION STARTERS')
    expect(categories).toContain('BURGER')
    expect(categories).toContain('MOMOS')
    expect(categories).toContain('PIZZA')
    expect(categories).toContain('SANDWICH')
    expect(categories).toContain('DESSERT / SWEET')
    expect(categories).toContain('TWISTER')
    expect(categories).toContain('ADD ON / EXTRA')
  })

  it('accurately resolves all 56 items by name or aliases', () => {
    for (const item of OFFICIAL_MENU_CATALOG) {
      const found = findCatalogItem(item.name)
      expect(found, `Failed to find item by name: ${item.name}`).not.toBeNull()
      expect(found?.id).toBe(item.id)
    }
  })

  it('correctly distinguishes tricky item pairs', () => {
    // Chicken Pizza vs Malai Chicken Pizza
    const cp = findCatalogItem('chicken pizza')
    expect(cp?.id).toBe('chicken-pizza-7inch')
    expect(cp?.price).toBe(149)

    const mcp = findCatalogItem('malai chicken pizza')
    expect(mcp?.id).toBe('malai-chicken-pizza-7inch')
    expect(mcp?.price).toBe(149)

    // Regular Pizza vs Mini Pizza
    const miniMcp = findCatalogItem('mini malai chicken pizza')
    expect(miniMcp?.id).toBe('mini-malai-chicken-pizza')
    expect(miniMcp?.price).toBe(99)

    // Malai Kabab vs Malai Kabab Twister
    const mk = findCatalogItem('malai kabab')
    expect(mk?.id).toBe('malai-kabab-4pc')
    expect(mk?.price).toBe(199)

    const mkt = findCatalogItem('malai kabab twister')
    expect(mkt?.id).toBe('malai-kabab-twister')
    expect(mkt?.price).toBe(149)

    // Chicken Malai Box
    const cmb = findCatalogItem('chicken malai box')
    expect(cmb?.id).toBe('chicken-malai-box-4pc')
    expect(cmb?.price).toBe(119)
  })
})

describe('Deterministic Order Parser (Hindi, Hinglish & English)', () => {
  it('passes Mandatory Test Case 1 with exact items, quantities, and pricing', () => {
    const input = 'Chicken malai box 2 aur malai kabab 2, 4 cold coffee, malai chicken pizza 2 kardo'
    const result = parseCustomerOrder(input)

    expect(result).not.toBeNull()
    expect(result?.items).toHaveLength(4)
    expect(result?.subtotal).toBe(1330)

    // Item 1: Chicken Malai Box [4 Pc] x 2 = ₹238
    const item1 = result?.items.find((i) => i.item.id === 'chicken-malai-box-4pc')
    expect(item1).toBeDefined()
    expect(item1?.quantity).toBe(2)
    expect(item1?.unitPrice).toBe(119)
    expect(item1?.totalPrice).toBe(238)

    // Item 2: Malai Kabab [4pc] x 2 = ₹398
    const item2 = result?.items.find((i) => i.item.id === 'malai-kabab-4pc')
    expect(item2).toBeDefined()
    expect(item2?.quantity).toBe(2)
    expect(item2?.unitPrice).toBe(199)
    expect(item2?.totalPrice).toBe(398)

    // Item 3: Cold Coffee [200 ml] x 4 = ₹396
    const item3 = result?.items.find((i) => i.item.id === 'cold-coffee-200ml')
    expect(item3).toBeDefined()
    expect(item3?.quantity).toBe(4)
    expect(item3?.unitPrice).toBe(99)
    expect(item3?.totalPrice).toBe(396)

    // Item 4: Malai Chicken Pizza [7-inch] x 2 = ₹298
    const item4 = result?.items.find((i) => i.item.id === 'malai-chicken-pizza-7inch')
    expect(item4).toBeDefined()
    expect(item4?.quantity).toBe(2)
    expect(item4?.unitPrice).toBe(149)
    expect(item4?.totalPrice).toBe(298)

    // Verify WhatsApp output contains exact required sections
    expect(result?.formattedSummary).toContain('🍽️ *ILLUSION CAFE & RESTAURANT*')
    expect(result?.formattedSummary).toContain('🧾 *Your Order Summary*')
    expect(result?.formattedSummary).toContain('🍗 *2 × Chicken Malai Box [4 Pc]*')
    expect(result?.formattedSummary).toContain('₹119 × 2 = ₹238')
    expect(result?.formattedSummary).toContain('🍢 *2 × Malai Kabab [4pc]*')
    expect(result?.formattedSummary).toContain('₹199 × 2 = ₹398')
    expect(result?.formattedSummary).toContain('☕ *4 × Cold Coffee [200 ml]*')
    expect(result?.formattedSummary).toContain('₹99 × 4 = ₹396')
    expect(result?.formattedSummary).toContain('🍕 *2 × Malai Chicken Pizza [7-inch]*')
    expect(result?.formattedSummary).toContain('₹149 × 2 = ₹298')
    expect(result?.formattedSummary).toContain('💰 *Food Subtotal: ₹1,330*')
    expect(result?.formattedSummary).toContain('1️⃣ Confirm Details')
  })

  it('passes Mandatory Test Case 2 (Ek chicken pizza aur 2 cold coffee)', () => {
    const input = 'Ek chicken pizza aur 2 cold coffee'
    const result = parseCustomerOrder(input)

    expect(result).not.toBeNull()
    expect(result?.items).toHaveLength(2)
    expect(result?.subtotal).toBe(347)

    const pizza = result?.items.find((i) => i.item.id === 'chicken-pizza-7inch')
    expect(pizza).toBeDefined()
    expect(pizza?.quantity).toBe(1)
    expect(pizza?.unitPrice).toBe(149)
    expect(pizza?.totalPrice).toBe(149)

    const coffee = result?.items.find((i) => i.item.id === 'cold-coffee-200ml')
    expect(coffee).toBeDefined()
    expect(coffee?.quantity).toBe(2)
    expect(coffee?.unitPrice).toBe(99)
    expect(coffee?.totalPrice).toBe(198)

    expect(result?.formattedSummary).toContain('Food Subtotal: ₹347')
  })

  it('parses Hindi number words before or after item names', () => {
    // "Do burger aur ek pasta"
    const res1 = parseCustomerOrder('Do burger aur ek pasta')
    expect(res1).not.toBeNull()
    expect(res1?.items).toHaveLength(2)
    const burger = res1?.items.find((i) => i.item.category === 'BURGER')
    expect(burger?.quantity).toBe(2)
    const pasta = res1?.items.find((i) => i.item.category === 'MAGGI & PASTA')
    expect(pasta?.quantity).toBe(1)

    // "2 malai box add kardo"
    const res2 = parseCustomerOrder('2 malai box add kardo')
    expect(res2).not.toBeNull()
    expect(res2?.items[0].item.id).toBe('chicken-malai-box-4pc')
    expect(res2?.items[0].quantity).toBe(2)

    // "Pizza chicken wala 2 chahiye"
    const res3 = parseCustomerOrder('Pizza chicken wala 2 chahiye')
    expect(res3).not.toBeNull()
    expect(res3?.items[0].item.id).toBe('chicken-pizza-7inch')
    expect(res3?.items[0].quantity).toBe(2)
  })

  it('ignores general inquiries without order quantities (e.g. "Chicken pizza hai kya?")', () => {
    expect(parseCustomerOrder('Chicken pizza hai kya?')).toBeNull()
    expect(parseCustomerOrder('kya cold coffee milega?')).toBeNull()
    expect(parseCustomerOrder('Menu dikhao please')).toBeNull()
  })

  it('parses food orders with Hinglish action verbs like "kr de", "kar de", "bana de"', () => {
    const res = parseCustomerOrder('1 chicken pizza aur 2 cold coffee kr de')
    expect(res).not.toBeNull()
    expect(res?.items).toHaveLength(2)
    expect(res?.subtotal).toBe(347)
  })
})
