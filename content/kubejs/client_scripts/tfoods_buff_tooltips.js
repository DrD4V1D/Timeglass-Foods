// Timeglass Foods - client tooltip display for effective buffs.
// Rhino/ES5-safe.

var TT_NODE_DIR_CANDIDATES = [
  'kubejs/timeglass_registry/nodes',
  'timeglass_registry/nodes'
]
var TT_NODE_IDS_CANDIDATES = [
  'kubejs/timeglass_registry/node_ids.json',
  'timeglass_registry/node_ids.json'
]

var TT_NODE_CACHE = {}
var TT_BUFF_CACHE = {}
var TT_TAG_RULES = []
var TT_ACTIVE_NODE_DIR = TT_NODE_DIR_CANDIDATES[0]

function ttIsJavaList(value) {
  return value != null && typeof value.size === 'function' && typeof value.get === 'function'
}

function ttIsJavaMap(value) {
  return value != null && typeof value.get === 'function' && typeof value.keySet === 'function'
}

function ttGetField(obj, key, fallback) {
  if (obj == null) return fallback

  if (ttIsJavaMap(obj)) {
    var mapValue = obj.get(key)
    return mapValue === undefined || mapValue === null ? fallback : mapValue
  }

  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    var objValue = obj[key]
    return objValue === undefined ? fallback : objValue
  }

  return fallback
}

