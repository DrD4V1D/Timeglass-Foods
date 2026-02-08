// Timeglass Foods – Runtime edible item dump
// Forge 1.20.1 + KubeJS 6
//
// Command:
//   /tfoods dump_edibles
//
// Output:
//   kubejs/tfoods_edible_items.json

const OUTPUT_PATH = 'kubejs/tfoods_edible_items.json'

ServerEvents.loaded(event => {
  const edibleItems = []

  const allItemIds = Ingredient.of('*').itemIds

  for (const id of allItemIds) {
    try {
      if (Item.of(id).isEdible()) edibleItems.push(id)
    } catch (err) {
      // skip weird mod items
    }
  }

  edibleItems.sort()

  const payload = {
    generated_at: new Date().toISOString(),
    count: edibleItems.length,
    items: edibleItems
  }

  JsonIO.write(OUTPUT_PATH, payload)

  console.info(`[Timeglass Foods] Dumped ${edibleItems.length} edible items → ${OUTPUT_PATH}`)
})
