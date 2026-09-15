import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PALETTE,
  THEME_PALETTES,
  parsePalette,
  parseTheme,
} from '../src/hooks/useTheme.ts'

test('parseTheme: 正确解析合法模式并在非法输入时回退到 system', () => {
  assert.equal(parseTheme('light'), 'light')
  assert.equal(parseTheme('dark'), 'dark')
  assert.equal(parseTheme('system'), 'system')
  assert.equal(parseTheme('unknown'), 'system')
  assert.equal(parseTheme(''), 'system')
  assert.equal(parseTheme(null), 'system')
  assert.equal(parseTheme(undefined), 'system')
  assert.equal(parseTheme(123), 'system')
  assert.equal(parseTheme({}), 'system')
})

test('parsePalette: 正确解析全部 6 种预设调色板并在非法输入时回退到默认调色板', () => {
  const expectedPalettes = [
    'indigo-slate',
    'ocean-azure',
    'obsidian-luxe',
    'cyber-violet',
    'emerald-matrix',
    'warm-amber',
  ]

  assert.equal(THEME_PALETTES.length, 6)
  assert.deepEqual(
    THEME_PALETTES.map((p) => p.id),
    expectedPalettes
  )

  for (const id of expectedPalettes) {
    assert.equal(parsePalette(id), id)
  }

  assert.equal(DEFAULT_PALETTE, 'indigo-slate')
  assert.equal(parsePalette('non-existent-theme'), DEFAULT_PALETTE)
  assert.equal(parsePalette(''), DEFAULT_PALETTE)
  assert.equal(parsePalette(null), DEFAULT_PALETTE)
  assert.equal(parsePalette(undefined), DEFAULT_PALETTE)
  assert.equal(parsePalette(42), DEFAULT_PALETTE)
})

test('THEME_PALETTES: 元数据完整性校验', () => {
  for (const meta of THEME_PALETTES) {
    assert.ok(meta.id.length > 0)
    assert.ok(meta.name.length > 0)
    assert.ok(meta.englishName.length > 0)
    assert.ok(meta.description.length > 0)
    assert.ok(meta.primaryColor.startsWith('#'))
    assert.ok(meta.tag.length > 0)
  }
})

