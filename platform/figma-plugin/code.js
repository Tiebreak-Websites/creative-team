// Creative Tools — Figma plugin (main thread).
// Receives `figma_ops` from the UI (fetched from the local platform backend)
// and writes them onto the canvas. Op vocabulary (kept in sync with the
// backend tools): create_text, duplicate_page.

figma.showUI(__html__, { width: 340, height: 460, themeColors: true })
figma.ui.postMessage({ type: 'file', fileKey: figma.fileKey || '' })

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'apply') {
    try {
      const result = await applyOps(msg.ops || [])
      figma.ui.postMessage({ type: 'done', applied: result.applied, skipped: result.skipped })
      figma.notify('Applied ' + result.applied + ' operation(s) to the canvas')
    } catch (e) {
      const m = (e && e.message) ? e.message : String(e)
      figma.ui.postMessage({ type: 'error', message: m })
      figma.notify('Error: ' + m, { error: true })
    }
  } else if (msg.type === 'close') {
    figma.closePlugin()
  }
}

async function applyOps(ops) {
  let applied = 0
  let skipped = 0
  for (const op of ops) {
    if (op && op.op === 'create_text') {
      await createText(op)
      applied++
    } else if (op && op.op === 'duplicate_page') {
      await duplicatePage(op)
      applied++
    } else {
      skipped++
    }
  }
  return { applied, skipped }
}

function hexToRgb(hex) {
  const h = String(hex || '#111111').replace('#', '')
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.padEnd(6, '0').slice(0, 6)
  return {
    r: parseInt(n.slice(0, 2), 16) / 255,
    g: parseInt(n.slice(2, 4), 16) / 255,
    b: parseInt(n.slice(4, 6), 16) / 255,
  }
}

// Load a usable default font (Inter, falling back to Roboto). Returns the font.
async function loadDefaultFont() {
  try {
    const f = { family: 'Inter', style: 'Regular' }
    await figma.loadFontAsync(f)
    return f
  } catch (e) {
    const f = { family: 'Roboto', style: 'Regular' }
    await figma.loadFontAsync(f)
    return f
  }
}

async function createText(op) {
  const font = await loadDefaultFont()
  const node = figma.createText()
  node.fontName = font
  node.fontSize = op.fontSize || 16
  node.characters = op.text || ''
  if (op.name) node.name = op.name
  if (typeof op.x === 'number') node.x = op.x
  if (typeof op.y === 'number') node.y = op.y
  if (op.width) {
    node.textAutoResize = 'HEIGHT'
    node.resize(op.width, node.height)
  }
  if (op.color) node.fills = [{ type: 'SOLID', color: hexToRgb(op.color) }]
  figma.currentPage.appendChild(node)
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
}

// Load every font used by a text node so its characters can be edited.
async function loadFontsForText(node) {
  const len = node.characters.length
  if (node.fontName === figma.mixed) {
    const seen = {}
    for (let i = 0; i < len; i++) {
      const f = node.getRangeFontName(i, i + 1)
      const key = f.family + '|' + f.style
      if (!seen[key]) {
        seen[key] = true
        await figma.loadFontAsync(f)
      }
    }
  } else {
    await figma.loadFontAsync(node.fontName)
  }
}

// Walk an original subtree and its clone in lockstep, mapping original node id
// -> cloned node (clone preserves child order, so parallel traversal is safe).
function pairTree(orig, clone, map) {
  map[orig.id] = clone
  if ('children' in orig && 'children' in clone) {
    const a = orig.children
    const b = clone.children
    for (let i = 0; i < a.length && i < b.length; i++) pairTree(a[i], b[i], map)
  }
}

async function duplicatePage(op) {
  const pages = figma.root.children
  let src = null
  for (const p of pages) {
    if (p.name === op.sourcePageName) { src = p; break }
  }
  if (!src) src = figma.currentPage

  const newPage = figma.createPage()
  newPage.name = op.newPageName || (src.name + ' — copy')

  const map = {}
  for (const child of src.children) {
    const clone = child.clone()
    newPage.appendChild(clone)
    pairTree(child, clone, map)
  }

  const reps = op.replacements || {}
  for (const origId in reps) {
    const node = map[origId]
    if (node && node.type === 'TEXT') {
      await loadFontsForText(node)
      node.characters = String(reps[origId])
    }
  }

  figma.currentPage = newPage
}
