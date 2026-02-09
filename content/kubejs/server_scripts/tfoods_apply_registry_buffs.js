// Timeglass Foods - apply buffs from registry nodes with inheritance.
// Rhino/ES5-safe version for KubeJS 2001.6.x.

var TF_NODE_DIR_CANDIDATES = [
  'kubejs/timeglass_registry/nodes',
  'timeglass_registry/nodes'
]
var TF_NODE_IDS_CANDIDATES = [
  'kubejs/timeglass_registry/node_ids.json',
  'timeglass_registry/node_ids.json'
]

var TF_NODE_CACHE = {}
var TF_BUFF_CACHE = {}
var TF_TAG_RULES = []
var TF_ACTIVE_NODE_DIR = TF_NODE_DIR_CANDIDATES[0]

function tfIsJavaList(value) {
  return value != null && typeof value.size === 'function' && typeof value.get === 'function'
}

function tfIsJavaMap(value) {
  return value != null && typeof value.get === 'function' && typeof value.keySet === 'function'
}

function tfGetField(obj, key, fallback) {
  if (obj == null) return fallback

  if (tfIsJavaMap(obj)) {
    var mapValue = obj.get(key)
    return mapValue === undefined || mapValue === null ? fallback : mapValue
  }

  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    var objValue = obj[key]
    return objValue === undefined ? fallback : objValue
  }

  return fallback
}

function tfToArray(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value

  if (tfIsJavaList(value)) {
    var outList = []
    for (var i = 0; i < value.size(); i++) outList.push(value.get(i))
    return outList
  }

  if (typeof value.iterator === 'function') {
    var outIter = []
    var it = value.iterator()
    while (it.hasNext()) outIter.push(it.next())
    return outIter
  }

  return []
}

function tfObjectEntries(value) {
  var entries = []
  if (value == null) return entries

  if (tfIsJavaMap(value)) {
    var it = value.keySet().iterator()
    while (it.hasNext()) {
      var key = it.next()
      entries.push([String(key), value.get(key)])
    }
    return entries
  }

  for (var k in value) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) continue
    entries.push([k, value[k]])
  }
  return entries
}

function tfNormalizeNumber(value, fallback) {
  var n = Number(value)
  return typeof n === 'number' && isFinite(n) ? n : fallback
}

function tfClampInt(value, minValue, fallback) {
  var n = Math.floor(tfNormalizeNumber(value, fallback))
  return n < minValue ? minValue : n
}

function tfClampChance(value) {
  var n = tfNormalizeNumber(value, 1)
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function tfFirstDefined() {
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]
  }
  return undefined
}