function ttToArray(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value

  if (ttIsJavaList(value)) {
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

function ttObjectEntries(value) {
  var entries = []
  if (value == null) return entries

  if (ttIsJavaMap(value)) {
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

function ttNormalizeNumber(value, fallback) {
  var n = Number(value)
  return typeof n === 'number' && isFinite(n) ? n : fallback
}

function ttClampInt(value, minValue, fallback) {
  var n = Math.floor(ttNormalizeNumber(value, fallback))
  return n < minValue ? minValue : n
}

function ttClampChance(value) {
  var n = ttNormalizeNumber(value, 1)
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function ttFirstDefined() {
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]
  }
  return undefined
}

function ttNodeFilename(nodeId) {
  return String(nodeId).replace(/\//g, '--').replace(/:/g, '__') + '.json'
}

function ttTokenToNodeId(token) {
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

function ttToBuffSpec(defaultEffectId, raw) {
  if (raw == null) return null

  if (!ttIsJavaMap(raw) && typeof raw !== 'object') {
    var compactN = Number(raw)
    if (isFinite(compactN) && typeof defaultEffectId === 'string' && defaultEffectId.indexOf(':') >= 0) {
      return {
        effect: defaultEffectId,
        duration: ttClampInt(compactN, 1, 200),
        amplifier: 0,
        chance: 1
      }
    }
  }

  var rawEffect = ttFirstDefined(ttGetField(raw, 'effect', null), defaultEffectId)
  var effectId = rawEffect == null ? '' : String(rawEffect)
  if (effectId.indexOf(':') < 0) return null

  var duration = ttClampInt(
    ttFirstDefined(ttGetField(raw, 'duration', null), ttGetField(raw, 'ticks', null), ttGetField(raw, 'time', null)),
    1,
    200
  )
  var amplifier = ttClampInt(
    ttFirstDefined(ttGetField(raw, 'amplifier', null), ttGetField(raw, 'level', null), ttGetField(raw, 'lvl', null)),
    0,
    0
  )
  var chance = ttClampChance(
    ttFirstDefined(ttGetField(raw, 'chance', null), ttGetField(raw, 'probability', null), ttGetField(raw, 'odds', null), 1)
  )

  return {
    effect: effectId,
    duration: duration,
    amplifier: amplifier,
    chance: chance
  }
}

function ttNormalizeAssignedBuffs(assignedBuffs) {
  var specs = []
  var entries = ttObjectEntries(assignedBuffs)
  for (var i = 0; i < entries.length; i++) {
    var pair = entries[i]
    var key = pair[0]
    var raw = pair[1]
    var guessedEffect = key.indexOf(':') >= 0 ? key : null
    var spec = ttToBuffSpec(guessedEffect, raw)
    if (spec) specs.push(spec)
  }
  return specs
}

function ttMergeBestSpec(targetMap, incomingSpec) {
  var effect = incomingSpec.effect
  var current = targetMap[effect]
  if (!current) {
    targetMap[effect] = incomingSpec
    return
  }

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

function ttMergeBuffMaps(targetMap, sourceMap) {
  for (var effect in sourceMap) {
    if (!Object.prototype.hasOwnProperty.call(sourceMap, effect)) continue
    ttMergeBestSpec(targetMap, sourceMap[effect])
  }
}

function ttReadNode(nodeId) {
  if (Object.prototype.hasOwnProperty.call(TT_NODE_CACHE, nodeId)) {
    return TT_NODE_CACHE[nodeId]
  }

  var fileName = ttNodeFilename(nodeId)
  for (var i = 0; i < TT_NODE_DIR_CANDIDATES.length; i++) {
    var baseDir = TT_NODE_DIR_CANDIDATES[i]
    var readPath = baseDir + '/' + fileName
    try {
      var rawNode = JsonIO.read(readPath)
      if (rawNode == null) continue

      TT_ACTIVE_NODE_DIR = baseDir

      var enabled = ttGetField(rawNode, 'enabled', true)
      if (enabled === false) {
        TT_NODE_CACHE[nodeId] = null
        return null
      }

      var resolvedId = String(ttGetField(rawNode, 'id', nodeId))
      if (resolvedId.length === 0) resolvedId = nodeId

      var node = {
        id: resolvedId,
        direct_ingredients: ttToArray(ttGetField(rawNode, 'direct_ingredients', [])),
        assigned_buffs: ttGetField(rawNode, 'assigned_buffs', {})
      }

      TT_NODE_CACHE[nodeId] = node
      return node
    } catch (e) {
      // try next candidate path
    }
  }

  TT_NODE_CACHE[nodeId] = null
  return null
}

function ttResolveEffectiveBuffMap(nodeId, visiting) {
  if (Object.prototype.hasOwnProperty.call(TT_BUFF_CACHE, nodeId)) {
    return TT_BUFF_CACHE[nodeId]
  }

  if (visiting[nodeId]) return {}
  visiting[nodeId] = true

  var node = ttReadNode(nodeId)
  var merged = {}

  if (node) {
    var ownSpecs = ttNormalizeAssignedBuffs(node.assigned_buffs)
    for (var i = 0; i < ownSpecs.length; i++) {
      ttMergeBestSpec(merged, ownSpecs[i])
    }

    for (var j = 0; j < node.direct_ingredients.length; j++) {
      var childId = ttTokenToNodeId(node.direct_ingredients[j])
      if (!childId) continue
      ttMergeBuffMaps(merged, ttResolveEffectiveBuffMap(childId, visiting))
    }
  }

  delete visiting[nodeId]
  TT_BUFF_CACHE[nodeId] = merged
  return merged
}

function ttLoadNodeIdsFromManifest() {
  for (var i = 0; i < TT_NODE_IDS_CANDIDATES.length; i++) {
    var manifestPath = TT_NODE_IDS_CANDIDATES[i]
    try {
      var payloadObj = JsonIO.read(manifestPath)
      if (payloadObj == null) continue

      var rawNodeIds = ttToArray(ttGetField(payloadObj, 'node_ids', []))
      var ids = []
      for (var j = 0; j < rawNodeIds.length; j++) {
        var s = String(rawNodeIds[j])
        if (s.length > 0) ids.push(s)
      }

      if (ids.length > 0) return ids
    } catch (e) {
      // keep silent on client
    }
  }
  return []
}

function ttBuildFallbackNodeIds() {
  var ids = []
  var allItemIds = Ingredient.of('*').itemIds
  for (var i = 0; i < allItemIds.length; i++) {
    var itemId = allItemIds[i]
    try {
      if (Item.of(itemId).isEdible()) ids.push(String(itemId))
    } catch (e) {
      // skip odd registry entries
    }
  }
  return ids
}

function ttInitTagRules(nodeIds) {
  var enabledTags = 0
  for (var i = 0; i < nodeIds.length; i++) {
    var nodeId = nodeIds[i]
    if (nodeId.indexOf('tag:') !== 0) continue

    var node = ttReadNode(nodeId)
    if (!node) continue

    var tagId = nodeId.substring(4)
    if (tagId.indexOf(':') < 0) continue

    try {
      TT_TAG_RULES.push({ id: nodeId, ingredient: Ingredient.of('#' + tagId) })
      enabledTags++
    } catch (e) {
      // skip bad tags
    }
  }
  return enabledTags
}

function ttCountKeys(obj) {
  var n = 0
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) n++
  }
  return n
}

function ttTitleCaseWords(s) {
  var words = s.split('_')
  for (var i = 0; i < words.length; i++) {
    var w = words[i]
    if (w.length === 0) continue
    words[i] = w.charAt(0).toUpperCase() + w.substring(1)
  }
  return words.join(' ')
}

function ttRoman(num) {
  var n = Math.floor(num)
  if (n <= 0) return '0'
  var map = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ]
  var out = ''
  for (var i = 0; i < map.length; i++) {
    while (n >= map[i][0]) {
      out += map[i][1]
      n -= map[i][0]
    }
  }
  return out
}

function ttEffectLabel(effectId) {
  var parts = String(effectId).split(':')
  if (parts.length !== 2) return String(effectId)
  var ns = parts[0]
  var path = parts[1]
  var label = ttTitleCaseWords(path)
  return ns === 'minecraft' ? label : label + ' (' + ns + ')'
}

function ttSecondsLabel(ticks) {
  var sec = ticks / 20.0
  if (Math.floor(sec) === sec) return String(sec) + 's'
  return String(Math.round(sec * 10) / 10) + 's'
}

function ttFormatBuffLine(spec) {
  var lvl = spec.amplifier + 1
  var line = '- ' + ttEffectLabel(spec.effect)
  if (lvl > 1) {
    line += ' ' + ttRoman(lvl)
  }
  line += ' (' + ttSecondsLabel(spec.duration)
  if (spec.chance < 1) {
    line += ', ' + Math.round(spec.chance * 100) + '%'
  }
  line += ')'
  return line
}

function ttSortedKeys(map) {
  var keys = []
  for (var k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k)) keys.push(k)
  }
  keys.sort()
  return keys
}

function ttBuildEffectiveMapForItem(itemStack) {
  var merged = {}
  var itemId = String(itemStack.id)

  ttMergeBuffMaps(merged, ttResolveEffectiveBuffMap(itemId, {}))
  for (var i = 0; i < TT_TAG_RULES.length; i++) {
    var tagRule = TT_TAG_RULES[i]
    if (!tagRule.ingredient.test(itemStack)) continue
    ttMergeBuffMaps(merged, ttResolveEffectiveBuffMap(tagRule.id, {}))
  }

  return merged
}

function ttInitRegistry() {
  var nodeIds = ttLoadNodeIdsFromManifest()
  var source = 'manifest'
  if (nodeIds.length === 0) {
    nodeIds = ttBuildFallbackNodeIds()
    source = 'fallback'
  }

  var tagRules = ttInitTagRules(nodeIds)
  console.info(
    '[Timeglass Foods] Tooltip index source=' + source +
    ' ids=' + nodeIds.length +
    ' tag_rules=' + tagRules +
    ' node_dir=' + TT_ACTIVE_NODE_DIR
  )
}

ttInitRegistry()

ItemEvents.tooltip(function (event) {
  event.addAdvanced('*', function (item, advanced, text) {
    var buffMap = ttBuildEffectiveMapForItem(item)
    if (ttCountKeys(buffMap) === 0) return

    text.add('Timeglass Buffs:')
    var keys = ttSortedKeys(buffMap)
    for (var i = 0; i < keys.length; i++) {
      var spec = buffMap[keys[i]]
      text.add(ttFormatBuffLine(spec))
    }
  })
})