function tfNodeFilename(nodeId) {
  return String(nodeId).replace(/\//g, '--').replace(/:/g, '__') + '.json'
}

function tfTokenToNodeId(token) {
  if (token == null) return null
  var s = String(token)

  if (s.indexOf('item:') === 0) {
    var itemId = s.substring(5)
    return itemId.indexOf(':') >= 0 ? itemId : null
  }

  if (s.indexOf('tag:') === 0) {
    var tagId = s.substring(4)
    return tagId.indexOf(':') >= 0 ? s : null
  }

  return null
}

function tfToBuffSpec(defaultEffectId, raw) {
  if (raw == null) return null

  // Compact number form: { "minecraft:speed": 200 }
  if (!tfIsJavaMap(raw) && typeof raw !== 'object') {
    var compactN = Number(raw)
    if (isFinite(compactN) && typeof defaultEffectId === 'string' && defaultEffectId.indexOf(':') >= 0) {
      return {
        effect: defaultEffectId,
        duration: tfClampInt(compactN, 1, 200),
        amplifier: 0,
        chance: 1
      }
    }
  }

  var rawEffect = tfFirstDefined(tfGetField(raw, 'effect', null), defaultEffectId)
  var effectId = rawEffect == null ? '' : String(rawEffect)
  if (effectId.indexOf(':') < 0) return null

  var duration = tfClampInt(
    tfFirstDefined(tfGetField(raw, 'duration', null), tfGetField(raw, 'ticks', null), tfGetField(raw, 'time', null)),
    1,
    200
  )
  var amplifier = tfClampInt(
    tfFirstDefined(tfGetField(raw, 'amplifier', null), tfGetField(raw, 'level', null), tfGetField(raw, 'lvl', null)),
    0,
    0
  )
  var chance = tfClampChance(
    tfFirstDefined(tfGetField(raw, 'chance', null), tfGetField(raw, 'probability', null), tfGetField(raw, 'odds', null), 1)
  )

  return {
    effect: effectId,
    duration: duration,
    amplifier: amplifier,
    chance: chance
  }
}

function tfNormalizeAssignedBuffs(assignedBuffs) {
  var specs = []
  var entries = tfObjectEntries(assignedBuffs)
  for (var i = 0; i < entries.length; i++) {
    var pair = entries[i]
    var key = pair[0]
    var raw = pair[1]
    var guessedEffect = key.indexOf(':') >= 0 ? key : null
    var spec = tfToBuffSpec(guessedEffect, raw)
    if (spec) specs.push(spec)
  }
  return specs
}

function tfMergeBestSpec(targetMap, incomingSpec) {
  var effect = incomingSpec.effect
  var current = targetMap[effect]
  if (!current) {
    targetMap[effect] = incomingSpec
    return
  }

  // Multiple sources of same effect: max power, then max duration, then max chance.
  if (incomingSpec.amplifier > current.amplifier) {
    targetMap[effect] = incomingSpec
    return
  }
  if (incomingSpec.amplifier < current.amplifier) return

  if (incomingSpec.duration > current.duration) {
    targetMap[effect] = incomingSpec
    return
  }
  if (incomingSpec.duration < current.duration) return

  if (incomingSpec.chance > current.chance) {
    targetMap[effect] = incomingSpec
  }
}

function tfMergeBuffMaps(targetMap, sourceMap) {
  for (var effect in sourceMap) {
    if (!Object.prototype.hasOwnProperty.call(sourceMap, effect)) continue
    tfMergeBestSpec(targetMap, sourceMap[effect])
  }
}

function tfReadNode(nodeId) {
  if (Object.prototype.hasOwnProperty.call(TF_NODE_CACHE, nodeId)) {
    return TF_NODE_CACHE[nodeId]
  }

  var fileName = tfNodeFilename(nodeId)

  for (var i = 0; i < TF_NODE_DIR_CANDIDATES.length; i++) {
    var baseDir = TF_NODE_DIR_CANDIDATES[i]
    var readPath = baseDir + '/' + fileName
    try {
      var rawNode = JsonIO.read(readPath)
      if (rawNode == null) continue

      TF_ACTIVE_NODE_DIR = baseDir

      var enabled = tfGetField(rawNode, 'enabled', true)
      if (enabled === false) {
        TF_NODE_CACHE[nodeId] = null
        return null
      }

      var resolvedId = String(tfGetField(rawNode, 'id', nodeId))
      if (resolvedId.length === 0) resolvedId = nodeId

      var node = {
        id: resolvedId,
        direct_ingredients: tfToArray(tfGetField(rawNode, 'direct_ingredients', [])),
        assigned_buffs: tfGetField(rawNode, 'assigned_buffs', {})
      }

      TF_NODE_CACHE[nodeId] = node
      return node
    } catch (e) {
      // Try next candidate path
    }
  }

  TF_NODE_CACHE[nodeId] = null
  return null
}

function tfResolveEffectiveBuffMap(nodeId, visiting) {
  if (Object.prototype.hasOwnProperty.call(TF_BUFF_CACHE, nodeId)) {
    return TF_BUFF_CACHE[nodeId]
  }

  if (visiting[nodeId]) return {}
  visiting[nodeId] = true

  var node = tfReadNode(nodeId)
  var merged = {}

  if (node) {
    var ownSpecs = tfNormalizeAssignedBuffs(node.assigned_buffs)
    for (var i = 0; i < ownSpecs.length; i++) {
      tfMergeBestSpec(merged, ownSpecs[i])
    }

    for (var j = 0; j < node.direct_ingredients.length; j++) {
      var childId = tfTokenToNodeId(node.direct_ingredients[j])
      if (!childId) continue
      tfMergeBuffMaps(merged, tfResolveEffectiveBuffMap(childId, visiting))
    }
  }

  delete visiting[nodeId]
  TF_BUFF_CACHE[nodeId] = merged
  return merged
}

function tfLoadNodeIdsFromManifest() {
  for (var i = 0; i < TF_NODE_IDS_CANDIDATES.length; i++) {
    var manifestPath = TF_NODE_IDS_CANDIDATES[i]
    try {
      var payloadObj = JsonIO.read(manifestPath)
      if (payloadObj == null) continue

      var rawNodeIds = tfToArray(tfGetField(payloadObj, 'node_ids', []))
      var ids = []
      for (var j = 0; j < rawNodeIds.length; j++) {
        var s = String(rawNodeIds[j])
        if (s.length > 0) ids.push(s)
      }

      if (ids.length > 0) {
        return ids
      }
    } catch (e) {
      console.info('[Timeglass Foods] Manifest read failed path=' + manifestPath + ' err=' + String(e))
    }
  }
  return []
}

function tfBuildFallbackNodeIds() {
  var ids = []
  var allItemIds = Ingredient.of('*').itemIds
  for (var i = 0; i < allItemIds.length; i++) {
    var itemId = allItemIds[i]
    try {
      if (Item.of(itemId).isEdible()) ids.push(String(itemId))
    } catch (e) {
      // Skip odd registry entries
    }
  }
  return ids
}

function tfInitTagRules(nodeIds) {
  var enabledTags = 0
  var badTags = 0

  for (var i = 0; i < nodeIds.length; i++) {
    var nodeId = nodeIds[i]
    if (nodeId.indexOf('tag:') !== 0) continue

    var node = tfReadNode(nodeId)
    if (!node) continue

    var tagId = nodeId.substring(4)
    if (tagId.indexOf(':') < 0) {
      badTags++
      continue
    }

    try {
      TF_TAG_RULES.push({ id: nodeId, ingredient: Ingredient.of('#' + tagId) })
      enabledTags++
    } catch (e) {
      badTags++
    }
  }

  return { enabledTags: enabledTags, badTags: badTags }
}

function tfCountKeys(obj) {
  var n = 0
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) n++
  }
  return n
}

function tfInitRegistry() {
  var nodeIds = tfLoadNodeIdsFromManifest()
  var source = 'manifest'
  if (nodeIds.length === 0) {
    nodeIds = tfBuildFallbackNodeIds()
    source = 'fallback'
  }

  var tagInit = tfInitTagRules(nodeIds)
  var breadPreview = tfCountKeys(tfResolveEffectiveBuffMap('minecraft:bread', {}))
  var sweetRollPreview = tfCountKeys(tfResolveEffectiveBuffMap('create:sweet_roll', {}))

  console.info(
    '[Timeglass Foods] Node index source=' + source +
    ' ids=' + nodeIds.length +
    ' tag_rules=' + tagInit.enabledTags +
    ' bad_tags=' + tagInit.badTags
  )
  console.info(
    '[Timeglass Foods] Preview buffs bread=' + breadPreview +
    ' sweet_roll=' + sweetRollPreview +
    ' node_dir=' + TF_ACTIVE_NODE_DIR
  )
}

function tfApplyBuffMap(player, buffMap) {
  for (var effect in buffMap) {
    if (!Object.prototype.hasOwnProperty.call(buffMap, effect)) continue
    var spec = buffMap[effect]
    if (spec.chance < 1 && Math.random() > spec.chance) continue
    player.potionEffects.add(spec.effect, spec.duration, spec.amplifier)
  }
}

tfInitRegistry()

ItemEvents.foodEaten(function (event) {
  var itemId = String(event.item.id)
  var merged = {}

  tfMergeBuffMaps(merged, tfResolveEffectiveBuffMap(itemId, {}))
  for (var i = 0; i < TF_TAG_RULES.length; i++) {
    var tagRule = TF_TAG_RULES[i]
    if (!tagRule.ingredient.test(event.item)) continue
    tfMergeBuffMaps(merged, tfResolveEffectiveBuffMap(tagRule.id, {}))
  }

  tfApplyBuffMap(event.player, merged)
})
